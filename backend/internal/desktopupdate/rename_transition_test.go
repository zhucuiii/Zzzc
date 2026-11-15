package desktopupdate

import (
	"os"
	"path/filepath"
	"testing"
)

// 产品从 BeefTV 改名为 Zzzc。已经装了旧版（以 BeefTV.exe 运行）的用户，
// 必须能完成"最后一次"旧名升级，否则这些人永远停在旧版本。
// 这组测试锁定过渡期的三条不变量。

// 包里同时带新名与兼容名时，布局校验通过。
func TestWindowsLayoutAcceptsTransitionPackageWithBothNames(t *testing.T) {
	root := t.TempDir()
	if err := WriteWindowsLayout(root, "v2.2.3"); err != nil {
		t.Fatal(err)
	}
	// 兼容副本：内容与新主程序一致，只是文件名不同。
	if err := os.WriteFile(filepath.Join(root, windowsLegacyExeName), []byte("MZ-v2.2.3"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsLayout(root); err != nil {
		t.Fatalf("带兼容副本的过渡包应当通过校验: %v", err)
	}
}

// 只带兼容名的包也认：打包脚本万一漏了新名，升级不能因此中断。
func TestWindowsLayoutAcceptsLegacyNameOnly(t *testing.T) {
	root := t.TempDir()
	if err := WriteWindowsLayout(root, "v2.2.3"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, windowsExeName)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, windowsLegacyExeName), []byte("MZ-v2.2.3"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsLayout(root); err != nil {
		t.Fatalf("仅有旧名的包也应被接受: %v", err)
	}
}

// 旧版更新器以 BeefTV.exe 为目标升级时，替换后该位置必须是新内容，
// 且程序名保持不变 —— 否则重启会找不到程序。
func TestSwapWindowsKeepsLegacyNameDuringTransition(t *testing.T) {
	root := t.TempDir()
	installed, staged := filepath.Join(root, "installed"), filepath.Join(root, "staged")
	for _, dir := range []string{installed, staged} {
		if err := WriteWindowsLayout(dir, "old"); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(staged, windowsExeName), []byte("MZ-new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staged, windowsLegacyExeName), []byte("MZ-new"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 模拟旧版：目标程序叫 BeefTV.exe。
	legacyTarget := filepath.Join(installed, windowsLegacyExeName)
	if err := os.WriteFile(legacyTarget, []byte("MZ-old"), 0o644); err != nil {
		t.Fatal(err)
	}

	req := HelperRequest{
		Platform:   "windows-amd64",
		TargetPath: legacyTarget,
		StagedPath: staged,
		BackupPath: filepath.Join(root, "backup"),
	}
	if err := SwapInstall(req); err != nil {
		t.Fatalf("旧名升级失败: %v", err)
	}

	got, err := os.ReadFile(legacyTarget)
	if err != nil {
		t.Fatalf("升级后找不到原程序路径: %v", err)
	}
	if string(got) != "MZ-new" {
		t.Fatalf("旧名程序未被替换为新版本: %q", got)
	}
}
