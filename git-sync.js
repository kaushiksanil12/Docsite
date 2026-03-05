/**
 * git-sync.js — Auto-sync docs and uploads to a SEPARATE GitHub repo
 *
 * Strategy: maintains a separate git worktree at .data-repo/ that
 * mirrors the docs/ and uploads/ directories. On sync, files are
 * copied into .data-repo/, committed, and pushed.
 *
 * Architecture:
 *   .git/        → App code repo (what developers fork)
 *   .data-repo/  → Separate git repo with only docs & uploads
 *
 * This way, each user's personal docs push to their OWN repo.
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const SYNC_CONFIG_FILE = path.resolve('./.sync-config.json');
const DATA_REPO_DIR = path.resolve('./.data-repo');
const DEBOUNCE_MS = 30000; // 30 seconds after last change

let syncEnabled = false;
let remoteUrl = '';
let debounceTimer = null;
let isSyncing = false;
let lastSyncTime = null;
let lastSyncStatus = 'idle'; // idle | syncing | success | error
let lastSyncError = '';
let watchers = [];

// ─── Config Persistence ───────────────────────────────────────────
function loadConfig() {
    try {
        if (fs.existsSync(SYNC_CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(SYNC_CONFIG_FILE, 'utf-8'));
            syncEnabled = !!data.enabled;
            remoteUrl = data.remoteUrl || '';
            return data;
        }
    } catch { /* ignore */ }
    return { enabled: false, remoteUrl: '' };
}

function saveConfig() {
    fs.writeFileSync(SYNC_CONFIG_FILE, JSON.stringify({
        enabled: syncEnabled,
        remoteUrl: remoteUrl,
    }, null, 2), 'utf-8');
}

// ─── Git Helpers (all operate inside .data-repo/) ─────────────────
function gitExec(args) {
    return execSync(`git ${args}`, {
        cwd: DATA_REPO_DIR,
        encoding: 'utf-8',
        timeout: 30000,
    });
}

function isDataRepoInit() {
    return fs.existsSync(path.join(DATA_REPO_DIR, '.git', 'HEAD'));
}

function ensureDataRepo() {
    if (!isDataRepoInit()) {
        // Create the data repo directory and init a fresh git repo inside it
        fs.mkdirSync(DATA_REPO_DIR, { recursive: true });
        execSync('git init', { cwd: DATA_REPO_DIR, encoding: 'utf-8', timeout: 10000 });

        // Configure git user for the data repo
        try {
            gitExec('config user.name "DevDocs Auto-Sync"');
            gitExec('config user.email "devdocs@local"');
        } catch { /* ignore */ }

        console.log('  📦 Initialized data repo (.data-repo)');
    }

    // Ensure subdirectories exist
    fs.mkdirSync(path.join(DATA_REPO_DIR, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(DATA_REPO_DIR, 'uploads'), { recursive: true });
}

function getRemoteUrl() {
    try {
        return gitExec('remote get-url origin').trim();
    } catch { return ''; }
}

function setRemoteUrl(url) {
    try {
        const existing = getRemoteUrl();
        if (existing) {
            gitExec(`remote set-url origin "${url}"`);
        } else {
            gitExec(`remote add origin "${url}"`);
        }
        return true;
    } catch (err) {
        console.error('  ❌ Failed to set remote:', err.message);
        return false;
    }
}

// ─── File Copy Helpers ────────────────────────────────────────────
function copyDirSync(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });

    // Remove old files in dest that no longer exist in src
    if (fs.existsSync(dest)) {
        const destFiles = getAllFiles(dest);
        const srcFiles = getAllFiles(src).map(f => path.relative(src, f));
        for (const df of destFiles) {
            const rel = path.relative(dest, df);
            if (!srcFiles.includes(rel)) {
                try { fs.unlinkSync(df); } catch { /* skip */ }
            }
        }
    }

    // Copy all files from src to dest
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function getAllFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...getAllFiles(full));
        } else {
            results.push(full);
        }
    }
    return results;
}

// ─── Sync Logic ───────────────────────────────────────────────────
async function performSync() {
    if (isSyncing) return;
    if (!syncEnabled || !remoteUrl) return;

    isSyncing = true;
    lastSyncStatus = 'syncing';

    try {
        ensureDataRepo();

        // Set remote if needed
        const currentRemote = getRemoteUrl();
        if (currentRemote !== remoteUrl) {
            setRemoteUrl(remoteUrl);
        }

        // Copy docs and uploads into the data repo
        const docsDir = path.resolve('./docs');
        const uploadsDir = path.resolve('./uploads');
        copyDirSync(docsDir, path.join(DATA_REPO_DIR, 'docs'));
        copyDirSync(uploadsDir, path.join(DATA_REPO_DIR, 'uploads'));

        // Stage everything
        gitExec('add -A');

        // Check if there are changes to commit
        try {
            gitExec('diff --cached --quiet');
            // No changes staged
            isSyncing = false;
            lastSyncStatus = 'success';
            return;
        } catch {
            // There are staged changes — continue to commit
        }

        // Commit with timestamp
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        gitExec(`commit -m "auto-sync: ${timestamp}"`);

        // Push (async to avoid blocking the server)
        exec('git push -u origin HEAD', { cwd: DATA_REPO_DIR, timeout: 60000 }, (err) => {
            if (err) {
                console.error('  ❌ Git push failed:', err.message);
                lastSyncStatus = 'error';
                lastSyncError = err.message;
            } else {
                console.log('  ✅ Auto-synced docs to GitHub');
                lastSyncStatus = 'success';
                lastSyncError = '';
                lastSyncTime = new Date().toISOString();
            }
            isSyncing = false;
        });
    } catch (err) {
        console.error('  ❌ Auto-sync failed:', err.message);
        lastSyncStatus = 'error';
        lastSyncError = err.message;
        isSyncing = false;
    }
}

// ─── File Watcher ─────────────────────────────────────────────────
function scheduleSync() {
    if (!syncEnabled) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        performSync();
    }, DEBOUNCE_MS);
}

function startWatching(dirs) {
    stopWatching();

    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
                if (!filename) return;
                if (filename.startsWith('.git') || filename.startsWith('.data-repo')) return;
                if (filename === '.sync-config.json') return;
                scheduleSync();
            });
            watchers.push(watcher);
        } catch (err) {
            console.error(`  ⚠️ Could not watch ${dir}:`, err.message);
        }
    }

    if (watchers.length > 0) {
        console.log('  👁️  Watching for changes (auto-sync enabled)');
    }
}

function stopWatching() {
    for (const w of watchers) {
        try { w.close(); } catch { /* ignore */ }
    }
    watchers = [];
}

// ─── Public API ───────────────────────────────────────────────────
function getStatus() {
    return {
        enabled: syncEnabled,
        remoteUrl: remoteUrl,
        status: lastSyncStatus,
        lastSync: lastSyncTime,
        error: lastSyncError,
        isDataRepo: isDataRepoInit(),
    };
}

function configure({ enabled, remoteUrl: url }, watchDirs) {
    if (url !== undefined) remoteUrl = url;
    if (enabled !== undefined) syncEnabled = !!enabled;
    saveConfig();

    if (syncEnabled && remoteUrl) {
        ensureDataRepo();
        startWatching(watchDirs);
        scheduleSync();
    } else {
        stopWatching();
    }
}

function init(watchDirs) {
    loadConfig();

    if (!remoteUrl && isDataRepoInit()) {
        const existing = getRemoteUrl();
        if (existing) {
            remoteUrl = existing;
            saveConfig();
        }
    }

    if (syncEnabled && remoteUrl) {
        startWatching(watchDirs);
    }
}

function triggerSync() {
    if (!syncEnabled || !remoteUrl) {
        return { success: false, error: 'Sync not configured' };
    }
    performSync();
    return { success: true };
}

// ─── Synchronous Flush (for shutdown) ─────────────────────────────
// Blocks until commit + push are complete. Called during graceful shutdown.
function flushSync() {
    if (!syncEnabled || !remoteUrl) return;
    if (!isDataRepoInit()) return;

    try {
        ensureDataRepo();

        const currentRemote = getRemoteUrl();
        if (currentRemote !== remoteUrl) setRemoteUrl(remoteUrl);

        // Copy docs and uploads
        const docsDir = path.resolve('./docs');
        const uploadsDir = path.resolve('./uploads');
        copyDirSync(docsDir, path.join(DATA_REPO_DIR, 'docs'));
        copyDirSync(uploadsDir, path.join(DATA_REPO_DIR, 'uploads'));

        // Stage
        gitExec('add -A');

        // Check for changes
        try {
            gitExec('diff --cached --quiet');
            console.log('  ✅ No unsaved changes — clean shutdown');
            return;
        } catch {
            // has staged changes
        }

        // Commit
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        gitExec(`commit -m "auto-sync (shutdown): ${timestamp}"`);

        // Push SYNCHRONOUSLY — block until done
        console.log('  ⏳ Flushing data to GitHub before shutdown...');
        execSync('git push -u origin HEAD', {
            cwd: DATA_REPO_DIR,
            encoding: 'utf-8',
            timeout: 60000,
        });

        console.log('  ✅ Data safely pushed to GitHub');
        lastSyncTime = new Date().toISOString();
        lastSyncStatus = 'success';
    } catch (err) {
        console.error('  ❌ Shutdown sync failed:', err.message);
    }
}

// ─── Graceful Shutdown ────────────────────────────────────────────
let shutdownHandled = false;
function handleShutdown(signal) {
    if (shutdownHandled) return;
    shutdownHandled = true;
    console.log(`\n  🛑 Received ${signal} — syncing before exit...`);
    if (debounceTimer) clearTimeout(debounceTimer);
    stopWatching();
    flushSync();
    process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

module.exports = { init, configure, getStatus, triggerSync, performSync, flushSync };
