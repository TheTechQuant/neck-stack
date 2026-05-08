package dash

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Health reports whether NECK Dash is serving requests.
//
//encore:api public method=GET path=/health
func Health(ctx context.Context) (*HealthResponse, error) {
	return &HealthResponse{OK: true}, nil
}

// ListTraces returns recent traces from VictoriaTraces through its Jaeger API.
//
//encore:api public method=GET path=/traces
func ListTraces(ctx context.Context, params *TraceListParams) (*TraceListResponse, error) {
	limit := params.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	services := []string{params.Service}
	if params.Service == "" {
		discovered, err := listServices(ctx)
		if err == nil {
			services = discovered
		}
		if len(services) > 8 {
			services = services[:8]
		}
	}

	seen := make(map[string]bool)
	var traces []TraceSummary
	for _, service := range services {
		if service == "" {
			continue
		}
		got, err := queryJaegerTraces(ctx, service, limit)
		if err != nil {
			return nil, err
		}
		for _, trace := range got {
			if params.Search != "" && !strings.Contains(trace.TraceID+trace.Service+trace.Endpoint, params.Search) {
				continue
			}
			if !seen[trace.TraceID] {
				seen[trace.TraceID] = true
				traces = append(traces, trace)
			}
		}
	}
	sort.Slice(traces, func(i, j int) bool { return traces[i].StartedAt > traces[j].StartedAt })
	if len(traces) > limit {
		traces = traces[:limit]
	}
	return &TraceListResponse{Traces: traces}, nil
}

// GetTrace returns a raw Jaeger trace payload from VictoriaTraces.
//
//encore:api public method=GET path=/traces/:traceID
func GetTrace(ctx context.Context, traceID string) (*TraceDetailResponse, error) {
	var raw json.RawMessage
	if err := getJSON(ctx, victoriaTracesQueryURL()+"/api/traces/"+url.PathEscape(traceID), &raw); err != nil {
		return nil, err
	}
	return &TraceDetailResponse{TraceID: traceID, RawJSON: string(raw)}, nil
}

// MetricsSummary returns Encore runtime RED metrics and trace-derived latency data.
//
//encore:api public method=GET path=/metrics/summary
func MetricsSummary(ctx context.Context, params *MetricsParams) (*MetricsResponse, error) {
	hours := params.Hours
	if hours <= 0 || hours > 720 {
		hours = 24
	}
	source := "runtime"
	counts, _ := queryMetric(ctx, fmt.Sprintf(`sum by (service,endpoint) (increase(e_requests_total[%dh]))`, hours))
	errorsByEndpoint, _ := queryMetric(ctx, fmt.Sprintf(`sum by (service,endpoint) (increase(e_requests_total{code!="ok"}[%dh]))`, hours))
	if len(counts) == 0 {
		source = "trace"
		counts, _ = queryMetric(ctx, fmt.Sprintf(`sum by (service,endpoint) (increase(neckdash_trace_requests_total[%dh]))`, hours))
		errorsByEndpoint, _ = queryMetric(ctx, fmt.Sprintf(`sum by (service,endpoint) (increase(neckdash_trace_errors_total[%dh]))`, hours))
	}
	avg, _ := queryMetric(ctx, `avg by (service,endpoint) (neckdash_trace_request_duration_seconds)`)
	runtime, _ := runtimeMetrics(ctx)

	merged := make(map[string]ServiceMetric)
	for key, value := range counts {
		service, endpoint := splitMetricKey(key)
		metric := merged[key]
		metric.Service = service
		metric.Endpoint = endpoint
		metric.TraceCount = value
		metric.Source = source
		merged[key] = metric
	}
	for key, value := range errorsByEndpoint {
		metric := merged[key]
		metric.ErrorCount = value
		merged[key] = metric
	}
	for key, value := range avg {
		metric := merged[key]
		metric.AvgDurationMS = value * 1000
		if metric.Source == "" {
			metric.Source = "trace"
		}
		merged[key] = metric
	}
	var services []ServiceMetric
	for _, metric := range merged {
		services = append(services, metric)
	}
	sort.Slice(services, func(i, j int) bool { return services[i].TraceCount > services[j].TraceCount })
	return &MetricsResponse{WindowHours: hours, Services: services, Runtime: runtime}, nil
}

// CustomMetrics returns app-defined Encore metrics exported through Prometheus remote write.
//
//encore:api public method=GET path=/metrics/custom
func CustomMetrics(ctx context.Context, params *MetricsParams) (*CustomMetricsResponse, error) {
	hours := params.Hours
	if hours <= 0 || hours > 720 {
		hours = 24
	}
	definitions, err := metricDefinitions()
	if err != nil {
		return nil, err
	}

	var samples []MetricSample
	for _, def := range definitions {
		if !validMetricName(def.Name) {
			continue
		}
		latest, err := queryVector(ctx, fmt.Sprintf(`last_over_time(%s[%dh])`, def.Name, hours))
		if err != nil {
			continue
		}
		windowValues := make(map[string]float64)
		if def.Kind == "counter" {
			window, err := queryVector(ctx, fmt.Sprintf(`increase(%s[%dh])`, def.Name, hours))
			if err == nil {
				for _, item := range window {
					windowValues[labelsKey(item.Labels)] = item.Value
				}
			}
		}
		for _, item := range latest {
			serviceName := valueOr(item.Labels["service_id"], def.ServiceName)
			sample := MetricSample{
				Name:        def.Name,
				Kind:        def.Kind,
				ServiceName: serviceName,
				Labels:      publicMetricLabels(item.Labels),
				Value:       item.Value,
				WindowValue: item.Value,
				Timestamp:   item.Timestamp.UTC().Format(time.RFC3339Nano),
			}
			if def.Kind == "counter" {
				sample.WindowValue = windowValues[labelsKey(item.Labels)]
			}
			samples = append(samples, sample)
		}
	}
	sort.Slice(samples, func(i, j int) bool {
		if samples[i].Name == samples[j].Name {
			return samples[i].ServiceName < samples[j].ServiceName
		}
		return samples[i].Name < samples[j].Name
	})
	return &CustomMetricsResponse{WindowHours: hours, Definitions: definitions, Samples: samples}, nil
}

// Flow returns VictoriaTraces service dependency data.
//
//encore:api public method=GET path=/flow
func Flow(ctx context.Context) (*FlowResponse, error) {
	end := time.Now().UnixMilli()
	var raw struct {
		Data []struct {
			Parent    string `json:"parent"`
			Child     string `json:"child"`
			CallCount int64  `json:"callCount"`
		} `json:"data"`
	}
	endpoint := fmt.Sprintf("%s/api/dependencies?endTs=%d&lookback=%d", victoriaTracesQueryURL(), end, int64(time.Hour/time.Millisecond))
	_ = getJSON(ctx, endpoint, &raw)

	nodes, edges := catalogFlow()
	seenNodes := make(map[string]bool)
	for _, node := range nodes {
		seenNodes[node.ID] = true
	}
	for _, edge := range raw.Data {
		if edge.Parent == "" || edge.Child == "" {
			continue
		}
		if !seenNodes[edge.Parent] {
			nodes = append(nodes, FlowNode{ID: edge.Parent, Kind: "service", Name: edge.Parent})
			seenNodes[edge.Parent] = true
		}
		if !seenNodes[edge.Child] {
			nodes = append(nodes, FlowNode{ID: edge.Child, Kind: "service", Name: edge.Child})
			seenNodes[edge.Child] = true
		}
		edges = append(edges, FlowEdge{Source: edge.Parent, Target: edge.Child, Kind: "observed", Count: edge.CallCount})
	}
	return &FlowResponse{Nodes: nodes, Edges: edges}, nil
}

// Catalog returns generated Encore metadata and OpenAPI JSON mounted by the deployed app.
//
//encore:api public method=GET path=/catalog
func Catalog(ctx context.Context) (*CatalogResponse, error) {
	meta, _ := os.ReadFile(env("NECKDASH_META_PATH", "/catalog/meta.json"))
	openapi, _ := os.ReadFile(env("NECKDASH_OPENAPI_PATH", "/catalog/openapi.json"))
	return &CatalogResponse{MetaJSON: string(meta), OpenAPIJSON: string(openapi)}, nil
}

// GetSampling documents how sampling is applied for self-hosted deployments.
//
//encore:api public method=GET path=/settings/sampling
func GetSampling(ctx context.Context) (*SamplingResponse, error) {
	rate, err := strconv.ParseFloat(env("NECK_TRACE_SAMPLE_RATE", "1"), 64)
	if err != nil || rate < 0 || rate > 1 {
		rate = 1
	}
	return &SamplingResponse{
		Rules: []SamplingRule{{
			ScopeType:  "default",
			ScopeValue: "",
			Rate:       rate,
		}},
		RuntimeNote: "Sampling is enforced by deploy/encore/runtime.prod.pb. Change NECK_TRACE_SAMPLE_RATE, run pnpm infra:encore, rebuild the backend image, and redeploy.",
	}, nil
}

func listServices(ctx context.Context) ([]string, error) {
	var raw struct {
		Data []string `json:"data"`
	}
	if err := getJSON(ctx, victoriaTracesQueryURL()+"/api/services", &raw); err != nil {
		return nil, err
	}
	sort.Strings(raw.Data)
	return raw.Data, nil
}

func queryJaegerTraces(ctx context.Context, service string, limit int) ([]TraceSummary, error) {
	endpoint := victoriaTracesQueryURL() + "/api/traces?service=" + url.QueryEscape(service) + "&limit=" + strconv.Itoa(limit)
	var raw struct {
		Data []jaegerTrace `json:"data"`
	}
	if err := getJSON(ctx, endpoint, &raw); err != nil {
		return nil, err
	}
	out := make([]TraceSummary, 0, len(raw.Data))
	for _, trace := range raw.Data {
		out = append(out, summarizeJaegerTrace(trace))
	}
	return out, nil
}

func getJSON(ctx context.Context, endpoint string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("GET %s failed with HTTP %d", endpoint, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func summarizeJaegerTrace(trace jaegerTrace) TraceSummary {
	summary := TraceSummary{TraceID: trace.TraceID, SpanCount: len(trace.Spans)}
	if len(trace.Spans) == 0 {
		return summary
	}
	root := trace.Spans[0]
	for _, span := range trace.Spans {
		if len(span.References) == 0 {
			root = span
			break
		}
	}
	process := trace.Processes[root.ProcessID]
	summary.Service = process.ServiceName
	summary.Endpoint = root.OperationName
	summary.StartedAt = time.UnixMicro(root.StartTime).UTC().Format(time.RFC3339Nano)
	summary.DurationMS = float64(root.Duration) / 1000
	for _, tag := range root.Tags {
		if tag.Key == "encore.env_id" {
			summary.Environment = fmt.Sprint(tag.Value)
		}
		if tag.Key == "http.status_code" || tag.Key == "http.response.status_code" {
			if value, ok := numericTag(tag.Value); ok {
				summary.StatusCode = int(value)
			}
		}
		if tag.Key == "error" && fmt.Sprint(tag.Value) == "true" {
			summary.Error = true
		}
	}
	return summary
}

type jaegerTrace struct {
	TraceID   string                   `json:"traceID"`
	Spans     []jaegerSpan             `json:"spans"`
	Processes map[string]jaegerProcess `json:"processes"`
}

type jaegerSpan struct {
	ProcessID     string            `json:"processID"`
	OperationName string            `json:"operationName"`
	StartTime     int64             `json:"startTime"`
	Duration      int64             `json:"duration"`
	Tags          []jaegerKeyValue  `json:"tags"`
	References    []json.RawMessage `json:"references"`
}

type jaegerProcess struct {
	ServiceName string `json:"serviceName"`
}

type jaegerKeyValue struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

type metricVector struct {
	Labels    map[string]string
	Value     float64
	Timestamp time.Time
}

type metricDefinitionRaw struct {
	Name        string `json:"name"`
	Kind        any    `json:"kind"`
	Doc         string `json:"doc"`
	ServiceName string `json:"service_name"`
	Labels      []struct {
		Key string `json:"key"`
		Doc string `json:"doc"`
	} `json:"labels"`
}

func numericTag(value interface{}) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func queryMetric(ctx context.Context, query string) (map[string]float64, error) {
	results, err := queryVector(ctx, query)
	if err != nil {
		return nil, err
	}
	out := make(map[string]float64)
	for _, result := range results {
		out[result.Labels["service"]+"\x00"+result.Labels["endpoint"]] = result.Value
	}
	return out, nil
}

func queryVector(ctx context.Context, query string) ([]metricVector, error) {
	endpoint := victoriaMetricsQueryURL() + "?query=" + url.QueryEscape(query)
	var raw struct {
		Data struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Value  []interface{}     `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := getJSON(ctx, endpoint, &raw); err != nil {
		return nil, err
	}
	out := make([]metricVector, 0, len(raw.Data.Result))
	for _, result := range raw.Data.Result {
		value := 0.0
		var ts time.Time
		if len(result.Value) >= 2 {
			if unixSeconds, ok := numericTag(result.Value[0]); ok {
				sec, frac := int64(unixSeconds), unixSeconds-float64(int64(unixSeconds))
				ts = time.Unix(sec, int64(frac*1e9))
			}
			value, _ = strconv.ParseFloat(fmt.Sprint(result.Value[1]), 64)
		}
		out = append(out, metricVector{Labels: result.Metric, Value: value, Timestamp: ts})
	}
	return out, nil
}

func runtimeMetrics(ctx context.Context) ([]MetricSample, error) {
	names := []struct {
		name string
		kind string
	}{
		{"e_requests_total", "counter"},
		{"e_sys_memory_used_bytes", "gauge"},
	}
	var out []MetricSample
	for _, item := range names {
		results, err := queryVector(ctx, `last_over_time(`+item.name+`[1h])`)
		if err != nil {
			continue
		}
		for _, result := range results {
			out = append(out, MetricSample{
				Name:        item.name,
				Kind:        item.kind,
				ServiceName: valueOr(result.Labels["service"], result.Labels["service_id"]),
				Labels:      publicMetricLabels(result.Labels),
				Value:       result.Value,
				WindowValue: result.Value,
				Timestamp:   result.Timestamp.UTC().Format(time.RFC3339Nano),
			})
		}
	}
	return out, nil
}

func splitMetricKey(key string) (string, string) {
	parts := strings.SplitN(key, "\x00", 2)
	if len(parts) != 2 {
		return key, ""
	}
	return parts[0], parts[1]
}

func metricDefinitions() ([]MetricDefinition, error) {
	data, err := os.ReadFile(env("NECKDASH_META_PATH", "/catalog/meta.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var raw struct {
		Metrics []metricDefinitionRaw `json:"metrics"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	definitions := make([]MetricDefinition, 0, len(raw.Metrics))
	for _, item := range raw.Metrics {
		def := MetricDefinition{
			Name:        item.Name,
			Kind:        metricKind(item.Kind),
			Doc:         item.Doc,
			ServiceName: item.ServiceName,
		}
		for _, label := range item.Labels {
			def.Labels = append(def.Labels, MetricLabel{Key: label.Key, Doc: label.Doc})
		}
		if def.Name != "" {
			definitions = append(definitions, def)
		}
	}
	sort.Slice(definitions, func(i, j int) bool { return definitions[i].Name < definitions[j].Name })
	return definitions, nil
}

func metricKind(value any) string {
	switch typed := value.(type) {
	case string:
		switch strings.ToLower(typed) {
		case "counter", "metric_counter", "0":
			return "counter"
		case "gauge", "metric_gauge", "1":
			return "gauge"
		case "histogram", "metric_histogram", "2":
			return "histogram"
		default:
			return strings.ToLower(typed)
		}
	case float64:
		switch int(typed) {
		case 1:
			return "gauge"
		case 2:
			return "histogram"
		default:
			return "counter"
		}
	default:
		return "counter"
	}
}

func validMetricName(value string) bool {
	if value == "" {
		return false
	}
	for i, ch := range value {
		ok := ch == '_' || ch == ':' || ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || i > 0 && ch >= '0' && ch <= '9'
		if !ok {
			return false
		}
	}
	return true
}

func labelsKey(labels map[string]string) string {
	keys := make([]string, 0, len(labels))
	for key := range labels {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, key := range keys {
		b.WriteString(key)
		b.WriteByte('=')
		b.WriteString(labels[key])
		b.WriteByte('\x00')
	}
	return b.String()
}

func publicMetricLabels(labels map[string]string) map[string]string {
	out := make(map[string]string, len(labels))
	for key, value := range labels {
		if key != "__name__" {
			out[key] = value
		}
	}
	return out
}

func catalogFlow() ([]FlowNode, []FlowEdge) {
	data, err := os.ReadFile(env("NECKDASH_META_PATH", "/catalog/meta.json"))
	if err != nil {
		return nil, nil
	}
	var meta struct {
		Svcs []struct {
			Name string `json:"name"`
		} `json:"svcs"`
		SQLDatabases []struct {
			Name string `json:"name"`
		} `json:"sql_databases"`
		CacheClusters []struct {
			Name      string `json:"name"`
			Keyspaces []struct {
				Service string `json:"service"`
			} `json:"keyspaces"`
		} `json:"cache_clusters"`
		PubSubTopics []struct {
			Name       string `json:"name"`
			Publishers []struct {
				ServiceName string `json:"service_name"`
			} `json:"publishers"`
			Subscriptions []struct {
				ServiceName string `json:"service_name"`
			} `json:"subscriptions"`
		} `json:"pubsub_topics"`
		Buckets []struct {
			Name string `json:"name"`
		} `json:"buckets"`
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, nil
	}
	seen := make(map[string]bool)
	var nodes []FlowNode
	addNode := func(id, kind, name string) {
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		nodes = append(nodes, FlowNode{ID: id, Kind: kind, Name: name})
	}
	var edges []FlowEdge
	for _, svc := range meta.Svcs {
		addNode(svc.Name, "service", svc.Name)
	}
	for _, database := range meta.SQLDatabases {
		addNode("db:"+database.Name, "database", database.Name)
	}
	for _, bucket := range meta.Buckets {
		addNode("bucket:"+bucket.Name, "bucket", bucket.Name)
	}
	for _, cache := range meta.CacheClusters {
		cacheID := "cache:" + cache.Name
		addNode(cacheID, "cache", cache.Name)
		for _, keyspace := range cache.Keyspaces {
			if keyspace.Service != "" {
				edges = append(edges, FlowEdge{Source: keyspace.Service, Target: cacheID, Kind: "cache", Count: 0})
			}
		}
	}
	for _, topic := range meta.PubSubTopics {
		topicID := "topic:" + topic.Name
		addNode(topicID, "topic", topic.Name)
		for _, publisher := range topic.Publishers {
			if publisher.ServiceName != "" {
				edges = append(edges, FlowEdge{Source: publisher.ServiceName, Target: topicID, Kind: "publish", Count: 0})
			}
		}
		for _, subscription := range topic.Subscriptions {
			if subscription.ServiceName != "" {
				edges = append(edges, FlowEdge{Source: topicID, Target: subscription.ServiceName, Kind: "subscribe", Count: 0})
			}
		}
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].Kind == nodes[j].Kind {
			return nodes[i].Name < nodes[j].Name
		}
		return nodes[i].Kind < nodes[j].Kind
	})
	return nodes, edges
}
