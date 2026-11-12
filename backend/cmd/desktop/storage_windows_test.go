//go:build windows

package main

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
	"infinite-canvas/backend/internal/desktopstorage"
)

func TestWindowsOpenDesktopMigratesWithBusyScratch(t *testing.T) {
	for _, scratch := range []bool{true, false} {
		name := "durable"
		if scratch {
			name = "scratch"
		}
		t.Run(name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "profile")
			target := filepath.Join(t.TempDir(), "selected")
			app := newDesktopApp(root)
			app.storageRoot = root
			if err := app.start(context.Background()); err != nil {
				t.Fatal(err)
			}
			defer app.stop(context.Background())
			rel := "resources/original.tmp"
			if scratch {
				rel = "cache/tmp/busy.tmp"
			}
			path := filepath.Join(root, rel)
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			wide, err := windows.UTF16PtrFromString(path)
			if err != nil {
				t.Fatal(err)
			}
			handle, err := windows.CreateFile(wide, windows.GENERIC_READ, 0, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer windows.CloseHandle(handle)
			// Keep the file busy even on filesystems that do not enforce share modes.
			if err = windows.LockFileEx(handle, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &windows.Overlapped{}); err != nil {
				t.Fatal(err)
			}
			requireBusyFile(t, path)
			_, err = app.MigrateStorage(target)
			if scratch {
				if err != nil {
					t.Fatal("open desktop could not migrate with busy scratch", err)
				}
				selected, err := desktopstorage.Resolve(root)
				if err != nil || selected != app.dataDir || selected == root {
					t.Fatal("new workspace not selected", err)
				}
			} else {
				if err == nil {
					t.Fatal("migrated locked durable data")
				}
				if app.dataDir != root {
					t.Fatal("switched away from original directory")
				}
			}
			if app.runtime() == nil || !app.runtime().Ready() {
				t.Fatal("desktop workspace not available after migration attempt")
			}
		})
	}
}

// requireBusyFile rejects filesystems that silently allow a second reader, so
// a migration failure below can only come from the held file, not the sandbox.
func requireBusyFile(t *testing.T, path string) {
	t.Helper()
	file, err := os.Open(path)
	if err == nil {
		defer file.Close()
		if _, readErr := io.ReadAll(file); readErr == nil {
			t.Fatal("test filesystem does not enforce Windows sharing or byte-range locks")
		}
		return
	}
	if !errors.Is(err, windows.ERROR_SHARING_VIOLATION) && !errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
		t.Fatalf("unexpected busy-file probe error: %v", err)
	}
}
