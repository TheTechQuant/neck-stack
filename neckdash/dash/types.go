package dash

type HealthResponse struct {
	OK bool `json:"ok"`
}

type TraceListParams struct {
	App     string `query:"app"`
	Service string `query:"service"`
	Search  string `query:"search"`
	Limit   int    `query:"limit"`
	Hours   int    `query:"hours"`
}

type AppParams struct {
	App string `query:"app"`
}

type DashApp struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MetaPath    string `json:"metaPath"`
	OpenAPIPath string `json:"openapiPath"`
	HasMeta     bool   `json:"hasMeta"`
	HasOpenAPI  bool   `json:"hasOpenapi"`
}

type AppsResponse struct {
	Apps       []DashApp `json:"apps"`
	DefaultApp string    `json:"defaultApp"`
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

type TraceServicesResponse struct {
	Services []string `json:"services"`
}

type TraceDetailResponse struct {
	TraceID string `json:"traceId"`
	RawJSON string `json:"rawJson"`
}

type LogListParams struct {
	App     string `query:"app"`
	Query   string `query:"query"`
	Service string `query:"service"`
	Level   string `query:"level"`
	TraceID string `query:"traceId"`
	Limit   int    `query:"limit"`
	Hours   int    `query:"hours"`
}

type LogEntry struct {
	Timestamp string            `json:"timestamp"`
	Message   string            `json:"message"`
	Level     string            `json:"level"`
	Service   string            `json:"service"`
	Endpoint  string            `json:"endpoint"`
	TraceID   string            `json:"traceId"`
	SpanID    string            `json:"spanId"`
	Fields    map[string]string `json:"fields"`
}

type LogListResponse struct {
	Query string     `json:"query"`
	Logs  []LogEntry `json:"logs"`
}

type MetricsParams struct {
	Hours int    `query:"hours"`
	App   string `query:"app"`
}

type InsightsParams struct {
	Range string `query:"range"`
	App   string `query:"app"`
}

type InsightsPoint struct {
	Timestamp string  `json:"timestamp"`
	Value     float64 `json:"value"`
}

type InsightsSeries struct {
	Service string          `json:"service"`
	Points  []InsightsPoint `json:"points"`
}

type InsightsService struct {
	Service   string  `json:"service"`
	Requests  float64 `json:"requests"`
	Errors    float64 `json:"errors"`
	ErrorRate float64 `json:"errorRate"`
	Rate      float64 `json:"rate"`
}

type InsightsResponse struct {
	Range         string            `json:"range"`
	WindowSeconds int64             `json:"windowSeconds"`
	Requests      float64           `json:"requests"`
	Errors        float64           `json:"errors"`
	ErrorRate     float64           `json:"errorRate"`
	RequestRate   []InsightsSeries  `json:"requestRate"`
	Services      []InsightsService `json:"services"`
}

type ServiceMetric struct {
	Service    string  `json:"service"`
	Endpoint   string  `json:"endpoint"`
	TraceCount float64 `json:"traceCount"`
	ErrorCount float64 `json:"errorCount"`
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
	ID               string   `json:"id"`
	Kind             string   `json:"kind"`
	Name             string   `json:"name"`
	Doc              string   `json:"doc,omitempty"`
	PublicEndpoints  int      `json:"publicEndpoints,omitempty"`
	AuthEndpoints    int      `json:"authEndpoints,omitempty"`
	PrivateEndpoints int      `json:"privateEndpoints,omitempty"`
	Databases        []string `json:"databases,omitempty"`
	CronJobs         []string `json:"cronJobs,omitempty"`
}

type FlowEdge struct {
	Source        string   `json:"source"`
	Target        string   `json:"target"`
	Kind          string   `json:"kind"`
	Count         int64    `json:"count"`
	Static        bool     `json:"static"`
	Observed      bool     `json:"observed"`
	StaticCount   int64    `json:"staticCount,omitempty"`
	ObservedCount int64    `json:"observedCount,omitempty"`
	Details       []string `json:"details,omitempty"`
}

type FlowResponse struct {
	Nodes []FlowNode `json:"nodes"`
	Edges []FlowEdge `json:"edges"`
}

type CatalogResponse struct {
	AppID       string           `json:"appId"`
	MetaJSON    string           `json:"metaJson"`
	OpenAPIJSON string           `json:"openapiJson"`
	Services    []CatalogService `json:"services"`
}

type CatalogService struct {
	Name           string            `json:"name"`
	RelPath        string            `json:"relPath"`
	Doc            string            `json:"doc"`
	Databases      []string          `json:"databases"`
	Metrics        []string          `json:"metrics"`
	Buckets        []CatalogBucket   `json:"buckets"`
	Endpoints      []CatalogEndpoint `json:"endpoints"`
	PublicCount    int               `json:"publicCount"`
	PrivateCount   int               `json:"privateCount"`
	StreamingCount int               `json:"streamingCount"`
}

type CatalogBucket struct {
	Name       string   `json:"name"`
	Operations []string `json:"operations"`
}

type CatalogEndpoint struct {
	ServiceName          string   `json:"serviceName"`
	Name                 string   `json:"name"`
	Method               string   `json:"method"`
	Path                 string   `json:"path"`
	Access               string   `json:"access"`
	Protocol             string   `json:"protocol"`
	Doc                  string   `json:"doc"`
	Summary              string   `json:"summary"`
	Description          string   `json:"description"`
	Exposed              bool     `json:"exposed"`
	AuthRequired         bool     `json:"authRequired"`
	AllowUnauthenticated bool     `json:"allowUnauthenticated"`
	Streaming            bool     `json:"streaming"`
	Tags                 []string `json:"tags"`
	RequestSchemaJSON    string   `json:"requestSchemaJson"`
	ResponseSchemaJSON   string   `json:"responseSchemaJson"`
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
