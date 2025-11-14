import { ensureReadPermission } from './fsScanner.js';

const STORAGE_KEY = 'sora-preferred-archive-path';
export const DEFAULT_PREFERRED_ARCHIVE_PATH = 'C:\\SORAimages\\Images';

function readStoredPath() {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const trimmed = stored.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  } catch (error) {
    console.debug('Unable to read preferred archive path from storage:', error);
  }
  return null;
}

function writeStoredPath(value) {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    if (!value || value.trim().length === 0 || value.trim() === DEFAULT_PREFERRED_ARCHIVE_PATH) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, value.trim());
  } catch (error) {
    console.debug('Unable to persist preferred archive path:', error);
  }
}

export function getPreferredArchivePath() {
  return readStoredPath() ?? DEFAULT_PREFERRED_ARCHIVE_PATH;
}

export function setPreferredArchivePath(path) {
  const nextValue = path && path.trim().length > 0 ? path.trim() : DEFAULT_PREFERRED_ARCHIVE_PATH;
  writeStoredPath(nextValue);
  return nextValue;
}

/**
 * Try to open the preferred archive directory without user interaction.
 * Returns the handle if the browser allowed it, otherwise null.
 *
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function attemptPreferredArchiveDirectory(pathOverride) {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
    return null;
  }

  try {
    const preferredPath = pathOverride && pathOverride.trim().length > 0
      ? pathOverride.trim()
      : getPreferredArchivePath();
    const directory = await window.showDirectoryPicker({
      mode: 'read',
      id: 'sora-archive-preferred',
      startIn: preferredPath
    });
    const granted = await ensureReadPermission(directory);
    if (!granted) {
      return null;
    }
    return directory;
  } catch (error) {
    const name = error?.name;
    if (name === 'AbortError' || name === 'NotAllowedError' || name === 'SecurityError') {
      console.debug('Preferred archive auto-connect skipped:', error);
      return null;
    }
    console.warn('Preferred archive auto-connect failed:', error);
    return null;
  }
}
