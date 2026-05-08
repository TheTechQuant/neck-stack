package dash

type HealthResponse struct {
	OK bool `json:"ok"`
}

type TraceListParams struct {
	Service string `query:"service"`
	Search  string `query:"search"`
	Limit   int    `query:"limit"`
}

type TraceSummary struct {
	TraceID     string  `json:"traceId"`
	Service     string  `json:"service"`
	Endpoint    string  `json:"endpoint"`
	StartedAt   string  `json:"startedAt"`
	DurationMS  float64 `json:"durationMs"`
	SpanCount   int     `json:"spanCount"`
	Error       bool    `json:"error"`
	StatusCode  int     `json:"statusCode"`
	Environment string  `json:"environment"`
}

type TraceListResponse struct {
	Traces []TraceSummary `json:"traces"`
}

type TraceDetailResponse struct {
	TraceID string `json:"traceId"`
	RawJSON string `json:"rawJson"`
}

type MetricsParams struct {
	Hours int `query:"hours"`
}

type ServiceMetric struct {
	Service       string  `json:"service"`
	Endpoint      string  `json:"endpoint"`
	TraceCount    float64 `json:"traceCount"`
	ErrorCount    float64 `json:"errorCount"`
	AvgDurationMS float64 `json:"avgDurationMs"`
	Source        string  `json:"source"`
}

type MetricsResponse struct {
	WindowHours int             `json:"windowHours"`
	Services    []ServiceMetric `json:"services"`
	Runtime     []MetricSample  `json:"runtime"`
}

type MetricLabel struct {
	Key string `json:"key"`
	Doc string `json:"doc"`
}

type MetricDefinition struct {
	Name        string        `json:"name"`
	Kind        string        `json:"kind"`
	Doc         string        `json:"doc"`
	ServiceName string        `json:"serviceName"`
	Labels      []MetricLabel `json:"labels"`
}

type MetricSample struct {
	Name        string            `json:"name"`
	Kind        string            `json:"kind"`
	ServiceName string            `json:"serviceName"`
	Labels      map[string]string `json:"labels"`
	Value       float64           `json:"value"`
	WindowValue float64           `json:"windowValue"`
	Timestamp   string            `json:"timestamp"`
}

type CustomMetricsResponse struct {
	WindowHours int                `json:"windowHours"`
	Definitions []MetricDefinition `json:"definitions"`
	Samples     []MetricSample     `json:"samples"`
}

type FlowNode struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type FlowEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
	Count  int64  `json:"count"`
}

type FlowResponse struct {
	Nodes []FlowNode `json:"nodes"`
	Edges []FlowEdge `json:"edges"`
}

type CatalogResponse struct {
	MetaJSON    string `json:"metaJson"`
	OpenAPIJSON string `json:"openapiJson"`
}

type SamplingResponse struct {
	Rules       []SamplingRule `json:"rules"`
	RuntimeNote string         `json:"runtimeNote"`
}

type SamplingRule struct {
	ScopeType  string  `json:"scopeType"`
	ScopeValue string  `json:"scopeValue"`
	Rate       float64 `json:"rate"`
}
