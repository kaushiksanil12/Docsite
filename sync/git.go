package sync

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// SyncConfig represents the persistent configuration for git sync
type SyncConfig struct {
	RemoteURL string `json:"remoteUrl"`
	PAT       string `json:"pat,omitempty"`
	Enabled   bool   `json:"enabled"`
}

// SyncStatus represents the current state of git synchronization
type SyncStatus struct {
	RemoteURL string    `json:"remoteUrl"`
	HasPat    bool      `json:"hasPat"`
	Enabled   bool      `json:"enabled"`
	LastSync  time.Time `json:"lastSync"`
	Status    string    `json:"status"` // "idle", "syncing", "error", "success"
	Error     string    `json:"error,omitempty"`
}

var (
	currStatus SyncStatus
	statusMu   sync.RWMutex
	currConfig SyncConfig
)

func setStatus(status string, err error) {
	statusMu.Lock()
	defer statusMu.Unlock()
	currStatus.Status = status
	if err != nil {
		currStatus.Error = err.Error()
	} else {
		currStatus.Error = ""
		if status == "success" || status == "idle" {
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

// SetConfiguration updates the current sync configuration
func SetConfiguration(config SyncConfig) {
	statusMu.Lock()
	defer statusMu.Unlock()
	currConfig = config
	currStatus.RemoteURL = config.RemoteURL
	currStatus.Enabled = config.Enabled
	currStatus.HasPat = config.PAT != ""
}

// GetConfiguration returns the current sync configuration
func GetConfiguration() SyncConfig {
	statusMu.RLock()
	defer statusMu.RUnlock()
	return currConfig
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

// Initialize checks if repo exists, handles initialization for subdirectories
func (g *GitManager) Initialize() error {
	if g.RepoURL == "" {
		log.Println("Git Sync: No REPO_URL provided, skipping initialization.")
		return nil
	}

	// Check if .git exists specifically in our target directory
	// We avoid 'rev-parse' because it might find a parent repository
	gitDir := filepath.Join(g.TargetDir, ".git")
	if _, err := os.Stat(gitDir); err == nil {
		log.Println("Git Sync: Repository already initialized at target.")
		return g.Pull()
	}

	log.Printf("Git Sync: Initializing repository at %s...", g.TargetDir)

	// Option A: Try to clone (works if directory is empty)
	if _, err := g.runCommand("clone", g.RepoURL, "."); err == nil {
		return nil
	}

	// Option B: Manual init (works if directory already has files)
	log.Println("Git Sync: Clone failed or directory not empty. Falling back to init/remote...")
	if _, err := g.runCommand("init"); err != nil {
		return err
	}
	if _, err := g.runCommand("remote", "add", "origin", g.RepoURL); err != nil {
		// Might already exist if we're retrying
		g.runCommand("remote", "set-url", "origin", g.RepoURL)
	}

	g.Pull() // Try to pull, but don't fail if it's an empty repo
	return nil
}

// Pull performs a git pull
func (g *GitManager) Pull() error {
	setStatus("syncing", nil)
	log.Println("Git Sync: Pulling latest changes...")

	// Default to main or master
	err := g.pullFromBranch("main")
	if err != nil && !isNewRepoError(err) {
		err = g.pullFromBranch("master")
	}

	if err != nil && !isNewRepoError(err) {
		setStatus("error", err)
	} else {
		setStatus("success", nil)
		err = nil // Clear error if it was just a new repo issue
	}
	return err
}

func isNewRepoError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "couldn't find remote ref") ||
		strings.Contains(msg, "Remote branch main not found") ||
		strings.Contains(msg, "Remote branch master not found") ||
		strings.Contains(msg, "Couldn't find remote ref")
}

func (g *GitManager) pullFromBranch(branch string) error {
	u := g.getAuthenticatedURL()
	_, err := g.runCommand("pull", u, branch)
	return err
}

func (g *GitManager) getAuthenticatedURL() string {
	config := GetConfiguration()
	if config.PAT == "" || !strings.HasPrefix(config.RemoteURL, "https://") {
		return "origin"
	}
	// Inject PAT: https://pat@github.com/user/repo.git
	return strings.Replace(config.RemoteURL, "https://", "https://"+config.PAT+"@", 1)
}

// Sync performs the full add-commit-push-pull cycle
func (g *GitManager) Sync() error {
	if !GetConfiguration().Enabled {
		return nil
	}

	setStatus("syncing", nil)
	log.Println("Git Sync: Starting sync cycle...")

	// 1. Add (use -A to include all changes, ignore error if nothing changed)
	if _, err := g.runCommand("add", "-A"); err != nil {
		// Log but don't fail if add has issues (might be partially ignored)
		log.Printf("Git Sync: Add Warning: %v", err)
	}

	// 2. Commit (ignore error if nothing to commit)
	_, _ = g.runCommand("commit", "-m", "Auto-sync from DevDocs (Go)")

	// 3. Push
	u := g.getAuthenticatedURL()
	if _, err := g.runCommand("push", u, "main"); err != nil {
		_, _ = g.runCommand("push", u, "master")
	}

	// 4. Pull
	err := g.Pull()
	if err != nil {
		setStatus("error", err)
	} else {
		setStatus("success", nil)
	}
	return err
}
