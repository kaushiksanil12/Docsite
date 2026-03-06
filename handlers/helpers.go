package handlers

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// SafePath validates a relative path and returns an absolute path if safe
func SafePath(rootDir, relPath string) string {
	cleaned := filepath.Clean(relPath)
	if strings.HasPrefix(cleaned, "..") || filepath.IsAbs(cleaned) {
		cleaned = strings.TrimPrefix(cleaned, "..")
		cleaned = strings.TrimPrefix(cleaned, "/")
	}

	full := filepath.Join(rootDir, cleaned)
	absRoot, _ := filepath.Abs(rootDir)
	absFull, _ := filepath.Abs(full)

	if !strings.HasPrefix(absFull, absRoot) {
		return ""
	}

	return full
}

// ExtractImagePaths finds /uploads/ references in content
func ExtractImagePaths(content string) []string {
	re := regexp.MustCompile(`!\[.*?\]\(/uploads/([^)]+)\)`)
	matches := re.FindAllStringSubmatch(content, -1)
	var images []string
	for _, match := range matches {
		if len(match) > 1 {
			images = append(images, match[1])
		}
	}
	return images
}

// safeMove mimics fs.rename with copy fallback for EXDEV
func safeMove(oldPath, newPath string) error {
	err := os.Rename(oldPath, newPath)
	if err != nil {
		return copyMove(oldPath, newPath)
	}
	return nil
}

func copyMove(oldPath, newPath string) error {
	src, err := os.Open(oldPath)
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.Create(newPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return err
	}

	return os.RemoveAll(oldPath)
}

// collectImagesFromDir recursively finds /uploads/ references in all .md files in a dir
func collectImagesFromDir(dir string) []string {
	var images []string
	filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(d.Name(), ".md") {
			content, _ := os.ReadFile(path)
			images = append(images, ExtractImagePaths(string(content))...)
		}
		return nil
	})
	return images
}

// readTrashMeta reads trash metadata from file
func readTrashMeta(path string) []TrashItem {
	data, err := os.ReadFile(path)
	if err != nil {
		return []TrashItem{}
	}
	var meta []TrashItem
	json.Unmarshal(data, &meta)
	return meta
}

// writeTrashMeta writes trash metadata to file
func writeTrashMeta(path string, meta []TrashItem) {
	data, _ := json.MarshalIndent(meta, "", "  ")
	os.WriteFile(path, data, 0644)
}
