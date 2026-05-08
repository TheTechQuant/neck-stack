package dash

import (
	"bufio"
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"encore.dev/appruntime/exported/trace2"
	"encr.dev/pkg/traceparser"
	tracepb2 "encr.dev/proto/encore/engine/trace2"
	"google.golang.org/protobuf/encoding/protojson"
)

type traceRequestMeta struct {
	AppID     string
	EnvID     string
	DeployID  string
	AppCommit string
}

type otlpRequest struct {
	ResourceSpans []otlpResourceSpan `json:"resourceSpans"`
}

type otlpResourceSpan struct {
	Resource   otlpResource    `json:"resource"`
	ScopeSpans []otlpScopeSpan `json:"scopeSpans"`
}

type otlpResource struct {
	Attributes []otlpAttribute `json:"attributes"`
}

type otlpScopeSpan struct {
	Scope otlpScope  `json:"scope"`
	Spans []otlpSpan `json:"spans"`
}

type otlpScope struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type otlpSpan struct {
	TraceID           string          `json:"traceId"`
	SpanID            string          `json:"spanId"`
	ParentSpanID      string          `json:"parentSpanId,omitempty"`
	Name              string          `json:"name"`
	Kind              int             `json:"kind"`
	StartTimeUnixNano string          `json:"startTimeUnixNano"`
	EndTimeUnixNano   string          `json:"endTimeUnixNano"`
	Attributes        []otlpAttribute `json:"attributes,omitempty"`
	Events            []otlpEvent     `json:"events,omitempty"`
	Status            otlpStatus      `json:"status"`
}

type otlpEvent struct {
	TimeUnixNano string          `json:"timeUnixNano"`
	Name         string          `json:"name"`
	Attributes   []otlpAttribute `json:"attributes,omitempty"`
}

type otlpStatus struct {
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type otlpAttribute struct {
	Key   string    `json:"key"`
	Value otlpValue `json:"value"`
}

type otlpValue struct {
	StringValue *string  `json:"stringValue,omitempty"`
	IntValue    *string  `json:"intValue,omitempty"`
	DoubleValue *float64 `json:"doubleValue,omitempty"`
	BoolValue   *bool    `json:"boolValue,omitempty"`
}

type spanBuilder struct {
	TraceID      string
	SpanID       string
	ParentSpanID string
	Name         string
	Service      string
	Endpoint     string
	Topic        string
	Subscription string
	Kind         int
	Start        time.Time
	End          time.Time
	StatusCode   int
	Error        string
	Synthetic    bool
	Attributes   []otlpAttribute
	Events       []otlpEvent
}

// Trace receives Encore runtime trace streams, converts them to OTLP, augments
// them with Encore metadata, and forwards them to VictoriaTraces.
//
//encore:api public raw method=POST path=/trace
func Trace(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := validateTraceAuth(req); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	meta, version, anchor, err := parseTraceRequest(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	events, err := parseEncoreEvents(req.Body, anchor, version)
	if err != nil {
		http.Error(w, "parse Encore trace stream: "+err.Error(), http.StatusBadRequest)
		return
	}
	otlp, spans, err := convertToOTLP(meta, events)
	if err != nil {
		http.Error(w, "convert trace stream: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if err := postOTLP(req, otlp); err != nil {
		http.Error(w, "post to VictoriaTraces: "+err.Error(), http.StatusBadGateway)
		return
	}
	_ = postDerivedMetrics(req, meta, spans)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func parseTraceRequest(req *http.Request) (traceRequestMeta, trace2.Version, trace2.TimeAnchor, error) {
	meta := traceRequestMeta{
		AppID:     req.Header.Get("X-Encore-App-ID"),
		EnvID:     req.Header.Get("X-Encore-Env-ID"),
		DeployID:  req.Header.Get("X-Encore-Deploy-ID"),
		AppCommit: req.Header.Get("X-Encore-App-Commit"),
	}
	if meta.AppID == "" {
		return meta, 0, trace2.TimeAnchor{}, fmt.Errorf("missing X-Encore-App-ID")
	}
	if meta.EnvID == "" {
		meta.EnvID = "production"
	}

	versionNumber, err := strconv.Atoi(req.Header.Get("X-Encore-Trace-Version"))
	if err != nil || versionNumber <= 0 {
		return meta, 0, trace2.TimeAnchor{}, fmt.Errorf("bad X-Encore-Trace-Version")
	}
	var anchor trace2.TimeAnchor
	if err := anchor.UnmarshalText([]byte(req.Header.Get("X-Encore-Trace-TimeAnchor"))); err != nil {
		return meta, 0, trace2.TimeAnchor{}, fmt.Errorf("bad X-Encore-Trace-TimeAnchor: %w", err)
	}
	return meta, trace2.Version(versionNumber), anchor, nil
}

func parseEncoreEvents(body io.Reader, anchor trace2.TimeAnchor, version trace2.Version) ([]*tracepb2.TraceEvent, error) {
	reader := bufio.NewReader(body)
	var events []*tracepb2.TraceEvent
	for {
		ev, err := traceparser.ParseEvent(reader, anchor, version)
		if ev != nil {
			events = append(events, ev)
		}
		if err == nil {
			continue
		}
		if err == io.EOF {
			return events, nil
		}
		return events, err
	}
}

func validateTraceAuth(req *http.Request) error {
	if strings.EqualFold(os.Getenv("NECKDASH_REQUIRE_TRACE_AUTH"), "false") {
		return nil
	}
	key := os.Getenv("ENCORE_AUTH_KEY")
	if key == "" {
		return fmt.Errorf("ENCORE_AUTH_KEY is not configured")
	}
	dateHeader := req.Header.Get("Date")
	requestDate, err := http.ParseTime(dateHeader)
	if err != nil {
		return fmt.Errorf("invalid Date header")
	}
	if diff := time.Since(requestDate); diff > 15*time.Minute || diff < -15*time.Minute {
		return fmt.Errorf("trace signature date is outside allowed skew")
	}
	raw, err := base64.RawStdEncoding.DecodeString(req.Header.Get("X-Encore-Auth"))
	if err != nil || len(raw) < 4+sha256.Size {
		return fmt.Errorf("invalid X-Encore-Auth")
	}
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = fmt.Fprintf(mac, "%s\x00%s", dateHeader, req.URL.Path)
	if !hmac.Equal(mac.Sum(nil), raw[4:]) {
		return fmt.Errorf("invalid trace signature")
	}
	return nil
}

func convertToOTLP(meta traceRequestMeta, events []*tracepb2.TraceEvent) (otlpRequest, []spanBuilder, error) {
	builders := make(map[string]*spanBuilder)
	for _, ev := range events {
		spanID := hexSpanID(ev.SpanId)
		builder := builders[spanID]
		if builder == nil {
			builder = &spanBuilder{
				TraceID: hexTraceID(ev.TraceId),
				SpanID:  spanID,
				Kind:    1,
				Start:   ev.EventTime.AsTime(),
				End:     ev.EventTime.AsTime(),
			}
			builders[spanID] = builder
		}
		if start := ev.GetSpanStart(); start != nil {
			applySpanStart(builder, start, ev.EventTime.AsTime())
			continue
		}
		if end := ev.GetSpanEnd(); end != nil {
			applySpanEnd(builder, end, ev.EventTime.AsTime())
			continue
		}
		if spanEvent := ev.GetSpanEvent(); spanEvent != nil {
			builder.Events = append(builder.Events, convertSpanEvent(spanEvent, ev.EventTime.AsTime()))
		}
	}

	var spans []spanBuilder
	for _, builder := range builders {
		if builder.Name == "" {
			builder.Name = "encore.span"
		}
		if builder.Service == "" {
			builder.Service = "unknown"
		}
		if builder.End.Before(builder.Start) || builder.End.Equal(builder.Start) {
			builder.End = builder.Start.Add(time.Millisecond)
		}
		builder.Attributes = append(builder.Attributes,
			stringAttr("encore.app_id", meta.AppID),
			stringAttr("encore.env_id", meta.EnvID),
			stringAttr("encore.deploy_id", meta.DeployID),
			stringAttr("encore.app_commit", meta.AppCommit),
		)
		spans = append(spans, *builder)
	}
	spans = append(spans, buildSyntheticSpans(events, builders)...)
	sort.Slice(spans, func(i, j int) bool { return spans[i].Start.Before(spans[j].Start) })

	request := otlpRequest{ResourceSpans: make([]otlpResourceSpan, 0, len(spans))}
	for _, span := range spans {
		if span.Service == "" {
			span.Service = "unknown"
		}
		request.ResourceSpans = append(request.ResourceSpans, otlpResourceSpan{
			Resource: otlpResource{Attributes: []otlpAttribute{
				stringAttr("service.name", span.Service),
				stringAttr("encore.app_id", meta.AppID),
				stringAttr("encore.env_id", meta.EnvID),
			}},
			ScopeSpans: []otlpScopeSpan{{
				Scope: otlpScope{Name: "neckdash.encore-adapter", Version: "0.1.0"},
				Spans: []otlpSpan{{
					TraceID:           span.TraceID,
					SpanID:            span.SpanID,
					ParentSpanID:      span.ParentSpanID,
					Name:              span.Name,
					Kind:              span.Kind,
					StartTimeUnixNano: strconv.FormatInt(span.Start.UnixNano(), 10),
					EndTimeUnixNano:   strconv.FormatInt(span.End.UnixNano(), 10),
					Attributes:        span.Attributes,
					Events:            span.Events,
					Status:            status(span),
				}},
			}},
		})
	}
	return request, spans, nil
}

func applySpanStart(builder *spanBuilder, start *tracepb2.SpanStart, t time.Time) {
	builder.Start = t
	if start.ParentSpanId != nil {
		builder.ParentSpanID = hexSpanID(start.GetParentSpanId())
	}
	switch data := start.Data.(type) {
	case *tracepb2.SpanStart_Request:
		builder.Service = data.Request.ServiceName
		builder.Endpoint = data.Request.EndpointName
		builder.Name = data.Request.EndpointName
		builder.Kind = 2
		builder.Attributes = append(builder.Attributes,
			stringAttr("http.request.method", data.Request.HttpMethod),
			stringAttr("url.path", data.Request.Path),
			stringAttr("encore.endpoint", data.Request.EndpointName),
		)
	case *tracepb2.SpanStart_Auth:
		builder.Service = data.Auth.ServiceName
		builder.Endpoint = data.Auth.EndpointName
		builder.Name = "auth." + data.Auth.EndpointName
		builder.Kind = 2
	case *tracepb2.SpanStart_PubsubMessage:
		builder.Service = data.PubsubMessage.ServiceName
		builder.Topic = data.PubsubMessage.TopicName
		builder.Subscription = data.PubsubMessage.SubscriptionName
		builder.Name = data.PubsubMessage.TopicName + "/" + data.PubsubMessage.SubscriptionName
		builder.Kind = 5
		builder.Attributes = append(builder.Attributes,
			stringAttr("messaging.system", "nsq"),
			stringAttr("messaging.destination.name", data.PubsubMessage.TopicName),
			stringAttr("messaging.operation.name", "process"),
		)
	case *tracepb2.SpanStart_Test:
		builder.Service = data.Test.ServiceName
		builder.Name = data.Test.TestName
	}
}

func applySpanEnd(builder *spanBuilder, end *tracepb2.SpanEnd, t time.Time) {
	builder.End = t
	builder.StatusCode = int(end.StatusCode)
	if end.ParentSpanId != nil && builder.ParentSpanID == "" {
		builder.ParentSpanID = hexSpanID(end.GetParentSpanId())
	}
	if end.Error != nil {
		builder.Error = end.Error.Msg
		builder.Attributes = append(builder.Attributes, boolAttr("error", true), stringAttr("exception.message", end.Error.Msg))
	}
	switch data := end.Data.(type) {
	case *tracepb2.SpanEnd_Request:
		builder.Service = valueOr(builder.Service, data.Request.ServiceName)
		builder.Endpoint = valueOr(builder.Endpoint, data.Request.EndpointName)
		builder.Attributes = append(builder.Attributes, intAttr("http.response.status_code", int64(data.Request.HttpStatusCode)))
	case *tracepb2.SpanEnd_Auth:
		builder.Service = valueOr(builder.Service, data.Auth.ServiceName)
		builder.Endpoint = valueOr(builder.Endpoint, data.Auth.EndpointName)
	case *tracepb2.SpanEnd_PubsubMessage:
		builder.Service = valueOr(builder.Service, data.PubsubMessage.ServiceName)
	}
	if end.DurationNanos > 0 {
		builder.Start = t.Add(-time.Duration(end.DurationNanos))
	}
}

func buildSyntheticSpans(events []*tracepb2.TraceEvent, parents map[string]*spanBuilder) []spanBuilder {
	open := make(map[string][]*spanBuilder)
	var out []spanBuilder

	for index, ev := range events {
		spanEvent := ev.GetSpanEvent()
		if spanEvent == nil {
			continue
		}
		parentID := hexSpanID(ev.SpanId)
		parent := parents[parentID]
		if span, key := syntheticStart(ev, parent, parentID, spanEvent, index); span != nil {
			open[key] = append(open[key], span)
			continue
		}
		key, errMessage, statusCode, attrs, ok := syntheticEnd(parentID, spanEvent)
		if !ok {
			continue
		}
		queue := open[key]
		if len(queue) == 0 {
			continue
		}
		span := queue[0]
		open[key] = queue[1:]
		span.End = ev.EventTime.AsTime()
		span.StatusCode = statusCode
		span.Attributes = append(span.Attributes, attrs...)
		if errMessage != "" {
			span.Error = errMessage
			span.Attributes = append(span.Attributes, boolAttr("error", true), stringAttr("exception.message", errMessage))
		}
		if span.End.Before(span.Start) || span.End.Equal(span.Start) {
			span.End = span.Start.Add(time.Millisecond)
		}
		out = append(out, *span)
	}

	for _, queue := range open {
		for _, span := range queue {
			if span.End.Before(span.Start) || span.End.Equal(span.Start) {
				span.End = span.Start.Add(time.Millisecond)
			}
			out = append(out, *span)
		}
	}
	return out
}

func syntheticStart(ev *tracepb2.TraceEvent, parent *spanBuilder, parentID string, spanEvent *tracepb2.SpanEvent, index int) (*spanBuilder, string) {
	t := ev.EventTime.AsTime()
	base := func(name, key string, kind int) *spanBuilder {
		service := "unknown"
		traceID := hexTraceID(ev.TraceId)
		if parent != nil {
			service = valueOr(parent.Service, service)
			traceID = valueOr(parent.TraceID, traceID)
		}
		return &spanBuilder{
			TraceID:      traceID,
			SpanID:       syntheticSpanID(parentID, index),
			ParentSpanID: parentID,
			Name:         name,
			Service:      service,
			Kind:         kind,
			Start:        t,
			End:          t.Add(time.Millisecond),
			Synthetic:    true,
			Attributes: []otlpAttribute{
				boolAttr("encore.synthetic", true),
				stringAttr("encore.synthetic.kind", key),
			},
		}
	}

	switch data := spanEvent.Data.(type) {
	case *tracepb2.SpanEvent_RpcCallStart:
		target := data.RpcCallStart
		name := target.GetTargetServiceName() + "." + target.GetTargetEndpointName()
		if strings.Trim(name, ".") == "" {
			name = "encore.rpc"
		}
		span := base(valueOr(name, "encore.rpc"), parentID+"|rpc", 3)
		span.Endpoint = target.GetTargetEndpointName()
		span.Attributes = append(span.Attributes,
			stringAttr("rpc.system", "encore"),
			stringAttr("rpc.service", target.GetTargetServiceName()),
			stringAttr("rpc.method", target.GetTargetEndpointName()),
			stringAttr("peer.service", target.GetTargetServiceName()),
		)
		return span, parentID + "|rpc"
	case *tracepb2.SpanEvent_DbQueryStart:
		query := data.DbQueryStart.GetQuery()
		verb := firstSQLVerb(query)
		name := "SQL query"
		if verb != "" {
			name = "SQL " + verb
		}
		span := base(name, parentID+"|db.query", 3)
		span.Attributes = append(span.Attributes,
			stringAttr("db.system", "postgresql"),
			stringAttr("db.operation.name", firstSQLVerb(query)),
			stringAttr("db.statement", query),
			stringAttr("peer.service", "postgres"),
		)
		return span, parentID + "|db.query"
	case *tracepb2.SpanEvent_DbTransactionStart:
		span := base("SQL transaction", parentID+"|db.tx", 3)
		span.Attributes = append(span.Attributes, stringAttr("db.system", "postgresql"), stringAttr("peer.service", "postgres"))
		return span, parentID + "|db.tx"
	case *tracepb2.SpanEvent_HttpCallStart:
		call := data.HttpCallStart
		name := strings.TrimSpace(call.GetMethod() + " " + httpPath(call.GetUrl()))
		span := base(valueOr(name, "HTTP call"), parentID+"|http", 3)
		span.Attributes = append(span.Attributes,
			stringAttr("http.request.method", call.GetMethod()),
			stringAttr("url.full", call.GetUrl()),
			stringAttr("server.address", httpHost(call.GetUrl())),
		)
		return span, parentID + "|http"
	case *tracepb2.SpanEvent_PubsubPublishStart:
		pub := data.PubsubPublishStart
		span := base("publish "+pub.GetTopic(), parentID+"|pubsub", 4)
		span.Topic = pub.GetTopic()
		span.Attributes = append(span.Attributes,
			stringAttr("messaging.system", "nsq"),
			stringAttr("messaging.destination.name", pub.GetTopic()),
			stringAttr("messaging.operation.name", "publish"),
			stringAttr("peer.service", pub.GetTopic()),
		)
		return span, parentID + "|pubsub"
	case *tracepb2.SpanEvent_CacheCallStart:
		cache := data.CacheCallStart
		span := base("cache."+cache.GetOperation(), parentID+"|cache", 3)
		span.Attributes = append(span.Attributes,
			stringAttr("db.system", "redis"),
			stringAttr("db.operation.name", cache.GetOperation()),
			intAttr("db.redis.key_count", int64(len(cache.GetKeys()))),
			boolAttr("encore.cache.write", cache.GetWrite()),
			stringAttr("peer.service", "redis"),
		)
		return span, parentID + "|cache"
	default:
		return nil, ""
	}
}

func syntheticEnd(parentID string, spanEvent *tracepb2.SpanEvent) (string, string, int, []otlpAttribute, bool) {
	switch data := spanEvent.Data.(type) {
	case *tracepb2.SpanEvent_RpcCallEnd:
		return parentID + "|rpc", errorMessage(data.RpcCallEnd.GetErr()), 0, nil, true
	case *tracepb2.SpanEvent_DbQueryEnd:
		return parentID + "|db.query", errorMessage(data.DbQueryEnd.GetErr()), 0, nil, true
	case *tracepb2.SpanEvent_DbTransactionEnd:
		tx := data.DbTransactionEnd
		return parentID + "|db.tx", errorMessage(tx.GetErr()), 0, []otlpAttribute{
			stringAttr("db.transaction.completion", tx.GetCompletion().String()),
		}, true
	case *tracepb2.SpanEvent_HttpCallEnd:
		call := data.HttpCallEnd
		statusCode := int(call.GetStatusCode())
		errMessage := errorMessage(call.GetErr())
		if errMessage == "" && statusCode >= 500 {
			errMessage = fmt.Sprintf("HTTP %d", statusCode)
		}
		attrs := []otlpAttribute{}
		if statusCode > 0 {
			attrs = append(attrs, intAttr("http.response.status_code", int64(statusCode)))
		}
		return parentID + "|http", errMessage, statusCode, attrs, true
	case *tracepb2.SpanEvent_PubsubPublishEnd:
		pub := data.PubsubPublishEnd
		attrs := []otlpAttribute{}
		if messageID := pub.GetMessageId(); messageID != "" {
			attrs = append(attrs, stringAttr("messaging.message.id", messageID))
		}
		return parentID + "|pubsub", errorMessage(pub.GetErr()), 0, attrs, true
	case *tracepb2.SpanEvent_CacheCallEnd:
		cache := data.CacheCallEnd
		return parentID + "|cache", errorMessage(cache.GetErr()), 0, []otlpAttribute{
			stringAttr("encore.cache.result", cache.GetResult().String()),
		}, true
	default:
		return "", "", 0, nil, false
	}
}

func convertSpanEvent(event *tracepb2.SpanEvent, t time.Time) otlpEvent {
	out := otlpEvent{TimeUnixNano: strconv.FormatInt(t.UnixNano(), 10), Name: traceEventName(event)}
	if log := event.GetLogMessage(); log != nil {
		out.Attributes = append(out.Attributes, stringAttr("log.message", log.Msg), stringAttr("log.level", log.Level.String()))
		for _, field := range log.Fields {
			out.Attributes = append(out.Attributes, logFieldAttr(field))
		}
		return out
	}
	data, _ := protojson.MarshalOptions{UseProtoNames: true}.Marshal(event)
	out.Attributes = append(out.Attributes, stringAttr("encore.event_json", string(data)))
	return out
}

func traceEventName(event *tracepb2.SpanEvent) string {
	switch event.Data.(type) {
	case *tracepb2.SpanEvent_LogMessage:
		return "log"
	case *tracepb2.SpanEvent_RpcCallStart:
		return "rpc.start"
	case *tracepb2.SpanEvent_RpcCallEnd:
		return "rpc.end"
	case *tracepb2.SpanEvent_DbQueryStart:
		return "db.query.start"
	case *tracepb2.SpanEvent_DbQueryEnd:
		return "db.query.end"
	case *tracepb2.SpanEvent_DbTransactionStart:
		return "db.transaction.start"
	case *tracepb2.SpanEvent_DbTransactionEnd:
		return "db.transaction.end"
	case *tracepb2.SpanEvent_PubsubPublishStart:
		return "pubsub.publish.start"
	case *tracepb2.SpanEvent_PubsubPublishEnd:
		return "pubsub.publish.end"
	case *tracepb2.SpanEvent_CacheCallStart:
		return "cache.start"
	case *tracepb2.SpanEvent_CacheCallEnd:
		return "cache.end"
	case *tracepb2.SpanEvent_HttpCallStart:
		return "http.client.start"
	case *tracepb2.SpanEvent_HttpCallEnd:
		return "http.client.end"
	default:
		return "encore.event"
	}
}

func postOTLP(req *http.Request, payload otlpRequest) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	httpReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, victoriaTracesOTLPURL(), bytes.NewReader(data))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

func postDerivedMetrics(req *http.Request, meta traceRequestMeta, spans []spanBuilder) error {
	var lines strings.Builder
	now := time.Now().UnixMilli()
	for _, span := range spans {
		if span.Synthetic || span.Endpoint == "" {
			continue
		}
		labels := fmt.Sprintf(`app_id=%q,env_id=%q,service=%q,endpoint=%q`, meta.AppID, meta.EnvID, span.Service, span.Endpoint)
		duration := span.End.Sub(span.Start).Seconds()
		lines.WriteString(fmt.Sprintf("neckdash_trace_requests_total{%s} 1 %d\n", labels, now))
		lines.WriteString(fmt.Sprintf("neckdash_trace_request_duration_seconds{%s} %f %d\n", labels, duration, now))
		if span.Error != "" || span.StatusCode != 0 && span.StatusCode != int(tracepb2.StatusCode_STATUS_CODE_OK) {
			lines.WriteString(fmt.Sprintf("neckdash_trace_errors_total{%s} 1 %d\n", labels, now))
		}
	}
	if lines.Len() == 0 {
		return nil
	}
	httpReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, victoriaMetricsImportURL(), strings.NewReader(lines.String()))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "text/plain")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

func status(span spanBuilder) otlpStatus {
	if span.Error != "" {
		return otlpStatus{Code: 2, Message: span.Error}
	}
	return otlpStatus{Code: 1}
}

func hexTraceID(id *tracepb2.TraceID) string {
	if id == nil {
		return ""
	}
	var b [16]byte
	binary.LittleEndian.PutUint64(b[0:8], id.Low)
	binary.LittleEndian.PutUint64(b[8:16], id.High)
	return hex.EncodeToString(b[:])
}

func hexSpanID(id uint64) string {
	var b [8]byte
	binary.LittleEndian.PutUint64(b[:], id)
	return hex.EncodeToString(b[:])
}

func syntheticSpanID(parentSpanID string, index int) string {
	sum := sha256.Sum256([]byte(parentSpanID + ":" + strconv.Itoa(index)))
	return hex.EncodeToString(sum[:8])
}

func stringAttr(key, value string) otlpAttribute {
	return otlpAttribute{Key: key, Value: otlpValue{StringValue: &value}}
}

func intAttr(key string, value int64) otlpAttribute {
	text := strconv.FormatInt(value, 10)
	return otlpAttribute{Key: key, Value: otlpValue{IntValue: &text}}
}

func boolAttr(key string, value bool) otlpAttribute {
	return otlpAttribute{Key: key, Value: otlpValue{BoolValue: &value}}
}

func logFieldAttr(field *tracepb2.LogField) otlpAttribute {
	key := "log.field." + field.Key
	switch value := field.Value.(type) {
	case *tracepb2.LogField_Str:
		return stringAttr(key, value.Str)
	case *tracepb2.LogField_Bool:
		return boolAttr(key, value.Bool)
	case *tracepb2.LogField_Int:
		return intAttr(key, value.Int)
	case *tracepb2.LogField_Uint:
		return stringAttr(key, strconv.FormatUint(value.Uint, 10))
	case *tracepb2.LogField_Float64:
		return otlpAttribute{Key: key, Value: otlpValue{DoubleValue: &value.Float64}}
	default:
		data, _ := protojson.MarshalOptions{UseProtoNames: true}.Marshal(field)
		return stringAttr(key, string(data))
	}
}

func errorMessage(err *tracepb2.Error) string {
	if err == nil {
		return ""
	}
	return err.GetMsg()
}

func firstSQLVerb(query string) string {
	fields := strings.Fields(query)
	if len(fields) == 0 {
		return ""
	}
	return strings.ToUpper(fields[0])
}

func httpHost(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return parsed.Hostname()
}

func httpPath(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Path == "" {
		return rawURL
	}
	return parsed.Path
}

func valueOr(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
