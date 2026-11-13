package httptransport

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
)

const LaunchTokenHeader = "X-Desktop-Token"
const DevProxyTokenHeader = "X-Beeftv-Dev-Proxy"

type desktopAuthenticatedKey struct{}
type devProxyAuthenticatedKey struct{}

// DesktopAuthenticated can only be set after the launch credential was verified.
func DesktopAuthenticated(r *http.Request) bool {
	trusted, _ := r.Context().Value(desktopAuthenticatedKey{}).(bool)
	return trusted
}

// DevProxyAuthenticated is set only by RequireDevProxyToken. It marks the
// loopback development proxy boundary, not a browser identity.
func DevProxyAuthenticated(r *http.Request) bool {
	trusted, _ := r.Context().Value(devProxyAuthenticatedKey{}).(bool)
	return trusted
}

func NewLaunchToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func RequireLaunchToken(token string) func(http.Handler) http.Handler {
	want := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions || r.URL.Path == "/api/health/live" {
				next.ServeHTTP(w, r)
				return
			}
			got := []byte(r.Header.Get(LaunchTokenHeader))
			if len(want) == 0 || len(got) != len(want) || subtle.ConstantTimeCompare(got, want) != 1 {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code":   http.StatusForbidden,
					"data":   nil,
					"msg":    "桌面运行时授权无效",
					"reason": "desktop_token_required",
				})
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), desktopAuthenticatedKey{}, true)))
		})
	}
}

// RequireDevProxyToken is for docker-compose.dev only. The Vite proxy injects
// this shared header after the browser request arrives.
func RequireDevProxyToken(token string) func(http.Handler) http.Handler {
	want := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions || r.URL.Path == "/api/health/live" {
				next.ServeHTTP(w, r)
				return
			}
			got := []byte(r.Header.Get(DevProxyTokenHeader))
			if len(want) == 0 || len(got) != len(want) || subtle.ConstantTimeCompare(got, want) != 1 {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code":   http.StatusForbidden,
					"data":   nil,
					"msg":    "dev proxy trust required",
					"reason": "dev_proxy_token_required",
				})
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), devProxyAuthenticatedKey{}, true)))
		})
	}
}
