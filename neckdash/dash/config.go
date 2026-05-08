package dash

import "os"

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

func victoriaMetricsImportURL() string {
	return env("VICTORIA_METRICS_IMPORT_URL", "http://victoria-metrics:8428/api/v1/import/prometheus")
}

func victoriaMetricsQueryURL() string {
	return env("VICTORIA_METRICS_QUERY_URL", "http://victoria-metrics:8428/api/v1/query")
}
