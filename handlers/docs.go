package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/yuin/goldmark"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer/html"
)

// --- Types ---

type FileItem struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Type     string     `json:"type"` // "file" or "folder"
	Children []FileItem `json:"children,omitempty"`
}

type DocResponse struct {
	Raw          string    `json:"raw"`
	HTML         string    `json:"html"`
	Path         string    `json:"path"`
	Name         string    `json:"name"`
	LastModified time.Time `json:"lastModified"`
}

type SearchResult struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Snippet string `json:"snippet"`
}

// --- Configuration ---

var md = goldmark.New(
	goldmark.WithExtensions(
		extension.GFM,
		highlighting.NewHighlighting(
			highlighting.WithStyle("github"),
		),
	),
	goldmark.WithParserOptions(
		parser.WithAutoHeadingID(),
	),
	goldmark.WithRendererOptions(
		html.WithHardWraps(),
		html.WithXHTML(),
	),
)

// --- Handlers ---

// GetTree returns the file structure of the documentation directory
func GetTree(docsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tree := buildTree(docsDir, "")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tree)
	}
}

// GetDoc reads and renders a markdown file
func GetDoc(docsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		relPath := chi.URLParam(r, "*")
		fullPath := SafePath(docsDir, relPath)

		if fullPath == "" {
			http.Error(w, `{"error":"Invalid path"}`, http.StatusBadRequest)
			return
		}

		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			http.Error(w, `{"error":"File not found"}`, http.StatusNotFound)
			return
		}

		raw, err := os.ReadFile(fullPath)
		if err != nil {
			http.Error(w, `{"error":"Failed to read file"}`, http.StatusInternalServerError)
			return
		}

		var buf bytes.Buffer
		if err := md.Convert(raw, &buf); err != nil {
			log.Printf("Markdown conversion error: %v", err)
			buf.Write(raw)
		}

		stat, _ := os.Stat(fullPath)
		res := DocResponse{
			Raw:          string(raw),
			HTML:         buf.String(),
			Path:         relPath,
			Name:         strings.TrimSuffix(filepath.Base(relPath), ".md"),
			LastModified: stat.ModTime(),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(res)
	}
}

// SaveDoc creates or updates a markdown file
func SaveDoc(docsDir, uploadsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		relPath := chi.URLParam(r, "*")
		fullPath := SafePath(docsDir, relPath)

		if fullPath == "" {
			http.Error(w, `{"error":"Invalid path"}`, http.StatusBadRequest)
			return
		}

		if !strings.HasSuffix(fullPath, ".md") {
			http.Error(w, `{"error":"Only .md files are supported"}`, http.StatusBadRequest)
			return
		}

		var body struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":"Invalid request body"}`, http.StatusBadRequest)
			return
		}

		// Handle orphaned images
		var oldImages []string
		if _, err := os.Stat(fullPath); err == nil {
			oldContent, _ := os.ReadFile(fullPath)
			oldImages = ExtractImagePaths(string(oldContent))
		}

		// Ensure parent directory exists
		if err := os.MkdirAll(filepath.Dir(fullPath), 0755); err != nil {
			http.Error(w, `{"error":"Failed to create directory"}`, http.StatusInternalServerError)
			return
		}

		if err := os.WriteFile(fullPath, []byte(body.Content), 0644); err != nil {
			http.Error(w, `{"error":"Failed to save file"}`, http.StatusInternalServerError)
			return
		}

		// Cleanup orphaned images
		newImages := ExtractImagePaths(body.Content)
		for _, oldImg := range oldImages {
			found := false
			for _, newImg := range newImages {
				if oldImg == newImg {
					found = true
					break
				}
			}
			if !found {
				imgPath := filepath.Join(uploadsDir, oldImg)
				os.Remove(imgPath)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "path": relPath})
	}
}

// SearchDocs handles searching through markdown files
func SearchDocs(docsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("q")
		if len(strings.TrimSpace(query)) < 2 {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte("[]"))
			return
		}

		results := searchInDir(docsDir, strings.ToLower(query), "")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(results)
	}
}

// CreateFolder creates a new directory
func CreateFolder(docsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			FolderPath string `json:"folderPath"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":"Invalid request"}`, http.StatusBadRequest)
			return
		}

		fullPath := SafePath(docsDir, body.FolderPath)
		if fullPath == "" {
			http.Error(w, `{"error":"Invalid path"}`, http.StatusBadRequest)
			return
		}

		if _, err := os.Stat(fullPath); err == nil {
			http.Error(w, `{"error":"Folder already exists"}`, http.StatusConflict)
			return
		}

		if err := os.MkdirAll(fullPath, 0755); err != nil {
			http.Error(w, `{"error":"Failed to create folder"}`, http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "path": body.FolderPath})
	}
}

// Rename handles moving or renaming files/folders
func Rename(docsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			OldPath string `json:"oldPath"`
			NewPath string `json:"newPath"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":"Invalid request"}`, http.StatusBadRequest)
			return
		}

		fullOld := SafePath(docsDir, body.OldPath)
		fullNew := SafePath(docsDir, body.NewPath)

		if fullOld == "" || fullNew == "" {
			http.Error(w, `{"error":"Invalid path"}`, http.StatusBadRequest)
			return
		}

		if _, err := os.Stat(fullOld); os.IsNotExist(err) {
			http.Error(w, `{"error":"Source not found"}`, http.StatusNotFound)
			return
		}

		if _, err := os.Stat(fullNew); err == nil {
			http.Error(w, `{"error":"Destination already exists"}`, http.StatusConflict)
			return
		}

		os.MkdirAll(filepath.Dir(fullNew), 0755)

		if err := safeMove(fullOld, fullNew); err != nil {
			http.Error(w, `{"error":"Failed to rename"}`, http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
	}
}

// UploadImage handles multipart image uploads
func UploadImage(uploadsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.ParseMultipartForm(10 << 20)

		file, handler, err := r.FormFile("image")
		if err != nil {
			http.Error(w, `{"error":"No image uploaded"}`, http.StatusBadRequest)
			return
		}
		defer file.Close()

		ext := filepath.Ext(handler.Filename)
		allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".svg": true, ".webp": true}
		if !allowed[strings.ToLower(ext)] {
			http.Error(w, `{"error":"Only image files are allowed"}`, http.StatusBadRequest)
			return
		}

		uniqueName := fmt.Sprintf("%d-%d%s", time.Now().UnixNano(), rand.Intn(1000000), ext)
		destPath := filepath.Join(uploadsDir, uniqueName)

		dst, err := os.Create(destPath)
		if err != nil {
			http.Error(w, `{"error":"Failed to create file"}`, http.StatusInternalServerError)
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			http.Error(w, `{"error":"Failed to save image"}`, http.StatusInternalServerError)
			return
		}

		url := fmt.Sprintf("/uploads/%s", uniqueName)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"url":      url,
			"filename": uniqueName,
		})
	}
}

// --- Internal Logic ---

func buildTree(dir, base string) []FileItem {
	var items []FileItem
	entries, err := os.ReadDir(dir)
	if err != nil {
		return items
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() && !entries[j].IsDir() {
			return true
		}
		if !entries[i].IsDir() && entries[j].IsDir() {
			return false
		}
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		name := entry.Name()
		relPath := name
		if base != "" {
			relPath = base + "/" + name
		}

		if entry.IsDir() {
			if strings.HasPrefix(name, ".") {
				continue
			}
			items = append(items, FileItem{
				Name:     name,
				Path:     relPath,
				Type:     "folder",
				Children: buildTree(filepath.Join(dir, name), relPath),
			})
		} else if strings.HasSuffix(name, ".md") {
			items = append(items, FileItem{
				Name: strings.TrimSuffix(name, ".md"),
				Path: relPath,
				Type: "file",
			})
		}
	}
	return items
}

func searchInDir(dir, query, base string) []SearchResult {
	var results []SearchResult
	entries, err := os.ReadDir(dir)
	if err != nil {
		return results
	}

	for _, entry := range entries {
		name := entry.Name()
		relPath := name
		if base != "" {
			relPath = base + "/" + name
		}
		fullPath := filepath.Join(dir, name)

		if entry.IsDir() {
			if strings.HasPrefix(name, ".") {
				continue
			}
			results = append(results, searchInDir(fullPath, query, relPath)...)
		} else if strings.HasSuffix(name, ".md") {
			content, err := os.ReadFile(fullPath)
			if err != nil {
				continue
			}
			contentStr := string(content)
			lowerContent := strings.ToLower(contentStr)
			idx := strings.Index(lowerContent, query)
			if idx != -1 {
				start := idx - 60
				if start < 0 {
					start = 0
				}
				end := idx + len(query) + 60
				if end > len(contentStr) {
					end = len(contentStr)
				}

				snippet := strings.ReplaceAll(contentStr[start:end], "\n", " ")
				if start > 0 {
					snippet = "..." + snippet
				}
				if end < len(contentStr) {
					snippet = snippet + "..."
				}

				results = append(results, SearchResult{
					Name:    strings.TrimSuffix(name, ".md"),
					Path:    relPath,
					Snippet: snippet,
				})
			}
		}
	}
	return results
}
