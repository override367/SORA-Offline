/**
 * Utilities for working with the gallery index and prompts.
 */

const GEN_ID_REGEX = /gen_[a-z0-9]+/i;
const THUMB_KEYS = [
  'thumb',
  'thumbnail',
  'image',
  'img',
  'src',
  'preview',
  'poster'
];
const URL_KEYS = ['href', 'url', 'pageUrl', 'link'];
const PROMPT_KEYS = ['prompt', 'caption', 'description', 'text'];

/**
 * Extracts the canonical Sora generation id from any string value.
 * @param {string} value
 * @returns {string | null}
 */
export function extractGenId(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(GEN_ID_REGEX);
  return match ? match[0] : null;
}

/**
 * Build a canonical page URL for a Sora generation id.
 * @param {string} id
 * @returns {string}
 */
export function buildPageUrl(id) {
  return `https://sora.chatgpt.com/g/${id}`;
}

/**
 * Attempt to find a usable thumbnail URL on an arbitrary object.
 * @param {Record<string, any>} obj
 * @returns {string | null}
 */
function findThumb(obj) {
  for (const key of THUMB_KEYS) {
    if (typeof obj[key] === 'string' && obj[key]) {
      return obj[key];
    }
  }
  return null;
}

/**
 * Attempt to find a relevant page URL on an arbitrary object.
 * @param {Record<string, any>} obj
 * @returns {string | null}
 */
function findPageUrl(obj) {
  for (const key of URL_KEYS) {
    if (typeof obj[key] === 'string' && obj[key]) {
      return obj[key];
    }
  }
  return null;
}

/**
 * Attempt to find prompt text on an arbitrary object.
 * @param {Record<string, any>} obj
 * @returns {string | null}
 */
function findPrompt(obj) {
  for (const key of PROMPT_KEYS) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Normalize one index entry into the internal shape.
 * @param {any} entry
 * @returns {{ id: string, pageUrl: string, thumbUrl: string | null, prompt?: string, original: any } | null}
 */
export function normalizeIndexEntry(entry) {
  if (entry == null) return null;

  if (typeof entry === 'string') {
    const id = extractGenId(entry);
    if (!id) return null;
    return {
      id,
      pageUrl: buildPageUrl(id),
      thumbUrl: entry.startsWith('http') ? entry : null,
      original: entry
    };
  }

  if (typeof entry === 'object') {
    let id = null;
    if (entry.id && typeof entry.id === 'string') {
      id = extractGenId(entry.id) || entry.id;
    }
    if (!id) {
      id = extractGenId(JSON.stringify(entry));
    }
    if (!id) return null;

    let pageUrl = findPageUrl(entry) || buildPageUrl(id);
    if (!extractGenId(pageUrl)) {
      pageUrl = buildPageUrl(id);
    }

    const thumbUrl = findThumb(entry);
    const prompt = findPrompt(entry) || undefined;

    return {
      id,
      pageUrl,
      thumbUrl: thumbUrl || null,
      prompt,
      original: entry
    };
  }

  return null;
}

/**
 * Normalize the raw index file contents.
 * @param {any} raw
 * @returns {{ items: Array<ReturnType<typeof normalizeIndexEntry>>, skipped: number }}
 */
export function normalizeIndexData(raw) {
  const items = [];
  let skipped = 0;

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const normalized = normalizeIndexEntry(entry);
      if (normalized) {
        items.push(normalized);
      } else {
        skipped += 1;
      }
    }
  } else if (raw && typeof raw === 'object' && Array.isArray(raw.items)) {
    // Support schemas where the payload is under a property like { items: [...] }
    for (const entry of raw.items) {
      const normalized = normalizeIndexEntry(entry);
      if (normalized) {
        items.push(normalized);
      } else {
        skipped += 1;
      }
    }
  } else {
    throw new Error('Unsupported index format. Expected an array or { items: [] } structure.');
  }

  return { items, skipped };
}

/**
 * Read and normalize an index file that was chosen via the file picker.
 * @param {File} file
 * @returns {Promise<{ items: Array<ReturnType<typeof normalizeIndexEntry>>, skipped: number }>}
 */
export async function parseIndexFile(file) {
  const text = await file.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Index file is empty.');
  }
  try {
    const parsed = JSON.parse(trimmed);
    return normalizeIndexData(parsed);
  } catch (error) {
    throw new Error(`Failed to parse index file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Attempt to fetch the default index file from the server.
 * @param {string} url
 * @returns {Promise<{ items: Array<ReturnType<typeof normalizeIndexEntry>>, skipped: number } | null>}
 */
export async function loadDefaultIndex(url = 'sora_gallery_index.json') {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      console.warn('Index fetch failed:', response.status, response.statusText);
      return null;
    }
    const data = await response.json();
    return normalizeIndexData(data);
  } catch (error) {
    console.warn('Index fetch error:', error);
    return null;
  }
}

/**
 * Given the normalized metadata, derive a prompt string.
 * @param {ReturnType<typeof normalizeIndexEntry>} entry
 * @param {Record<string, any> | undefined} meta
 * @returns {string}
 */
export function resolvePrompt(entry, meta) {
  if (meta && typeof meta.Prompt === 'string' && meta.Prompt.trim()) {
    return meta.Prompt.trim();
  }
  if (entry && typeof entry.prompt === 'string' && entry.prompt.trim()) {
    return entry.prompt.trim();
  }
  if (entry?.original && typeof entry.original.prompt === 'string') {
    return entry.original.prompt.trim();
  }
  return '';
}

/**
 * Sanitize text for filenames.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeForFilename(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\-_. ]+/gi, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 64);
}
