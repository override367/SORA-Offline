import {
  loadDefaultIndex,
  parseIndexFile,
  resolvePrompt
} from './data.js';
import {
  saveDirectoryHandle,
  getDirectoryHandle
} from './handleStorage.js';
import {
  scanArchiveDirectory,
  ensureReadPermission,
  validateStoredHandle
} from './fsScanner.js';

const galleryGrid = document.querySelector('.gallery-grid');
const searchInput = document.querySelector('#search');
const preferOfflineCheckbox = document.querySelector('#prefer-offline');
const statusStats = document.querySelector('.stats');
const indexStatus = document.querySelector('#index-status');
const archiveStatus = document.querySelector('#archive-status');
const loadIndexButton = document.querySelector('#load-index-button');
const connectFolderButton = document.querySelector('#connect-folder');
const hiddenIndexInput = document.querySelector('#index-file-input');
const archiveNotice = document.querySelector('#archive-notice');

let normalizedIndex = [];
let archiveData = { byId: new Map(), mediaCount: 0, metaCount: 0, errors: [] };
let searchTerm = '';
const objectUrlCache = new Map();

function setIndexStatus(message, type = 'info') {
  if (!indexStatus) return;
  indexStatus.textContent = message;
  indexStatus.dataset.state = type;
}

function setArchiveStatus(message) {
  if (!archiveStatus) return;
  archiveStatus.textContent = message;
}

function revokeObjectUrls() {
  for (const url of objectUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  objectUrlCache.clear();
}

function formatStats() {
  if (!statusStats) return;
  const total = normalizedIndex.length;
  let offline = 0;
  for (const item of normalizedIndex) {
    const offlineEntry = archiveData.byId.get(item.id);
    if (offlineEntry && offlineEntry.files.length > 0) {
      offline += 1;
    }
  }
  const missing = total - offline;
  statusStats.innerHTML = `
    <span><strong>${total}</strong> items</span>
    <span><strong>${offline}</strong> offline</span>
    <span><strong>${missing}</strong> missing</span>
  `;
}

function createBadge(entry) {
  const badge = document.createElement('span');
  badge.classList.add('badge');
  if (entry && entry.files.length > 0) {
    badge.classList.add('offline');
    badge.textContent = 'Offline';
  } else {
    badge.classList.add('missing');
    badge.textContent = 'Missing';
  }
  return badge;
}

async function openOfflineFile(handle) {
  try {
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    const win = window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups for this site to view offline files.');
    }
  } catch (error) {
    alert(`Unable to open file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function applyOfflinePreview(container, fileHandle) {
  try {
    const file = await fileHandle.getFile();
    const cacheKey = `${fileHandle.name}-${file.lastModified}`;
    if (!objectUrlCache.has(cacheKey)) {
      objectUrlCache.set(cacheKey, URL.createObjectURL(file));
    }
    const url = objectUrlCache.get(cacheKey);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) {
      const video = document.createElement('video');
      video.src = url;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('aria-label', 'Offline preview video');
      container.replaceChildren(video);
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Offline preview';
      container.replaceChildren(img);
    }
  } catch (error) {
    console.warn('Failed to load offline preview:', error);
  }
}

function createCard(item) {
  const offlineEntry = archiveData.byId.get(item.id);
  const card = document.createElement('article');
  card.className = 'gallery-card';

  const preview = document.createElement('div');
  preview.className = 'preview';
  const previewImage = document.createElement('img');
  previewImage.alt = item.id;
  previewImage.loading = 'lazy';
  if (item.thumbUrl && !preferOfflineCheckbox.checked) {
    previewImage.src = item.thumbUrl;
  } else {
    previewImage.src = item.thumbUrl || '';
  }
  preview.append(previewImage);

  const body = document.createElement('div');
  body.className = 'card-body';

  const header = document.createElement('div');
  header.className = 'card-header';
  const idSpan = document.createElement('span');
  idSpan.className = 'id';
  idSpan.textContent = item.id;
  header.append(idSpan, createBadge(offlineEntry));

  const promptPara = document.createElement('p');
  promptPara.className = 'prompt';
  promptPara.textContent = resolvePrompt(item, offlineEntry?.meta) || '—';

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const onlineButton = document.createElement('button');
  onlineButton.className = 'secondary';
  onlineButton.textContent = 'View online';
  onlineButton.addEventListener('click', () => {
    window.open(item.pageUrl, '_blank', 'noopener');
  });

  const offlineButton = document.createElement('button');
  offlineButton.className = 'secondary';
  offlineButton.textContent = 'View offline';
  offlineButton.disabled = !offlineEntry || offlineEntry.files.length === 0;
  offlineButton.addEventListener('click', async () => {
    if (!offlineEntry || offlineEntry.files.length === 0) return;
    await openOfflineFile(offlineEntry.files[0]);
  });

  const copyButton = document.createElement('button');
  copyButton.className = 'ghost';
  copyButton.textContent = 'Copy prompt';
  copyButton.addEventListener('click', async () => {
    const text = resolvePrompt(item, offlineEntry?.meta);
    if (!text) {
      alert('No prompt text available for this item yet.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = 'Copied!';
      setTimeout(() => {
        copyButton.textContent = 'Copy prompt';
      }, 1500);
    } catch (error) {
      alert(text);
    }
  });

  actions.append(onlineButton, offlineButton, copyButton);
  body.append(header, promptPara, actions);
  card.append(preview, body);

  if (preferOfflineCheckbox.checked && offlineEntry && offlineEntry.files.length > 0) {
    applyOfflinePreview(preview, offlineEntry.files[0]);
  }

  return card;
}

function renderGallery() {
  if (!galleryGrid) return;
  galleryGrid.innerHTML = '';

  const filtered = normalizedIndex.filter((item) => {
    if (!searchTerm) return true;
    const offlineEntry = archiveData.byId.get(item.id);
    const prompt = resolvePrompt(item, offlineEntry?.meta);
    const haystack = [
      item.id,
      item.pageUrl,
      item.thumbUrl ?? '',
      prompt,
      JSON.stringify(offlineEntry?.meta || {})
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(searchTerm.toLowerCase());
  });

  for (const item of filtered) {
    galleryGrid.append(createCard(item));
  }

  if (filtered.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'notice';
    emptyState.innerHTML = '<strong>No results.</strong> Try clearing the search filter or connect your archive folder.';
    galleryGrid.append(emptyState);
  }

  formatStats();
}

async function handleIndexFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    setIndexStatus(`Loading ${file.name}…`, 'loading');
    const result = await parseIndexFile(file);
    normalizedIndex = result.items;
    setIndexStatus(`Loaded ${normalizedIndex.length} items (skipped ${result.skipped}).`, 'success');
    renderGallery();
  } catch (error) {
    setIndexStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    event.target.value = '';
  }
}

async function pickArchiveFolder() {
  try {
    const directory = await window.showDirectoryPicker({ mode: 'read' });
    const granted = await ensureReadPermission(directory);
    if (!granted) {
      setArchiveStatus('Permission denied for the selected folder.');
      return;
    }
    setArchiveStatus('Scanning archive…');
    await saveDirectoryHandle(directory);
    archiveData = await scanArchiveDirectory(directory);
    setArchiveStatus(`Connected. Media files: ${archiveData.mediaCount}, meta files: ${archiveData.metaCount}.`);
    if (archiveNotice) {
      archiveNotice.hidden = true;
    }
    renderGallery();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    setArchiveStatus(error instanceof Error ? error.message : String(error));
  }
}

async function restorePreviousFolder() {
  const stored = await getDirectoryHandle();
  if (!stored) return;
  const validated = await validateStoredHandle(stored);
  if (!validated) return;
  setArchiveStatus('Restoring previous archive folder…');
  if (archiveNotice) {
    archiveNotice.hidden = false;
  }
  try {
    archiveData = await scanArchiveDirectory(validated);
    if (archiveNotice) {
      archiveNotice.hidden = true;
    }
    setArchiveStatus(`Connected. Media files: ${archiveData.mediaCount}, meta files: ${archiveData.metaCount}.`);
    renderGallery();
  } catch (error) {
    setArchiveStatus(error instanceof Error ? error.message : String(error));
  }
}

async function init() {
  loadIndexButton?.addEventListener('click', () => hiddenIndexInput?.click());
  hiddenIndexInput?.addEventListener('change', handleIndexFileSelection);
  connectFolderButton?.addEventListener('click', pickArchiveFolder);
  searchInput?.addEventListener('input', (event) => {
    searchTerm = event.target.value.trim();
    renderGallery();
  });
  preferOfflineCheckbox?.addEventListener('change', () => {
    revokeObjectUrls();
    renderGallery();
  });

  setIndexStatus('Loading default index…', 'loading');
  const defaultIndex = await loadDefaultIndex();
  if (defaultIndex) {
    normalizedIndex = defaultIndex.items;
    setIndexStatus(`Loaded ${normalizedIndex.length} items (skipped ${defaultIndex.skipped}).`, 'success');
    renderGallery();
  } else {
    setIndexStatus('Failed to load sora_gallery_index.json. Please choose an index file manually.', 'error');
  }

  await restorePreviousFolder();
}

init();
