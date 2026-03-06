package handlers

import (
	"encoding/json"
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
		var newConfig sync.SyncConfig
		if err := json.NewDecoder(r.Body).Decode(&newConfig); err != nil {
			http.Error(w, `{"error":"Invalid configuration"}`, http.StatusBadRequest)
			return
		}

		sync.SetConfiguration(newConfig)

		// Persist to file
		os.MkdirAll(filepath.Dir(configPath), 0755)
		data, _ := json.MarshalIndent(newConfig, "", "  ")
		os.WriteFile(configPath, data, 0644)

		// Re-initialize GitManager if URL changed
		if newConfig.RemoteURL != "" {
			*git = sync.NewGitManager(newConfig.RemoteURL, docsDir)
			if err := (*git).Initialize(); err != nil {
				// We don't return error here because we want to save the settings anyway
				// The status will reflect the error
			}
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
