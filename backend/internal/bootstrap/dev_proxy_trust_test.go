package bootstrap

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

const (
	devProxyToken    = "compose-dev-proxy"
	devLaunchToken   = "compose-dev-launch"
	devUIBootstrap   = "compose-dev-ui-bootstrap"
	devCanvasID      = "dev-proxy-canvas"
	devProxyRemote   = "172.19.0.3:12345"
	devProxyHost     = "backend:8080"
	devBrowserOrigin = "http://localhost:3000"
)

type devProxyHarness struct {
	rt      *Runtime
	browser string
}

func newDevProxyHarness(t *testing.T) *devProxyHarness {
	t.Helper()
	rt, err := Open(context.Background(), Config{
		Profile:          ProfileServer,
		DataDir:          t.TempDir(),
		ListenAddr:       "127.0.0.1:0",
		LaunchToken:      devLaunchToken,
		UIBootstrapToken: devUIBootstrap,
		DevProxyToken:    devProxyToken,
		AutoMigrate:      true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rt.Close(context.Background()) })
	return &devProxyHarness{rt: rt, browser: devBrowserOrigin}
}

func (h *devProxyHarness) call(method, path, body string, proxy, launch, ui bool) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "http://"+devProxyHost+"/api"+path, strings.NewReader(body))
	request.RemoteAddr = devProxyRemote
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", h.browser)
	if proxy {
		request.Header.Set("X-Beeftv-Dev-Proxy", devProxyToken)
	}
	if launch {
		request.Header.Set("X-Desktop-Token", devLaunchToken)
	}
	if ui {
		request.Header.Set("X-Beeftv-UI-Bootstrap", devUIBootstrap)
	}
	response := httptest.NewRecorder()
	h.rt.Handler().ServeHTTP(response, request)
	return response
}

func seedDevProxyCanvas(t *testing.T, rt *Runtime) int64 {
	t.Helper()
	owner, err := rt.service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rt.service.UpsertUserCanvasProject(owner.ID, []byte(`{"id":"`+devCanvasID+`","title":"Dev","revision":0,"nodes":[],"connections":[]}`)); err != nil {
		t.Fatal(err)
	}
	raw, err := rt.service.UserCanvasProject(owner.ID, devCanvasID)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Revision int64 `json:"revision"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	return doc.Revision
}

func TestServerDevProxyBootstrapIssuesUISessionAndCommitsOnce(t *testing.T) {
	h := newDevProxyHarness(t)
	revision := seedDevProxyCanvas(t, h.rt)

	issued := h.call(http.MethodPost, "/assistant/ui-session", `{}`, true, true, true)
	if issued.Code != http.StatusOK {
		t.Fatalf("ui-session status = %d: %s", issued.Code, issued.Body.String())
	}
	data, reason := decodeEnvelope(t, issued)
	if reason != "" {
		t.Fatalf("ui-session reason = %q", reason)
	}
	sessionToken, _ := data["token"].(string)
	if sessionToken == "" {
		t.Fatalf("ui-session did not issue a token: %s", issued.Body.String())
	}

	body := `{"opId":"dev-proxy-commit","params":{"canvasId":"` + devCanvasID + `","expectedRevision":` +
		jsonNumber(revision) + `,"document":{"title":"Committed through Vite proxy","nodes":[],"connections":[]}}}`
	committed := h.call(http.MethodPost, "/ops/canvas.document.commit", body, true, true, true)
	if committed.Code != http.StatusOK {
		t.Fatalf("commit status = %d: %s", committed.Code, committed.Body.String())
	}
	commitData, commitReason := decodeEnvelope(t, committed)
	if commitReason != "" {
		t.Fatalf("commit reason = %q", commitReason)
	}
	if commitData["caller"] != "manual" || commitData["replayed"] != false {
		t.Fatalf("unexpected commit caller/replay: %#v", commitData)
	}

	replayed := h.call(http.MethodPost, "/ops/canvas.document.commit", body, true, true, true)
	if replayed.Code != http.StatusOK {
		t.Fatalf("replayed commit status = %d: %s", replayed.Code, replayed.Body.String())
	}
	replayData, _ := decodeEnvelope(t, replayed)
	if replayData["replayed"] != true {
		t.Fatalf("same op id was not replayed: %#v", replayData)
	}

	var receipts int64
	if err := h.rt.db.Model(&model.AgentOpRecord{}).Where("op_id = ?", "dev-proxy-commit").Count(&receipts).Error; err != nil {
		t.Fatal(err)
	}
	if receipts != 1 {
		t.Fatalf("operation receipts = %d, want 1", receipts)
	}
}

func TestServerDevProxyTrustRequiresEveryCredential(t *testing.T) {
	h := newDevProxyHarness(t)
	for _, tc := range []struct {
		name               string
		proxy, launch, ui  bool
		wantReasonContains string
	}{
		{name: "missing-proxy", launch: true, ui: true, wantReasonContains: "dev_proxy_token_required"},
		{name: "missing-launch", proxy: true, ui: true, wantReasonContains: "desktop_token_required"},
		{name: "missing-ui", proxy: true, launch: true, wantReasonContains: "forbidden"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := "/assistant/ui-session"
			if tc.name == "missing-ui" {
				path = "/ops/canvas.get"
			}
			response := h.call(http.MethodPost, path, `{"params":{"canvasId":"missing"}}`, tc.proxy, tc.launch, tc.ui)
			if response.Code != http.StatusForbidden {
				t.Fatalf("status = %d: %s", response.Code, response.Body.String())
			}
			if !strings.Contains(response.Body.String(), tc.wantReasonContains) {
				t.Fatalf("body = %s, want reason containing %q", response.Body.String(), tc.wantReasonContains)
			}
		})
	}
}

func TestServerDefaultsHaveNoDesktopTrust(t *testing.T) {
	rt, err := Open(context.Background(), Config{Profile: ProfileServer, DataDir: t.TempDir(), ListenAddr: "127.0.0.1:0", AutoMigrate: true})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close(context.Background())
	if rt.LaunchToken() != "" || rt.UIBootstrapToken() != "" {
		t.Fatalf("server defaults issued desktop credentials: launch=%q ui=%q", rt.LaunchToken(), rt.UIBootstrapToken())
	}
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/assistant/ui-session", strings.NewReader(`{}`))
	request.RemoteAddr = "127.0.0.1:12345"
	response := httptest.NewRecorder()
	rt.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("server default ui-session status = %d, want 403", response.Code)
	}
}

func TestDevProxyTrustRejectsDesktopProfile(t *testing.T) {
	_, err := Open(context.Background(), Config{
		Profile: ProfileDesktop, DataDir: t.TempDir(), ListenAddr: "127.0.0.1:0", AutoMigrate: true,
		DevProxyToken: devProxyToken,
	})
	if err == nil {
		t.Fatal("desktop profile accepted a server-only dev proxy token")
	}
}

func jsonNumber(value int64) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}
