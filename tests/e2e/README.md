# Browser tests

These tests drive a real browser with the real extension against a fake copy of each chat site
(`tests/fixtures/mock-site.mjs`). The fake sites answer on the real addresses (`https://chatgpt.com/`,
`https://claude.ai/`, `https://gemini.google.com/app`, `https://grok.com/`), so the extension's
host matching, content scripts and fetch calls run exactly as they do in production. Nothing leaves
your machine and your own browser profile is never used.

The unit tests (`node scripts/test.mjs`) need nothing but `npm install`. The browser tests need the
set-up below.

## Chrome / Edge (Chromium) — Playwright

```
npm i --no-save playwright
npx playwright install chromium
node --test --test-concurrency=1 tests/e2e/selection.e2e.mjs tests/e2e/bulk.e2e.mjs
```

Run a few tests only: add `--test-name-pattern="claude fast|rate limit"`. The full run takes a few minutes
because each test starts its own browser.

| Variable | Meaning |
| --- | --- |
| `PLAYWRIGHT_MODULE` | Absolute path to Playwright's entry file, when it is installed somewhere `import 'playwright'` cannot find. |
| `CHROMIUM_EXECUTABLE` | Run this Chromium/Chrome binary instead of Playwright's own (it must support `--load-extension`). |
| `EXTENSION_DIR` | Test this unpacked extension folder instead of `extension/`. |

`tests/helpers/extension.mjs` starts Chromium with the unpacked extension in a throwaway profile,
`tests/helpers/scenario.mjs` opens a fake site and gives short helpers for the in-page panel, and
`mock-site.mjs` serves the pages through Playwright request routing.

## Firefox — real desktop Firefox, no dependencies

```
node tests/e2e/firefox.mjs [--require] [--only=<regex on check id or name>]
```

It builds `scripts/build-firefox.mjs` output into a temp folder, starts the installed Firefox headless
with a throwaway profile, installs the package as a temporary add-on and talks to the browser over
WebDriver BiDi (Node's built-in `WebSocket`) plus Marionette for trusted mouse and keyboard input. No
geckodriver, Selenium, Playwright or download is involved. Firefox 140 or newer is needed (the add-on
declares it); the checks were written against 157.

- Without Firefox installed the run prints a note and exits 0. `--require` makes that an error (use it in CI).
- `--only=F05` or `--only=gemini` runs the matching checks. Check ids are listed at the top of each line of output.

| Variable | Meaning |
| --- | --- |
| `FIREFOX_BIN` | Firefox executable (default: the standard install path, or `firefox` on `PATH`). |
| `FIREFOX_SHOTS_DIR` | Keep screenshots (panel light/dark/Persian, popup, options) in this folder. |
| `EXTENSION_DIR` | Build the Firefox package from this extension folder instead of `extension/`. |
| `FIREFOX_PACKAGE_DIR` | Install this prebuilt Firefox package folder and skip the build. |
| `FIREFOX_TRACE` | Set to `1` to log every native input action with a timestamp. |

How the pieces fit (`tests/helpers/firefox.mjs`):

- **Fake sites.** `network.addIntercept` pauses every request to the four site origins and
  `network.provideResponse` answers it from `handleMockRequest` (the same function the Chromium route
  uses). Request bodies come from a BiDi data collector (`network.getData`).
- **Sending messages.** An extension page (the options page, kept open as a utility tab) runs
  `chrome.tabs.query` / `chrome.tabs.sendMessage` / `chrome.scripting.executeScript` "as the
  extension", the way the popup and the worker do. `scripting.executeScript({ func })` runs in the
  content scripts' own sandbox, which is how a check reads `ABCM` state or runs a content-script function.
- **Input.** Clicks, typing, Shift-click and dragging are native input through Marionette. BiDi's own
  input module refuses `moz-extension://` pages.
- **Event page.** `extensions.background.idle.timeout` is lowered so the background really suspends
  during the run; one check waits for `backgroundState === "stopped"` and then wakes it with a command.

What is not covered: the physical Alt+Shift+B key press (headless native key events do not reach
Firefox's own shortcut handler, so the check verifies Firefox registered the shortcut and fires the
same `ExtensionShortcuts.onCommand` callback the key would), the toolbar popup as an actual popup panel
(it is opened as a tab, scoped to the active tab exactly as the popup scopes itself), the permission
prompt of a real install from addons.mozilla.org (a temporary install grants the host permissions
silently), and the live chat sites themselves.

Exit status is non-zero when a check fails, when Firefox logs a manifest problem, or when the
extension's background throws.
