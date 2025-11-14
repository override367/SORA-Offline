// ==UserScript==
// @name         Sora Auto Saver
// @namespace    https://github.com/
// @version      1.0.0
// @description  Automatically download Sora media with prompt metadata when visiting generation pages.
// @author       Sora Archive Kit
// @match        https://sora.chatgpt.com/g/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const AUTO_CLOSE_DELAY = 1500;
  const MEDIA_POLL_INTERVAL = 400;
  const MEDIA_POLL_ATTEMPTS = 75;

  const state = {
    banner: null,
    status: 'idle',
    autoMode: new URLSearchParams(window.location.search).get('auto') === '1'
  };

  function sanitizeForFilename(value) {
    if (!value) return '';
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\-_. ]+/gi, ' ')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 64);
  }

  function ensureBanner() {
    if (state.banner) return state.banner;
    const wrapper = document.createElement('div');
    wrapper.id = 'sora-saver-banner';
    wrapper.innerHTML = `
      <style>
        #sora-saver-banner {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 999999;
          background: rgba(9, 12, 20, 0.92);
          border: 1px solid rgba(77, 171, 247, 0.4);
          border-radius: 14px;
          padding: 12px 16px;
          color: #e8f0ff;
          font-family: 'Inter', 'Segoe UI', sans-serif;
          min-width: 240px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
        }
        #sora-saver-banner button {
          margin-top: 12px;
          width: 100%;
          border-radius: 10px;
          border: 1px solid rgba(77, 171, 247, 0.5);
          background: rgba(77, 171, 247, 0.12);
          color: #e8f0ff;
          font-weight: 600;
          padding: 8px 12px;
          cursor: pointer;
        }
        #sora-saver-banner button:hover {
          background: rgba(77, 171, 247, 0.22);
        }
        #sora-saver-banner .status {
          font-size: 0.9rem;
        }
      </style>
      <div class="status">Sora Saver ready</div>
      <button type="button">Download with prompt</button>
    `;
    document.body.append(wrapper);
    const button = wrapper.querySelector('button');
    button.addEventListener('click', handleDownloadRequest);
    state.banner = wrapper;
    return wrapper;
  }

  function updateStatus(message) {
    const banner = ensureBanner();
    const statusEl = banner.querySelector('.status');
    statusEl.textContent = message;
  }

  function getGenerationId() {
    const match = window.location.pathname.match(/gen_[a-z0-9]+/i);
    return match ? match[0] : null;
  }

  function looksLikePlaceholder(url) {
    if (!url) return false;
    const normalized = url.toString();
    if (normalized.startsWith('data:')) return true;
    if (/placeholder/i.test(normalized)) return true;
    if (/\bsora\/images\//i.test(normalized)) return true;
    if (/avatar|thumb|icon/i.test(normalized) && !/generations|videos|outputs?/i.test(normalized)) return true;
    return false;
  }

  function looksLikeRealMedia(url) {
    if (!url || looksLikePlaceholder(url)) return false;
    const normalized = url.toString();
    if (/videos\.openai\.com/i.test(normalized)) return true;
    if (/vg-?assets?/i.test(normalized)) return true;
    if (/sora-prod.*\.s3/i.test(normalized)) return true;
    if (/storage\.googleapis\.com/i.test(normalized)) return true;
    if (/\.(mp4|webm|mov|m4v|mpg|mpeg|gif)(?=[?#]|$)/i.test(normalized)) return true;
    if (/\.(png|jpe?g|webp|avif|bmp|tiff)(?=[?#]|$)/i.test(normalized)) return true;
    return false;
  }

  function* deepCollect(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) {
        yield* deepCollect(node.shadowRoot);
      }
      yield node;
    }
  }

  function deriveMediaCandidate(element) {
    if (!(element instanceof Element)) return null;
    if (element.tagName === 'VIDEO') {
      const sources = [element.currentSrc, element.src];
      const sourceEl = element.querySelector('source[src]');
      if (sourceEl) sources.push(sourceEl.currentSrc || sourceEl.src);
      for (const candidate of sources) {
        if (looksLikeRealMedia(candidate)) {
          return { url: candidate, kind: 'video' };
        }
      }
    }
    if (element.tagName === 'IMG') {
      const sources = [element.currentSrc, element.src];
      const srcset = element.srcset?.split(',') || [];
      for (const entry of srcset) {
        const [candidate] = entry.trim().split(/\s+/);
        if (candidate) sources.push(candidate);
      }
      for (const candidate of sources) {
        if (looksLikeRealMedia(candidate)) {
          if (element.naturalWidth && element.naturalWidth < 40) continue;
          if (element.naturalHeight && element.naturalHeight < 40) continue;
          return { url: candidate, kind: 'image' };
        }
      }
    }
    return null;
  }

  async function waitForMedia() {
    let fallbackImage = null;
    for (let attempt = 0; attempt < MEDIA_POLL_ATTEMPTS; attempt += 1) {
      for (const element of deepCollect(document)) {
        if (!(element instanceof Element)) continue;
        if (element.tagName === 'VIDEO') {
          const candidate = deriveMediaCandidate(element);
          if (candidate) {
            return candidate;
          }
        }
      }

      for (const element of deepCollect(document)) {
        if (!(element instanceof Element) || element.tagName !== 'IMG') continue;
        const candidate = deriveMediaCandidate(element);
        if (candidate) {
          fallbackImage = fallbackImage || candidate;
        }
      }

      if (fallbackImage) {
        return fallbackImage;
      }

      await new Promise((resolve) => setTimeout(resolve, MEDIA_POLL_INTERVAL));
    }
    throw new Error('Timed out waiting for media to load.');
  }

  function extractPromptFromAttributes(element) {
    const attrs = ['data-prompt', 'data-text', 'data-tooltip', 'aria-label', 'title'];
    for (const attr of attrs) {
      const value = element.getAttribute?.(attr);
      if (value && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  function extractPromptText() {
    const selectors = [
      '[data-testid="prompt"]',
      '[data-testid="viewer-prompt"]',
      '[data-purpose="prompt"]',
      '[data-prompt]',
      '[class*="prompt"]',
      '[class*="Prompt"]'
    ];
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const attributePrompt = extractPromptFromAttributes(el);
        if (attributePrompt) return attributePrompt;
        const text = el.textContent?.trim();
        if (text && text.length > 10) {
          return text;
        }
      }
    }

    // Fall back to meta tags or page title.
    const metaPrompt = document.querySelector('meta[name="description"]')?.content;
    if (metaPrompt) return metaPrompt.trim();
    return document.title.replace(/\|.*$/g, '').trim();
  }

  function determineExtension(url, kind) {
    try {
      const parsed = new URL(url);
      const basename = parsed.pathname.split('/').pop() || '';
      const ext = basename.split('.').pop();
      if (ext && ext.length <= 5) {
        return ext.toLowerCase();
      }
    } catch (error) {
      // Ignore URL parse issues and fall back to defaults.
    }
    return kind === 'video' ? 'mp4' : 'webp';
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function runDownloadFlow() {
    const id = getGenerationId();
    if (!id) throw new Error('Could not determine generation id from URL.');
    updateStatus('Locating media…');
    const media = await waitForMedia();
    updateStatus('Capturing prompt…');
    const prompt = extractPromptText();
    const sanitizedPrompt = sanitizeForFilename(prompt) || 'asset';
    const baseName = `gen_${id}--${sanitizedPrompt}`;
    const extension = determineExtension(media.url, media.kind);
    const mediaFileName = `${baseName}.${extension}`;
    const metaFileName = `gen_${id}.meta.json`;

    updateStatus('Downloading media…');
    let mediaResponse;
    try {
      mediaResponse = await fetch(media.url, {
        mode: 'cors',
        credentials: 'omit'
      });
    } catch (networkError) {
      console.warn('Initial media fetch failed, retrying without explicit CORS options.', networkError);
      mediaResponse = await fetch(media.url);
    }

    if (!mediaResponse.ok) {
      throw new Error(`Failed to download media (${mediaResponse.status}).`);
    }
    const mediaBlob = await mediaResponse.blob();
    triggerDownload(mediaBlob, mediaFileName);

    const meta = {
      SourceURL: window.location.href,
      AssetURL: media.url,
      Prompt: prompt,
      Title: sanitizedPrompt.replace(/_/g, ' ').slice(0, 80) || id,
      Kind: media.kind,
      SuggestedBaseName: baseName
    };
    const metaBlob = new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' });
    triggerDownload(metaBlob, metaFileName);
    updateStatus('Downloads complete ✔');
  }

  async function handleDownloadRequest() {
    try {
      const banner = ensureBanner();
      const button = banner.querySelector('button');
      button.disabled = true;
      await runDownloadFlow();
      if (state.autoMode) {
        updateStatus('Auto mode: closing tab…');
        setTimeout(() => window.close(), AUTO_CLOSE_DELAY);
      } else {
        setTimeout(() => {
          button.disabled = false;
          updateStatus('Ready for another download');
        }, 1200);
      }
    } catch (error) {
      console.error('Sora Saver error', error);
      updateStatus(error instanceof Error ? error.message : String(error));
      const banner = ensureBanner();
      const button = banner.querySelector('button');
      button.disabled = false;
    }
  }

  function init() {
    ensureBanner();
    if (state.autoMode) {
      updateStatus('Auto mode detected — saving…');
      setTimeout(() => handleDownloadRequest(), 600);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
