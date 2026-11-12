package main

import (
	"fmt"
	"io"

	"infinite-canvas/backend/internal/desktopupdate"
)

func cmdVerifyExtract(args []string, stdout, stderr io.Writer) error {
	fs := newFlagSet("verify-extract", stderr)
	platform := fs.String("platform", "", "platform of the release archive")
	zipPath := fs.String("zip", "", "release zip to extract")
	dest := fs.String("dest", "", "dedicated empty extraction directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 || *zipPath == "" || *dest == "" {
		return fmt.Errorf("verify-extract requires --platform, --zip, and --dest")
	}
	if err := desktopupdate.VerifyReleaseArchive(*zipPath, *dest, *platform); err != nil {
		return fmt.Errorf("release archive failed updater extraction: %w", err)
	}
	fmt.Fprintln(stdout, "updater extraction and layout validation passed")
	return nil
}
