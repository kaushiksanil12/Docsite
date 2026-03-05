/**
 * git-sync.js — Auto-sync docs and uploads to a SEPARATE GitHub repo
 *
 * Uses a dedicated .data-git/ directory as a separate git repository,
 * completely independent from the app's code repo (.git/).
 *
 * Architecture:
 *   .git/       → App code repo (what developers fork)
 *   .data-git/  → User data repo (each user's personal docs)
 *
 * This way, when someone forks the app, their docs/uploads are saved
 * in their OWN repo, not mixed with the codebase.
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const SYNC_CONFIG_FILE = path.resolve('./.sync-config.json');
const DATA_GIT_DIR = path.resolve('./.data-git');
const WORK_TREE = process.cwd();
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

// ─── Git Helpers (operate on .data-git, NOT .git) ───────────────
function gitCmd(args) {
    return `git --git-dir="${DATA_GIT_DIR}" --work-tree="${WORK_TREE}" ${args}`;
}

function gitExec(args) {
    return execSync(gitCmd(args), { cwd: WORK_TREE, encoding: 'utf-8', timeout: 30000 });
}

function isDataRepoInit() {
    return fs.existsSync(path.join(DATA_GIT_DIR, 'HEAD'));
}

function ensureDataRepo() {
    if (!isDataRepoInit()) {
        // Initialize a bare-like separate git dir
        execSync(`git init --separate-git-dir "${DATA_GIT_DIR}"`, {
            cwd: WORK_TREE,
            encoding: 'utf-8',
            timeout: 10000,
        });
        // The above creates a .git file (pointer) in WORK_TREE — remove it
        // since we already have the real .git for the code repo
        const gitPointer = path.join(WORK_TREE, '.git');
        if (fs.existsSync(gitPointer) && fs.statSync(gitPointer).isFile()) {
            // It's a pointer file, check if it points to .data-git
            const content = fs.readFileSync(gitPointer, 'utf-8');
            if (content.includes('.data-git') || content.includes('data-git')) {
                fs.unlinkSync(gitPointer);
            }
        }

        // Create a .gitignore inside the data repo to ONLY track docs and uploads
        const dataGitignore = path.join(DATA_GIT_DIR, 'info', 'exclude');
        fs.mkdirSync(path.join(DATA_GIT_DIR, 'info'), { recursive: true });
        fs.writeFileSync(dataGitignore, [
            '# Only track docs and uploads — ignore everything else',
            '/*',
            '!/docs/',
            '!/uploads/',
        ].join('\n'), 'utf-8');

        // Set git config for the data repo
        try {
            gitExec('config user.name "DevDocs Auto-Sync"');
            gitExec('config user.email "devdocs@local"');
        } catch { /* ignore */ }

        console.log('  📦 Initialized separate data repo (.data-git)');
    }
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

        // Stage docs and uploads
        try { gitExec('add docs/'); } catch { /* might not exist yet */ }
        try { gitExec('add uploads/'); } catch { /* might not exist yet */ }

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

        // Push (async to avoid blocking)
        const pushCmd = gitCmd('push -u origin HEAD');
        exec(pushCmd, { cwd: WORK_TREE, timeout: 60000 }, (err) => {
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
                if (filename.startsWith('.git') || filename.startsWith('.data-git')) return;
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

    // Pick up remote from existing data repo if available
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

module.exports = { init, configure, getStatus, triggerSync, performSync };
