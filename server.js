const express = require('express');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');
const hljs = require('highlight.js');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const gitSync = require('./git-sync');

// ─── Config ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DOCS_DIR = path.resolve(process.env.DOCS_DIR || './docs');
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads');
const TRASH_DIR = path.resolve('./trash');
const TRASH_DOCS_DIR = path.join(TRASH_DIR, 'docs');
const TRASH_UPLOADS_DIR = path.join(TRASH_DIR, 'uploads');
const TRASH_META_FILE = path.join(TRASH_DIR, 'meta.json');

// Ensure directories exist
[DOCS_DIR, UPLOADS_DIR, TRASH_DOCS_DIR, TRASH_UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Ensure trash meta file exists
if (!fs.existsSync(TRASH_META_FILE)) {
  fs.writeFileSync(TRASH_META_FILE, '[]', 'utf-8');
}

// ─── Marked config ─────────────────────────────────────────────────
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true,
});

// ─── Multer config ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|svg|webp|bmp)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// ─── Express App ───────────────────────────────────────────────────
const app = express();

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Validate a doc path — prevent path traversal
 */
function safePath(relPath) {
  const cleaned = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(DOCS_DIR, cleaned);
  if (!full.startsWith(DOCS_DIR)) return null;
  return full;
}

/**
 * Extract image filenames referenced in markdown content
 * Matches patterns like ![alt](/uploads/filename.png)
 */
function extractImagePaths(content) {
  const regex = /!\[.*?\]\(\/uploads\/([^)]+)\)/g;
  const images = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    images.push(match[1]);
  }
  return images;
}

/**
 * Recursively collect all image references from .md files in a directory
 */
function collectImagesFromDir(dir) {
  const images = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return images; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      images.push(...collectImagesFromDir(fullPath));
    } else if (entry.name.endsWith('.md')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        images.push(...extractImagePaths(content));
      } catch { /* skip */ }
    }
  }
  return images;
}

/**
 * Read trash metadata
 */
function readTrashMeta() {
  try {
    return JSON.parse(fs.readFileSync(TRASH_META_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Write trash metadata
 */
function writeTrashMeta(meta) {
  fs.writeFileSync(TRASH_META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Build a tree structure from a directory
 */
function buildTree(dir, base = '') {
  const items = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return items;
  }

  // Sort: folders first, then files, alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      items.push({
        name: entry.name,
        path: relPath,
        type: 'folder',
        children: buildTree(path.join(dir, entry.name), relPath),
      });
    } else if (entry.name.endsWith('.md')) {
      items.push({
        name: entry.name.replace(/\.md$/, ''),
        path: relPath,
        type: 'file',
      });
    }
  }
  return items;
}

/**
 * Recursively search for a query in all .md files
 */
function searchDocs(dir, query, base = '') {
  const results = [];
  const lowerQuery = query.toLowerCase();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...searchDocs(fullPath, query, relPath));
    } else if (entry.name.endsWith('.md')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lowerContent = content.toLowerCase();
        const idx = lowerContent.indexOf(lowerQuery);
        if (idx !== -1) {
          // Extract context snippet
          const start = Math.max(0, idx - 60);
          const end = Math.min(content.length, idx + query.length + 60);
          let snippet = content.substring(start, end).replace(/\n/g, ' ');
          if (start > 0) snippet = '...' + snippet;
          if (end < content.length) snippet = snippet + '...';

          results.push({
            name: entry.name.replace(/\.md$/, ''),
            path: relPath,
            snippet,
          });
        }
      } catch { /* skip unreadable */ }
    }
  }
  return results;
}

// ─── API Routes ────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Get folder/file tree
app.get('/api/tree', (req, res) => {
  res.json(buildTree(DOCS_DIR));
});

// Search docs
app.get('/api/search', (req, res) => {
  const q = req.query.q;
  if (!q || q.trim().length < 2) {
    return res.json([]);
  }
  res.json(searchDocs(DOCS_DIR, q.trim()));
});

// Read a markdown file
app.get('/api/doc/*', (req, res) => {
  const relPath = req.params[0];
  const fullPath = safePath(relPath);
  if (!fullPath) return res.status(400).json({ error: 'Invalid path' });

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const html = marked(raw);
    const stat = fs.statSync(fullPath);
    res.json({
      raw,
      html,
      path: relPath,
      name: path.basename(relPath, '.md'),
      lastModified: stat.mtime,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// Create or update a markdown file
app.post('/api/doc/*', (req, res) => {
  const relPath = req.params[0];
  const fullPath = safePath(relPath);
  if (!fullPath) return res.status(400).json({ error: 'Invalid path' });

  // Ensure the file ends with .md
  if (!fullPath.endsWith('.md')) {
    return res.status(400).json({ error: 'Only .md files are supported' });
  }

  const { content } = req.body;
  if (content === undefined) {
    return res.status(400).json({ error: 'Content is required' });
  }

  try {
    // Collect old image references before saving (for orphan cleanup)
    let oldImages = [];
    if (fs.existsSync(fullPath)) {
      const oldContent = fs.readFileSync(fullPath, 'utf-8');
      oldImages = extractImagePaths(oldContent);
    }

    // Save the new content
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');

    // Clean up orphaned images (removed from content)
    const newImages = extractImagePaths(content);
    const orphanedImages = oldImages.filter(img => !newImages.includes(img));
    for (const img of orphanedImages) {
      const imgPath = path.join(UPLOADS_DIR, img);
      if (fs.existsSync(imgPath)) {
        try { fs.unlinkSync(imgPath); } catch { /* skip */ }
      }
    }

    res.json({ success: true, path: relPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Delete a file or folder (soft delete — move to trash)
app.delete('/api/doc/*', (req, res) => {
  const relPath = req.params[0];
  const fullPath = safePath(relPath);
  if (!fullPath) return res.status(400).json({ error: 'Invalid path' });

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const stat = fs.statSync(fullPath);
    const timestamp = Date.now();
    const trashId = `${timestamp}_${path.basename(relPath)}`;
    const trashDocPath = path.join(TRASH_DOCS_DIR, trashId);
    const isDir = stat.isDirectory();

    // Collect image references before moving
    let images = [];
    if (isDir) {
      images = collectImagesFromDir(fullPath);
    } else if (fullPath.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      images = extractImagePaths(content);
    }

    // Move images to trash
    const trashedImages = [];
    for (const img of images) {
      const imgSrc = path.join(UPLOADS_DIR, img);
      const imgDest = path.join(TRASH_UPLOADS_DIR, `${timestamp}_${img}`);
      if (fs.existsSync(imgSrc)) {
        fs.renameSync(imgSrc, imgDest);
        trashedImages.push({ original: img, trashed: `${timestamp}_${img}` });
      }
    }

    // Move the doc/folder to trash
    fs.renameSync(fullPath, trashDocPath);

    // Save metadata
    const meta = readTrashMeta();
    meta.push({
      id: trashId,
      originalPath: relPath,
      type: isDir ? 'folder' : 'file',
      deletedAt: new Date(timestamp).toISOString(),
      images: trashedImages,
    });
    writeTrashMeta(meta);

    res.json({ success: true, trashedTo: trashId });
  } catch (err) {
    console.error('Trash error:', err);
    res.status(500).json({ error: 'Failed to move to trash' });
  }
});

// ─── Trash API Routes ──────────────────────────────────────────────

// List trashed items
app.get('/api/trash', (req, res) => {
  const meta = readTrashMeta();
  res.json(meta);
});

// Restore a trashed item
app.post('/api/trash/restore', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const meta = readTrashMeta();
  const itemIdx = meta.findIndex(m => m.id === id);
  if (itemIdx === -1) return res.status(404).json({ error: 'Trash item not found' });

  const item = meta[itemIdx];
  const trashDocPath = path.join(TRASH_DOCS_DIR, item.id);
  const restorePath = path.join(DOCS_DIR, item.originalPath);

  if (!fs.existsSync(trashDocPath)) {
    // Item missing from trash, clean up meta
    meta.splice(itemIdx, 1);
    writeTrashMeta(meta);
    return res.status(404).json({ error: 'Trash file not found on disk' });
  }

  try {
    // Ensure parent directory exists
    const parentDir = path.dirname(restorePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // If destination already exists, add a suffix
    let finalPath = restorePath;
    if (fs.existsSync(finalPath)) {
      const ext = path.extname(finalPath);
      const base = finalPath.slice(0, -ext.length || undefined);
      finalPath = `${base}_restored_${Date.now()}${ext}`;
    }

    // Restore the doc/folder
    fs.renameSync(trashDocPath, finalPath);

    // Restore images
    for (const img of (item.images || [])) {
      const imgTrash = path.join(TRASH_UPLOADS_DIR, img.trashed);
      const imgRestore = path.join(UPLOADS_DIR, img.original);
      if (fs.existsSync(imgTrash)) {
        fs.renameSync(imgTrash, imgRestore);
      }
    }

    // Remove from meta
    meta.splice(itemIdx, 1);
    writeTrashMeta(meta);

    res.json({ success: true, restoredTo: item.originalPath });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(500).json({ error: 'Failed to restore' });
  }
});

// Permanently delete a single trash item
app.delete('/api/trash/:id', (req, res) => {
  const { id } = req.params;
  const meta = readTrashMeta();
  const itemIdx = meta.findIndex(m => m.id === id);
  if (itemIdx === -1) return res.status(404).json({ error: 'Trash item not found' });

  const item = meta[itemIdx];

  try {
    // Delete doc/folder from trash
    const trashDocPath = path.join(TRASH_DOCS_DIR, item.id);
    if (fs.existsSync(trashDocPath)) {
      const stat = fs.statSync(trashDocPath);
      if (stat.isDirectory()) {
        fs.rmSync(trashDocPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(trashDocPath);
      }
    }

    // Delete images from trash
    for (const img of (item.images || [])) {
      const imgPath = path.join(TRASH_UPLOADS_DIR, img.trashed);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    // Remove from meta
    meta.splice(itemIdx, 1);
    writeTrashMeta(meta);

    res.json({ success: true });
  } catch (err) {
    console.error('Permanent delete error:', err);
    res.status(500).json({ error: 'Failed to permanently delete' });
  }
});

// Empty all trash
app.delete('/api/trash/clear/all', (req, res) => {
  try {
    // Remove all files in trash directories
    fs.rmSync(TRASH_DOCS_DIR, { recursive: true, force: true });
    fs.rmSync(TRASH_UPLOADS_DIR, { recursive: true, force: true });
    fs.mkdirSync(TRASH_DOCS_DIR, { recursive: true });
    fs.mkdirSync(TRASH_UPLOADS_DIR, { recursive: true });
    writeTrashMeta([]);
    res.json({ success: true });
  } catch (err) {
    console.error('Empty trash error:', err);
    res.status(500).json({ error: 'Failed to empty trash' });
  }
});

// Create a folder
app.post('/api/folder', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath is required' });

  const fullPath = safePath(folderPath);
  if (!fullPath) return res.status(400).json({ error: 'Invalid path' });

  if (fs.existsSync(fullPath)) {
    return res.status(409).json({ error: 'Folder already exists' });
  }

  try {
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ success: true, path: folderPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Rename a file or folder
app.post('/api/rename', (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) {
    return res.status(400).json({ error: 'oldPath and newPath are required' });
  }

  const fullOld = safePath(oldPath);
  const fullNew = safePath(newPath);
  if (!fullOld || !fullNew) return res.status(400).json({ error: 'Invalid path' });

  if (!fs.existsSync(fullOld)) {
    return res.status(404).json({ error: 'Source not found' });
  }
  if (fs.existsSync(fullNew)) {
    return res.status(409).json({ error: 'Destination already exists' });
  }

  try {
    // Ensure parent of new path exists
    const parentDir = path.dirname(fullNew);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.renameSync(fullOld, fullNew);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename' });
  }
});

// Upload an image
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ success: true, url, filename: req.file.filename });
});

// ─── Sync API ──────────────────────────────────────────────────────
app.get('/api/sync/status', (req, res) => {
  res.json(gitSync.getStatus());
});

app.post('/api/sync/configure', (req, res) => {
  const { enabled, remoteUrl, pat } = req.body;
  gitSync.configure({ enabled, remoteUrl, pat }, [DOCS_DIR, UPLOADS_DIR, TRASH_DIR]);
  res.json({ success: true, ...gitSync.getStatus() });
});

app.post('/api/sync/trigger', (req, res) => {
  const result = gitSync.triggerSync();
  res.json(result);
});

app.post('/api/sync/pull', async (req, res) => {
  try {
    const result = await gitSync.pullRemote();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Catch-all: serve index.html ──────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   DevDocs running on port ${PORT}        ║`);
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
  console.log(`  📁 Docs directory:    ${DOCS_DIR}`);
  console.log(`  🖼️  Uploads directory: ${UPLOADS_DIR}`);

  // Initialize git auto-sync
  gitSync.init([DOCS_DIR, UPLOADS_DIR, TRASH_DIR]);
  const syncStatus = gitSync.getStatus();
  if (syncStatus.enabled) {
    console.log(`  🔄 Auto-sync: enabled (${syncStatus.remoteUrl})`);
  } else {
    console.log(`  🔄 Auto-sync: disabled (configure in Settings)`);
  }
  console.log('');
});
