package desktopstorage

import (
	"os"
	"path/filepath"
	"testing"
)

// 产品改名（BeefTV → Zzzc）时，已有用户的数据目录必须原样接管，
// 不能出现"升级后画布全空"。这组测试锁定三个不变量：
// 旧目录会迁移、新目录不被覆盖、全新安装不受影响。
func TestAdoptLegacyDataDirMigratesExistingWorkspace(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "BeefTV")
	next := filepath.Join(root, "Zzzc")

	if err := os.MkdirAll(filepath.Join(legacy, "cache"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"projects":["canvas-1"]}`)
	if err := os.WriteFile(filepath.Join(legacy, "workspace.json"), payload, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "cache", "blob.bin"), []byte("cached"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := adoptLegacyDataDir(root, next); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(next, "workspace.json"))
	if err != nil {
		t.Fatalf("迁移后找不到工作区文件: %v", err)
	}
	if string(got) != string(payload) {
		t.Fatalf("工作区内容被改变: %q", got)
	}
	// 子目录也要跟着走
	if _, err := os.Stat(filepath.Join(next, "cache", "blob.bin")); err != nil {
		t.Fatalf("子目录未迁移: %v", err)
	}
	// 同一卷内是原子改名，旧目录不应该还留着
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("旧目录应当已被移走，实际仍存在")
	}
}

// 新目录已存在时必须原样保留，绝不因为旧目录存在就覆盖用户当前数据。
func TestAdoptLegacyDataDirNeverOverwritesExistingData(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "BeefTV")
	next := filepath.Join(root, "Zzzc")

	for _, dir := range []string{legacy, next} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(legacy, "marker.txt"), []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(next, "marker.txt"), []byte("current"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := adoptLegacyDataDir(root, next); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(next, "marker.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "current" {
		t.Fatalf("新目录被旧数据覆盖了: %q", got)
	}
}

// 全新安装没有旧目录，不应报错，也不应臆造一个空目录。
func TestAdoptLegacyDataDirNoOpOnFreshInstall(t *testing.T) {
	root := t.TempDir()
	next := filepath.Join(root, "Zzzc")

	if err := adoptLegacyDataDir(root, next); err != nil {
		t.Fatalf("全新安装不应失败: %v", err)
	}
	if _, err := os.Stat(next); !os.IsNotExist(err) {
		t.Fatalf("全新安装不应提前创建数据目录")
	}
}
