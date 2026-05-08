package dash

import (
	"os"
	"strings"
)

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func victoriaTracesOTLPURL() string {
	return env("VICTORIA_TRACES_OTLP_URL", "http://victoria-traces:10428/insert/opentelemetry/v1/traces")
}

func victoriaTracesQueryURL() string {
	return env("VICTORIA_TRACES_QUERY_URL", "http://victoria-traces:10428/select/jaeger")
}

func victoriaMetricsQueryURL() string {
	return env("VICTORIA_METRICS_QUERY_URL", "http://victoria-metrics:8428/api/v1/query")
}

func victoriaMetricsRangeQueryURL() string {
	value := env("VICTORIA_METRICS_RANGE_QUERY_URL", "")
	if value != "" {
		return value
	}
	return strings.TrimSuffix(victoriaMetricsQueryURL(), "/query") + "/query_range"
}

func victoriaLogsInsertURL() string {
	return env("VICTORIA_LOGS_INSERT_URL", "http://victoria-logs:9428/insert/jsonline?_stream_fields=app_id,env_id,service,level&_time_field=timestamp&_msg_field=message")
}

func victoriaLogsQueryURL() string {
	return env("VICTORIA_LOGS_QUERY_URL", "http://victoria-logs:9428/select/logsql/query")
}

func victoriaLogsTailURL() string {
	value := env("VICTORIA_LOGS_TAIL_URL", "")
	if value != "" {
		return value
	}
	return strings.TrimSuffix(victoriaLogsQueryURL(), "/query") + "/tail"
}
