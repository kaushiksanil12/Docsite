package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
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

	SYNC_INTERVAL    = getEnv("SYNC_INTERVAL", "5m")
	SYNC_CONFIG_FILE = filepath.Join("config", "sync.json")
)

func main() {
	// Pre-requisites
	os.MkdirAll(DOCS_DIR, 0755)
	os.MkdirAll(UPLOADS_DIR, 0755)
	os.MkdirAll(filepath.Join(TRASH_DIR, "docs"), 0755)
	os.MkdirAll(filepath.Join(TRASH_DIR, "uploads"), 0755)

	// Ensure trash meta file exists
	if _, err := os.Stat(TRASH_META_FILE); os.IsNotExist(err) {
		os.WriteFile(TRASH_META_FILE, []byte("[]"), 0644)
	}

	// Initialize Git Sync
	var gitManager *sync.GitManager
	handlers.SetConfigPath(SYNC_CONFIG_FILE)

	// Load config from file or env
	var config sync.SyncConfig
	if data, err := os.ReadFile(SYNC_CONFIG_FILE); err == nil {
		json.Unmarshal(data, &config)
	} else if gitRepoURL := getEnv("GIT_REPO_URL", ""); gitRepoURL != "" {
		config.RemoteURL = gitRepoURL
		config.Enabled = true
	}
	sync.SetConfiguration(config)

	// Start Scheduler (it now handles nil managers and waits for config)
	duration, _ := time.ParseDuration(SYNC_INTERVAL)
	scheduler := sync.NewScheduler(&gitManager, duration)
	scheduler.Start()

	// Initialize manager if we have a URL from file or env
	if config.RemoteURL != "" {
		gitManager = sync.NewGitManager(config.RemoteURL, DOCS_DIR)
		if err := gitManager.Initialize(); err != nil {
			log.Printf("Git Sync Initialization Error: %v", err)
		}
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
		r.Post("/sync/configure", handlers.ConfigureSync(&gitManager, DOCS_DIR))
		r.Post("/sync/trigger", handlers.TriggerSync(&gitManager))
		r.Post("/sync/pull", handlers.PullSync(&gitManager))
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

	// Create a Server struct
	srv := &http.Server{
		Addr:    ":" + PORT,
		Handler: r,
	}

	// Run our server in a goroutine so that it doesn't block.
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %s\n", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown the server
	quit := make(chan os.Signal, 1)
	// kill (no param) default send syscall.SIGTERM
	// kill -2 is syscall.SIGINT
	// kill -9 is syscall.SIGKILL but can't be catch, so don't need add it
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	// Perform final sync
	if gitManager != nil && sync.GetConfiguration().Enabled {
		log.Println("Triggering final sync before shutdown...")
		if err := gitManager.Sync(); err != nil {
			log.Printf("Final sync failed: %v", err)
		} else {
			log.Println("Final sync completed successfully.")
		}
	}

	// The context is used to inform the server it has 5 seconds to finish
	// the request it is currently handling
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown: ", err)
	}

	log.Println("Server exiting")
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
