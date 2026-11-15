package desktopstorage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const locationFile = "storage-location.json"

type Location struct {
	DataDir       string            `json:"dataDir"`
	PreviousDir   string            `json:"previousDir,omitempty"`
	PreviousFiles map[string]string `json:"previousFiles,omitempty"`
}

// 产品名与数据目录名；历史版本用的是 "BeefTV"。
const (
	dataDirName       = "Zzzc"
	legacyDataDirName = "BeefTV"
)

func DefaultRoot() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	next := filepath.Join(root, dataDirName)
	// 改名不能让已有用户的画布"凭空消失"：新目录还不存在、旧目录在，
	// 就把旧目录整体改名过来。改名是同一卷内的原子操作，失败也不丢数据
	// （旧目录原样保留），下次启动会再试一次。
	if err := adoptLegacyDataDir(root, next); err != nil {
		return "", err
	}
	return next, nil
}

// adoptLegacyDataDir 在首次以新名字启动时接管旧数据目录。
// 只在"新目录不存在"时动手，绝不覆盖任何已存在的新数据。
func adoptLegacyDataDir(root, next string) error {
	if _, err := os.Stat(next); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("检查应用数据目录失败: %w", err)
	}
	legacy := filepath.Join(root, legacyDataDirName)
	info, err := os.Stat(legacy)
	if err != nil || !info.IsDir() {
		// 没有旧数据：全新安装，新目录由后续流程创建。
		return nil
	}
	if err := os.Rename(legacy, next); err != nil {
		// 跨卷或权限问题无法原子改名时，退化为复制后保留原件，
		// 宁可多留一份旧目录，也不让用户看到空工作区。
		if copyErr := copyDir(legacy, next); copyErr != nil {
			return fmt.Errorf("迁移旧应用数据目录失败: %w", copyErr)
		}
	}
	return nil
}

// copyDir 逐项复制目录内容（含权限位），用于无法原子改名的跨卷迁移。
// 只读取源目录，从不修改或删除它。
func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode().Perm())
	})
}

// The pointer stays in the system profile, independent of the selected data volume.
// A missing selected volume must never silently create an empty workspace.
func Resolve(root string) (string, error) {
	body, err := os.ReadFile(filepath.Join(root, locationFile))
	if errors.Is(err, os.ErrNotExist) {
		return root, nil
	}
	if err != nil {
		return "", fmt.Errorf("读取存储目录设置失败: %w", err)
	}
	var location Location
	if err := json.Unmarshal(body, &location); err != nil {
		return "", fmt.Errorf("存储目录设置损坏: %w", err)
	}
	if !filepath.IsAbs(location.DataDir) {
		return "", errors.New("存储目录设置无效")
	}
	if info, err := os.Stat(location.DataDir); err != nil || !info.IsDir() {
		return "", fmt.Errorf("存储目录无法访问，请连接对应磁盘后重试：%s", location.DataDir)
	}
	return location.DataDir, nil
}

func Save(root, dataDir, previousDir string) error {
	return saveLocation(root, Location{DataDir: dataDir, PreviousDir: previousDir})
}

func SaveMigration(root, dataDir, previousDir string, files map[string]string) error {
	return saveLocation(root, Location{DataDir: dataDir, PreviousDir: previousDir, PreviousFiles: files})
}

func saveLocation(root string, location Location) error {
	body, err := json.Marshal(location)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(root, ".storage-location-*")
	if err != nil {
		return err
	}
	path := file.Name()
	defer os.Remove(path)
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(body)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err := os.Rename(path, filepath.Join(root, locationFile)); err != nil {
		return err
	}
	return nil
}

func canonical(path string) (string, error) {
	path = strings.TrimSpace(path)
	if !filepath.IsAbs(path) || filepath.Dir(filepath.Clean(path)) == filepath.Clean(path) {
		return "", errors.New("请选择磁盘中的文件夹，例如 D:\\BeefTV")
	}
	path = filepath.Clean(path)
	missing := []string{}
	for {
		resolved, err := filepath.EvalSymlinks(path)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", err
		}
		missing = append(missing, filepath.Base(path))
		path = parent
	}
}

func contains(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
