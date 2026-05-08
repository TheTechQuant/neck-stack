package dash

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestValidateTraceAuthAcceptsPrivateAndSingleDomainPaths(t *testing.T) {
	t.Setenv("NECKDASH_TRACE_AUTH_KEYS", "test-app=trace-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	for _, path := range []string{"/trace", "/__neck_dash/api/trace"} {
		req := signedTraceRequest(t, path, "trace-secret")
		req.Header.Set("X-Encore-App-ID", "test-app")
		if err := validateTraceAuth(req); err != nil {
			t.Fatalf("validateTraceAuth(%q) = %v", path, err)
		}
	}
}

func TestValidateTraceAuthAcceptsCanonicalPathWhenRawEndpointRewritesRequestPath(t *testing.T) {
	t.Setenv("NECKDASH_TRACE_AUTH_KEYS", "test-app=trace-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequest(t, "/trace", "trace-secret")
	req.Header.Set("X-Encore-App-ID", "test-app")
	req.URL.Path = "/"
	if err := validateTraceAuth(req); err != nil {
		t.Fatalf("validateTraceAuth rejected canonical path signature after raw endpoint rewrite: %v", err)
	}
}

func TestValidateTraceAuthAcceptsCaddyForwardedTraceAuthHeader(t *testing.T) {
	t.Setenv("NECKDASH_TRACE_AUTH_KEYS", "test-app=trace-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequest(t, "/__neck_dash/api/trace", "trace-secret")
	req.Header.Set("X-Encore-App-ID", "test-app")
	req.Header.Set("X-Neckdash-Trace-Auth", req.Header.Get("X-Encore-Auth"))
	req.Header.Del("X-Encore-Auth")
	if err := validateTraceAuth(req); err != nil {
		t.Fatalf("validateTraceAuth rejected Caddy-forwarded trace auth header: %v", err)
	}
}

func TestValidateTraceAuthRejectsNonIngestionPathSignature(t *testing.T) {
	t.Setenv("NECKDASH_TRACE_AUTH_KEYS", "test-app=trace-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequest(t, "/not-trace", "trace-secret")
	req.Header.Set("X-Encore-App-ID", "test-app")
	req.URL.Path = "/trace"
	if err := validateTraceAuth(req); err == nil {
		t.Fatal("validateTraceAuth accepted a signature for a non-ingestion path")
	}
}

func TestValidateTraceAuthRequiresConfiguredKey(t *testing.T) {
	t.Setenv("NECKDASH_TRACE_AUTH_KEYS", "")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequest(t, "/trace", "trace-secret")
	req.Header.Set("X-Encore-App-ID", "test-app")
	if err := validateTraceAuth(req); err == nil {
		t.Fatal("validateTraceAuth accepted a request without NECKDASH_TRACE_AUTH_KEYS")
	}
}

func TestValidateTraceAuthRequiresExpectedKeyID(t *testing.T) {
	t.Setenv("NECKDASH_TRACE_AUTH_KEYS", "test-app=trace-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequestWithKeyID(t, "/trace", "trace-secret", 2)
	req.Header.Set("X-Encore-App-ID", "test-app")
	if err := validateTraceAuth(req); err == nil {
		t.Fatal("validateTraceAuth accepted an unexpected key id")
	}
}

func TestValidateTraceAuthUsesAppSpecificKeys(t *testing.T) {
	t.Setenv("NECKDASH_TRACE_AUTH_KEYS", "billing=billing-secret,core=core-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequest(t, "/trace", "billing-secret")
	req.Header.Set("X-Encore-App-ID", "billing")
	if err := validateTraceAuth(req); err != nil {
		t.Fatalf("validateTraceAuth rejected app-specific key: %v", err)
	}
}

func signedTraceRequest(t *testing.T, path string, key string) *http.Request {
	t.Helper()
	return signedTraceRequestWithKeyID(t, path, key, 1)
}

func signedTraceRequestWithKeyID(t *testing.T, path string, key string, keyID uint32) *http.Request {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "https://example.com"+path, nil)
	date := time.Now().UTC().Format(http.TimeFormat)
	req.Header.Set("Date", date)

	mac := hmac.New(sha256.New, []byte(key))
	_, _ = fmt.Fprintf(mac, "%s\x00%s", date, path)
	raw := make([]byte, 4, 4+sha256.Size)
	binary.BigEndian.PutUint32(raw[0:4], keyID)
	raw = mac.Sum(raw)
	req.Header.Set("X-Encore-Auth", base64.RawStdEncoding.EncodeToString(raw))
	return req
}
