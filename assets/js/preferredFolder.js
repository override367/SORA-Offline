import { ensureReadPermission } from './fsScanner.js';

export const PREFERRED_ARCHIVE_PATH = 'C:\\SORAimages\\Images';

/**
 * Try to open the preferred archive directory without user interaction.
 * Returns the handle if the browser allowed it, otherwise null.
 *
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function attemptPreferredArchiveDirectory() {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
    return null;
  }

  try {
    const directory = await window.showDirectoryPicker({
      mode: 'read',
      id: 'sora-archive-preferred',
      startIn: PREFERRED_ARCHIVE_PATH
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
