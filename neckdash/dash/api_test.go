package dash

import (
	"testing"
	"time"
)

func TestResolveInsightsWindow(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		wantID       string
		wantDuration time.Duration
		wantStep     int64
		wantRate     string
	}{
		{name: "ten minutes", input: "10m", wantID: "10m", wantDuration: 10 * time.Minute, wantStep: 15, wantRate: "1m"},
		{name: "one hour", input: "1h", wantID: "1h", wantDuration: time.Hour, wantStep: 60, wantRate: "2m"},
		{name: "eight hours", input: "8h", wantID: "8h", wantDuration: 8 * time.Hour, wantStep: 300, wantRate: "10m"},
		{name: "three days", input: "3d", wantID: "3d", wantDuration: 72 * time.Hour, wantStep: 3600, wantRate: "2h"},
		{name: "seven days", input: "7d", wantID: "7d", wantDuration: 7 * 24 * time.Hour, wantStep: 7200, wantRate: "4h"},
		{name: "default", input: "", wantID: "24h", wantDuration: 24 * time.Hour, wantStep: 900, wantRate: "30m"},
		{name: "unknown default", input: "forever", wantID: "24h", wantDuration: 24 * time.Hour, wantStep: 900, wantRate: "30m"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveInsightsWindow(tt.input)
			if got.ID != tt.wantID {
				t.Fatalf("ID = %q, want %q", got.ID, tt.wantID)
			}
			if got.Duration != tt.wantDuration {
				t.Fatalf("Duration = %s, want %s", got.Duration, tt.wantDuration)
			}
			if got.StepSeconds != tt.wantStep {
				t.Fatalf("StepSeconds = %d, want %d", got.StepSeconds, tt.wantStep)
			}
			if got.RateWindow != tt.wantRate {
				t.Fatalf("RateWindow = %q, want %q", got.RateWindow, tt.wantRate)
			}
		})
	}
}

func TestVictoriaMetricsRangeQueryURL(t *testing.T) {
	t.Setenv("VICTORIA_METRICS_QUERY_URL", "http://metrics:8428/api/v1/query")
	t.Setenv("VICTORIA_METRICS_RANGE_QUERY_URL", "")
	if got := victoriaMetricsRangeQueryURL(); got != "http://metrics:8428/api/v1/query_range" {
		t.Fatalf("range URL = %q", got)
	}

	t.Setenv("VICTORIA_METRICS_RANGE_QUERY_URL", "http://metrics/select/0/prometheus/api/v1/query_range")
	if got := victoriaMetricsRangeQueryURL(); got != "http://metrics/select/0/prometheus/api/v1/query_range" {
		t.Fatalf("override range URL = %q", got)
	}
}

func TestMetricAppFilter(t *testing.T) {
	if got := metricAppFilter("billing"); got != `{app_id="billing"}` {
		t.Fatalf("filter = %q", got)
	}
	if got := mergeMetricFilter(metricAppFilter("billing"), `code!="ok"`); got != `{app_id="billing",code!="ok"}` {
		t.Fatalf("merged filter = %q", got)
	}
}

func TestCatalogFlowBuildsEncoreFlowModel(t *testing.T) {
	meta := []byte(`{
		"pkgs": [
			{
				"rel_path": "api",
				"service_name": "api",
				"doc": "API service.",
				"rpc_calls": [{"pkg": "worker", "name": "Process"}]
			},
			{"rel_path": "worker", "service_name": "worker", "doc": "Worker service."}
		],
		"svcs": [
			{
				"name": "api",
				"rel_path": "api",
				"databases": ["api", "worker"],
				"rpcs": [
					{"name": "Ping", "access_type": 1},
					{"name": "Profile", "access_type": 2},
					{"name": "Internal", "access_type": 0}
				]
			},
			{"name": "worker", "rel_path": "worker", "databases": ["worker"], "rpcs": []}
		],
		"cron_jobs": [
			{"id": "api-refresh", "title": "Refresh API", "endpoint": {"pkg": "api"}}
		],
		"pubsub_topics": [
			{
				"name": "events",
				"doc": "Domain events.",
				"publishers": [{"service_name": "api"}],
				"subscriptions": [{"name": "handle-events", "service_name": "worker"}]
			}
		]
	}`)

	nodes, edges := catalogFlow(meta)

	apiNode := findFlowNode(t, nodes, "service:api")
	if apiNode.Kind != "service" || apiNode.Name != "api" || apiNode.Doc != "API service." {
		t.Fatalf("api node = %#v", apiNode)
	}
	if apiNode.PublicEndpoints != 1 || apiNode.AuthEndpoints != 1 || apiNode.PrivateEndpoints != 1 {
		t.Fatalf("endpoint counts = public %d auth %d private %d", apiNode.PublicEndpoints, apiNode.AuthEndpoints, apiNode.PrivateEndpoints)
	}
	if len(apiNode.Databases) != 2 || apiNode.Databases[0] != "api" || apiNode.Databases[1] != "worker" {
		t.Fatalf("databases = %#v", apiNode.Databases)
	}
	if len(apiNode.CronJobs) != 1 || apiNode.CronJobs[0] != "Refresh API" {
		t.Fatalf("cron jobs = %#v", apiNode.CronJobs)
	}

	topicNode := findFlowNode(t, nodes, "topic:events")
	if topicNode.Kind != "topic" || topicNode.Doc != "Domain events." {
		t.Fatalf("topic node = %#v", topicNode)
	}

	assertFlowEdge(t, edges, "service:api", "service:worker", "rpc", 1)
	assertFlowEdge(t, edges, "service:api", "service:worker", "database", 1)
	assertFlowEdge(t, edges, "service:api", "topic:events", "publish", 1)
	assertFlowEdge(t, edges, "topic:events", "service:worker", "subscription", 1)
}

func findFlowNode(t *testing.T, nodes []FlowNode, id string) FlowNode {
	t.Helper()
	for _, node := range nodes {
		if node.ID == id {
			return node
		}
	}
	t.Fatalf("missing node %q in %#v", id, nodes)
	return FlowNode{}
}

func assertFlowEdge(t *testing.T, edges map[string]*flowEdgeAccumulator, source string, target string, kind string, count int64) {
	t.Helper()
	key := source + "\x00" + target + "\x00" + kind
	edge, ok := edges[key]
	if !ok {
		t.Fatalf("missing edge %s -> %s (%s)", source, target, kind)
	}
	if edge.edge.Count != count || edge.edge.StaticCount != count || !edge.edge.Static {
		t.Fatalf("edge = %#v, want static count %d", edge.edge, count)
	}
}
