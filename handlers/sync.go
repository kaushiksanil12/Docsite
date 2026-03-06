package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kaushik/docsite-backend/sync"
)

// GetSyncStatus returns the current Git synchronization status
func GetSyncStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := sync.GetStatus()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	}
}

// TriggerSync manually starts a Git sync cycle
func TriggerSync(git *sync.GitManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		go git.Sync() // Run in background to avoid blocking request
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Sync started"})
	}
}
