// Run with Vite running: playwright-cli -s=perf run-code --filename scripts/check-site-runtime.js
async (page) => {
  await page.goto('http://127.0.0.1:1420');
  const data = await page.evaluate(async () => {
    const { BUILTIN_THEMES, buildSunoCss } = await import('/src/extensions.ts');
    const { defaultBackground } = await import('/src/theme-background.ts');
    return {
      themes: BUILTIN_THEMES.map(theme => ({ ...theme, css: buildSunoCss(theme, [], '') })),
      gradient: buildSunoCss({ ...BUILTIN_THEMES[1], background: { ...defaultBackground, type: 'gradient' } }, [], ''),
      image: buildSunoCss({ ...BUILTIN_THEMES[1], background: { ...defaultBackground, type: 'image', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=' } }, [], ''),
    };
  });
  const runtime = await (await page.request.get('http://127.0.0.1:1420/src-tauri/src/site-runtime.js?raw')).text();
  await page.route('https://suno.com/__customsuno_runtime_check', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><html><head><style>
    body{margin:0;background:#111;color:white;font:18px system-ui}main{padding:60px}
    #hero{background:#101012;padding:80px;border-radius:16px}h1{text-align:center}
    textarea{width:90%;height:100px;border-radius:20px;padding:20px;background:transparent;color:white;font:inherit}
    .bg-background-primary{background:var(--color-background-primary)}
    </style></head><body><main class="bg-background-primary"><section id="hero"><h1>Turn your thoughts into music</h1><div class="bg-black" style="background:linear-gradient(orange,black)"><textarea placeholder="Describe the song you want to make"></textarea></div></section><div id="rows"></div></main></body></html>`,
  }));
  await page.goto('https://suno.com/__customsuno_runtime_check');
  await page.evaluate(() => {
    window.checkCounts = { scans: 0, styleLookups: 0 };
    const query = document.querySelectorAll.bind(document);
    document.querySelectorAll = (...args) => { window.checkCounts.scans++; return query(...args); };
    const get = document.getElementById.bind(document);
    document.getElementById = id => { if (id === 'customsuno-site-styles') window.checkCounts.styleLookups++; return get(id); };
  });
  await page.evaluate(runtime);
  const result = await page.evaluate(async data => {
    const assert = (value, message) => { if (!value) throw Error(message); };
    const wait = () => new Promise(resolve => setTimeout(resolve, 160));
    const api = window.__customSuno;
    const hero = document.getElementById('hero');
    const rgb = hex => `rgb(${[1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(', ')})`;
    assert(hero.hasAttribute('data-customsuno-composer'), 'Composer not detected');
    for (const theme of data.themes) {
      api.configure({ css: theme.css, mods: {}, pluginIds: [] });
      assert(getComputedStyle(hero).backgroundColor === rgb(theme.colors.background), theme.id + ' hero background');
      assert(getComputedStyle(hero.querySelector('h1')).color === rgb(theme.colors.text), theme.id + ' heading');
      assert(getComputedStyle(hero.querySelector('textarea'), '::placeholder').color === rgb(theme.colors.muted), theme.id + ' placeholder');
      assert(getComputedStyle(hero.querySelector('.bg-black')).backgroundImage === 'none', 'Hardcoded gradient remains');
    }
    api.configure({ css: data.gradient, mods: {}, pluginIds: ['check'] });
    assert(getComputedStyle(document.documentElement).backgroundImage.includes('linear-gradient'), 'Wallpaper missing');
    assert(getComputedStyle(document.querySelector('main')).backgroundColor === 'rgba(0, 0, 0, 0)', 'Main masks wallpaper');
    assert(getComputedStyle(document.body).backgroundImage === 'none', 'Duplicate wallpaper');
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); dialog.className = 'bg-background-primary'; document.body.append(dialog);
    assert(getComputedStyle(dialog).backgroundColor === rgb(data.themes[1].colors.background), 'Dialog became transparent'); dialog.remove();
    api.configure({ css: data.image, mods: {}, pluginIds: ['check'] });
    assert(getComputedStyle(document.documentElement).backgroundImage.includes('data:image/png'), 'Image wallpaper missing');
    let hits = 0, cleanups = 0, navigations = 0;
    api.install({ id: 'check', name: 'Check' }, api => {
      api.observe('a[href*="/song/"]', () => { hits++; return () => cleanups++; });
      api.onNavigate(() => navigations++);
    });
    await wait();
    window.checkCounts = { scans: 0, styleLookups: 0 };
    const rows = document.getElementById('rows');
    for (let batch = 0; batch < 20; batch++) {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 100; i++) { const el = document.createElement('span'); el.textContent = String(i); fragment.append(el); }
      rows.replaceChildren(fragment);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const link = document.createElement('a'); link.href = '/song/test'; rows.append(link);
    await wait();
    assert(hits === 1, 'Incremental plugin missed inserted link');
    assert(window.checkCounts.scans === 0, 'Body mutations caused whole-document scans');
    assert(window.checkCounts.styleLookups === 0, 'Body mutations triggered style application');
    const counts = { ...window.checkCounts };
    history.pushState({}, '', '/__customsuno_runtime_check?a');
    history.replaceState({}, '', '/__customsuno_runtime_check?b');
    assert(navigations === 2, 'SPA navigation notifications failed');
    const style = document.createElement('style'); style.textContent = '#hero { color: red; }'; document.head.append(style);
    await wait();
    assert(document.head.lastElementChild.id === 'customsuno-site-styles', 'Late stylesheet order not restored');
    document.getElementById('customsuno-site-styles').remove();
    await wait();
    assert(document.getElementById('customsuno-site-styles'), 'Removed stylesheet not restored');
    const replacement = hero.cloneNode(true); replacement.removeAttribute('data-customsuno-composer'); hero.replaceWith(replacement);
    await wait();
    assert(replacement.hasAttribute('data-customsuno-composer'), 'Composer not detected after SPA replacement');
    const late = link.cloneNode(); rows.append(late);
    api.configure({ css: '', mods: {}, pluginIds: [] });
    await wait();
    assert(hits === 1 && cleanups === 1, 'Uninstall left a pending plugin callback');
    assert(getComputedStyle(replacement).backgroundColor === 'rgb(16, 16, 18)', 'Disable did not restore original hero');
    assert(getComputedStyle(replacement.querySelector('.bg-black')).backgroundImage.includes('linear-gradient'), 'Disable did not restore gradient');
    let relationalHits = 0;
    api.configure({ css: '', mods: {}, pluginIds: ['relational'] });
    const group = document.createElement('div'); group.className = 'group'; document.body.append(group);
    api.install({ id: 'relational', name: 'Relational' }, api => api.observe('.group:has(a)', () => { relationalHits++; }));
    group.append(document.createElement('a')); await wait();
    assert(relationalHits === 1, 'Relational selector missed an existing ancestor');
    api.configure({ css: '', mods: {}, pluginIds: [] }); group.remove();
    return { themes: data.themes.length, mutations: 2000, ...counts, pluginHits: hits, cleanups, navigations, relationalHits, disable: true, dynamicComposer: true };
  }, data);
  await page.evaluate(css => window.__customSuno.configure({ css, mods: {}, pluginIds: [] }), data.themes[3].css);
  await page.screenshot({ path: 'output/playwright/composer-light-check.png' });
  return result;
}
