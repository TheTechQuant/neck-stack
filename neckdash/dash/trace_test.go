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
	t.Setenv("ENCORE_AUTH_KEY", "trace-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	for _, path := range []string{"/trace", "/__neck_dash/api/trace"} {
		req := signedTraceRequest(t, path, "trace-secret")
		if err := validateTraceAuth(req); err != nil {
			t.Fatalf("validateTraceAuth(%q) = %v", path, err)
		}
	}
}

func TestValidateTraceAuthBindsSignatureToRequestPath(t *testing.T) {
	t.Setenv("ENCORE_AUTH_KEY", "trace-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequest(t, "/trace", "trace-secret")
	req.URL.Path = "/__neck_dash/api/trace"
	if err := validateTraceAuth(req); err == nil {
		t.Fatal("validateTraceAuth accepted a signature for a different path")
	}
}

func TestValidateTraceAuthRequiresConfiguredKey(t *testing.T) {
	t.Setenv("ENCORE_AUTH_KEY", "")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequest(t, "/trace", "trace-secret")
	if err := validateTraceAuth(req); err == nil {
		t.Fatal("validateTraceAuth accepted a request without ENCORE_AUTH_KEY")
	}
}

func TestValidateTraceAuthRequiresExpectedKeyID(t *testing.T) {
	t.Setenv("ENCORE_AUTH_KEY", "trace-secret")
	t.Setenv("NECKDASH_REQUIRE_TRACE_AUTH", "true")

	req := signedTraceRequestWithKeyID(t, "/trace", "trace-secret", 2)
	if err := validateTraceAuth(req); err == nil {
		t.Fatal("validateTraceAuth accepted an unexpected key id")
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
