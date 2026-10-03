# Website plugins

Plugins run inside the Suno page. They can change the DOM, add styles, handle events, and observe navigation. They have no access to native Tauri commands.

## Package format

Import a UTF-8 `.plugin.json` file:

```json
{
  "schemaVersion": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A Suno extension.",
  "author": "Your name",
  "enabled": true,
  "script": "api.toast('Hello!');",
  "sunoCss": "main { --my-color: #26c8cd; }"
}
```

`script` is a JavaScript function body with an `api` parameter. `window` and `document` refer to the website. It runs when enabled and after full navigation. Use observers and navigation hooks for SPA updates. Top-level `import`, `export`, and `await` are unsupported; put asynchronous work inside an async function.

Plain `.js` imports start disabled. JSON imports use the `enabled` field (default: true). IDs start with a lowercase letter and contain lowercase letters, digits, or hyphens, up to 64 characters. Packages are limited to 256 KiB; scripts to 128 KiB. Syntax is validated on import.

## API

| API | Behavior |
| --- | --- |
| `api.id`, `api.version` | Plugin ID and API version (`1.0.0`) |
| `api.document`, `api.window` | Website objects |
| `api.toast(text)` | Display a notice |
| `api.addStyle(css)` | Add a style with automatic cleanup |
| `api.on(target, event, handler, options?)` | Register a listener; returns `off()` |
| `api.observe(selector, callback)` | Process current and newly added matching elements once each; returns `off()` |
| `api.onNavigate(callback)` | Observe SPA URL changes; returns `off()` |
| `api.onCleanup(fn)` | Register cleanup |
| `api.storage.get(key, fallback?)` | Read plugin-specific JSON data |
| `api.storage.set(key, value)` | Store JSON data in the website profile |
| `api.storage.remove(key)` | Remove stored data |

A function returned by the script also runs on cleanup. Listeners, observers, and styles registered through the API are removed automatically. Undo direct DOM changes, timers, and global state yourself.

```js
api.observe('a[href*="/song/"]', link => {
  const button = document.createElement('button');
  button.textContent = 'Copy link';
  link.insertAdjacentElement('afterend', button);
  api.on(button, 'click', async event => {
    event.preventDefault();
    event.stopPropagation();
    await navigator.clipboard.writeText(link.href);
    api.toast('Copied.');
  });
  return () => button.remove();
});
```

The [Song Tools example](../public/examples/song-tools.en.plugin.json) can also be installed from the app. Only install plugins you trust: JavaScript has the website's privileges, including access to page content and session state.

## Themes and audio presets

Plugins may contribute `themes` and `presets`, available while the plugin is enabled. See [Studio Essentials](../examples/studio-essentials.plugin.json) and [Ocean](../examples/ocean.theme.json).

Theme colors (`background`, `surface`, `panel`, `accent`, `text`, `muted`, `line`) use `#RGB` or `#RRGGBB`. Optional `background` fields include `type` (`solid`, `gradient`, `image`), `color1`, `color2`, `angle`, `dim`, `opacity`, `fit` (`cover`, `contain`, `repeat`), and `image`. Images are embedded PNG/JPEG/WebP data URLs limited to 192 KiB. External resources and SVG are rejected in declarative CSS and wallpapers.

Presets provide ten `gains` for 32/64/125/250/500/1000/2000/4000/8000/16000 Hz, plus `preamp`, `enhance`, `warmth`, `clarity`, `compression`, and `normalize`. Gain range: -12 to 12 dB. Preamp: -18 to 12 dB. Effect values: 0 to 100.

Complete packages are saved in the app profile, so the original import file is no longer needed. Suno website changes may require selector updates.
