(() => {
  if (location.protocol !== 'https:' || !(location.hostname === 'suno.com' || location.hostname.endsWith('.suno.com'))) return;
  if (window.__customSuno) return;
  const running = new Map();
  let config = { css: '', mods: {} };
  let appliedCss = '';
  let style = null;
  let styleTimer = null;
  const routeListeners = new Set();
  let lastUrl = location.href;
  const toast = message => {
    if (!document.body) return;
    const el = document.createElement('div');
    el.textContent = String(message).slice(0, 350);
    el.style.cssText = 'position:fixed;bottom:90px;right:24px;z-index:2147483647;background:#142728;color:#edffff;border:1px solid #25c7cc;padding:12px 18px;border-radius:10px;font:13px system-ui;max-width:380px;box-shadow:0 8px 30px #0006';
    document.body.append(el);
    setTimeout(() => el.remove(), 6000);
  };
  const apply = () => {
    if (!document.documentElement) return;
    style = document.getElementById('customsuno-site-styles');
    if (!style) { style = document.createElement('style'); style.id = 'customsuno-site-styles'; (document.head || document.documentElement).append(style); }
    if (style.textContent !== appliedCss) style.textContent = appliedCss;
    // Keep custom rules after stylesheets that Next.js mounts during SPA navigation.
    const root = document.head || document.documentElement;
    if (style.parentNode !== root || style.nextSibling) root.appendChild(style);
  };
  const uninstall = id => {
    const plugin = running.get(id);
    if (!plugin) return;
    plugin.cleanups.reverse().forEach(fn => { try { fn(); } catch (error) { console.warn('[CustomSuno] Cleanup', id, error); } });
    running.delete(id);
  };
  window.__customSuno = {
    configure(next) {
      config = next;
      // Build large image/theme strings only when settings actually change.
      appliedCss = config.css + (config.mods.compact ? '\nmain [role="row"],main [data-testid*="song"]{padding-block:4px!important}main{font-size:13px!important}' : '')
        + (config.mods.focus ? '\naside,nav[aria-label="Main navigation"]{display:none!important}' : '')
        + (config.mods.motion ? '\n*,*::before,*::after{animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important}' : '');
      for (const id of running.keys()) if (!next.pluginIds.includes(id)) uninstall(id);
      apply();
    },
    install(meta, start) {
      const source = start.toString();
      if (running.get(meta.id)?.source === source) return;
      uninstall(meta.id);
      const cleanups = [];
      const onCleanup = fn => { if (typeof fn === 'function') cleanups.push(fn); return fn; };
      const api = Object.freeze({
        id: meta.id, version: '1.0.0', document, window,
        toast,
        onCleanup,
        addStyle(css) {
          const el = document.createElement('style'); el.dataset.customsunoPlugin = meta.id; el.textContent = String(css);
          (document.head || document.documentElement).append(el); onCleanup(() => el.remove()); return el;
        },
        on(target, event, handler, options) {
          target.addEventListener(event, handler, options);
          const off = () => target.removeEventListener(event, handler, options); onCleanup(off); return off;
        },
        observe(selector, callback) {
          const seen = new WeakSet();
          const pending = new Set();
          let timer = null, stopped = false;
          // Relational selectors may match existing ancestors/siblings after insertion.
          const relational = /[\s>+~]|:(?:has|empty|nth-|first-|last-|only-)/i.test(selector);
          const visit = el => { if (!stopped && !seen.has(el)) { seen.add(el); onCleanup(callback(el)); } };
          const scan = () => { document.querySelectorAll(selector).forEach(visit); };
          const flush = () => {
            timer = null;
            if (stopped) return;
            const roots = new Set(pending); pending.clear();
            if (relational) { scan(); return; }
            for (const root of roots) {
              if (!root.isConnected) continue;
              let nested = false;
              for (let parent = root.parentElement; parent; parent = parent.parentElement) {
                if (roots.has(parent)) { nested = true; break; }
              }
              if (nested) continue;
              if (root.matches(selector)) visit(root);
              root.querySelectorAll(selector).forEach(visit);
            }
          };
          const observer = new MutationObserver(records => {
            for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) pending.add(node);
            if ((pending.size || relational) && timer === null) timer = setTimeout(flush, 80);
          });
          observer.observe(document, { childList: true, subtree: true }); scan();
          const off = () => { stopped = true; observer.disconnect(); clearTimeout(timer); pending.clear(); }; onCleanup(off); return off;
        },
        onNavigate(callback) { routeListeners.add(callback); const off = () => routeListeners.delete(callback); onCleanup(off); return off; },
        storage: Object.freeze({
          get(key, fallback = null) { try { const raw = localStorage.getItem(`customsuno:${meta.id}:${key}`); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } },
          set(key, value) { localStorage.setItem(`customsuno:${meta.id}:${key}`, JSON.stringify(value)); },
          remove(key) { localStorage.removeItem(`customsuno:${meta.id}:${key}`); },
        }),
      });
      running.set(meta.id, { source, cleanups });
      try { const result = start(api); if (typeof result === 'function') onCleanup(result); else if (result?.then) result.then(onCleanup).catch(error => toast(`${meta.name}: ${error.message}`)); }
      catch (error) { uninstall(meta.id); console.error('[CustomSuno]', meta.name, error); toast(`${meta.name}: ${error.message}`); }
    },
  };
  const scheduleStyle = () => {
    if (styleTimer === null) styleTimer = setTimeout(() => { styleTimer = null; apply(); }, 0);
  };
  const headObserver = new MutationObserver(records => {
    if (records.some(record => record.target !== style && [...record.addedNodes, ...record.removedNodes].some(node =>
      node !== style && node.nodeType === 1 && (node.tagName === 'STYLE' || node.tagName === 'LINK')
    )) || !style?.isConnected) scheduleStyle();
  });
  const watchHead = () => {
    headObserver.disconnect();
    if (document.head) headObserver.observe(document.head, { childList: true });
    apply();
  };
  // Never observe the song list/player just to maintain a stylesheet in <head>.
  const rootObserver = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeName === 'HEAD'))) watchHead();
  });
  if (document.documentElement) rootObserver.observe(document.documentElement, { childList: true });
  watchHead();
  document.addEventListener('DOMContentLoaded', watchHead, { once: true });
  // Find the home composer by its visible purpose, not generated class names.
  // Only inspect new headings/fields; player text updates do not rescan the page.
  const composerCandidates = 'h1,h2,h3,[role="heading"],textarea,[contenteditable="true"]';
  const markComposer = root => {
    const candidates = root.matches?.(composerCandidates) ? [root, ...root.querySelectorAll(composerCandidates)] : root.querySelectorAll(composerCandidates);
    for (const candidate of candidates) {
      const heading = /turn your thoughts into music/i.test(candidate.textContent || '');
      const field = candidate.matches('textarea,[contenteditable="true"]');
      if (!heading && !field) continue;
      for (let parent = candidate.parentElement, depth = 0; parent && depth < 7 && !parent.matches('body,html,main'); parent = parent.parentElement, depth++) {
        if (!parent.querySelector('textarea,[contenteditable="true"]') || !/turn your thoughts into music/i.test(parent.textContent || '')) continue;
        // Include empty decorative wrappers surrounding the heading and input.
        const content = parent.textContent;
        for (let level = 0; level < 3 && parent.parentElement && !parent.parentElement.matches('body,html,main') && parent.parentElement.textContent === content; level++) parent = parent.parentElement;
        if (!parent.hasAttribute('data-customsuno-composer')) parent.setAttribute('data-customsuno-composer', '');
        break;
      }
    }
  };
  let composerTimer = null;
  const composerRoots = new Set();
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) composerRoots.add(node);
    if (composerRoots.size && composerTimer === null) composerTimer = setTimeout(() => {
      composerTimer = null;
      const roots = new Set(composerRoots); composerRoots.clear();
      for (const root of roots) {
        if (!root.isConnected) continue;
        let nested = false;
        for (let parent = root.parentElement; parent; parent = parent.parentElement) if (roots.has(parent)) { nested = true; break; }
        if (!nested) markComposer(root);
      }
    }, 80);
  }).observe(document, { childList: true, subtree: true });
  markComposer(document);
  const navigate = () => { if (location.href !== lastUrl) { lastUrl = location.href; routeListeners.forEach(fn => { try { fn(lastUrl); } catch (error) { console.warn(error); } }); } };
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) { const result = original.apply(this, args); navigate(); return result; };
  }
  window.addEventListener('popstate', navigate);
  window.addEventListener('hashchange', navigate);
  document.addEventListener('keydown', event => {
    if (!config.mods.shortcuts || !event.altKey || event.code !== 'Space' || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    const audio = [...document.querySelectorAll('audio,video')].find(el => !el.paused) || document.querySelector('audio,video');
    if (audio) { event.preventDefault(); if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
  });
})();
