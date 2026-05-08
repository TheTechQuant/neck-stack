package dash

import (
	"strings"
	"testing"
	"time"

	tracepb2 "encr.dev/proto/encore/engine/trace2"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestExtractLogEntriesPreservesStructuredFields(t *testing.T) {
	traceID := &tracepb2.TraceID{High: 2, Low: 1}
	now := time.Date(2026, 5, 8, 10, 11, 12, 0, time.UTC)
	events := []*tracepb2.TraceEvent{
		{
			TraceId:   traceID,
			SpanId:    42,
			EventTime: timestamppb.New(now),
			Event: &tracepb2.TraceEvent_SpanStart{SpanStart: &tracepb2.SpanStart{
				Data: &tracepb2.SpanStart_Request{Request: &tracepb2.RequestSpanStart{
					ServiceName:  "core",
					EndpointName: "health",
				}},
			}},
		},
		{
			TraceId:   traceID,
			SpanId:    42,
			EventTime: timestamppb.New(now.Add(time.Second)),
			Event: &tracepb2.TraceEvent_SpanEvent{SpanEvent: &tracepb2.SpanEvent{
				Data: &tracepb2.SpanEvent_LogMessage{LogMessage: &tracepb2.LogMessage{
					Level: tracepb2.LogMessage_INFO,
					Msg:   "health check",
					Fields: []*tracepb2.LogField{
						{Key: "is_subscriber", Value: &tracepb2.LogField_Bool{Bool: true}},
						{Key: "login method", Value: &tracepb2.LogField_Str{Str: "oauth"}},
					},
				}},
			}},
		},
	}

	_, _, logs, err := convertToOTLP(traceRequestMeta{AppID: "app", EnvID: "prod"}, events)
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(logs))
	}
	log := logs[0]
	if log["message"] != "health check" || log["level"] != "info" {
		t.Fatalf("unexpected log basics: %#v", log)
	}
	if log["service"] != "core" || log["endpoint"] != "health" {
		t.Fatalf("log did not inherit span service/endpoint: %#v", log)
	}
	if log["field.is_subscriber"] != true || log["field.login_method"] != "oauth" {
		t.Fatalf("structured fields were not preserved: %#v", log)
	}
}

func TestBuildLogQuery(t *testing.T) {
	query := buildLogQuery(&LogListParams{
		Query:   `payment "failed"`,
		Service: "billing",
		Level:   "ERROR",
		TraceID: "abc123",
		Hours:   8,
	}, false)

	for _, want := range []string{
		`_time:8h`,
		`"payment \"failed\""`,
		`service:="billing"`,
		`level:="error"`,
		`trace_id:="abc123"`,
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("query %q does not contain %q", query, want)
		}
	}
}
