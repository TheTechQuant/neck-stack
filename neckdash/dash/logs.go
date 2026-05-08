package dash

import (
	"bufio"
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	tracepb2 "encr.dev/proto/encore/engine/trace2"
	"google.golang.org/protobuf/encoding/protojson"
)

type victoriaLogEntry map[string]any

var logFieldNamePattern = regexp.MustCompile(`[^A-Za-z0-9_.-]+`)

// ListLogs returns searchable Encore structured logs stored in VictoriaLogs.
//
//encore:api public method=GET path=/logs
func ListLogs(ctx context.Context, params *LogListParams) (*LogListResponse, error) {
	limit := params.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	query := buildLogQuery(params, false)
	values := url.Values{}
	values.Set("query", query)
	values.Set("limit", strconv.Itoa(limit))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, victoriaLogsQueryURL(), strings.NewReader(values.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("VictoriaLogs query failed with HTTP %d", resp.StatusCode)
	}

	logs, err := decodeVictoriaLogRows(resp.Body)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(logs, func(i, j int) bool {
		return logs[i].Timestamp > logs[j].Timestamp
	})
	return &LogListResponse{Query: query, Logs: logs}, nil
}

// TailLogs proxies VictoriaLogs live tailing for CLI and UI clients.
//
//encore:api public raw method=GET path=/logs/tail
func TailLogs(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	params := &LogListParams{
		Query:   req.URL.Query().Get("query"),
		Service: req.URL.Query().Get("service"),
		Level:   req.URL.Query().Get("level"),
		TraceID: req.URL.Query().Get("traceId"),
	}
	if !hasLogFilter(params) {
		http.Error(w, "provide query, service, level, or traceId before live tailing logs", http.StatusBadRequest)
		return
	}
	values := url.Values{}
	values.Set("query", buildLogQuery(params, true))
	if startOffset := req.URL.Query().Get("start_offset"); startOffset != "" {
		values.Set("start_offset", startOffset)
	}
	if refreshInterval := req.URL.Query().Get("refresh_interval"); refreshInterval != "" {
		values.Set("refresh_interval", refreshInterval)
	}

	tailReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, victoriaLogsTailURL(), strings.NewReader(values.Encode()))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tailReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(tailReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("VictoriaLogs tail failed with HTTP %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

func extractLogEntries(meta traceRequestMeta, events []*tracepb2.TraceEvent, builders map[string]*spanBuilder) []victoriaLogEntry {
	entries := make([]victoriaLogEntry, 0)
	for _, ev := range events {
		spanEvent := ev.GetSpanEvent()
		if spanEvent == nil {
			continue
		}
		message := spanEvent.GetLogMessage()
		if message == nil {
			continue
		}

		spanID := hexSpanID(ev.SpanId)
		builder := builders[spanID]
		service, endpoint := "unknown", ""
		if builder != nil {
			service = valueOr(builder.Service, service)
			endpoint = builder.Endpoint
		}

		entry := victoriaLogEntry{
			"timestamp":  ev.EventTime.AsTime().UTC().Format(time.RFC3339Nano),
			"message":    message.GetMsg(),
			"level":      strings.ToLower(message.GetLevel().String()),
			"trace_id":   hexTraceID(ev.TraceId),
			"span_id":    spanID,
			"service":    service,
			"endpoint":   endpoint,
			"app_id":     meta.AppID,
			"env_id":     meta.EnvID,
			"deploy_id":  meta.DeployID,
			"app_commit": meta.AppCommit,
		}
		for _, field := range message.GetFields() {
			entry["field."+normalizeLogFieldName(field.GetKey())] = logFieldValue(field)
		}
		if stack := message.GetStack(); stack != nil {
			data, _ := protojson.MarshalOptions{UseProtoNames: true}.Marshal(stack)
			entry["stack"] = string(data)
		}
		entries = append(entries, entry)
	}
	return entries
}

func postVictoriaLogs(req *http.Request, entries []victoriaLogEntry) error {
	if len(entries) == 0 {
		return nil
	}
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for _, entry := range entries {
		if err := encoder.Encode(entry); err != nil {
			return err
		}
	}
	logReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, victoriaLogsInsertURL(), &body)
	if err != nil {
		return err
	}
	logReq.Header.Set("Content-Type", "application/stream+json")
	resp, err := http.DefaultClient.Do(logReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

func decodeVictoriaLogRows(reader io.Reader) ([]LogEntry, error) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	var logs []LogEntry
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var row map[string]any
		if err := json.Unmarshal(line, &row); err != nil {
			return nil, err
		}
		logs = append(logs, victoriaRowToLogEntry(row))
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return logs, nil
}

func victoriaRowToLogEntry(row map[string]any) LogEntry {
	fields := make(map[string]string)
	for key, value := range row {
		switch key {
		case "_time", "_msg", "_stream", "timestamp", "message", "level", "service", "endpoint", "trace_id", "span_id":
			continue
		default:
			fields[key] = stringValue(value, "")
		}
	}
	return LogEntry{
		Timestamp: stringValue(row["_time"], stringValue(row["timestamp"], "")),
		Message:   stringValue(row["_msg"], stringValue(row["message"], "")),
		Level:     stringValue(row["level"], ""),
		Service:   stringValue(row["service"], ""),
		Endpoint:  stringValue(row["endpoint"], ""),
		TraceID:   stringValue(row["trace_id"], ""),
		SpanID:    stringValue(row["span_id"], ""),
		Fields:    fields,
	}
}

func buildLogQuery(params *LogListParams, tail bool) string {
	hours := params.Hours
	if hours <= 0 || hours > 720 {
		hours = 1
	}
	parts := []string{}
	if !tail {
		parts = append(parts, fmt.Sprintf("_time:%dh", hours))
	}
	if query := strings.TrimSpace(params.Query); query != "" {
		parts = append(parts, quoteLogsQLPhrase(query))
	}
	if service := strings.TrimSpace(params.Service); service != "" {
		parts = append(parts, logsQLExact("service", service))
	}
	if level := strings.TrimSpace(params.Level); level != "" {
		parts = append(parts, logsQLExact("level", strings.ToLower(level)))
	}
	if traceID := strings.TrimSpace(params.TraceID); traceID != "" {
		parts = append(parts, logsQLExact("trace_id", traceID))
	}
	if len(parts) == 0 {
		return "*"
	}
	return strings.Join(parts, " AND ")
}

func hasLogFilter(params *LogListParams) bool {
	return strings.TrimSpace(params.Query) != "" ||
		strings.TrimSpace(params.Service) != "" ||
		strings.TrimSpace(params.Level) != "" ||
		strings.TrimSpace(params.TraceID) != ""
}

func logsQLExact(field, value string) string {
	return logsQLField(field) + ":=" + quoteLogsQLString(value)
}

func logsQLField(field string) string {
	if regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.-]*$`).MatchString(field) {
		return field
	}
	return quoteLogsQLString(field)
}

func quoteLogsQLPhrase(value string) string {
	return quoteLogsQLString(value)
}

func quoteLogsQLString(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`, "\r", `\r`, "\t", `\t`)
	return `"` + replacer.Replace(value) + `"`
}

func normalizeLogFieldName(key string) string {
	key = strings.Trim(logFieldNamePattern.ReplaceAllString(key, "_"), "_.-")
	if key == "" {
		return "unnamed"
	}
	return key
}

func logFieldValue(field *tracepb2.LogField) any {
	switch value := field.GetValue().(type) {
	case *tracepb2.LogField_Error:
		return errorMessage(value.Error)
	case *tracepb2.LogField_Str:
		return value.Str
	case *tracepb2.LogField_Bool:
		return value.Bool
	case *tracepb2.LogField_Time:
		if value.Time == nil {
			return ""
		}
		return value.Time.AsTime().UTC().Format(time.RFC3339Nano)
	case *tracepb2.LogField_Dur:
		return time.Duration(value.Dur).String()
	case *tracepb2.LogField_Uuid:
		return hex.EncodeToString(value.Uuid)
	case *tracepb2.LogField_Json:
		return string(value.Json)
	case *tracepb2.LogField_Int:
		return value.Int
	case *tracepb2.LogField_Uint:
		return strconv.FormatUint(value.Uint, 10)
	case *tracepb2.LogField_Float32:
		return value.Float32
	case *tracepb2.LogField_Float64:
		return value.Float64
	default:
		data, _ := protojson.MarshalOptions{UseProtoNames: true}.Marshal(field)
		return string(data)
	}
}

func stringValue(value any, fallback string) string {
	switch typed := value.(type) {
	case string:
		if typed != "" {
			return typed
		}
	case fmt.Stringer:
		if typed.String() != "" {
			return typed.String()
		}
	case nil:
		return fallback
	default:
		return fmt.Sprint(typed)
	}
	return fallback
}
