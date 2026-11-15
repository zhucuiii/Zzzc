package generation

import (
	"bytes"
	"io"
	"testing"
)

type protocolUploadTestResources struct {
	ResourcePort
	files map[string][]byte
}

func (r protocolUploadTestResources) Lookup(_ string, resourceID string) (ResourceInfo, error) {
	data := r.files[resourceID]
	return ResourceInfo{
		ID:       resourceID,
		Status:   "ready",
		MimeType: "image/png",
		Size:     int64(len(data)),
	}, nil
}

func (r protocolUploadTestResources) LocalMode() bool {
	return true
}

func (r protocolUploadTestResources) Open(_ string, resourceID string) (ResourceInfo, io.ReadCloser, error) {
	data := r.files[resourceID]
	return ResourceInfo{
		ID:       resourceID,
		Status:   "ready",
		MimeType: "image/png",
		Size:     int64(len(data)),
	}, io.NopCloser(bytes.NewReader(data)), nil
}

func TestProtocolMediaUploadTargetUsesManifestUploadURLForConfiguredVendor(t *testing.T) {
	if !useManifestUploadURL("https://tokenhub.ysdui.cn", "https://tokenhub.ysdui.cn", "https://ysdui.cn/api/file/v1/upload") {
		t.Fatal("expected tokenhub.ysdui.cn to route uploads to ysdui.cn")
	}
	if !useManifestUploadURL("https://ysdui.cn", "https://tokenhub.ysdui.cn", "https://ysdui.cn/api/file/v1/upload") {
		t.Fatal("expected ysdui.cn to route uploads to ysdui.cn")
	}
	if useManifestUploadURL("http://127.0.0.1:18080", "https://tokenhub.ysdui.cn", "https://ysdui.cn/api/file/v1/upload") {
		t.Fatal("expected local test server to keep its own origin")
	}
	if useManifestUploadURL("https://tokenhub.ysdui.cn", "https://tokenhub.ysdui.cn", "https://127.0.0.1:8443/api/file/v1/upload") {
		t.Fatal("expected loopback upload URL to be rejected even when config matches manifest base")
	}
	if useManifestUploadURL("https://tokenhub.ysdui.cn", "https://tokenhub.ysdui.cn", "https://evil.example.com/api/file/v1/upload") {
		t.Fatal("expected unrelated upload domain to be rejected even when config matches manifest base")
	}
}

