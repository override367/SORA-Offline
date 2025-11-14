/**
 * Minimal IndexedDB wrapper for storing FileSystem handles.
 */
const DB_NAME = 'sora-archive-kit';
const STORE_NAME = 'handles';
const KEY_ARCHIVE = 'archive';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = callback(store, tx);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Persist a directory handle.
 * @param {FileSystemDirectoryHandle} handle
 */
export function saveDirectoryHandle(handle) {
  return withStore('readwrite', (store) => {
    store.put(handle, KEY_ARCHIVE);
  });
}

/**
 * Retrieve the previously stored directory handle if available.
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
export async function getDirectoryHandle() {
  try {
    return await withStore('readonly', (store) => store.get(KEY_ARCHIVE));
  } catch (error) {
    console.warn('Unable to read stored directory handle:', error);
    return null;
  }
}

/**
 * Remove the stored directory handle (e.g. when permissions are revoked).
 */
export function clearDirectoryHandle() {
  return withStore('readwrite', (store) => {
    store.delete(KEY_ARCHIVE);
  });
}
