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
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	hours := params.Hours
	if hours <= 0 || hours > 168 {
		hours = 1
	}
	if looksLikeTraceID(params.Search) {
		trace, err := getJaegerTrace(ctx, params.Search)
		if err == nil && trace.TraceID != "" {
			return &TraceListResponse{Traces: []TraceSummary{summarizeJaegerTrace(trace)}}, nil
		}
	}
	services := []string{params.Service}
	if params.Service == "" {
		discovered, err := listServices(ctx)
		if err == nil {
			services = discovered
		}
		fanoutLimit := traceServiceFanoutLimit()
		if len(services) > fanoutLimit {
			services = services[:fanoutLimit]
		}
	}

	end := time.Now()
	start := end.Add(-time.Duration(hours) * time.Hour)
	seen := make(map[string]bool)
	var traces []TraceSummary
	for _, service := range services {
		if service == "" {
			continue
		}
		got, err := queryJaegerTraces(ctx, service, limit, start, end)
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

// ListTraceServices returns service names indexed by VictoriaTraces.
//
//encore:api public method=GET path=/traces/services
func ListTraceServices(ctx context.Context) (*TraceServicesResponse, error) {
	services, err := listServices(ctx)
	if err != nil {
		return nil, err
	}
	return &TraceServicesResponse{Services: services}, nil
}

// GetTrace returns a raw Jaeger trace payload from VictoriaTraces.
//
//encore:api public method=GET path=/traces/detail/:traceID
func GetTrace(ctx context.Context, traceID string) (*TraceDetailResponse, error) {
	var raw json.RawMessage
	if err := getJSON(ctx, victoriaTracesQueryURL()+"/api/traces/"+url.PathEscape(traceID), &raw); err != nil {
		return nil, err
	}
	return &TraceDetailResponse{TraceID: traceID, RawJSON: string(raw)}, nil
}

// Insights returns an Encore Cloud-style operational overview.
//
//encore:api public method=GET path=/insights
func Insights(ctx context.Context, params *InsightsParams) (*InsightsResponse, error) {
	window := resolveInsightsWindow(params.Range)
	requests, _ := queryScalar(ctx, fmt.Sprintf(`sum(increase(e_requests_total[%s]))`, window.PromDuration))
	errors, _ := queryScalar(ctx, fmt.Sprintf(`sum(increase(e_requests_total{code!="ok"}[%s]))`, window.PromDuration))
	services, _ := insightServices(ctx, window)
	series, _ := insightRateSeries(ctx, window)

	errorRate := 0.0
	if requests > 0 {
		errorRate = errors / requests
	}
	return &InsightsResponse{
		Range:         window.ID,
		WindowSeconds: int64(window.Duration.Seconds()),
		Requests:      requests,
		Errors:        errors,
		ErrorRate:     errorRate,
		RequestRate:   series,
		Services:      services,
	}, nil
}

// MetricsSummary returns Encore runtime RED metrics from Prometheus remote write.
//
//encore:api public method=GET path=/metrics/summary
func MetricsSummary(ctx context.Context, params *MetricsParams) (*MetricsResponse, error) {
	hours := params.Hours
	if hours <= 0 || hours > 720 {
		hours = 24
	}
	counts, _ := queryMetric(ctx, fmt.Sprintf(`sum by (service,endpoint) (increase(e_requests_total[%dh]))`, hours))
	errorsByEndpoint, _ := queryMetric(ctx, fmt.Sprintf(`sum by (service,endpoint) (increase(e_requests_total{code!="ok"}[%dh]))`, hours))
	runtime, _ := runtimeMetrics(ctx)

	merged := make(map[string]ServiceMetric)
	for key, value := range counts {
		service, endpoint := splitMetricKey(key)
		metric := merged[key]
		metric.Service = service
		metric.Endpoint = endpoint
		metric.TraceCount = value
		merged[key] = metric
	}
	for key, value := range errorsByEndpoint {
		metric := merged[key]
		metric.ErrorCount = value
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

// Catalog returns generated Encore metadata and OpenAPI JSON mounted by the deployed app.
//
//encore:api public method=GET path=/catalog
func Catalog(ctx context.Context) (*CatalogResponse, error) {
	meta, _ := os.ReadFile(env("NECKDASH_META_PATH", "/catalog/meta.json"))
	openapi, _ := os.ReadFile(env("NECKDASH_OPENAPI_PATH", "/catalog/openapi.json"))
	return &CatalogResponse{
		MetaJSON:    string(meta),
		OpenAPIJSON: string(openapi),
		Services:    buildCatalog(meta, openapi),
	}, nil
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
		RuntimeNote: "Sampling is enforced by the Encore runtime trace exporter. Change NECK_TRACE_SAMPLE_RATE, regenerate deployment config, rebuild the backend image, and redeploy.",
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

func getJaegerTrace(ctx context.Context, traceID string) (jaegerTrace, error) {
	var raw struct {
		Data []jaegerTrace `json:"data"`
	}
	err := getJSON(ctx, victoriaTracesQueryURL()+"/api/traces/"+url.PathEscape(traceID), &raw)
	if err != nil || len(raw.Data) == 0 {
		return jaegerTrace{}, err
	}
	return raw.Data[0], nil
}

func queryJaegerTraces(ctx context.Context, service string, limit int, start time.Time, end time.Time) ([]TraceSummary, error) {
	values := url.Values{}
	values.Set("service", service)
	values.Set("limit", strconv.Itoa(limit))
	values.Set("start", strconv.FormatInt(start.UnixMicro(), 10))
	values.Set("end", strconv.FormatInt(end.UnixMicro(), 10))
	endpoint := victoriaTracesQueryURL() + "/api/traces?" + values.Encode()
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

func traceServiceFanoutLimit() int {
	limit, err := strconv.Atoi(env("NECKDASH_TRACE_SERVICE_FANOUT_LIMIT", "32"))
	if err != nil || limit <= 0 {
		return 32
	}
	if limit > 256 {
		return 256
	}
	return limit
}

func looksLikeTraceID(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 16 && len(value) != 32 {
		return false
	}
	for _, ch := range value {
		if !(ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'f' || ch >= 'A' && ch <= 'F') {
			return false
		}
	}
	return true
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

type metricRange struct {
	Labels map[string]string
	Points []metricRangePoint
}

type metricRangePoint struct {
	Timestamp time.Time
	Value     float64
}

type insightsWindow struct {
	ID           string
	PromDuration string
	Duration     time.Duration
	StepSeconds  int64
	RateWindow   string
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

func resolveInsightsWindow(value string) insightsWindow {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "10m":
		return insightsWindow{ID: "10m", PromDuration: "10m", Duration: 10 * time.Minute, StepSeconds: 15, RateWindow: "1m"}
	case "1h":
		return insightsWindow{ID: "1h", PromDuration: "1h", Duration: time.Hour, StepSeconds: 60, RateWindow: "2m"}
	case "8h":
		return insightsWindow{ID: "8h", PromDuration: "8h", Duration: 8 * time.Hour, StepSeconds: 5 * 60, RateWindow: "10m"}
	case "3d":
		return insightsWindow{ID: "3d", PromDuration: "3d", Duration: 72 * time.Hour, StepSeconds: 60 * 60, RateWindow: "2h"}
	case "7d":
		return insightsWindow{ID: "7d", PromDuration: "7d", Duration: 7 * 24 * time.Hour, StepSeconds: 2 * 60 * 60, RateWindow: "4h"}
	default:
		return insightsWindow{ID: "24h", PromDuration: "24h", Duration: 24 * time.Hour, StepSeconds: 15 * 60, RateWindow: "30m"}
	}
}

func insightServices(ctx context.Context, window insightsWindow) ([]InsightsService, error) {
	requests, err := queryByLabel(ctx, fmt.Sprintf(`sum by (service) (increase(e_requests_total[%s]))`, window.PromDuration), "service")
	if err != nil {
		return nil, err
	}
	errors, _ := queryByLabel(ctx, fmt.Sprintf(`sum by (service) (increase(e_requests_total{code!="ok"}[%s]))`, window.PromDuration), "service")
	rates, _ := queryByLabel(ctx, fmt.Sprintf(`sum by (service) (rate(e_requests_total[%s]))`, window.RateWindow), "service")

	seen := make(map[string]bool)
	var services []InsightsService
	for service, count := range requests {
		seen[service] = true
		metric := InsightsService{
			Service:  valueOr(service, "unknown"),
			Requests: count,
			Errors:   errors[service],
			Rate:     rates[service],
		}
		if metric.Requests > 0 {
			metric.ErrorRate = metric.Errors / metric.Requests
		}
		services = append(services, metric)
	}
	for service, count := range errors {
		if seen[service] {
			continue
		}
		metric := InsightsService{
			Service: valueOr(service, "unknown"),
			Errors:  count,
			Rate:    rates[service],
		}
		services = append(services, metric)
	}
	sort.Slice(services, func(i, j int) bool { return services[i].Requests > services[j].Requests })
	return services, nil
}

func insightRateSeries(ctx context.Context, window insightsWindow) ([]InsightsSeries, error) {
	end := time.Now()
	start := end.Add(-window.Duration)
	results, err := queryRange(ctx, fmt.Sprintf(`sum by (service) (rate(e_requests_total[%s]))`, window.RateWindow), start, end, window.StepSeconds)
	if err != nil {
		return nil, err
	}
	series := make([]InsightsSeries, 0, len(results))
	for _, result := range results {
		service := valueOr(result.Labels["service"], "unknown")
		points := make([]InsightsPoint, 0, len(result.Points))
		for _, point := range result.Points {
			points = append(points, InsightsPoint{
				Timestamp: point.Timestamp.UTC().Format(time.RFC3339Nano),
				Value:     point.Value,
			})
		}
		series = append(series, InsightsSeries{Service: service, Points: points})
	}
	sort.Slice(series, func(i, j int) bool { return series[i].Service < series[j].Service })
	return series, nil
}

func queryScalar(ctx context.Context, query string) (float64, error) {
	results, err := queryVector(ctx, query)
	if err != nil {
		return 0, err
	}
	total := 0.0
	for _, result := range results {
		total += result.Value
	}
	return total, nil
}

func queryByLabel(ctx context.Context, query string, label string) (map[string]float64, error) {
	results, err := queryVector(ctx, query)
	if err != nil {
		return nil, err
	}
	out := make(map[string]float64)
	for _, result := range results {
		key := result.Labels[label]
		if key == "" && label == "service" {
			key = result.Labels["service_id"]
		}
		out[key] += result.Value
	}
	return out, nil
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

func queryRange(ctx context.Context, query string, start time.Time, end time.Time, stepSeconds int64) ([]metricRange, error) {
	values := url.Values{}
	values.Set("query", query)
	values.Set("start", strconv.FormatInt(start.Unix(), 10))
	values.Set("end", strconv.FormatInt(end.Unix(), 10))
	values.Set("step", strconv.FormatInt(stepSeconds, 10))

	var raw struct {
		Data struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Values [][]interface{}   `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := getJSON(ctx, victoriaMetricsRangeQueryURL()+"?"+values.Encode(), &raw); err != nil {
		return nil, err
	}

	out := make([]metricRange, 0, len(raw.Data.Result))
	for _, result := range raw.Data.Result {
		item := metricRange{Labels: result.Metric, Points: make([]metricRangePoint, 0, len(result.Values))}
		for _, value := range result.Values {
			if len(value) < 2 {
				continue
			}
			unixSeconds, ok := numericTag(value[0])
			if !ok {
				continue
			}
			sec, frac := int64(unixSeconds), unixSeconds-float64(int64(unixSeconds))
			parsed, err := strconv.ParseFloat(fmt.Sprint(value[1]), 64)
			if err != nil {
				continue
			}
			item.Points = append(item.Points, metricRangePoint{
				Timestamp: time.Unix(sec, int64(frac*1e9)),
				Value:     parsed,
			})
		}
		out = append(out, item)
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
