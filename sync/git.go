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
		log.Println("Git Sync: Repository already initialized at target. Updating remote URL...")
		// Update the remote URL in case the user changed it in the UI
		g.runCommand("remote", "set-url", "origin", g.RepoURL)
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
	// Force the default branch to be 'main' to prevent master/main split
	g.runCommand("branch", "-M", "main")

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

	// Detect branch
	branch, _ := g.getCurrentBranch()
	if branch == "" || branch == "HEAD" {
		branch = "main" // fallback
	}

	err := g.pullFromBranch(branch)
	// If the initial pull fails because 'main' doesn't exist remotely yet, that's fine (new repo)

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
	// Add --allow-unrelated-histories so local markdown files can safely merge with a newly linked, non-empty remote repository
	_, err := g.runCommand("pull", u, branch, "--allow-unrelated-histories")
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
	setStatus("syncing", nil)
	log.Println("Git Sync: Starting sync cycle...")

	// 1. Add (use -A to include all changes)
	out, err := g.runCommand("add", "-A")
	if err != nil {
		log.Printf("Git Sync: Add Warning: %v (Output: %s)", err, out)
	}

	// 2. Commit (ignore error if nothing to commit)
	out, err = g.runCommand("commit", "-m", "Auto-sync from DevDocs (Go)")
	if err != nil {
		// Only log commit info, don't fail sync if nothing to commit
		log.Printf("Git Sync: Commit info: %v (Output: %s)", err, out)
	}

	// Detect current branch
	branch, err := g.getCurrentBranch()
	if err != nil {
		branch = "main" // fallback
	}

	// 3. Push
	u := g.getAuthenticatedURL()
	log.Printf("Git Sync: Pushing to remote branch %s...", branch)
	out, err = g.runCommand("push", "-u", u, branch)
	if err != nil {
		log.Printf("Git Sync: Push failed: %v (Output: %s)", err, out)
		setStatus("error", fmt.Errorf("git push %s failed: %v", branch, err))
		return err
	}

	// 4. Pull
	log.Println("Git Sync: Pulling after push...")
	err = g.Pull()
	if err != nil {
		// Pull handles its own status
		return err
	}

	setStatus("success", nil)
	return nil
}

func (g *GitManager) getCurrentBranch() (string, error) {
	out, err := g.runCommand("rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}
