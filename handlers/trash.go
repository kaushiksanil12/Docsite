package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type TrashedImage struct {
	Original string `json:"original"`
	Trashed  string `json:"trashed"`
}

type TrashItem struct {
	ID           string         `json:"id"`
	OriginalPath string         `json:"originalPath"`
	Type         string         `json:"type"` // "file" or "folder"
	DeletedAt    string         `json:"deletedAt"`
	Images       []TrashedImage `json:"images"`
}

// DeleteDoc moves a file or folder to trash
func DeleteDoc(docsDir, uploadsDir, trashDocsDir, trashUploadsDir, metaFile string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		relPath := chi.URLParam(r, "*")
		fullPath := SafePath(docsDir, relPath)

		if fullPath == "" {
			http.Error(w, `{"error":"Invalid path"}`, http.StatusBadRequest)
			return
		}

		stat, err := os.Stat(fullPath)
		if os.IsNotExist(err) {
			http.Error(w, `{"error":"Not found"}`, http.StatusNotFound)
			return
		}

		timestamp := time.Now().UnixMilli()
		trashID := fmt.Sprintf("%d_%s", timestamp, filepath.Base(relPath))
		trashDocPath := filepath.Join(trashDocsDir, trashID)
		isDir := stat.IsDir()

		// Collect image references before moving
		var images []string
		if isDir {
			images = collectImagesFromDir(fullPath)
		} else if strings.HasSuffix(fullPath, ".md") {
			content, _ := os.ReadFile(fullPath)
			images = ExtractImagePaths(string(content))
		}

		// Move images to trash
		var trashedImages []TrashedImage
		for _, img := range images {
			imgSrc := filepath.Join(uploadsDir, img)
			trashedID := fmt.Sprintf("%d_%s", timestamp, img)
			imgDest := filepath.Join(trashUploadsDir, trashedID)
			if _, err := os.Stat(imgSrc); err == nil {
				if err := safeMove(imgSrc, imgDest); err == nil {
					trashedImages = append(trashedImages, TrashedImage{Original: img, Trashed: trashedID})
				}
			}
		}

		// Move the doc/folder to trash
		if err := safeMove(fullPath, trashDocPath); err != nil {
			http.Error(w, `{"error":"Failed to move to trash"}`, http.StatusInternalServerError)
			return
		}

		// Save metadata
		meta := readTrashMeta(metaFile)
		meta = append(meta, TrashItem{
			ID:           trashID,
			OriginalPath: relPath,
			Type: func() string {
				if isDir {
					return "folder"
				}
				return "file"
			}(),
			DeletedAt: time.Now().Format(time.RFC3339),
			Images:    trashedImages,
		})
		writeTrashMeta(metaFile, meta)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "trashedTo": trashID})
	}
}

// ListTrash returns all items in the trash
func ListTrash(metaFile string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		meta := readTrashMeta(metaFile)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(meta)
	}
}

// RestoreTrash recovers an item from the trash
func RestoreTrash(docsDir, uploadsDir, trashDocsDir, trashUploadsDir, metaFile string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, `{"error":"Invalid request"}`, http.StatusBadRequest)
			return
		}

		meta := readTrashMeta(metaFile)
		idx := -1
		for i, item := range meta {
			if item.ID == req.ID {
				idx = i
				break
			}
		}

		if idx == -1 {
			http.Error(w, `{"error":"Trash item not found"}`, http.StatusNotFound)
			return
		}

		item := meta[idx]
		trashDocPath := filepath.Join(trashDocsDir, item.ID)
		restorePath := filepath.Join(docsDir, item.OriginalPath)

		if _, err := os.Stat(trashDocPath); os.IsNotExist(err) {
			meta = append(meta[:idx], meta[idx+1:]...)
			writeTrashMeta(metaFile, meta)
			http.Error(w, `{"error":"Trash file not found on disk"}`, http.StatusNotFound)
			return
		}

		os.MkdirAll(filepath.Dir(restorePath), 0755)

		finalPath := restorePath
		if _, err := os.Stat(finalPath); err == nil {
			ext := filepath.Ext(finalPath)
			base := strings.TrimSuffix(finalPath, ext)
			finalPath = fmt.Sprintf("%s_restored_%d%s", base, time.Now().Unix(), ext)
		}

		if err := safeMove(trashDocPath, finalPath); err != nil {
			http.Error(w, `{"error":"Failed to restore"}`, http.StatusInternalServerError)
			return
		}

		for _, img := range item.Images {
			imgTrash := filepath.Join(trashUploadsDir, img.Trashed)
			imgRestore := filepath.Join(uploadsDir, img.Original)
			if _, err := os.Stat(imgTrash); err == nil {
				safeMove(imgTrash, imgRestore)
			}
		}

		meta = append(meta[:idx], meta[idx+1:]...)
		writeTrashMeta(metaFile, meta)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "restoredTo": item.OriginalPath})
	}
}

// PermanentDelete removes an item forever
func PermanentDelete(trashDocsDir, trashUploadsDir, metaFile string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		meta := readTrashMeta(metaFile)
		idx := -1
		for i, item := range meta {
			if item.ID == id {
				idx = i
				break
			}
		}

		if idx == -1 {
			http.Error(w, `{"error":"Trash item not found"}`, http.StatusNotFound)
			return
		}

		item := meta[idx]
		trashPath := filepath.Join(trashDocsDir, item.ID)
		os.RemoveAll(trashPath)

		for _, img := range item.Images {
			os.Remove(filepath.Join(trashUploadsDir, img.Trashed))
		}

		meta = append(meta[:idx], meta[idx+1:]...)
		writeTrashMeta(metaFile, meta)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
	}
}

// ClearAllTrash empties everything
func ClearAllTrash(trashDocsDir, trashUploadsDir, metaFile string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		os.RemoveAll(trashDocsDir)
		os.RemoveAll(trashUploadsDir)
		os.MkdirAll(trashDocsDir, 0755)
		os.MkdirAll(trashUploadsDir, 0755)
		writeTrashMeta(metaFile, []TrashItem{})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
	}
}
