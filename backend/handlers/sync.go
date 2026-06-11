package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/kaushik/docsite-backend/sync"
)

var configPath string

// SetConfigPath sets the path where sync configuration is stored
func SetConfigPath(path string) {
	configPath = path
}

// GetSyncStatus returns the current Git synchronization status
func GetSyncStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := sync.GetStatus()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	}
}

// ConfigureSync updates the Git synchronization settings
func ConfigureSync(git **sync.GitManager, docsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var update sync.SyncConfig
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			log.Printf("Sync Config Decode Error: %v", err)
			http.Error(w, `{"error":"Invalid configuration"}`, http.StatusBadRequest)
			return
		}

		currentConfig := sync.GetConfiguration()
		log.Printf("Sync Config: Current state: %+v, Received update: %+v", currentConfig, update)

		// Logic: Merge settings.
		// If PAT is provided, use it. Else keep old one.
		if update.PAT != "" {
			currentConfig.PAT = update.PAT
		}

		// If URL changed, we'll re-init
		urlChanged := update.RemoteURL != currentConfig.RemoteURL

		currentConfig.RemoteURL = update.RemoteURL
		currentConfig.Enabled = update.Enabled

		sync.SetConfiguration(currentConfig)

		// Persist to file
		os.MkdirAll(filepath.Dir(configPath), 0755)
		data, _ := json.MarshalIndent(currentConfig, "", "  ")
		if err := os.WriteFile(configPath, data, 0644); err != nil {
			log.Printf("Failed to save sync config: %v", err)
		}

		// Re-initialize GitManager if URL changed or if it was never initialized
		if currentConfig.RemoteURL != "" && (urlChanged || *git == nil) {
			*git = sync.NewGitManager(currentConfig.RemoteURL, docsDir)
			if err := (*git).Initialize(); err != nil {
				log.Printf("Git Sync Initialization Error: %v", err)
			}
		} else if currentConfig.RemoteURL == "" {
			*git = nil // Clear if URL was removed
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
	}
}

// TriggerSync manually starts a Git sync cycle
func TriggerSync(git **sync.GitManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if *git == nil {
			http.Error(w, `{"error":"Sync not configured"}`, http.StatusBadRequest)
			return
		}
		go (*git).Sync()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
	}
}

// PullSync manually starts a Git pull
func PullSync(git **sync.GitManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if *git == nil {
			http.Error(w, `{"error":"Sync not configured"}`, http.StatusBadRequest)
			return
		}
		go (*git).Pull()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
	}
}
