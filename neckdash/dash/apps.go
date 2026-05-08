package dash

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"encore.dev/beta/errs"
)

type appCatalog struct {
	app          DashApp
	metaBytes    []byte
	openAPIBytes []byte
}

// ListApps returns Encore apps discovered by the shared per-server dashboard.
//
//encore:api public method=GET path=/apps
func ListApps(ctx context.Context) (*AppsResponse, error) {
	apps := discoverApps()
	defaultApp := ""
	if len(apps) > 0 {
		defaultApp = apps[0].ID
	}
	return &AppsResponse{Apps: apps, DefaultApp: defaultApp}, nil
}

func selectedCatalog(appID string) (appCatalog, error) {
	appID = strings.TrimSpace(appID)
	apps := discoverApps()
	if len(apps) == 0 {
		return appCatalog{}, nil
	}

	selected := apps[0]
	if appID != "" {
		found := false
		for _, app := range apps {
			if app.ID == appID {
				selected = app
				found = true
				break
			}
		}
		if !found {
			return appCatalog{}, errs.B().Code(errs.NotFound).Msg("unknown app").Err()
		}
	}

	metaBytes, _ := os.ReadFile(selected.MetaPath)
	openAPIBytes, _ := os.ReadFile(selected.OpenAPIPath)
	return appCatalog{app: selected, metaBytes: metaBytes, openAPIBytes: openAPIBytes}, nil
}

func discoverApps() []DashApp {
	seen := make(map[string]DashApp)

	if root := strings.TrimSpace(env("NECKDASH_APPS_ROOT", "")); root != "" {
		_ = filepath.WalkDir(root, func(filePath string, entry os.DirEntry, err error) error {
			if err != nil || entry.IsDir() || filepath.Base(filePath) != "meta.json" {
				return nil
			}
			normalized := filepath.ToSlash(filePath)
			if !strings.HasSuffix(normalized, "/deploy/encore/meta.json") {
				return nil
			}
			metaPath := filePath
			appRoot := filepath.Clean(filepath.Join(filepath.Dir(metaPath), "..", ".."))
			openAPIPath := filepath.Join(appRoot, "docs", "openapi.json")
			app := dashAppFromPaths(metaPath, openAPIPath, filepath.Base(appRoot))
			if app.ID != "" {
				seen[app.ID] = app
			}
			return nil
		})
	}

	if metaPath := strings.TrimSpace(env("NECKDASH_META_PATH", "")); metaPath != "" {
		openAPIPath := strings.TrimSpace(env("NECKDASH_OPENAPI_PATH", ""))
		app := dashAppFromPaths(metaPath, openAPIPath, env("NECKDASH_APP_ID", "app"))
		if app.ID != "" {
			seen[app.ID] = app
		}
	}

	apps := make([]DashApp, 0, len(seen))
	for _, app := range seen {
		apps = append(apps, app)
	}
	sort.Slice(apps, func(i, j int) bool { return apps[i].ID < apps[j].ID })
	return apps
}

func dashAppFromPaths(metaPath string, openAPIPath string, fallbackID string) DashApp {
	id := appIDFromMeta(metaPath)
	if id == "" {
		id = sanitizeAppID(fallbackID)
	}
	app := DashApp{
		ID:          id,
		Name:        id,
		MetaPath:    metaPath,
		OpenAPIPath: openAPIPath,
		HasMeta:     fileExists(metaPath),
		HasOpenAPI:  fileExists(openAPIPath),
	}
	return app
}

func appIDFromMeta(metaPath string) string {
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return ""
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return ""
	}
	for _, key := range []string{"app_id", "appId", "app_slug", "appSlug", "id", "slug"} {
		if value := strings.TrimSpace(stringValue(raw[key], "")); value != "" {
			return sanitizeAppID(value)
		}
	}
	return ""
}

func sanitizeAppID(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimSuffix(value, filepath.Ext(value))
	value = strings.Trim(value, "._- ")
	if value == "" {
		return ""
	}
	return value
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
