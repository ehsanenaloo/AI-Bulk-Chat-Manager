# Contributing to AI Bulk Chat Manager

Thank you for wanting to help. AI Bulk Chat Manager is a small, local browser extension (Chrome, Edge and Firefox) that selects, deletes, archives and exports chats on ChatGPT, Claude, Gemini and Grok. It gets better when people who use it report problems, fix text and send patches. You do not need to be an expert. A clear bug report or a corrected translation is a real contribution.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Picking something to work on](#picking-something-to-work-on)
- [Project principles](#project-principles)
- [Workflow](#workflow)
- [Project map](#project-map)
- [Run it locally](#run-it-locally)
- [Checks](#checks)
- [Writing tests](#writing-tests)
- [Code style](#code-style)
- [When a site changes: selectors and labels](#when-a-site-changes-selectors-and-labels)
- [Adding a site](#adding-a-site)
- [Adding or changing UI text](#adding-or-changing-ui-text)
- [Translations](#translations)
- [Privacy and permission changes](#privacy-and-permission-changes)
- [Commit and pull request checklist](#commit-and-pull-request-checklist)
- [Reporting bugs well](#reporting-bugs-well)
- [Security](#security)
- [Recognition](#recognition)
- [Maintainers and decisions](#maintainers-and-decisions)
- [Releases](#releases)
- [License and sign-off](#license-and-sign-off)

## Ways to contribute

- **Report a bug.** Use the [bug report form](https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/issues/new?template=bug_report.yml). Search [existing issues](https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/issues) first.
- **Tell us a site changed.** ChatGPT, Claude, Gemini and Grok change their pages, and the extension then needs new selectors. Use the [supported site changed form](https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/issues/new?template=site_changed.yml). This is the most useful report there is.
- **Suggest a feature.** Use the [feature request form](https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/issues/new?template=feature_request.yml). Describe the problem you have before the solution you want.
- **Improve a translation.** Fix a wrong or awkward string, or add a language. See [Translations](#translations). If you do not want to edit files, use the [translation fix form](https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/issues/new?template=translation_fix.yml).
- **Improve the docs or screenshots.** The user guide is in [docs/](../docs/) and is published at <https://ehsanenaloo.github.io/AI-Bulk-Chat-Manager/>. Fix errors, unclear steps, or outdated screenshots. Screenshots must not show real chat titles.
- **Review pull requests.** Try a change in your own browser profile and say what you saw. This helps a lot, and anyone can do it.
- **Fix an issue.** Pick one from the list below, say that you are on it, and open a pull request.

Not sure where to start? Open an issue and ask. It is fine to start small.

## Picking something to work on

These labels help you find work. The full list is in [labels.yml](labels.yml).

| Label | What it means |
| --- | --- |
| `good first issue` | Small, well described, and a good first change. The issue says where to look. |
| `help wanted` | The maintainer would like help and has agreed the change fits the project. |
| `site-changed` | A supported site changed its page and an action stopped working. Often a selector or label fix. |
| `translation` | A translation fix or a new language. No coding is needed for most of these. |
| `needs triage` | Not looked at yet. Please wait for a label before you start a large change. |

Before you start on an issue, leave a short comment such as "I would like to work on this." This avoids two people doing the same work. If you do not send a pull request within a few weeks, the maintainer may offer the issue to someone else. That is not a problem. You can come back later.

If you want to change something that has no issue, open one first. For a typo or a small fix, you can send a pull request directly.

## Project principles

These guide every review. They keep the extension small, safe and trusted.

1. **Local only.** No analytics, no remote code, no servers. The only network requests are the same-origin requests to a site's own backend that the user asked for by confirming Delete or Archive. A new network request needs a strong reason and an update to [docs/PRIVACY.md](../docs/PRIVACY.md).
2. **Least privilege.** Do not add permissions or sites. The permissions are `activeTab`, `scripting` and `storage`, and `scripts/validate.mjs` fails on anything else.
3. **Never conversation content.** The extension reads the sidebar's chat list (titles and links) and nothing else. It does not read the text of conversations.
4. **Never act on the wrong chat.** Destructive actions need a confirmation, run only on chats the user selected, match menu items and buttons by their label, and report what worked and what failed, separately. When a Delete goes through the page's menus, it is reported as done only when the chat really left the list; on the fast route, only when the site accepted the request.
5. **Render text as text.** Never build HTML from chat titles, links or translated strings. Use `textContent` and `createElement`. `validate.mjs` rejects `innerHTML`, `eval` and remote code.
6. **No build step.** The `extension/` folder is the extension, exactly as it ships. Use plain classic scripts, HTML and CSS. Do not add a framework, a bundler or a runtime dependency.

A change that breaks one of these needs a discussion in an issue before any code.

## Workflow

1. **Fork** the repository on GitHub and clone your fork.

   ```bash
   git clone https://github.com/<your-username>/AI-Bulk-Chat-Manager.git
   cd AI-Bulk-Chat-Manager
   git remote add upstream https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager.git
   ```

2. **Create a branch** from the latest `main`. Use a short name with a prefix:

   - `fix/claude-delete-menu`
   - `feat/export-selected-order`
   - `docs/troubleshooting-steps`
   - `i18n/fix-german-delete`
   - `chore/update-editorconfig`

3. **Make small commits.** One idea per commit. Each commit should leave the project in a working state.

4. **Write the commit message in Conventional Commits style:** `type(scope): short summary`. Use the imperative mood ("fix", not "fixed"). Keep the first line under about 72 characters. Examples:

   ```text
   fix(visual): never pick "Remove from project" for Delete
   fix(sites): update the Gemini sidebar selector
   feat(panel): add Markdown export
   docs(guide): explain Fast mode
   i18n(de): correct the word for "archive"
   test(bulk): cover a rate limit during the API phase
   ci(release): check the Firefox manifest
   ```

   Common types are `feat`, `fix`, `docs`, `i18n`, `refactor`, `perf`, `test`, `chore` and `ci`. Common scopes are `panel`, `popup`, `options`, `sites`, `api`, `visual`, `bulk`, `export`, `i18n`, `guide` and `validate`.

5. **Keep your branch up to date by rebasing**, not by merging `main` into it.

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

   If you have already pushed the branch, update it with `git push --force-with-lease`. The maintainer may squash your commits when merging, so a clean history on your side is helpful but not required.

6. **Open a pull request** against `main`. Fill in the template: what changed, why, the related issue, and how you tested it. Mark it as a draft if it is not ready. Keep one topic per pull request. A small pull request is reviewed faster.

7. **Respond to review.** Push follow-up commits to the same branch. When a comment is fixed, say so in a short reply.

### What review looks like

The maintainer checks that the change fits the [principles](#project-principles), passes CI, works in the browser, and is easy to read. You may get questions, requests for changes, or a suggestion to split the pull request. This is normal and is about the code, not about you.

AI Bulk Chat Manager has one maintainer, who works on it in spare time. Replies are best effort. A first response often comes within a week or two, and sometimes it takes longer. There is no promise of a date. If you have heard nothing after two weeks, a polite comment on the pull request is welcome.

## Project map

The repository root is kept small on purpose. The extension itself lives in `extension/`, and everything else (guide, tests, scripts, community files) sits beside it. The main places are:

| Path | What it holds |
| --- | --- |
| `extension/manifest.json` | Extension manifest (Manifest V3): permissions, content-script matches and file order, the keyboard shortcut. |
| `extension/background.js` | The background worker (a service worker in Chrome and Edge, an event page in Firefox). It serves the content scripts their translations and styles, opens links and the Options page, handles the keyboard shortcut and shows the support badge. It makes no network requests. |
| `extension/src/shared/` | Code used by several parts: `namespace.js` (the shared `ABCM` object), `ext.js` (promise wrappers over `chrome.*`), `sites.js` (the site registry and selectors), `settings.js`, `i18n.js` (translation loader and language list), `inject.js`, `nudge.js` (support reminder), `links.js`, `icons.js`, and `tokens.css` and `components.css`. |
| `extension/src/content/` | Content scripts that run on the chat sites: `config.js` (timings, endpoints, menu-label words), `dom.js` (reads the chat list), `state.js` (selection), `checkboxes.js`, `auto-attach.js`, `loader.js` (Load all older chats), `engines/api.js` and `engines/visual.js` (the two ways to delete or archive), `bulk.js` (runs an action over the selection), `exporter.js`, `app.js`, `bridge.js` and `main.js`. |
| `extension/src/content/ui/` | The in-page panel: `panel.js` and `panel.css`. |
| `extension/src/popup/` | The toolbar popup. |
| `extension/src/options/` | The Options page. |
| `extension/src/i18n/locales/` | Interface translations, one file per language: `en.json`, `de.json`, and so on. |
| `extension/_locales/` | Browser-level strings (name, description, tooltip, shortcut label), one folder per language. |
| `extension/icons/` | The toolbar and store icons. |
| `extension/THIRD_PARTY_NOTICES.md` | Licence notices for the little third-party material that ships. |
| `docs/` | The user guide (a static site published with GitHub Pages) and `PRIVACY.md`. |
| `tests/` | Unit tests in `tests/unit/` (`*.test.mjs`), browser tests in `tests/e2e/` (`*.e2e.mjs`), a fake chat site in `tests/fixtures/` and helpers in `tests/helpers/`. |
| `scripts/` | `validate.mjs`, `test.mjs`, `build.mjs`, `build-firefox.mjs`, `list-runtime-files.mjs`, `runtime-files.json` (what ships in the package) and `sync-labels.mjs`. |
| `.github/` | Issue forms, the pull request template, labels, workflows, and the community files (this guide, Code of Conduct, Security, Support). |

## Run it locally

You need Node.js 22 or newer (CI uses 24) and one of Chrome, Edge or Firefox.

```bash
npm install
```

This installs `jsdom`, which the unit tests use. Nothing from npm ships in the extension.

### Chrome and Edge

1. Use a **separate browser profile** for development, signed in to a **test account** on the sites you want to try. Do not test destructive features on chats you care about.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the **`extension/`** folder inside your clone (the folder that contains `manifest.json`), not the repository root.
4. After you edit a file, click the reload button on the extension card. Then reload the chat tab. Changes to the popup or Options page only need the page to be reopened.

### Firefox

The Firefox package is generated from the same files in `extension/`. The Chrome manifest is never changed.

1. Run `npm run build:firefox` (or `node scripts/build-firefox.mjs`). It writes the package to `dist/firefox/`. The `dist/` folder is not committed.
2. In Firefox 140 or newer, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and choose `dist/firefox/manifest.json`.
3. Use a separate Firefox profile and a test account. A temporary add-on is removed when Firefox closes.

### Where to find console logs

- **Chat page (content scripts):** open the page's developer tools (F12). The extension's messages start with `[ABCM]`.
- **Popup:** right-click inside the popup and choose **Inspect**.
- **Options page:** open it in a tab and press F12.
- **Background worker:** on `chrome://extensions`, click the **service worker** link on the extension's card. In Firefox use `about:debugging`.

## Checks

Run both of these before you push:

```bash
node scripts/validate.mjs
node scripts/test.mjs
```

`npm run check` runs the two in a row, and `npm test` is a shortcut for the second one.

- **`node scripts/validate.mjs`** checks the manifest, the permission list, the files it references (they must all exist inside `extension/`), that only shipping files sit in `extension/`, JavaScript syntax, JSON and locale files, a few code rules (no `eval`, no `innerHTML`, no remote code, no inline scripts), the addresses the code is allowed to mention, that the repository root stays small, and that `CHANGELOG.md` has a section for the current version.
- **`node scripts/test.mjs`** runs every `tests/unit/*.test.mjs` file with the built-in Node test runner. Pass a word to run only the files whose name contains it, for example `node scripts/test.mjs i18n`.
- **Browser tests (optional, but run them for changes to selection, deleting, archiving or the panel).** They load `extension/` into a real Chromium with a throwaway profile and drive a fake ChatGPT, Claude, Gemini and Grok page, so no account is needed:

  ```bash
  npm i --no-save playwright
  npx playwright install chromium
  node --test --test-concurrency=1 tests/e2e/*.e2e.mjs
  ```

- **Firefox tests (experimental).** `npm run test:firefox` is meant to drive a headless desktop Firefox with the generated package. It needs Firefox 140 or newer installed and does not need Playwright.

CI runs `validate` and the unit tests on every pull request. It also runs the Chromium browser tests on pushes to `main`, and a Firefox job that builds and lints the Firefox package (that job is informative for now and does not block a merge). The maintainer looks for a green CI run before merging a pull request.

Tests do not replace trying the change by hand. The fake pages model the structure of the real sites, but the real sites are the final judge. In the pull request, describe your manual steps: the browser and version, the site, what you clicked, and what you saw. Include a failure case, such as a cancelled dialog or a chat that no longer exists.

## Writing tests

A fix or a feature should come with a test when the behavior can be tested without a real site.

- **Where tests live.** Unit tests are in `tests/unit/`. Name a file after the area it covers and end it with `.test.mjs`. The runner picks up every file with that ending. Use `node:test` and `node:assert/strict`, with no other test library.
- **Name tests by behavior.** A good name reads like a sentence: "a chat unticked before its turn is skipped, and a vanished chat is reported". Put the failure cases next to the happy path.
- **Unit-test environment.** `createEnv({ files })` in `tests/helpers/dom.mjs` loads the extension's classic scripts into a jsdom window with an in-memory fake of the `chrome.*` APIs (`fakeChrome`), so modules run without a browser. It is good for logic, state, label matching and the API engine. It is not a layout engine, so leave pixel and scroll behavior to the browser tests.
- **Browser tests.** `openScenario(siteId, options)` in `tests/helpers/scenario.mjs` launches Chromium with the extension and serves the fake site from `tests/fixtures/mock-site.mjs`. Options let a test make chosen chats fail, trigger a rate limit, switch to dark mode or a right-to-left page, and seed settings. Add to `tests/e2e/` only when the behavior needs a real browser. Wait for a condition, never for a fixed delay.
- **Keep tests deterministic.** No real network, no real accounts, no reliance on test order, and no data shared between tests. Create the data a test needs inside the test. Use made-up chat titles.

## Code style

- Follow [.editorconfig](../.editorconfig): UTF-8, LF line endings, two spaces for indentation.
- The extension is plain classic scripts that attach to one global, `ABCM`, in the order listed in `manifest.json`. Each file is an immediately invoked function that starts with `if (g.ABCM?.__skip) return;`. Keep that pattern. If you add a content script, add it to the manifest in the right place (the first must stay `namespace.js` and the last `main.js`).
- Call `chrome.*` through `ABCM.ext` so Chrome, Edge and Firefox behave the same.
- Keep the background worker free of DOM APIs. It is also loaded as a Firefox event page, so keep its script list in `scripts/build-firefox.mjs` (`BACKGROUND_SCRIPTS`) in step with the `importScripts` call at the top of `background.js`.
- Show page-derived text with `textContent` or text nodes. Do not use `innerHTML` with chat titles, links or translated strings.
- Keep names meaningful and consistent with nearby code. Keep functions short. Prefer a clear small change over a large rewrite.
- Comments should explain why, not what.

### Accessibility

Every interface change should work for people who use a keyboard, a screen reader, a high zoom level, or a right-to-left language.

- All actions work with the keyboard. Tab order follows the visual order.
- Focus is visible. When a dialog opens, focus moves into it, and the safe choice (Cancel) has it, never the destructive one. When it closes, focus returns to where it was.
- Buttons and fields have a text label or an `aria-label`. Icons that carry meaning have a text alternative.
- Text and controls have enough contrast in both the light and the dark theme.
- Layouts work in right-to-left languages (Persian and Arabic are included). Prefer logical CSS properties such as `margin-inline-start` over `margin-left`.

## When a site changes: selectors and labels

The sites' pages are not an API, so a redesign can break the extension. The parts most likely to need an update are small and live in two places:

- **`extension/src/shared/sites.js`** has one entry per site: the CSS selector for the chat links (`conversation`, `anchorMatch`), the pattern that reads a chat id out of a link (`idRe`), where the chat title is (`title`), and a list of candidates for the sidebar container (`history`, most specific first). Fix these first when checkboxes do not appear or Select all finds nothing.
- **`extension/src/content/config.js`** has the selectors used to drive a site's own menus and dialogs (`selectors`), the words that identify the **Delete** and **Archive** menu items and buttons in many interface languages (`labels`), and the paths of the sites' backend endpoints (`api`).

Rules for changing them:

- Describe what you saw in the real page in the pull request. Open the browser's developer tools on the site (with a test account) and say which element the selector now matches. Do not paste real chat titles.
- Keep label matching strict. A menu item is clicked only if its text, `aria-label` or `data-testid` matches a known word for that operation, and a confirm button must match the same word. Do not add words such as "remove", which would also match "Remove from project". There is a test for this. Add a case for any new look-alike you find.
- Prefer a more specific selector over a looser one. A looser selector can attach checkboxes to things that are not chats.
- If a site's backend endpoint changed, update `config.js` and `engines/api.js`, and keep the fallback: when a request fails, the extension must still be able to use the page's menus.
- Update `tests/fixtures/mock-site.mjs` so the fake page keeps the structure of the real one, and run the browser tests.

## Adding a site

Adding a new site changes the access the extension asks for (the browser shows a new permission prompt on update), so **open an issue and agree it with the maintainer before writing code.** If it is agreed, the pieces are:

1. `extension/manifest.json`: add the site's address to the `matches` of the content script.
2. `extension/src/shared/sites.js`: add an entry (`id`, `name`, `hosts`, `url`, `color`, the selectors, `method` and `archive`). `method` is `'api'` if the extension will call the site's backend first, or `'visual'` if it only clicks through the page. A unit test checks that the manifest matches and the registry agree.
3. `extension/src/content/config.js` and `extension/src/content/engines/api.js`: if the site has a usable backend, add its endpoints and an action. Otherwise the visual engine (`engines/visual.js`) is used. Check that the Delete and Archive words of the site's menu are in `labels`.
4. `scripts/validate.mjs`: add the host to `ALLOWED_HOSTS`.
5. `tests/fixtures/mock-site.mjs` and `tests/helpers/scenario.mjs`: add a fake page and start address, then write browser tests like the existing ones.
6. `docs/PRIVACY.md`, the user guide, the README and `CHANGELOG.md`: list the new site and any request it makes. The `scripts/build-firefox.mjs` host list is derived from the manifest, so Firefox needs no extra change.

## Adding or changing UI text

All interface text lives in translation files, and no sentence is built by joining pieces.

1. **English source: `extension/src/i18n/locales/en.json`.** A flat JSON object of `key: message`. Keys look like `panel.deleteN` or `result.retry`. English is the base for every language and is always loaded as the fallback, so a missing key in another language shows the English text.
2. **One file per language: `extension/src/i18n/locales/<code>.json`.** The same keys as English, with translated values.
3. **Browser-level strings: `extension/_locales/<code>/messages.json`.** The browser's own format with `message` fields. It holds only four strings that the browser reads directly: the extension name, its short description, the toolbar tooltip and the keyboard shortcut label.

How to add a string in code:

- Add the key and English text to `en.json`, then use it with `ABCM.i18n.t('your.key')` in scripts, or `data-i18n="your.key"` in HTML (and `data-i18n-attr="title:your.key"` for attributes).
- Add the key to every other language file as well, or the parity test fails. If you cannot translate it, copy the English text and say so in the pull request.
- Every key in `en.json` must be used by the code, and every key the code uses must exist in `en.json`. A test checks both directions.

### Placeholders and plurals

Variables are written with single braces: `{count}`, `{site}`, `{done}`. In every translation:

- Keep each placeholder exactly as written. Do not translate the name, and do not change the braces.
- Include every placeholder that the English text has. You may move them to fit the grammar of your language.
- Do not add placeholders that the English text does not have.

A message that depends on a number is an object of plural forms instead of a string, for example `{ "one": "{count} chat selected", "other": "{count} chats selected" }`. Each language needs the plural categories its grammar uses (for example Russian needs `one`, `few`, `many` and `other`; Arabic needs `zero`, `one`, `two`, `few`, `many` and `other`; Japanese and Chinese need only `other`). The test checks this with `Intl.PluralRules`.

## Translations

The interface is available in 11 languages: English, Persian (`fa`), Spanish (`es`), French (`fr`), German (`de`), Brazilian Portuguese (`pt-BR`), Russian (`ru`), Simplified Chinese (`zh-CN`), Japanese (`ja`), Arabic (`ar`) and Hindi (`hi`). Most translations have not been reviewed by native speakers, so careful human fixes are very valuable.

### Fix a wrong string

1. Find the string in `extension/src/i18n/locales/<code>.json`. Search for the English text in `en.json` to find the key, then look for the same key in your language file.
2. Change only the value. Keep the key, the `{placeholders}` and the plural structure unchanged.
3. Run `node scripts/test.mjs i18n` to make sure the file is still consistent with English.
4. Open a pull request. In the description, name the screen where you saw the string and say whether you are a native speaker.

If you would rather not edit files, open a [translation fix issue](https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/issues/new?template=translation_fix.yml) with the current text and your suggestion.

### Add a language

Please open an issue first so we can agree on the language code and avoid duplicate work. Then:

1. Create `extension/src/i18n/locales/<code>.json`. The easiest way is to copy `en.json` and replace every value with your translation. Keep the keys unchanged, including every `{placeholder}` and every plural form your language needs.
2. Create `extension/_locales/<code>/messages.json` by copying `extension/_locales/en/messages.json` and translating the `message` values. The folder name is the browser's format: `pt_BR` and `zh_CN` use an underscore. `app_description` can be at most 132 characters and `app_name` at most 45 (`validate.mjs` checks both).
3. Add the language to the `LANGUAGES` list in `extension/src/shared/i18n.js`: `code`, `name` (the language's own name, as its speakers write it) and `dir` (`'rtl'` for right-to-left languages, otherwise `'ltr'`).
4. Add the words your language uses for **Delete** and **Archive** in the menus of ChatGPT, Claude, Gemini and Grok to `labels` in `extension/src/content/config.js`. This is what lets the extension find the right menu item when the site is shown in your language. Some words are already there; check first.
5. Run `node scripts/validate.mjs` and `node scripts/test.mjs`.
6. Load the extension, choose your language in the Options page, and look at the popup, the panel, the confirmation dialog and the result screen. Check for text that is cut off, overlaps, or points the wrong way.
7. Open a pull request. The maintainer will update language counts in the docs.

### Quality bar

- Use the natural words that people use for chats, delete, archive and export in your language, and the words the sites themselves use.
- Keep the tone short and friendly, like the English text.
- Keep the same meaning. Do not add or drop warnings, especially in the delete and archive confirmation messages.
- Be consistent. Use one word for one idea across the whole interface.
- Keep product and site names (ChatGPT, Claude, Gemini, Grok), file formats (JSON, CSV, Markdown) and keyboard keys unchanged.
- Check long words in the narrow popup and the small panel.

### Native-speaker review

Say in the pull request which of these applies:

- "I am a native speaker of this language."
- "I am fluent but not a native speaker."
- "I used a translation tool and checked the result myself."

All three are welcome. If a second person who speaks the language can read the change, ask for their review in the pull request. The maintainer cannot judge every language, so a review by another speaker is the strongest signal.

### Thanks

Translators are credited in the release notes by name or username, unless you prefer not to be named. Tell us in the pull request if you want to stay anonymous. See [Recognition](#recognition).

## Privacy and permission changes

Discuss these in an issue **before** you write code:

- A new permission, a new site in the content script matches, or any change to what the extension can access.
- A new network request, or any change to who the extension talks to.
- A new storage key, or a change to what is stored.
- Anything that reads, copies or exports more of a page than the sidebar's chat titles and links.
- Anything that adds analytics, remote code or a third-party service.

Each of these affects user trust and store review. If the change is accepted, the same pull request must update [docs/PRIVACY.md](../docs/PRIVACY.md) and the docs.

## Commit and pull request checklist

The pull request template has the same list.

- [ ] The change is focused, and the description says why it is needed.
- [ ] The pull request links the related issue, for example "Fixes #123".
- [ ] `node scripts/validate.mjs` and `node scripts/test.mjs` pass.
- [ ] I added or updated a test for the change, or I explained why it cannot be tested.
- [ ] I tried the change in a real browser on the affected site, and described the steps I took.
- [ ] I tested a failure case, not only the happy path.
- [ ] Commit messages follow the Conventional Commits style.
- [ ] No new permissions, site matches, network requests or storage keys, or they were agreed in an issue first.
- [ ] Interface text comes from `en.json` (and every language file), and chat titles are shown as text, not HTML.
- [ ] The change works with the keyboard and in a right-to-left language.
- [ ] User-visible changes are noted in [CHANGELOG.md](../CHANGELOG.md) under the upcoming version.
- [ ] The docs and [docs/PRIVACY.md](../docs/PRIVACY.md) are updated if behavior or data handling changed.
- [ ] Screenshots, logs and test files contain no real chat titles or personal data.
- [ ] I wrote this change or I have the right to submit it (see [License and sign-off](#license-and-sign-off)).

## Reporting bugs well

A good report lets someone else see the problem in a few minutes. Include:

- the extension version (shown at the top of the Options page), your browser and its version, and your operating system,
- the site (ChatGPT, Claude, Gemini or Grok) and the action that failed,
- whether **Fast mode** was on (Options page, Behavior),
- what you expected and what happened, including the reason text the result screen showed for a failed chat,
- the smallest set of steps that shows the problem,
- the diagnostics from **Options, Privacy, Copy diagnostics**. They contain the version, browser, language and settings, and no chat titles or links,
- console errors, if any (see [Where to find console logs](#where-to-find-console-logs)).

Never post chat titles, chat links or conversation text in a public issue. The result screen's **Copy report** button copies the titles of failed chats, so remove them before you paste it.

## Security

Do not open a public issue for a security problem. Follow [SECURITY.md](SECURITY.md) and use GitHub's private vulnerability report. For general help, see [SUPPORT.md](SUPPORT.md).

## Recognition

Every person whose commits are merged into `main` is credited by GitHub in the repository's contributors list. That list needs your commits to be linked to your GitHub account, so check that your Git email address is added to your GitHub profile.

Work that does not always show up as commits is credited in the release notes. This includes translations, documentation, bug reports with good reproduction steps, and reviews. You are named by your name or GitHub username, unless you prefer not to be. Tell the maintainer in the issue or pull request.

## Maintainers and decisions

AI Bulk Chat Manager is maintained by [Ehsan Enaloo](https://github.com/ehsanenaloo). The maintainer makes the final decision on what is merged and what is not, using the [project principles](#project-principles) and the results of CI.

If you disagree with a decision, say so in the issue. Give your reasons and your use case, and listen to the reply. Please keep the discussion respectful and about the work, as the [Code of Conduct](CODE_OF_CONDUCT.md) asks. A "no" to a feature is not a judgment about you. Often it means the idea needs a permission or a service that this project does not want. You are always free to fork the project under the MIT License.

## Releases

Releases are made by the maintainer. The maintainer updates the version in `extension/manifest.json` and `package.json`, adds a section to `CHANGELOG.md`, and pushes a tag named `vX.Y.Z`. The [release workflow](workflows/release.yml) then:

1. runs `node scripts/validate.mjs` and the unit tests,
2. checks that the tag matches the version in `extension/manifest.json`,
3. builds both packages with `node scripts/build.mjs`: `ai-bulk-chat-manager-X.Y.Z.zip` (Chrome and Edge, with `manifest.json` at the zip root) and `ai-bulk-chat-manager-X.Y.Z-firefox.zip`, each with the `LICENSE` and a SHA-256 checksum,
4. creates a GitHub Release with both zips and both checksums attached, and uses the matching section of `CHANGELOG.md` as the notes.

Publishing to the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons is a separate manual step.

## License and sign-off

AI Bulk Chat Manager is released under the [MIT License](../LICENSE). When you contribute, your contribution is licensed under the same terms.

By opening a pull request, you confirm that you wrote the change yourself, or that you have the right to submit it under the MIT License. Do not copy code, text or images from sources that do not allow this. There is no sign-off tool and no `Signed-off-by` line is required.
