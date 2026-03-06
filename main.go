package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/kaushik/docsite-backend/handlers"
	"github.com/kaushik/docsite-backend/sync"
)

var (
	PORT            = getEnv("PORT", "3000")
	DOCS_DIR        = getEnv("DOCS_DIR", "./docs")
	UPLOADS_DIR     = getEnv("UPLOADS_DIR", "./uploads")
	TRASH_DIR       = "./trash"
	TRASH_META_FILE = filepath.Join(TRASH_DIR, "meta.json")

	GIT_REPO_URL  = getEnv("GIT_REPO_URL", "")
	SYNC_INTERVAL = getEnv("SYNC_INTERVAL", "5m")
)

func main() {
	// Ensure directories exist
	dirs := []string{DOCS_DIR, UPLOADS_DIR, filepath.Join(TRASH_DIR, "docs"), filepath.Join(TRASH_DIR, "uploads")}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Fatalf("Failed to create directory %s: %v", dir, err)
		}
	}
	// Ensure trash meta file exists
	if _, err := os.Stat(TRASH_META_FILE); os.IsNotExist(err) {
		os.WriteFile(TRASH_META_FILE, []byte("[]"), 0644)
	}

	// Initialize Git Sync
	var gitManager *sync.GitManager
	if GIT_REPO_URL != "" {
		gitManager = sync.NewGitManager(GIT_REPO_URL, DOCS_DIR)
		if err := gitManager.Initialize(); err != nil {
			log.Printf("Git Sync Initialization Error: %v", err)
		}

		duration, err := time.ParseDuration(SYNC_INTERVAL)
		if err != nil {
			log.Printf("Invalid SYNC_INTERVAL '%s', using default 5m", SYNC_INTERVAL)
			duration = 5 * time.Minute
		}
		scheduler := sync.NewScheduler(gitManager, duration)
		scheduler.Start()
	}

	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// API Routes (Placeholders)
	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok"}`))
		})

		r.Get("/tree", handlers.GetTree(DOCS_DIR))
		r.Get("/search", handlers.SearchDocs(DOCS_DIR))
		r.Get("/doc/*", handlers.GetDoc(DOCS_DIR))
		r.Post("/doc/*", handlers.SaveDoc(DOCS_DIR, UPLOADS_DIR))
		r.Delete("/doc/*", handlers.DeleteDoc(DOCS_DIR, UPLOADS_DIR, filepath.Join(TRASH_DIR, "docs"), filepath.Join(TRASH_DIR, "uploads"), TRASH_META_FILE))

		r.Post("/folder", handlers.CreateFolder(DOCS_DIR))
		r.Post("/rename", handlers.Rename(DOCS_DIR))
		r.Post("/upload", handlers.UploadImage(UPLOADS_DIR))

		// Trash routes
		r.Route("/trash", func(r chi.Router) {
			r.Get("/", handlers.ListTrash(TRASH_META_FILE))
			r.Post("/restore", handlers.RestoreTrash(DOCS_DIR, UPLOADS_DIR, filepath.Join(TRASH_DIR, "docs"), filepath.Join(TRASH_DIR, "uploads"), TRASH_META_FILE))
			r.Delete("/{id}", handlers.PermanentDelete(filepath.Join(TRASH_DIR, "docs"), filepath.Join(TRASH_DIR, "uploads"), TRASH_META_FILE))
			r.Delete("/clear/all", handlers.ClearAllTrash(filepath.Join(TRASH_DIR, "docs"), filepath.Join(TRASH_DIR, "uploads"), TRASH_META_FILE))
		})

		// Sync routes
		r.Get("/sync/status", handlers.GetSyncStatus())
		if gitManager != nil {
			r.Post("/sync", handlers.TriggerSync(gitManager))
		}
	})

	// Static files
	workDir, _ := os.Getwd()
	filesDir := http.Dir(filepath.Join(workDir, "public"))
	FileServer(r, "/", filesDir)

	// Uploads static
	uploadsDir := http.Dir(UPLOADS_DIR)
	FileServer(r, "/uploads", uploadsDir)

	fmt.Printf("\n  ╔══════════════════════════════════════╗\n")
	fmt.Printf("  ║   DevDocs (Go) running on port %s     ║\n", PORT)
	fmt.Printf("  ║   http://localhost:%s              ║\n", PORT)
	fmt.Printf("  ╚══════════════════════════════════════╝\n\n")
	fmt.Printf("  📁 Docs directory:    %s\n", DOCS_DIR)
	fmt.Printf("  🖼️  Uploads directory: %s\n\n", UPLOADS_DIR)

	log.Fatal(http.ListenAndServe(":"+PORT, r))
}

// FileServer conveniently sets up a http.FileServer handler to serve
// static files from a http.FileSystem.
func FileServer(r chi.Router, path string, root http.FileSystem) {
	if path != "/" && path[len(path)-1] != '/' {
		r.Get(path, http.RedirectHandler(path+"/", http.StatusMovedPermanently).ServeHTTP)
		path += "/"
	}
	path += "*"

	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.RouteContext(r.Context())
		pathPrefix := rctx.RoutePattern()
		if pathPrefix[len(pathPrefix)-1] == '*' {
			pathPrefix = pathPrefix[:len(pathPrefix)-1]
		}

		fs := http.StripPrefix(pathPrefix, http.FileServer(root))
		fs.ServeHTTP(w, r)
	})
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
