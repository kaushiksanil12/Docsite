const express = require('express');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');
const hljs = require('highlight.js');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ─── Config ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DOCS_DIR = path.resolve(process.env.DOCS_DIR || './docs');
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads');

// Ensure directories exist
[DOCS_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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
    // Ensure parent directory exists
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ success: true, path: relPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Delete a file or folder
app.delete('/api/doc/*', (req, res) => {
  const relPath = req.params[0];
  const fullPath = safePath(relPath);
  if (!fullPath) return res.status(400).json({ error: 'Invalid path' });

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
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
  console.log(`  🖼️  Uploads directory: ${UPLOADS_DIR}\n`);
});
