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
import {
  attemptPreferredArchiveDirectory,
  PREFERRED_ARCHIVE_PATH
} from './preferredFolder.js';

const loadIndexButton = document.querySelector('#load-index-button');
const connectFolderButton = document.querySelector('#connect-folder');
const hiddenIndexInput = document.querySelector('#index-file-input');
const indexStatus = document.querySelector('#index-status');
const archiveStatus = document.querySelector('#archive-status');
const openLimitInput = document.querySelector('#open-limit');
const delayInput = document.querySelector('#delay-ms');
const autoCheckbox = document.querySelector('#append-auto');
const openButton = document.querySelector('#open-missing');
const progressText = document.querySelector('#progress-text');
const progressFill = document.querySelector('#progress-fill');
const harvestList = document.querySelector('.harvest-list');
const pendingCountText = document.querySelector('#pending-count');

let normalizedIndex = [];
let archiveData = { byId: new Map(), mediaCount: 0, metaCount: 0, errors: [] };

function setIndexStatus(message, type = 'info') {
  if (!indexStatus) return;
  indexStatus.textContent = message;
  indexStatus.dataset.state = type;
}

function setArchiveStatus(message) {
  if (!archiveStatus) return;
  archiveStatus.textContent = message;
}

function renderHarvestList() {
  if (!harvestList) return;
  harvestList.innerHTML = '';
  if (normalizedIndex.length === 0) {
    harvestList.innerHTML = '<div class="notice">Load an index to view missing items.</div>';
    if (pendingCountText) {
      pendingCountText.textContent = 'Load an index to calculate pending items.';
    }
    return;
  }

  let missingCount = 0;
  for (const item of normalizedIndex) {
    const offlineEntry = archiveData.byId.get(item.id);
    const isMissing = !offlineEntry || offlineEntry.files.length === 0;
    if (!isMissing) continue;
    missingCount += 1;

    const wrapper = document.createElement('div');
    wrapper.className = 'harvest-item';
    const header = document.createElement('div');
    header.className = 'summary';

    const idSpan = document.createElement('span');
    idSpan.textContent = item.id;
    const badge = document.createElement('span');
    badge.className = 'badge missing';
    badge.textContent = 'Missing';

    header.append(idSpan, badge);

    const prompt = document.createElement('p');
    prompt.className = 'prompt';
    const promptText = resolvePrompt(item, offlineEntry?.meta);
    prompt.textContent = promptText || '—';
    if (promptText) {
      prompt.title = promptText;
    }

    const link = document.createElement('a');
    link.href = item.pageUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open manually';

    wrapper.append(header, prompt, link);
    harvestList.append(wrapper);
  }

  if (missingCount === 0) {
    harvestList.innerHTML = '<div class="notice"><strong>All caught up!</strong> Every item in the index has a matching offline file.</div>';
  }

  if (pendingCountText) {
    const total = normalizedIndex.length;
    if (missingCount === 0) {
      pendingCountText.textContent = `All caught up — 0 items pending harvest out of ${total}.`;
    } else {
      const noun = missingCount === 1 ? 'item' : 'items';
      pendingCountText.textContent = `${missingCount} ${noun} pending harvest out of ${total}.`;
    }
  }
}

async function handleIndexFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    setIndexStatus(`Loading ${file.name}…`, 'loading');
    const result = await parseIndexFile(file);
    normalizedIndex = result.items;
    setIndexStatus(`Loaded ${normalizedIndex.length} items (skipped ${result.skipped}).`, 'success');
    renderHarvestList();
  } catch (error) {
    setIndexStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    event.target.value = '';
  }
}

async function pickArchiveFolder() {
  try {
    const directory = await window.showDirectoryPicker({ mode: 'read' });
    await connectArchiveDirectory(directory, {
      persistHandle: true,
      sourceLabel: 'selected archive folder'
    });
  } catch (error) {
    if (error?.name === 'AbortError') return;
    setArchiveStatus(error instanceof Error ? error.message : String(error));
  }
}

async function restorePreviousFolder() {
  const stored = await getDirectoryHandle();
  if (!stored) return false;
  const validated = await validateStoredHandle(stored);
  if (!validated) return false;
  setArchiveStatus('Restoring previous archive folder…');
  const connected = await connectArchiveDirectory(validated, {
    sourceLabel: 'previous archive folder'
  });
  return connected;
}

async function connectArchiveDirectory(directory, { persistHandle = false, sourceLabel = 'selected archive folder' } = {}) {
  if (!directory) return false;
  const granted = await ensureReadPermission(directory);
  if (!granted) {
    setArchiveStatus('Permission denied for the selected folder.');
    return false;
  }
  setArchiveStatus(`Scanning ${sourceLabel}…`);
  try {
    if (persistHandle) {
      await saveDirectoryHandle(directory);
    }
    archiveData = await scanArchiveDirectory(directory);
    setArchiveStatus(`Connected. Media files: ${archiveData.mediaCount}, meta files: ${archiveData.metaCount}.`);
    renderHarvestList();
    return true;
  } catch (error) {
    setArchiveStatus(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function autoConnectPreferredFolder() {
  setArchiveStatus(`Attempting to open preferred folder at ${PREFERRED_ARCHIVE_PATH}…`);
  const directory = await attemptPreferredArchiveDirectory();
  if (!directory) {
    setArchiveStatus('Archive folder not connected.');
    return false;
  }
  return connectArchiveDirectory(directory, {
    persistHandle: true,
    sourceLabel: `preferred folder (${PREFERRED_ARCHIVE_PATH})`
  });
}

function buildAutoUrl(url, appendAuto) {
  if (!appendAuto) return url;
  const hasQuery = url.includes('?');
  return `${url}${hasQuery ? '&' : '?'}auto=1`;
}

function updateProgress(current, total) {
  if (progressText) {
    progressText.textContent = `${current} / ${total}`;
  }
  const percent = total === 0 ? 0 : Math.round((current / total) * 100);
  if (progressFill) {
    progressFill.style.width = `${percent}%`;
  }
}

async function openMissing() {
  if (normalizedIndex.length === 0) {
    alert('Load the gallery index first.');
    return;
  }
  const limit = Number(openLimitInput.value) || 0;
  const delay = Number(delayInput.value) || 0;
  const appendAuto = autoCheckbox.checked;

  const missingItems = normalizedIndex.filter((item) => {
    const offlineEntry = archiveData.byId.get(item.id);
    return !offlineEntry || offlineEntry.files.length === 0;
  });

  if (missingItems.length === 0) {
    alert('All items already have offline files.');
    return;
  }

  const slice = limit > 0 ? missingItems.slice(0, limit) : missingItems;
  updateProgress(0, slice.length);

  for (let i = 0; i < slice.length; i += 1) {
    const item = slice[i];
    const url = buildAutoUrl(item.pageUrl, appendAuto);
    window.open(url, '_blank', 'noopener');
    updateProgress(i + 1, slice.length);
    if (delay > 0 && i < slice.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function init() {
  loadIndexButton?.addEventListener('click', () => hiddenIndexInput?.click());
  hiddenIndexInput?.addEventListener('change', handleIndexFileSelection);
  connectFolderButton?.addEventListener('click', pickArchiveFolder);
  openButton?.addEventListener('click', openMissing);

  setIndexStatus('Loading default index…', 'loading');
  const defaultIndex = await loadDefaultIndex();
  if (defaultIndex) {
    normalizedIndex = defaultIndex.items;
    setIndexStatus(`Loaded ${normalizedIndex.length} items (skipped ${defaultIndex.skipped}).`, 'success');
    renderHarvestList();
  } else {
    setIndexStatus('Failed to load sora_gallery_index.json. Please choose an index file manually.', 'error');
  }

  const restored = await restorePreviousFolder();
  if (!restored) {
    await autoConnectPreferredFolder();
  }
}

init();
