import { extractGenId } from './data.js';
import { clearDirectoryHandle } from './handleStorage.js';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v'];
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

/**
 * Attempt to ensure we have read permission for a directory handle.
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<boolean>}
 */
export async function ensureReadPermission(handle) {
  try {
    const status = await handle.queryPermission({ mode: 'read' });
    if (status === 'granted') {
      return true;
    }
    if (status === 'prompt') {
      const result = await handle.requestPermission({ mode: 'read' });
      return result === 'granted';
    }
    return false;
  } catch (error) {
    console.warn('Permission check failed:', error);
    return false;
  }
}

function extractIdFromName(name) {
  if (!name) return null;
  const id = extractGenId(name);
  if (id) return id;
  const withoutMeta = name.replace(/\.meta\.json$/i, '');
  return extractGenId(withoutMeta);
}

function isMediaFile(name) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return MEDIA_EXTENSIONS.has(ext);
}

function isMetaFile(name) {
  return /\.meta\.json$/i.test(name);
}

async function readMetaFile(handle) {
  try {
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to read ${handle.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function walkDirectory(handle, onFile, path = []) {
  for await (const [name, entry] of handle.entries()) {
    const nextPath = [...path, name];
    if (entry.kind === 'directory') {
      await walkDirectory(entry, onFile, nextPath);
    } else if (entry.kind === 'file') {
      await onFile(entry, nextPath.join('/'));
    }
  }
}

/**
 * Scan the archive directory collecting meta files and media handles keyed by id.
 * @param {FileSystemDirectoryHandle} directory
 * @returns {Promise<{ byId: Map<string, { files: FileSystemFileHandle[], meta?: any, metaError?: string }>, mediaCount: number, metaCount: number, errors: string[] }>}
 */
export async function scanArchiveDirectory(directory) {
  const byId = new Map();
  const errors = [];
  let mediaCount = 0;
  let metaCount = 0;

  const ensureEntry = (id) => {
    if (!byId.has(id)) {
      byId.set(id, { files: [], meta: undefined, metaError: undefined });
    }
    return byId.get(id);
  };

  await walkDirectory(directory, async (fileHandle, relativePath) => {
    const name = fileHandle.name;
    const id = extractIdFromName(name);
    if (!id) return;

    if (isMetaFile(name)) {
      try {
        const meta = await readMetaFile(fileHandle);
        const entry = ensureEntry(id);
        entry.meta = meta;
        entry.metaError = undefined;
        metaCount += 1;
      } catch (error) {
        const entry = ensureEntry(id);
        const message = error instanceof Error ? error.message : String(error);
        entry.metaError = message;
        errors.push(message);
      }
      return;
    }

    if (isMediaFile(name)) {
      const entry = ensureEntry(id);
      entry.files.push(fileHandle);
      mediaCount += 1;
    }
  });

  return { byId, mediaCount, metaCount, errors };
}

/**
 * Helper to forget a stored handle when permissions are revoked.
 * @param {FileSystemDirectoryHandle} handle
 */
export async function validateStoredHandle(handle) {
  const ok = await ensureReadPermission(handle);
  if (!ok) {
    await clearDirectoryHandle();
    return null;
  }
  return handle;
}

export const mediaExtensions = {
  images: IMAGE_EXTENSIONS,
  videos: VIDEO_EXTENSIONS,
  all: MEDIA_EXTENSIONS
};
