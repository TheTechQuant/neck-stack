package dash

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type flowMeta struct {
	Pkgs []struct {
		RelPath     string `json:"rel_path"`
		Doc         string `json:"doc"`
		ServiceName string `json:"service_name"`
		RPCCalls    []struct {
			Pkg  string `json:"pkg"`
			Name string `json:"name"`
		} `json:"rpc_calls"`
	} `json:"pkgs"`
	Svcs []struct {
		Name      string   `json:"name"`
		RelPath   string   `json:"rel_path"`
		Databases []string `json:"databases"`
		RPCs      []struct {
			Name       string `json:"name"`
			AccessType any    `json:"access_type"`
		} `json:"rpcs"`
	} `json:"svcs"`
	CronJobs []struct {
		ID       string `json:"id"`
		Title    string `json:"title"`
		Endpoint struct {
			Pkg string `json:"pkg"`
		} `json:"endpoint"`
	} `json:"cron_jobs"`
	PubSubTopics []struct {
		Name       string  `json:"name"`
		Doc        *string `json:"doc"`
		Publishers []struct {
			ServiceName string `json:"service_name"`
		} `json:"publishers"`
		Subscriptions []struct {
			Name        string `json:"name"`
			ServiceName string `json:"service_name"`
		} `json:"subscriptions"`
	} `json:"pubsub_topics"`
}

type flowEdgeAccumulator struct {
	edge FlowEdge
}

// Flow returns an Encore Flow-style dependency graph from generated metadata plus observed servicegraph counts.
//
//encore:api public method=GET path=/flow
func Flow(ctx context.Context) (*FlowResponse, error) {
	data, _ := os.ReadFile(env("NECKDASH_META_PATH", "/catalog/meta.json"))
	nodes, edgeMap := catalogFlow(data)
	seenNodes := make(map[string]bool, len(nodes))
	for _, node := range nodes {
		seenNodes[node.ID] = true
	}

	for _, observed := range observedFlowEdges(ctx) {
		sourceID := flowServiceID(observed.Source)
		targetID := flowServiceID(observed.Target)
		if !seenNodes[sourceID] {
			nodes = append(nodes, FlowNode{ID: sourceID, Kind: "service", Name: observed.Source})
			seenNodes[sourceID] = true
		}
		if !seenNodes[targetID] {
			nodes = append(nodes, FlowNode{ID: targetID, Kind: "service", Name: observed.Target})
			seenNodes[targetID] = true
		}
		mergeFlowEdge(edgeMap, FlowEdge{
			Source:        sourceID,
			Target:        targetID,
			Kind:          "rpc",
			Observed:      true,
			ObservedCount: observed.Count,
			Count:         observed.Count,
		})
	}

	edges := make([]FlowEdge, 0, len(edgeMap))
	for _, acc := range edgeMap {
		edge := acc.edge
		if edge.Count == 0 {
			edge.Count = edge.ObservedCount
		}
		if edge.Count == 0 {
			edge.Count = edge.StaticCount
		}
		edges = append(edges, edge)
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].Kind == nodes[j].Kind {
			return nodes[i].Name < nodes[j].Name
		}
		return nodes[i].Kind < nodes[j].Kind
	})
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].Source == edges[j].Source {
			if edges[i].Target == edges[j].Target {
				return edges[i].Kind < edges[j].Kind
			}
			return edges[i].Target < edges[j].Target
		}
		return edges[i].Source < edges[j].Source
	})
	return &FlowResponse{Nodes: nodes, Edges: edges}, nil
}

func observedFlowEdges(ctx context.Context) []FlowEdge {
	end := time.Now().UnixMilli()
	var raw struct {
		Data []struct {
			Parent    string `json:"parent"`
			Child     string `json:"child"`
			CallCount int64  `json:"callCount"`
		} `json:"data"`
	}
	endpoint := fmt.Sprintf("%s/api/dependencies?endTs=%d&lookback=%d", victoriaTracesQueryURL(), end, int64(time.Hour/time.Millisecond))
	if err := getJSON(ctx, endpoint, &raw); err != nil {
		return nil
	}
	edges := make([]FlowEdge, 0, len(raw.Data))
	for _, item := range raw.Data {
		if item.Parent == "" || item.Child == "" {
			continue
		}
		edges = append(edges, FlowEdge{Source: item.Parent, Target: item.Child, Count: item.CallCount})
	}
	return edges
}

func catalogFlow(data []byte) ([]FlowNode, map[string]*flowEdgeAccumulator) {
	if len(data) == 0 {
		return nil, make(map[string]*flowEdgeAccumulator)
	}
	var meta flowMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, make(map[string]*flowEdgeAccumulator)
	}

	packageToService := make(map[string]string)
	serviceToPackages := make(map[string][]string)
	serviceDocs := make(map[string]string)
	for _, pkg := range meta.Pkgs {
		if pkg.ServiceName == "" {
			continue
		}
		packageToService[pkg.RelPath] = pkg.ServiceName
		serviceToPackages[pkg.ServiceName] = append(serviceToPackages[pkg.ServiceName], pkg.RelPath)
		if pkg.Doc != "" && serviceDocs[pkg.ServiceName] == "" {
			serviceDocs[pkg.ServiceName] = pkg.Doc
		}
	}

	seenNodes := make(map[string]bool)
	nodes := make([]FlowNode, 0, len(meta.Svcs)+len(meta.PubSubTopics))
	addNode := func(node FlowNode) {
		if node.ID == "" || seenNodes[node.ID] {
			return
		}
		seenNodes[node.ID] = true
		nodes = append(nodes, node)
	}

	serviceNames := make(map[string]bool, len(meta.Svcs))
	for _, svc := range meta.Svcs {
		serviceNames[svc.Name] = true
		counts := flowEndpointCounts(svc.RPCs)
		addNode(FlowNode{
			ID:               flowServiceID(svc.Name),
			Kind:             "service",
			Name:             svc.Name,
			Doc:              serviceDocs[svc.Name],
			PublicEndpoints:  counts.public,
			AuthEndpoints:    counts.auth,
			PrivateEndpoints: counts.private,
			Databases:        copyStrings(svc.Databases),
			CronJobs:         flowServiceCronTitles(meta.CronJobs, serviceToPackages[svc.Name]),
		})
	}
	for _, topic := range meta.PubSubTopics {
		doc := ""
		if topic.Doc != nil {
			doc = *topic.Doc
		}
		addNode(FlowNode{ID: flowTopicID(topic.Name), Kind: "topic", Name: topic.Name, Doc: doc})
	}

	edges := make(map[string]*flowEdgeAccumulator)
	for _, pkg := range meta.Pkgs {
		sourceService := packageToService[pkg.RelPath]
		if sourceService == "" {
			continue
		}
		for _, rpc := range pkg.RPCCalls {
			targetService := packageToService[rpc.Pkg]
			if targetService == "" || targetService == sourceService {
				continue
			}
			mergeFlowEdge(edges, FlowEdge{
				Source:      flowServiceID(sourceService),
				Target:      flowServiceID(targetService),
				Kind:        "rpc",
				Static:      true,
				StaticCount: 1,
				Count:       1,
				Details:     []string{valueOr(rpc.Name, rpc.Pkg)},
			})
		}
	}

	for _, svc := range meta.Svcs {
		for _, database := range svc.Databases {
			if database == svc.Name || !serviceNames[database] {
				continue
			}
			mergeFlowEdge(edges, FlowEdge{
				Source:      flowServiceID(svc.Name),
				Target:      flowServiceID(database),
				Kind:        "database",
				Static:      true,
				StaticCount: 1,
				Count:       1,
				Details:     []string{database},
			})
		}
	}

	for _, topic := range meta.PubSubTopics {
		topicID := flowTopicID(topic.Name)
		for _, publisher := range topic.Publishers {
			if publisher.ServiceName == "" {
				continue
			}
			mergeFlowEdge(edges, FlowEdge{
				Source:      flowServiceID(publisher.ServiceName),
				Target:      topicID,
				Kind:        "publish",
				Static:      true,
				StaticCount: 1,
				Count:       1,
				Details:     []string{topic.Name},
			})
		}
		for _, subscription := range topic.Subscriptions {
			if subscription.ServiceName == "" {
				continue
			}
			mergeFlowEdge(edges, FlowEdge{
				Source:      topicID,
				Target:      flowServiceID(subscription.ServiceName),
				Kind:        "subscription",
				Static:      true,
				StaticCount: 1,
				Count:       1,
				Details:     []string{valueOr(subscription.Name, topic.Name)},
			})
		}
	}

	return nodes, edges
}

func mergeFlowEdge(edges map[string]*flowEdgeAccumulator, edge FlowEdge) {
	key := edge.Source + "\x00" + edge.Target + "\x00" + edge.Kind
	acc := edges[key]
	if acc == nil {
		if edge.StaticCount == 0 && edge.Static {
			edge.StaticCount = 1
		}
		if edge.ObservedCount == 0 && edge.Observed {
			edge.ObservedCount = edge.Count
		}
		edges[key] = &flowEdgeAccumulator{edge: edge}
		return
	}
	acc.edge.Static = acc.edge.Static || edge.Static
	acc.edge.Observed = acc.edge.Observed || edge.Observed
	acc.edge.StaticCount += edge.StaticCount
	acc.edge.ObservedCount += edge.ObservedCount
	acc.edge.Count += edge.Count
	acc.edge.Details = append(acc.edge.Details, edge.Details...)
}

func flowEndpointCounts(rpcs []struct {
	Name       string `json:"name"`
	AccessType any    `json:"access_type"`
}) struct{ public, auth, private int } {
	var counts struct{ public, auth, private int }
	for _, rpc := range rpcs {
		switch flowAccessType(rpc.AccessType) {
		case "public":
			counts.public++
		case "auth":
			counts.auth++
		default:
			counts.private++
		}
	}
	return counts
}

func flowAccessType(raw any) string {
	switch typed := raw.(type) {
	case string:
		value := strings.ToLower(typed)
		switch {
		case strings.Contains(value, "public") || value == "1":
			return "public"
		case strings.Contains(value, "auth") || value == "2":
			return "auth"
		default:
			return "private"
		}
	case float64:
		switch int(typed) {
		case 1:
			return "public"
		case 2:
			return "auth"
		default:
			return "private"
		}
	case int:
		switch typed {
		case 1:
			return "public"
		case 2:
			return "auth"
		default:
			return "private"
		}
	default:
		value := strings.ToLower(fmt.Sprint(raw))
		if parsed, err := strconv.Atoi(value); err == nil {
			return flowAccessType(parsed)
		}
		if strings.Contains(value, "public") {
			return "public"
		}
		if strings.Contains(value, "auth") {
			return "auth"
		}
		return "private"
	}
}

func flowServiceCronTitles(crons []struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Endpoint struct {
		Pkg string `json:"pkg"`
	} `json:"endpoint"`
}, packages []string) []string {
	if len(crons) == 0 || len(packages) == 0 {
		return []string{}
	}
	ownedPackages := make(map[string]bool, len(packages))
	for _, pkg := range packages {
		ownedPackages[pkg] = true
	}
	var titles []string
	for _, cron := range crons {
		if ownedPackages[cron.Endpoint.Pkg] {
			titles = append(titles, valueOr(cron.Title, cron.ID))
		}
	}
	sort.Strings(titles)
	return titles
}

func flowServiceID(name string) string {
	if strings.HasPrefix(name, "service:") {
		return name
	}
	return "service:" + name
}

func flowTopicID(name string) string {
	if strings.HasPrefix(name, "topic:") {
		return name
	}
	return "topic:" + name
}
