package dash

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type catalogPath struct {
	Segments []struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"segments"`
}

type catalogOpenAPIOperation struct {
	Summary            string
	Description        string
	Tags               []string
	RequestSchemaJSON  string
	ResponseSchemaJSON string
}

type catalogTag struct {
	Type  any    `json:"type"`
	Value string `json:"value"`
}

func buildCatalog(metaBytes []byte, openapiBytes []byte) []CatalogService {
	if len(metaBytes) == 0 {
		return nil
	}
	var meta struct {
		Pkgs []struct {
			RelPath     string `json:"rel_path"`
			Doc         string `json:"doc"`
			ServiceName string `json:"service_name"`
		} `json:"pkgs"`
		Svcs []struct {
			Name      string   `json:"name"`
			RelPath   string   `json:"rel_path"`
			Databases []string `json:"databases"`
			Metrics   []string `json:"metrics"`
			Buckets   []struct {
				Bucket     string   `json:"bucket"`
				Operations []string `json:"operations"`
			} `json:"buckets"`
			RPCs []struct {
				Name                 string         `json:"name"`
				Doc                  string         `json:"doc"`
				ServiceName          string         `json:"service_name"`
				AccessType           any            `json:"access_type"`
				Proto                any            `json:"proto"`
				Path                 catalogPath    `json:"path"`
				HTTPMethods          []string       `json:"http_methods"`
				Tags                 []catalogTag   `json:"tags"`
				Expose               map[string]any `json:"expose"`
				AllowUnauthenticated bool           `json:"allow_unauthenticated"`
				StreamingRequest     bool           `json:"streaming_request"`
				StreamingResponse    bool           `json:"streaming_response"`
			} `json:"rpcs"`
		} `json:"svcs"`
	}
	if err := json.Unmarshal(metaBytes, &meta); err != nil {
		return nil
	}

	serviceDocs := make(map[string]string)
	for _, pkg := range meta.Pkgs {
		if pkg.Doc == "" {
			continue
		}
		if pkg.ServiceName != "" {
			serviceDocs[pkg.ServiceName] = pkg.Doc
		}
		if pkg.RelPath != "" {
			serviceDocs[pkg.RelPath] = pkg.Doc
		}
	}
	openapiOps := parseOpenAPIOperations(openapiBytes)

	services := make([]CatalogService, 0, len(meta.Svcs))
	for _, svc := range meta.Svcs {
		service := CatalogService{
			Name:      svc.Name,
			RelPath:   svc.RelPath,
			Doc:       valueOr(serviceDocs[svc.Name], serviceDocs[svc.RelPath]),
			Databases: copyStrings(svc.Databases),
			Metrics:   copyStrings(svc.Metrics),
			Buckets:   []CatalogBucket{},
			Endpoints: []CatalogEndpoint{},
		}
		for _, bucket := range svc.Buckets {
			service.Buckets = append(service.Buckets, CatalogBucket{
				Name:       bucket.Bucket,
				Operations: copyStrings(bucket.Operations),
			})
		}
		for _, rpc := range svc.RPCs {
			method := "POST"
			if len(rpc.HTTPMethods) > 0 && rpc.HTTPMethods[0] != "" {
				method = strings.ToUpper(rpc.HTTPMethods[0])
			}
			route := catalogPathString(rpc.Path)
			operation := openapiOps[strings.ToUpper(method)+" "+normalizeOpenAPIPath(route)]
			summary, description := splitDoc(rpc.Doc)
			if summary == "" {
				summary = operation.Summary
			}
			if description == "" {
				description = operation.Description
			}
			access := catalogAccess(rpc.AccessType, len(rpc.Expose) > 0, rpc.AllowUnauthenticated)
			tags := catalogTags(rpc.Tags)
			if len(tags) == 0 {
				tags = operation.Tags
			}
			endpoint := CatalogEndpoint{
				ServiceName:          valueOr(rpc.ServiceName, svc.Name),
				Name:                 rpc.Name,
				Method:               method,
				Path:                 route,
				Access:               access,
				Protocol:             catalogProtocol(rpc.Proto),
				Doc:                  rpc.Doc,
				Summary:              summary,
				Description:          description,
				Exposed:              len(rpc.Expose) > 0,
				AuthRequired:         access == "auth",
				AllowUnauthenticated: rpc.AllowUnauthenticated,
				Streaming:            rpc.StreamingRequest || rpc.StreamingResponse,
				Tags:                 copyStrings(tags),
				RequestSchemaJSON:    operation.RequestSchemaJSON,
				ResponseSchemaJSON:   operation.ResponseSchemaJSON,
			}
			if endpoint.Exposed {
				service.PublicCount++
			} else {
				service.PrivateCount++
			}
			if endpoint.Streaming {
				service.StreamingCount++
			}
			service.Endpoints = append(service.Endpoints, endpoint)
		}
		sort.Slice(service.Endpoints, func(i, j int) bool {
			if service.Endpoints[i].Path == service.Endpoints[j].Path {
				return service.Endpoints[i].Method < service.Endpoints[j].Method
			}
			return service.Endpoints[i].Path < service.Endpoints[j].Path
		})
		services = append(services, service)
	}
	sort.Slice(services, func(i, j int) bool { return services[i].Name < services[j].Name })
	return services
}

func copyStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	return append([]string(nil), values...)
}

func catalogPathString(path catalogPath) string {
	if len(path.Segments) == 0 {
		return "/"
	}
	parts := make([]string, 0, len(path.Segments))
	for _, segment := range path.Segments {
		switch strings.ToUpper(segment.Type) {
		case "PARAM":
			parts = append(parts, ":"+segment.Value)
		case "WILDCARD", "FALLBACK":
			parts = append(parts, "*"+valueOr(segment.Value, "path"))
		default:
			parts = append(parts, segment.Value)
		}
	}
	return "/" + strings.Join(parts, "/")
}

func parseOpenAPIOperations(data []byte) map[string]catalogOpenAPIOperation {
	operations := make(map[string]catalogOpenAPIOperation)
	if len(data) == 0 {
		return operations
	}
	var spec struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(data, &spec); err != nil {
		return operations
	}
	for route, methods := range spec.Paths {
		for method, raw := range methods {
			var op struct {
				Summary     string   `json:"summary"`
				Description string   `json:"description"`
				Tags        []string `json:"tags"`
				RequestBody struct {
					Content map[string]struct {
						Schema any `json:"schema"`
					} `json:"content"`
				} `json:"requestBody"`
				Responses map[string]struct {
					Content map[string]struct {
						Schema any `json:"schema"`
					} `json:"content"`
				} `json:"responses"`
			}
			if err := json.Unmarshal(raw, &op); err != nil {
				continue
			}
			operations[strings.ToUpper(method)+" "+normalizeOpenAPIPath(route)] = catalogOpenAPIOperation{
				Summary:            op.Summary,
				Description:        op.Description,
				Tags:               op.Tags,
				RequestSchemaJSON:  schemaJSON(op.RequestBody.Content),
				ResponseSchemaJSON: responseSchemaJSON(op.Responses),
			}
		}
	}
	return operations
}

func schemaJSON(content map[string]struct {
	Schema any `json:"schema"`
}) string {
	if item, ok := content["application/json"]; ok {
		return marshalPrettyJSON(item.Schema)
	}
	for _, item := range content {
		return marshalPrettyJSON(item.Schema)
	}
	return ""
}

func responseSchemaJSON(responses map[string]struct {
	Content map[string]struct {
		Schema any `json:"schema"`
	} `json:"content"`
}) string {
	for code, response := range responses {
		if strings.HasPrefix(code, "2") {
			if schema := schemaJSON(response.Content); schema != "" {
				return schema
			}
		}
	}
	if response, ok := responses["default"]; ok {
		return schemaJSON(response.Content)
	}
	return ""
}

func marshalPrettyJSON(value any) string {
	if value == nil {
		return ""
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return ""
	}
	return string(data)
}

func splitDoc(doc string) (string, string) {
	lines := strings.Split(strings.TrimSpace(doc), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) == "" {
		return "", ""
	}
	summary := strings.TrimSpace(lines[0])
	if len(lines) == 1 {
		return summary, ""
	}
	return summary, strings.TrimSpace(strings.Join(lines[1:], "\n"))
}

func catalogAccess(raw any, exposed bool, allowUnauthenticated bool) string {
	switch strings.ToUpper(fmt.Sprint(raw)) {
	case "2", "AUTH", "RPC_ACCESS_TYPE_AUTH":
		return "auth"
	case "1", "PUBLIC", "RPC_ACCESS_TYPE_PUBLIC":
		return "public"
	}
	if exposed && !allowUnauthenticated {
		return "auth"
	}
	if exposed {
		return "public"
	}
	return "private"
}

func catalogProtocol(raw any) string {
	switch strings.ToUpper(fmt.Sprint(raw)) {
	case "1", "RAW", "RPC_PROTOCOL_RAW":
		return "raw"
	default:
		return "regular"
	}
}

func catalogTags(tags []catalogTag) []string {
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		if tag.Value != "" {
			out = append(out, tag.Value)
		}
	}
	sort.Strings(out)
	return out
}

func normalizeOpenAPIPath(path string) string {
	parts := strings.Split(path, "/")
	for i, part := range parts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			parts[i] = ":" + strings.TrimSuffix(strings.TrimPrefix(part, "{"), "}")
		}
	}
	return strings.Join(parts, "/")
}
