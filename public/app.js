/* ═══════════════════════════════════════════════════════════════
   DevDocs — Client-Side Application
   ═══════════════════════════════════════════════════════════════ */

(() => {
    'use strict';

    // ─── State ───────────────────────────────────────────────────
    let currentDoc = null;     // current file path
    let isEditing = false;
    let tree = [];
    let contextTarget = null;  // path for context menu

    // ─── DOM refs ────────────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const sidebar = $('#sidebar');
    const fileTree = $('#file-tree');
    const searchInput = $('#search-input');
    const searchResults = $('#search-results');
    const breadcrumbs = $('#breadcrumbs');
    const toolbar = $('#toolbar');
    const welcome = $('#welcome');
    const viewer = $('#viewer');
    const docContent = $('#doc-content');
    const editorPane = $('#editor-pane');
    const editor = $('#editor');
    const preview = $('#preview');
    const dropOverlay = $('#drop-overlay');
    const contextMenu = $('#context-menu');

    const btnEdit = $('#btn-edit');
    const btnSave = $('#btn-save');
    const btnCancel = $('#btn-cancel');
    const btnUpload = $('#btn-upload');
    const btnDeleteDoc = $('#btn-delete-doc');
    const imageInput = $('#image-upload-input');
    const btnNewFolder = $('#btn-new-folder');
    const btnNewFile = $('#btn-new-file');
    const sidebarToggle = $('#sidebar-toggle');
    const themeToggle = $('#theme-toggle');

    // Trash DOM refs
    const btnOpenTrash = $('#btn-open-trash');
    const trashPanel = $('#trash-panel');
    const trashList = $('#trash-list');
    const trashCountBadge = $('#trash-count');
    const btnEmptyTrash = $('#btn-empty-trash');
    const btnCloseTrash = $('#btn-close-trash');

    // ─── API helpers ─────────────────────────────────────────────
    async function api(url, opts = {}) {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...opts,
        });
        return res.json();
    }

    // ─── Toast ───────────────────────────────────────────────────
    function toast(msg, type = 'success') {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3100);
    }

    // ─── Load Tree ───────────────────────────────────────────────
    async function loadTree() {
        const scrollTop = fileTree.scrollTop;
        tree = await api('/api/tree');
        renderTree(tree, fileTree);
        fileTree.scrollTop = scrollTop;
    }

    // Keep track of which folders are open
    let openFolders = new Set();

    function renderTree(items, container, depth = 0) {
        container.innerHTML = '';
        for (const item of items) {
            const el = document.createElement('div');
            el.className = 'tree-item';

            if (item.type === 'folder') {
                const isOpen = openFolders.has(item.path);

                el.innerHTML = `
          <div class="tree-label drop-zone" draggable="true" data-path="${item.path}" data-type="folder" style="padding-left:${10 + depth * 14}px">
            <span class="tree-toggle ${isOpen ? 'open' : ''}">▶</span>
            <span class="tree-icon">📁</span>
            <span class="tree-name">${item.name}</span>
            <span class="tree-actions">
              <button class="tree-action-btn" data-action="add-file" title="New file">📄</button>
              <button class="tree-action-btn" data-action="add-folder" title="New folder">📁+</button>
              <button class="tree-action-btn delete-btn" data-action="delete-item" title="Delete folder">🗑️</button>
            </span>
          </div>
          <div class="tree-children" style="display: ${isOpen ? '' : 'none'}"></div>
        `;
                const childrenContainer = el.querySelector('.tree-children');
                renderTree(item.children || [], childrenContainer, depth + 1);

                // Toggle collapse
                const label = el.querySelector('.tree-label');
                const toggle = el.querySelector('.tree-toggle');
                label.addEventListener('click', (e) => {
                    if (e.target.closest('.tree-action-btn')) return;
                    toggle.classList.toggle('open');

                    if (toggle.classList.contains('open')) {
                        openFolders.add(item.path);
                        childrenContainer.style.display = '';
                    } else {
                        openFolders.delete(item.path);
                        childrenContainer.style.display = 'none';
                    }
                });

                // Inline action buttons
                el.querySelector('[data-action="add-file"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showInlineInput(childrenContainer, item.path, 'file', depth + 1);
                });
                el.querySelector('[data-action="add-folder"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showInlineInput(childrenContainer, item.path, 'folder', depth + 1);
                });
                el.querySelector('[data-action="delete-item"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteTreeItem(item.path, 'folder');
                });

                // Drag and Drop for folder (drop zone)
                label.addEventListener('dragstart', handleDragStart);
                label.addEventListener('dragover', handleDragOver);
                label.addEventListener('dragleave', handleDragLeave);
                label.addEventListener('drop', handleDrop);

                // Context menu
                label.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showContextMenu(e.clientX, e.clientY, item.path, 'folder');
                });

            } else {
                el.innerHTML = `
          <div class="tree-label drop-zone" draggable="true" data-path="${item.path}" data-type="file" style="padding-left:${10 + depth * 14}px">
            <span class="tree-icon">📄</span>
            <span class="tree-name">${item.name}</span>
            <span class="tree-actions">
              <button class="tree-action-btn delete-btn" data-action="delete-item" title="Delete file">🗑️</button>
            </span>
          </div>
        `;
                const label = el.querySelector('.tree-label');
                label.addEventListener('click', (e) => {
                    if (e.target.closest('.tree-action-btn')) return;
                    openDoc(item.path);
                });
                el.querySelector('[data-action="delete-item"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteTreeItem(item.path, 'file');
                });

                // Drag and Drop for file (draggable)
                label.addEventListener('dragstart', handleDragStart);
                // Also allow dropping onto a file to just place it in the same parent folder
                label.addEventListener('dragover', handleDragOver);
                label.addEventListener('dragleave', handleDragLeave);
                label.addEventListener('drop', handleDrop);
                label.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showContextMenu(e.clientX, e.clientY, item.path, 'file');
                });
            }

            container.appendChild(el);
        }
    }

    // ─── Drag and Drop Handlers ──────────────────────────────────
    function handleDragStart(e) {
        // e.target is the .tree-label
        const path = e.target.dataset.path;
        if (!path) return;
        e.dataTransfer.setData('text/plain', path);
        e.dataTransfer.effectAllowed = 'move';

        // Slight visual cue for the item being dragged
        setTimeout(() => e.target.style.opacity = '0.5', 0);

        // Clean up visual cue once drag ends
        e.target.addEventListener('dragend', () => e.target.style.opacity = '1', { once: true });
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const label = e.currentTarget;
        if (!label.classList.contains('drag-over')) {
            label.classList.add('drag-over');
            label.style.background = 'var(--bg-tertiary)';
            label.style.outline = '1px solid var(--accent)';
        }
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        const label = e.currentTarget;
        label.classList.remove('drag-over');
        label.style.background = '';
        label.style.outline = '';
    }

    async function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();

        const label = e.currentTarget;
        label.classList.remove('drag-over');
        label.style.background = '';
        label.style.outline = '';

        const sourcePath = e.dataTransfer.getData('text/plain');
        if (!sourcePath) return;

        const targetPathAttr = label.dataset.path; // the item dropped onto
        const targetType = label.dataset.type;

        // If target was root, we would handle differently. Here the drop was ON a label.
        // If they drop on a folder, target folder is that folder.
        // If they drop on a file, target folder is the file's parent folder.
        let targetFolder = '';
        if (targetPathAttr) {
            targetFolder = targetType === 'folder'
                ? targetPathAttr
                : targetPathAttr.substring(0, targetPathAttr.lastIndexOf('/'));
        }

        await processMove(sourcePath, targetFolder);
    }

    // Support dropping onto the root area (the empty space in fileTree)
    fileTree.addEventListener('dragover', (e) => {
        // Only accept if we're not over a specific tree label (handled by label's dragover)
        if (e.target.closest('.tree-label')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    fileTree.addEventListener('drop', async (e) => {
        if (e.target.closest('.tree-label')) return;
        e.preventDefault();
        const sourcePath = e.dataTransfer.getData('text/plain');
        if (!sourcePath) return;

        // Root drop
        await processMove(sourcePath, '');
    });

    async function processMove(sourcePath, targetFolder) {
        const itemName = sourcePath.split('/').pop();
        const sourceFolder = sourcePath.includes('/')
            ? sourcePath.substring(0, sourcePath.lastIndexOf('/'))
            : '';

        // Prevent dropping onto itself or its existing parent
        if (sourcePath === targetFolder || sourceFolder === targetFolder) return;

        // Prevent dropping a folder into its own children
        if (targetFolder.startsWith(sourcePath + '/')) {
            toast('Cannot move folder into itself', 'error');
            return;
        }

        const newPath = targetFolder ? `${targetFolder}/${itemName}` : itemName;

        const res = await api('/api/rename', {
            method: 'POST',
            body: JSON.stringify({ oldPath: sourcePath, newPath }),
        });

        if (res.success) {
            // Update currentDoc reference if the active file was moved
            if (currentDoc === sourcePath) currentDoc = newPath;
            else if (currentDoc && currentDoc.startsWith(sourcePath + '/')) {
                currentDoc = currentDoc.replace(sourcePath, newPath);
            }
            await loadTree();
        } else {
            toast(res.error || 'Failed to move', 'error');
        }
    }

    // ─── Delete from tree directly ────────────────────────────────
    async function deleteTreeItem(path, type) {
        const confirmMsg = type === 'folder'
            ? `Delete folder "${path}" and ALL its contents?`
            : `Delete "${path}"?`;
        const ok = await showConfirm(confirmMsg);
        if (!ok) return;
        const res = await api(`/api/doc/${path}`, { method: 'DELETE' });
        if (res.success) {
            toast('Moved to trash');
            if (currentDoc === path) { currentDoc = null; showWelcome(); }
            await loadTree();
            updateTrashCount();
        } else {
            toast(res.error || 'Delete failed', 'error');
        }
    }

    // ─── Custom Confirm Modal ─────────────────────────────────────
    const confirmModal = $('#confirm-modal');
    const confirmMessage = $('#confirm-message');
    const confirmOk = $('#confirm-ok');
    const confirmCancelBtn = $('#confirm-cancel');

    function showConfirm(message, okLabel = '🗑️ Delete', okClass = 'danger-solid') {
        return new Promise((resolve) => {
            confirmMessage.textContent = message;
            confirmOk.textContent = okLabel;

            // Reset classes and apply new one
            confirmOk.className = 'tool-btn ' + okClass;

            confirmModal.classList.remove('hidden');

            const cleanup = () => {
                confirmModal.classList.add('hidden');
                confirmOk.removeEventListener('click', onOk);
                confirmCancelBtn.removeEventListener('click', onCancel);
            };
            const onOk = () => { cleanup(); resolve(true); };
            const onCancel = () => { cleanup(); resolve(false); };

            confirmOk.addEventListener('click', onOk);
            confirmCancelBtn.addEventListener('click', onCancel);
        });
    }

    // ─── Inline Input (New file/folder in tree) ──────────────────
    function showInlineInput(container, parentPath, type, depth) {
        // Remove existing inline inputs
        document.querySelectorAll('.tree-inline-input').forEach(el => el.remove());

        const wrapper = document.createElement('div');
        wrapper.style.paddingLeft = `${10 + depth * 14}px`;
        const input = document.createElement('input');
        input.className = 'tree-inline-input';
        input.placeholder = type === 'folder' ? 'Folder name...' : 'filename.md';
        wrapper.appendChild(input);
        container.prepend(wrapper);

        // Preserve scroll manually as preventScroll isn't supported uniformly in older browsers or has buggy edge cases.
        const treeScroll = fileTree.scrollTop;
        input.focus({ preventScroll: true });
        fileTree.scrollTop = treeScroll;

        const commit = async () => {
            let name = input.value.trim();
            if (!name) { wrapper.remove(); return; }

            if (type === 'file' && !name.endsWith('.md')) name += '.md';

            const fullPath = parentPath ? `${parentPath}/${name}` : name;

            if (type === 'folder') {
                const res = await api('/api/folder', {
                    method: 'POST',
                    body: JSON.stringify({ folderPath: fullPath }),
                });
                if (res.success) {
                    toast(`Folder "${name}" created`);
                    await loadTree();
                } else {
                    toast(res.error || 'Failed', 'error');
                }
            } else {
                const res = await api(`/api/doc/${fullPath}`, {
                    method: 'POST',
                    body: JSON.stringify({ content: `# ${name.replace('.md', '')}\n\nStart writing here...\n` }),
                });
                if (res.success) {
                    toast(`File "${name}" created`);
                    await loadTree();
                    openDoc(fullPath);
                } else {
                    toast(res.error || 'Failed', 'error');
                }
            }
            wrapper.remove();
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') wrapper.remove();
        });
        input.addEventListener('blur', () => {
            setTimeout(() => wrapper.remove(), 200);
        });
    }

    // ─── Sidebar top-level buttons ───────────────────────────────
    btnNewFolder.addEventListener('click', () => {
        showInlineInput(fileTree, '', 'folder', 0);
    });

    btnNewFile.addEventListener('click', () => {
        showInlineInput(fileTree, '', 'file', 0);
    });

    // ─── Context Menu ────────────────────────────────────────────
    function showContextMenu(x, y, path, type) {
        contextTarget = { path, type };
        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.classList.remove('hidden');

        // Show/hide relevant buttons
        contextMenu.querySelector('[data-action="new-file"]').style.display = type === 'folder' ? '' : 'none';
        contextMenu.querySelector('[data-action="new-folder"]').style.display = type === 'folder' ? '' : 'none';
    }

    document.addEventListener('click', () => {
        contextMenu.classList.add('hidden');
    });

    contextMenu.addEventListener('click', async (e) => {
        const action = e.target.dataset.action;
        if (!action || !contextTarget) return;
        contextMenu.classList.add('hidden');

        const { path, type } = contextTarget;

        switch (action) {
            case 'new-file': {
                const name = prompt('New file name (e.g. my-notes.md):');
                if (!name) return;
                const fn = name.endsWith('.md') ? name : name + '.md';
                const fullPath = `${path}/${fn}`;
                const res = await api(`/api/doc/${fullPath}`, {
                    method: 'POST',
                    body: JSON.stringify({ content: `# ${fn.replace('.md', '')}\n\n` }),
                });
                if (res.success) { toast(`Created ${fn}`); await loadTree(); openDoc(fullPath); }
                else toast(res.error, 'error');
                break;
            }
            case 'new-folder': {
                const name = prompt('New folder name:');
                if (!name) return;
                const res = await api('/api/folder', {
                    method: 'POST',
                    body: JSON.stringify({ folderPath: `${path}/${name.trim()}` }),
                });
                if (res.success) { toast(`Created folder "${name}"`); await loadTree(); }
                else toast(res.error, 'error');
                break;
            }
            case 'rename': {
                const newName = prompt('New name:', path.split('/').pop());
                if (!newName) return;
                const parts = path.split('/');
                parts[parts.length - 1] = type === 'file' && !newName.endsWith('.md') ? newName + '.md' : newName;
                const newPath = parts.join('/');
                const res = await api('/api/rename', {
                    method: 'POST',
                    body: JSON.stringify({ oldPath: path, newPath }),
                });
                if (res.success) {
                    toast('Renamed successfully');
                    if (currentDoc === path) currentDoc = newPath;
                    await loadTree();
                } else toast(res.error, 'error');
                break;
            }
            case 'delete': {
                const confirmMsg = type === 'folder'
                    ? `Delete folder "${path}" and ALL its contents?`
                    : `Delete "${path}"?`;
                const ok = await showConfirm(confirmMsg);
                if (!ok) return;
                const res = await api(`/api/doc/${path}`, { method: 'DELETE' });
                if (res.success) {
                    toast('Moved to trash');
                    if (currentDoc === path) { currentDoc = null; showWelcome(); }
                    await loadTree();
                    updateTrashCount();
                } else toast(res.error, 'error');
                break;
            }
        }
    });

    // ─── Open Document ───────────────────────────────────────────
    async function openDoc(filePath) {
        currentDoc = filePath;
        exitEditor();

        const data = await api(`/api/doc/${filePath}`);
        if (data.error) { toast(data.error, 'error'); return; }

        // Breadcrumbs
        renderBreadcrumbs(filePath);

        // Set active in tree
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('active'));
        const activeLabel = document.querySelector(`.tree-label[data-path="${filePath}"]`);
        if (activeLabel) activeLabel.classList.add('active');

        // Show doc
        welcome.classList.add('hidden');
        editorPane.classList.add('hidden');
        viewer.classList.remove('hidden');
        toolbar.classList.remove('hidden');

        // Meta info
        const modified = new Date(data.lastModified).toLocaleString();
        docContent.innerHTML = `<div class="doc-meta">Last modified: ${modified}</div>` + data.html;

        // Apply syntax highlighting and copy button to code blocks in viewer
        docContent.querySelectorAll('pre').forEach(pre => {
            const block = pre.querySelector('code');
            if (window.hljs && block) {
                hljs.highlightElement(block);
            }

            // Add Copy Button
            const btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.textContent = 'Copy';
            btn.title = 'Copy code to clipboard';

            btn.addEventListener('click', () => {
                const text = block ? block.innerText : pre.innerText;
                navigator.clipboard.writeText(text).then(() => {
                    btn.textContent = 'Copied!';
                    btn.classList.add('copied');
                    setTimeout(() => {
                        btn.textContent = 'Copy';
                        btn.classList.remove('copied');
                    }, 2000);
                }).catch(err => console.error('Failed to copy: ', err));
            });
            pre.appendChild(btn);
        });

        // Store raw for editor
        editor.dataset.raw = data.raw;
    }

    function renderBreadcrumbs(filePath) {
        const parts = filePath.replace('.md', '').split('/');
        breadcrumbs.innerHTML = `<a class="breadcrumb-link" onclick="window.__showWelcome()">🏠 Home</a>`;
        parts.forEach((part, i) => {
            breadcrumbs.innerHTML += `<span class="breadcrumb-sep">/</span>`;
            if (i === parts.length - 1) {
                breadcrumbs.innerHTML += `<span class="breadcrumb-current">${part}</span>`;
            } else {
                breadcrumbs.innerHTML += `<span class="breadcrumb-link">${part}</span>`;
            }
        });
    }

    function showWelcome() {
        currentDoc = null;
        welcome.classList.remove('hidden');
        viewer.classList.add('hidden');
        editorPane.classList.add('hidden');
        toolbar.classList.add('hidden');
        breadcrumbs.innerHTML = '';
        document.querySelectorAll('.tree-label').forEach(el => el.classList.remove('active'));
    }
    window.__showWelcome = showWelcome;

    // ─── Manual Panel ────────────────────────────────────────────
    const manualPanel = $('#manual-panel');
    const openManualBtn = $('#open-manual');
    const closeManualBtn = $('#btn-close-manual');

    function openManualTo(sectionId) {
        manualPanel.classList.remove('hidden');
        if (sectionId) {
            const section = $(`#${sectionId}`);
            if (section) {
                setTimeout(() => {
                    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    section.classList.add('highlight-pulse');
                    setTimeout(() => section.classList.remove('highlight-pulse'), 3000);
                }, 100);
            }
        }
    }

    openManualBtn.addEventListener('click', () => openManualTo());

    closeManualBtn.addEventListener('click', () => {
        manualPanel.classList.add('hidden');
    });

    manualPanel.addEventListener('click', (e) => {
        if (e.target === manualPanel) manualPanel.classList.add('hidden');
    });

    const linkLearnPat = $('#link-learn-pat');
    if (linkLearnPat) {
        linkLearnPat.addEventListener('click', (e) => {
            e.preventDefault();
            syncPanel.classList.add('hidden');
            openManualTo('manual-pat-instructions');
        });
    }

    // ─── Editor ──────────────────────────────────────────────────
    function enterEditor() {
        if (!currentDoc) return;
        isEditing = true;
        viewer.classList.add('hidden');
        editorPane.classList.remove('hidden');
        editor.value = editor.dataset.raw || '';
        updatePreview();

        btnEdit.classList.add('hidden');
        btnSave.classList.remove('hidden');
        btnCancel.classList.remove('hidden');
        btnUpload.classList.remove('hidden');
        btnDeleteDoc.classList.add('hidden');
    }

    function exitEditor() {
        isEditing = false;
        editorPane.classList.add('hidden');
        btnEdit.classList.remove('hidden');
        btnSave.classList.add('hidden');
        btnCancel.classList.add('hidden');
        btnUpload.classList.add('hidden');
        btnDeleteDoc.classList.remove('hidden');
    }

    function updatePreview() {
        preview.innerHTML = marked.parse(editor.value);
        // Apply syntax highlighting to code blocks in preview
        if (window.hljs) {
            preview.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
        }
    }

    // Wire up marked on client side — we load it from CDN
    // The server renders for viewing, but for live preview we need client-side marked
    let markedReady = false;
    const markedScript = document.createElement('script');
    markedScript.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    markedScript.onload = () => { markedReady = true; };
    document.head.appendChild(markedScript);

    // Also load highlight.js for client-side use
    const hlScript = document.createElement('script');
    hlScript.src = 'https://cdn.jsdelivr.net/npm/highlight.js@11/highlight.min.js';
    hlScript.onload = () => {
        if (window.marked) {
            window.marked.setOptions({
                breaks: true,
                gfm: true,
            });
        }
        // Re-render preview now that hljs is available
        if (isEditing) updatePreview();
    };
    document.head.appendChild(hlScript);

    editor.addEventListener('input', () => {
        if (markedReady) updatePreview();
    });

    // ─── Scroll Sync (Editor ↔ Preview) ──────────────────────────
    let syncingScroll = false;

    editor.addEventListener('scroll', () => {
        if (syncingScroll) return;
        syncingScroll = true;
        const scrollRatio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
        preview.scrollTop = scrollRatio * (preview.scrollHeight - preview.clientHeight);
        requestAnimationFrame(() => { syncingScroll = false; });
    });

    preview.addEventListener('scroll', () => {
        if (syncingScroll) return;
        syncingScroll = true;
        const scrollRatio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
        editor.scrollTop = scrollRatio * (editor.scrollHeight - editor.clientHeight);
        requestAnimationFrame(() => { syncingScroll = false; });
    });

    btnEdit.addEventListener('click', enterEditor);
    btnCancel.addEventListener('click', () => {
        exitEditor();
        if (currentDoc) openDoc(currentDoc);
    });

    btnSave.addEventListener('click', saveDoc);

    async function saveDoc() {
        if (!currentDoc) return;
        const content = editor.value;
        const res = await api(`/api/doc/${currentDoc}`, {
            method: 'POST',
            body: JSON.stringify({ content }),
        });
        if (res.success) {
            toast('Saved!');
            editor.dataset.raw = content;
            exitEditor();
            openDoc(currentDoc);
        } else {
            toast(res.error || 'Save failed', 'error');
        }
    }

    btnDeleteDoc.addEventListener('click', async () => {
        if (!currentDoc) return;
        const ok = await showConfirm(`Delete "${currentDoc}"?`);
        if (!ok) return;
        const res = await api(`/api/doc/${currentDoc}`, { method: 'DELETE' });
        if (res.success) {
            toast('Moved to trash');
            showWelcome();
            await loadTree();
            updateTrashCount();
        } else toast(res.error, 'error');
    });

    // ─── Image Upload ────────────────────────────────────────────
    btnUpload.addEventListener('click', () => imageInput.click());

    imageInput.addEventListener('change', async (e) => {
        if (e.target.files.length) {
            await uploadImage(e.target.files[0]);
            e.target.value = '';
        }
    });

    async function uploadImage(file) {
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            insertAtCursor(`![${file.name}](${data.url})`);
            toast('Image uploaded');
        } else {
            toast(data.error || 'Upload failed', 'error');
        }
    }

    function insertAtCursor(text) {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const value = editor.value;
        editor.value = value.substring(0, start) + '\n' + text + '\n' + value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + text.length + 2;
        editor.focus();
        if (markedReady) updatePreview();
    }

    // Drag & Drop on editor
    editorPane.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('hidden');
    });
    editorPane.addEventListener('dragleave', (e) => {
        if (!editorPane.contains(e.relatedTarget)) {
            dropOverlay.classList.add('hidden');
        }
    });
    editorPane.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropOverlay.classList.add('hidden');
        const files = e.dataTransfer.files;
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                await uploadImage(file);
            }
        }
    });

    // Paste from clipboard
    editor.addEventListener('paste', async (e) => {
        const items = e.clipboardData.items;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) await uploadImage(file);
                return;
            }
        }
    });

    // ─── Search ──────────────────────────────────────────────────
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const q = searchInput.value.trim();
        if (q.length < 2) {
            searchResults.classList.add('hidden');
            searchResults.innerHTML = '';
            return;
        }
        searchTimeout = setTimeout(async () => {
            const results = await api(`/api/search?q=${encodeURIComponent(q)}`);
            renderSearchResults(results, q);
        }, 300);
    });

    function renderSearchResults(results, query) {
        searchResults.innerHTML = '';
        if (!results.length) {
            searchResults.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:0.82rem;">No results found</div>';
            searchResults.classList.remove('hidden');
            return;
        }

        for (const r of results) {
            const el = document.createElement('div');
            el.className = 'search-result-item';

            // Highlight matching text in snippet
            const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
            const highlighted = r.snippet.replace(regex, '<span class="highlight">$1</span>');

            el.innerHTML = `
        <div class="result-name">${r.name}</div>
        <div class="result-snippet">${highlighted}</div>
      `;
            el.addEventListener('click', () => {
                openDoc(r.path);
                searchInput.value = '';
                searchResults.classList.add('hidden');
            });
            searchResults.appendChild(el);
        }
        searchResults.classList.remove('hidden');
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ─── Sidebar Toggle ─────────────────────────────────────────
    const sidebarFloatToggle = $('#sidebar-float-toggle');

    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    sidebarFloatToggle.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
    });

    // ─── Theme Toggle ────────────────────────────────────────────
    function getSavedTheme() {
        return localStorage.getItem('devdocs-theme') || 'dark';
    }

    function applyTheme(theme) {
        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            themeToggle.textContent = '🌙'; // Click to go dark
        } else {
            document.documentElement.removeAttribute('data-theme');
            themeToggle.textContent = '☀️'; // Click to go light
        }
    }

    themeToggle.addEventListener('click', () => {
        const currentTheme = getSavedTheme();
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('devdocs-theme', newTheme);
        applyTheme(newTheme);
    });

    // Apply saved theme on startup
    applyTheme(getSavedTheme());

    // ─── Keyboard Shortcuts ──────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        // Ctrl+E: Edit
        if (e.ctrlKey && e.key === 'e') {
            e.preventDefault();
            if (currentDoc && !isEditing) enterEditor();
        }
        // Ctrl+S: Save
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (isEditing) saveDoc();
        }
        // Escape: Cancel edit
        if (e.key === 'Escape') {
            if (isEditing) { exitEditor(); if (currentDoc) openDoc(currentDoc); }
            contextMenu.classList.add('hidden');
        }
        // Ctrl+K: Focus search
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            searchInput.focus();
        }
    });

    // ─── Tab support in editor ───────────────────────────────────
    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 2;
        }
    });

    // ─── Trash Panel ─────────────────────────────────────────────
    async function updateTrashCount() {
        const items = await api('/api/trash');
        const count = items.length || 0;
        trashCountBadge.textContent = count;
        if (count > 0) {
            trashCountBadge.classList.remove('hidden');
        } else {
            trashCountBadge.classList.add('hidden');
        }
    }

    async function openTrashPanel() {
        trashPanel.classList.remove('hidden');
        await renderTrashList();
    }

    function closeTrashPanel() {
        trashPanel.classList.add('hidden');
    }

    async function renderTrashList() {
        const items = await api('/api/trash');
        trashList.innerHTML = '';

        if (!items.length) {
            trashList.innerHTML = '<div class="trash-empty-msg">🗑️ Trash is empty</div>';
            btnEmptyTrash.classList.add('hidden');
            return;
        }

        btnEmptyTrash.classList.remove('hidden');

        // Show newest first
        items.reverse();

        for (const item of items) {
            const el = document.createElement('div');
            el.className = 'trash-item';
            const icon = item.type === 'folder' ? '📁' : '📄';
            const deletedDate = new Date(item.deletedAt).toLocaleString();
            const imgCount = (item.images || []).length;
            const imgInfo = imgCount > 0 ? ` · ${imgCount} image${imgCount > 1 ? 's' : ''}` : '';

            el.innerHTML = `
                <span class="trash-item-icon">${icon}</span>
                <div class="trash-item-info">
                    <div class="trash-item-name">${item.originalPath}</div>
                    <div class="trash-item-meta">Deleted ${deletedDate}${imgInfo}</div>
                </div>
                <div class="trash-item-actions">
                    <button class="trash-restore-btn" title="Restore">↩ Restore</button>
                    <button class="trash-delete-btn" title="Delete permanently">✕</button>
                </div>
            `;

            el.querySelector('.trash-restore-btn').addEventListener('click', async () => {
                const res = await api('/api/trash/restore', {
                    method: 'POST',
                    body: JSON.stringify({ id: item.id }),
                });
                if (res.success) {
                    toast(`Restored "${item.originalPath}"`);
                    await renderTrashList();
                    await loadTree();
                    updateTrashCount();
                } else {
                    toast(res.error || 'Restore failed', 'error');
                }
            });

            el.querySelector('.trash-delete-btn').addEventListener('click', async () => {
                const ok = await showConfirm(`Permanently delete "${item.originalPath}"? This cannot be undone.`);
                if (!ok) return;
                const res = await api(`/api/trash/${item.id}`, { method: 'DELETE' });
                if (res.success) {
                    toast('Permanently deleted');
                    await renderTrashList();
                    updateTrashCount();
                } else {
                    toast(res.error || 'Delete failed', 'error');
                }
            });

            trashList.appendChild(el);
        }
    }

    btnOpenTrash.addEventListener('click', openTrashPanel);
    btnCloseTrash.addEventListener('click', closeTrashPanel);

    trashPanel.addEventListener('click', (e) => {
        if (e.target === trashPanel) closeTrashPanel();
    });

    btnEmptyTrash.addEventListener('click', async () => {
        const ok = await showConfirm('Permanently delete ALL items in trash? This cannot be undone.');
        if (!ok) return;
        const res = await api('/api/trash/clear/all', { method: 'DELETE' });
        if (res.success) {
            toast('Trash emptied');
            await renderTrashList();
            updateTrashCount();
        } else {
            toast(res.error || 'Failed to empty trash', 'error');
        }
    });

    // ─── Sync Settings Panel ─────────────────────────────────────
    const syncPanel = $('#sync-panel');
    const btnOpenSync = $('#btn-open-sync');
    const btnCloseSync = $('#btn-close-sync');
    const syncRemoteInput = $('#sync-remote-url');
    const syncPatInput = $('#sync-pat');
    const syncAutoInput = $('#sync-auto');
    const btnSaveSync = $('#btn-save-sync');
    const btnTriggerSync = $('#btn-trigger-sync');
    const btnPullSync = $('#btn-pull-sync');
    const syncStatusText = $('#sync-status-text');
    const syncLastTime = $('#sync-last-time');
    const syncErrorRow = $('#sync-error-row');
    const syncErrorText = $('#sync-error-text');
    const syncStatusDot = $('#sync-status-dot');
    const syncPanelTitle = $('#sync-panel-title');
    const syncDescText = $('#sync-desc-text');
    const syncStatusBox = $('#sync-status-box');

    function updateSyncUI(data) {
        if (data.remoteUrl) syncRemoteInput.value = data.remoteUrl;

        // Show masked placeholder if PAT is securely stored on server
        if (data.hasPat) {
            syncPatInput.placeholder = '•••••••••••••••••••• (Saved)';
            syncPatInput.value = ''; // Don't expose original token
        }

        const isConnected = !!data.remoteUrl;
        syncAutoInput.checked = data.enabled;

        // Update panel appearance based on state
        if (isConnected) {
            syncPanelTitle.textContent = '🔄 Sync Settings';
            syncDescText.innerHTML = `Connected to <strong>${data.remoteUrl.replace(/https?:\/\/github\.com\//, '').replace('.git', '')}</strong>. Change the URL below to switch repos.`;
            btnSaveSync.textContent = '💾 Update Settings';
            btnTriggerSync.classList.remove('hidden');
            btnPullSync.classList.remove('hidden');
            syncStatusBox.classList.remove('hidden');
        } else {
            syncPanelTitle.textContent = '🔄 Connect Your Data Repo';
            syncDescText.innerHTML = 'Create a <strong>new empty GitHub repo</strong> for your docs, then paste the URL below.';
            btnSaveSync.textContent = '🔗 Connect & Save';
            btnTriggerSync.classList.add('hidden');
            btnPullSync.classList.add('hidden');
            syncStatusBox.classList.add('hidden');
        }

        // Status display
        const statusMap = {
            idle: '⏸️ Idle',
            syncing: '🔄 Syncing...',
            success: '✅ Synced',
            error: '❌ Error',
        };
        syncStatusText.textContent = statusMap[data.status] || data.status;
        syncLastTime.textContent = data.lastSync
            ? new Date(data.lastSync).toLocaleString()
            : 'Never';

        // Error display
        if (data.error) {
            syncErrorRow.classList.remove('hidden');
            syncErrorText.textContent = data.error.replace(/(ghp_[a-zA-Z0-9]+)/g, '***'); // mask tokens in errors
        } else {
            syncErrorRow.classList.add('hidden');
        }

        // Sidebar dot color
        syncStatusDot.className = 'sync-dot';
        if (isConnected && data.status === 'success') {
            syncStatusDot.classList.add('active');
            if (!data.enabled) syncStatusDot.style.background = 'var(--text-muted)'; // Gray for manual sync success
            else syncStatusDot.style.background = ''; // reset to green
        }
        else if (data.status === 'syncing') syncStatusDot.classList.add('syncing');
        else if (data.status === 'error') syncStatusDot.classList.add('error');
    }

    async function loadSyncStatus() {
        const data = await api('/api/sync/status');
        updateSyncUI(data);
        return data;
    }

    btnOpenSync.addEventListener('click', async () => {
        syncPanel.classList.remove('hidden');
        await loadSyncStatus();
    });

    btnCloseSync.addEventListener('click', () => {
        syncPanel.classList.add('hidden');
    });

    syncPanel.addEventListener('click', (e) => {
        if (e.target === syncPanel) syncPanel.classList.add('hidden');
    });

    // Save = auto-enable sync when URL is provided
    btnSaveSync.addEventListener('click', async () => {
        const url = syncRemoteInput.value.trim();
        const pat = syncPatInput.value.trim();

        if (!url) {
            toast('Please enter a GitHub repo URL', 'error');
            return;
        }

        const payload = {
            enabled: syncAutoInput.checked,
            remoteUrl: url,
        };
        // Only send PAT if user typed a new one, else keep existing
        if (pat) {
            payload.pat = pat;
        }

        btnSaveSync.disabled = true;
        btnSaveSync.textContent = 'Connecting...';

        const res = await api('/api/sync/configure', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        btnSaveSync.disabled = false;

        if (res.success) {
            toast(syncAutoInput.checked ? 'Settings saved. Auto-sync enabled.' : 'Settings saved. Manual sync mode.');
            syncPatInput.value = ''; // clear input for security
            await loadSyncStatus();
        } else {
            toast(res.error || 'Failed to connect', 'error');
            await loadSyncStatus(); // reset button text
        }
    });

    btnPullSync.addEventListener('click', async () => {
        const ok = await showConfirm(
            'Sync & Pull from Remote? This will try to save your new files to GitHub first, then fetch all remote changes.',
            '📥 Pull & Overwrite',
            'primary'
        );
        if (!ok) return;

        btnPullSync.disabled = true;
        btnPullSync.textContent = '📥 Pulling...';

        try {
            const res = await api('/api/sync/pull', { method: 'POST' });
            if (res.success) {
                toast('Successfully pulled from remote!');
                await loadTree(); // Refresh the file tree
                await loadSyncStatus();
            } else {
                toast(res.error || 'Pull failed', 'error');
                await loadSyncStatus();
            }
        } catch (err) {
            toast(err.message || 'Pull failed', 'error');
            await loadSyncStatus();
        } finally {
            btnPullSync.disabled = false;
            btnPullSync.textContent = '📥 Pull from Remote';
        }
    });

    btnTriggerSync.addEventListener('click', async () => {
        const res = await api('/api/sync/trigger', { method: 'POST' });
        if (res.success) {
            toast('Sync triggered');
            setTimeout(loadSyncStatus, 3000);
        } else {
            toast(res.error || 'Sync not configured', 'error');
        }
    });

    // Poll sync status every 30 seconds
    setInterval(loadSyncStatus, 30000);

    // ─── Init ────────────────────────────────────────────────────
    loadTree();
    updateTrashCount();

    // Auto-show sync setup if no repo is configured yet
    (async () => {
        const syncData = await loadSyncStatus();
        if (!syncData.remoteUrl) {
            syncPanel.classList.remove('hidden');
        }
    })();

})();
