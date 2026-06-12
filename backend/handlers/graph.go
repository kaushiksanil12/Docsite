package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// GraphNode represents a document in the knowledge graph
type GraphNode struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Path  string `json:"path"`
	Links int    `json:"links"`
}

// GraphEdge represents a link between two documents
type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

// GraphResponse is the API response for the graph endpoint
type GraphResponse struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

var (
	// Matches [[wiki-style links]]
	wikiLinkRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
	// Matches [text](path.md) — relative markdown links
	mdLinkRe = regexp.MustCompile(`\[(?:[^\]]*)\]\(([^)]+\.md)\)`)
)

// GetGraph scans all markdown files and builds a knowledge graph
func GetGraph(docsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Step 1: Discover all .md files and build a lookup map
		// Key = lowercase filename without .md extension, Value = relative path
		fileLookup := make(map[string]string)
		var allFiles []string

		absDocsDir, err := filepath.Abs(docsDir)
		if err != nil {
			http.Error(w, `{"error":"Internal error"}`, http.StatusInternalServerError)
			return
		}

		err = filepath.WalkDir(docsDir, func(path string, d os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil // skip errored entries
			}
			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(d.Name(), ".md") {
				return nil
			}

			absPath, absErr := filepath.Abs(path)
			if absErr != nil {
				return nil
			}
			relPath, relErr := filepath.Rel(absDocsDir, absPath)
			if relErr != nil {
				return nil
			}
			// Normalize to forward slashes for consistency
			relPath = filepath.ToSlash(relPath)

			allFiles = append(allFiles, relPath)
			nameKey := strings.ToLower(strings.TrimSuffix(d.Name(), ".md"))
			fileLookup[nameKey] = relPath

			return nil
		})
		if err != nil {
			http.Error(w, `{"error":"Failed to scan docs"}`, http.StatusInternalServerError)
			return
		}

		// Step 2: For each file, extract links and build edges
		edgeSet := make(map[string]bool) // dedup edges
		linkCount := make(map[string]int)
		var edges []GraphEdge

		for _, relPath := range allFiles {
			fullPath := filepath.Join(absDocsDir, filepath.FromSlash(relPath))
			content, readErr := os.ReadFile(fullPath)
			if readErr != nil {
				continue
			}

			targets := extractLinkTargets(string(content), relPath, fileLookup)
			for _, target := range targets {
				// Create a canonical edge key (sorted) to avoid duplicates
				edgeKey := relPath + " -> " + target
				if edgeSet[edgeKey] {
					continue
				}
				edgeSet[edgeKey] = true

				edges = append(edges, GraphEdge{
					Source: relPath,
					Target: target,
				})
				linkCount[relPath]++
				linkCount[target]++
			}
		}

		// Step 3: Build nodes
		nodes := make([]GraphNode, 0, len(allFiles))
		for _, relPath := range allFiles {
			name := strings.TrimSuffix(filepath.Base(relPath), ".md")
			nodes = append(nodes, GraphNode{
				ID:    relPath,
				Name:  name,
				Path:  relPath,
				Links: linkCount[relPath],
			})
		}

		resp := GraphResponse{
			Nodes: nodes,
			Edges: edges,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// extractLinkTargets finds all document references in content and resolves them
func extractLinkTargets(content, sourcePath string, fileLookup map[string]string) []string {
	var targets []string
	seen := make(map[string]bool)
	sourceDir := filepath.Dir(sourcePath)

	// 1. Wiki-links: [[Some Document]]
	for _, match := range wikiLinkRe.FindAllStringSubmatch(content, -1) {
		if len(match) < 2 {
			continue
		}
		linkText := strings.TrimSpace(match[1])
		key := strings.ToLower(linkText)

		// Try exact match first, then with spaces→hyphens, then spaces→underscores
		candidates := []string{
			key,
			strings.ReplaceAll(key, " ", "-"),
			strings.ReplaceAll(key, " ", "_"),
		}

		for _, candidate := range candidates {
			if targetPath, ok := fileLookup[candidate]; ok {
				if targetPath != sourcePath && !seen[targetPath] {
					seen[targetPath] = true
					targets = append(targets, targetPath)
				}
				break
			}
		}
	}

	// 2. Markdown links: [text](path.md)
	for _, match := range mdLinkRe.FindAllStringSubmatch(content, -1) {
		if len(match) < 2 {
			continue
		}
		linkPath := match[1]

		// Skip external URLs
		if strings.HasPrefix(linkPath, "http://") || strings.HasPrefix(linkPath, "https://") {
			continue
		}

		// Resolve relative to source file's directory
		resolved := filepath.ToSlash(filepath.Clean(filepath.Join(sourceDir, linkPath)))

		// Check if this resolved path exists in our file list
		if _, exists := findInFiles(resolved, fileLookup); exists {
			if resolved != sourcePath && !seen[resolved] {
				seen[resolved] = true
				targets = append(targets, resolved)
			}
		}
	}

	return targets
}

// findInFiles checks if a resolved path matches any known file
func findInFiles(resolved string, fileLookup map[string]string) (string, bool) {
	for _, path := range fileLookup {
		if path == resolved {
			return path, true
		}
	}
	return "", false
}
