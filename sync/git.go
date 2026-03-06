package sync

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// SyncStatus represents the current state of git synchronization
type SyncStatus struct {
	LastSync time.Time `json:"lastSync"`
	Status   string    `json:"status"` // "idle", "syncing", "error"
	Error    string    `json:"error,omitempty"`
}

var (
	currStatus SyncStatus
	statusMu   sync.RWMutex
)

func setStatus(status string, err error) {
	statusMu.Lock()
	defer statusMu.Unlock()
	currStatus.Status = status
	if err != nil {
		currStatus.Error = err.Error()
	} else {
		currStatus.Error = ""
		if status == "idle" {
			currStatus.LastSync = time.Now()
		}
	}
}

// GetStatus returns the current sync status
func GetStatus() SyncStatus {
	statusMu.RLock()
	defer statusMu.RUnlock()
	return currStatus
}

// GitManager handles Git operations
type GitManager struct {
	RepoURL   string
	TargetDir string
}

// NewGitManager creates a new Git manager
func NewGitManager(repoURL, targetDir string) *GitManager {
	return &GitManager{
		RepoURL:   repoURL,
		TargetDir: targetDir,
	}
}

// runCommand executes a git command in the target directory
func (g *GitManager) runCommand(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = g.TargetDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("git %s failed: %w (output: %s)", strings.Join(args, " "), err, string(output))
	}
	return string(output), nil
}

// Initialize checks if repo exists, clones if not
func (g *GitManager) Initialize() error {
	if g.RepoURL == "" {
		log.Println("Git Sync: No REPO_URL provided, skipping initialization.")
		return nil
	}

	// Check if already a git repo
	_, err := g.runCommand("rev-parse", "--is-inside-work-tree")
	if err == nil {
		log.Println("Git Sync: Repository already initialized.")
		return g.Pull()
	}

	log.Printf("Git Sync: Partitioning/Cloning repository from %s...", g.RepoURL)
	// Note: We run clone outside the directory if we want to clone into it,
	// but usually we just clone into the target dir.
	// If target dir is not empty, we might need a different strategy.
	// Sticking to original Node logic: it assumes targetDir is the repo root.

	cmd := exec.Command("git", "clone", g.RepoURL, ".")
	cmd.Dir = g.TargetDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("clone failed: %w (output: %s)", err, string(output))
	}
	return nil
}

// Pull performs a git pull
func (g *GitManager) Pull() error {
	setStatus("syncing", nil)
	log.Println("Git Sync: Pulling latest changes...")
	_, err := g.runCommand("pull", "origin", "main")
	if err != nil {
		_, err = g.runCommand("pull", "origin", "master")
	}

	if err != nil {
		setStatus("error", err)
	} else {
		setStatus("idle", nil)
	}
	return err
}

// Sync performs the full add-commit-push-pull cycle
func (g *GitManager) Sync() error {
	setStatus("syncing", nil)
	log.Println("Git Sync: Starting sync cycle...")

	// 1. Add
	if _, err := g.runCommand("add", "."); err != nil {
		setStatus("error", err)
		return err
	}

	// 2. Commit (ignore error if nothing to commit)
	_, _ = g.runCommand("commit", "-m", "Auto-sync from DevDocs (Go)")

	// 3. Push
	if _, err := g.runCommand("push", "origin", "main"); err != nil {
		_, _ = g.runCommand("push", "origin", "master")
	}

	// 4. Pull
	err := g.Pull()
	if err != nil {
		setStatus("error", err)
	} else {
		setStatus("idle", nil)
	}
	return err
}
