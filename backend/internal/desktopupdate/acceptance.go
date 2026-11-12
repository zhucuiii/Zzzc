package desktopupdate

import (
	"fmt"
	"os"
)

// VerifyReleaseArchive applies the same extraction and layout checks used by
// the updater. Callers must provide a dedicated, empty destination directory.
func VerifyReleaseArchive(zipPath, dest, platform string) error {
	if info, err := os.Stat(dest); err == nil {
		if !info.IsDir() {
			return fmt.Errorf("archive verification destination is not a directory")
		}
		entries, err := os.ReadDir(dest)
		if err != nil {
			return err
		}
		if len(entries) != 0 {
			return fmt.Errorf("archive verification destination must be empty")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := extractSecureZip(zipPath, dest, defaultExtractLimits()); err != nil {
		return err
	}
	if err := validateExtractedLayout(dest, platform); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidArchive, err)
	}
	return nil
}
