# Changelog

All notable changes to AI Bulk Chat Manager are listed here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [9.0.0] - 2026-10-08

Version 9.0.0 is a full rebuild. The extension still does the same job (select many chats on ChatGPT, Claude, Gemini and Grok, then delete, archive or export them), but nearly all of the code, the interface and the safety checks were rewritten, and it now also runs in Edge and Firefox. The permissions did not change: `activeTab`, `scripting` and `storage`, plus the same five sites.

### Added

- **A floating panel inside the chat page.** Selecting, exporting, archiving and deleting now happen in a panel on the page itself, so you can see the real chat list while you work. It can be dragged (it remembers where you left it), minimized and closed, follows your light or dark theme and your accent color, works with the keyboard and in right-to-left languages, and keeps its own styles apart from the site's.
- **More ways to select.** Click a chat row or its checkbox, Shift-click for a range, Select all, Clear, Invert, select or unselect by part of a title, and select or unselect the oldest N chats. A live count shows how many chats are selected and how many are shown.
- **Load all older chats.** The sites only load part of your history until you scroll. One click scrolls the sidebar until nothing new arrives, so Select all can reach every chat. It scrolls the list only, puts it back where it was, shows progress, and can be stopped.
- **A confirmation dialog that lists what will change.** It names the site, lists the selected chats (with a search box when there are more than eight), and puts focus on Cancel, never on the destructive button. When you delete more chats than a threshold (20 by default, 1 to 500 in the Options page), you must also tick a box to confirm.
- **Live progress and a result screen.** A progress bar and the chat being worked on, a Stop button, and a final summary. If some chats fail, the summary lists each one with a plain-language reason, keeps them selected, and offers **Retry failed** and **Copy report**.
- **Export as JSON, CSV or Markdown.** Exported chats now carry their full, absolute links (version 8 exported the link as the page wrote it, which is a relative path). CSV starts with a byte order mark so Excel reads non-Latin titles correctly, and titles that begin with `=`, `+`, `-` or `@` are protected from being run as spreadsheet formulas. Markdown output escapes titles. Files are named `ai-chats-<site>-<date and time>.<format>`.
- **A new toolbar popup.** It shows whether the current tab is one of the supported sites and starts or ends selecting there, with the two quick switches (Fast mode and "Add checkboxes as you scroll"). On other pages it lists the four sites and opens them. The rotating About, GitHub, Rate and Support footer from version 8 is kept.
- **A new Options page.** Language, theme (system, light, dark), accent color, Fast mode, checkboxes as you scroll, the extra-confirmation threshold, an optional launcher button, the keyboard shortcut, a privacy summary, **Copy diagnostics** for bug reports (it contains no chat titles or links) and **Reset settings**.
- **A keyboard shortcut.** `Alt+Shift+B` opens or closes the panel on a supported site. It can be changed in the browser's shortcut settings.
- **An optional launcher button** in the corner of the chat pages that opens the panel. It is off by default.
- **11 interface languages:** English, Persian, Spanish, French, German, Brazilian Portuguese, Russian, Simplified Chinese, Japanese, Arabic and Hindi, with plural forms and right-to-left layout. The language follows the browser unless you choose one.
- **Firefox support** (Firefox 140 or newer, desktop). `scripts/build-firefox.mjs` generates the Firefox package from the same files: an event-page background instead of a service worker, the add-on id, and a declaration that no data is collected.
- **Microsoft Edge** uses the Chrome and Edge package.
- **Tests and tooling.** Unit tests (jsdom) cover selection, label matching, the API engine, the bulk runner, export, settings and translations. Browser tests drive a real Chromium against a fake ChatGPT, Claude, Gemini and Grok page, including failures, rate limits, Stop and right-to-left pages. `scripts/validate.mjs` checks the manifest, the permission list, file references, syntax, locale files, banned patterns and the repository layout. `scripts/build.mjs` builds both release zips with checksums.
- **Repository files:** issue forms (including one for "a supported site changed"), a pull request template, contributing guide, code of conduct, security policy, support guide, a privacy policy, third-party notices, and workflows for CI, releases and the guide site.

### Changed

- **Stricter matching of menu items and buttons, so the wrong one is never clicked.** When the extension has to use the site's own menus, it clicks an item only if its text, label or test id matches a known word for the action (Delete or Archive, with word lists for more than two dozen interface languages). An exact match beats a partial one, short Latin words must match as whole words, and an item such as "Remove from project" can never be chosen for Delete. The button in the confirmation dialog must match the same word, so Cancel and unknown buttons are never clicked.
- **A chat's own controls only.** The "..." button is looked up inside that chat's own row, never in the whole sidebar, so a button belonging to a neighbouring chat cannot be pressed by mistake.
- **A delete through the page's menus counts as done only when it really is.** The confirmation dialog must close and the chat must have left the list. If the chat is still there, it is reported as failed ("The chat was still in the list after deleting") and stays selected. Gemini's delete is checked the same way.
- **Fast mode follows one rule on every site that has a backend.** ChatGPT, Claude and Grok are asked directly first (Gemini has no usable endpoint and always uses its menus). If a request fails, or Fast mode is off, that chat is done through the page's menus instead. Before, Claude and Grok ignored the switch. Requests run three at a time at least 250 ms apart, a rate limit (HTTP 429) pauses every worker and retries the chat once, and the page-menu phase always runs one chat at a time so two chats can never fight over one menu.
- **Session handling in Fast mode.** For ChatGPT, the extension asks the site for its short-lived access token once at the start of a run (kept in memory for five minutes, never stored) and fetches a fresh one if the site answers 401 or 403. Claude refreshes its cached organization once if the site rejects it. Grok stops using the fast path for the rest of the page's life after a 404 or 405.
- **Failed and unfinished chats stay selected.** After an error, a Stop or a mid-run change, only the chats that were done are deselected, so you can retry the rest. A chat you untick during a run is skipped. Stop lets the request in flight finish and starts no more.
- **Archive is offered on ChatGPT only.** Claude, Gemini and Grok have no archive in the extension, and the button is hidden there.
- **Checkboxes no longer rearrange the site's page.** One checkbox is added inside each chat link, using padding reserved at the start of the row. The site's own elements are never moved, and finished rows are hidden rather than removed, which avoids errors when the site next redraws its list. If the site redraws a row, the checkbox is re-attached and the selection survives. While you select, a click on the row ticks it instead of opening the chat.
- **Chats added while you scroll get checkboxes automatically** (setting: "Add checkboxes as you scroll"), and the extension notices when the site replaces the whole sidebar.
- **Chat tabs that were already open work after an install or update** without a reload: the popup and the shortcut load the extension's scripts into the tab when needed. Leftovers of an older or orphaned copy (the version 8 checkboxes and attributes) are cleaned up.
- **Settings are stored in one validated `settings` object.** Damaged or old values are repaired instead of breaking the interface, and the version 8 Fast mode choice is carried over.
- **The code was reorganized** into small files that share one `ABCM` namespace, with no build step, and the site selectors in one table (`extension/src/shared/sites.js`) so that a site change is a small fix. The `extension/` folder is the extension exactly as it ships.
- **The manifest has no `key` or `update_url`.** The stores assign these. An unpacked copy therefore has a different extension id from a store install and the two can be installed side by side.
- **Release packages** are built by the same script locally and in the release workflow: `ai-bulk-chat-manager-<version>.zip` for Chrome and Edge, `ai-bulk-chat-manager-<version>-firefox.zip` for Firefox, each with `LICENSE`, `THIRD_PARTY_NOTICES.md` and a SHA-256 file.

### Removed

- The popup's Actions, Select, Tools, Logs and Help tabs, the single-letter shortcuts inside the popup, the Show/Hide checkboxes toggle and the operation log. Their jobs moved to the in-page panel and its result screen, which lists failures with reasons.
- The separate "preview" window, replaced by the confirmation dialog.

### Security and privacy

- Chat titles and links from the page are shown as text only. The code never builds HTML from them, and `scripts/validate.mjs` fails the build on `innerHTML`, `eval`, inline scripts or remote code.
- The extension has no `host_permissions` in Chrome and Edge, no `web_accessible_resources` and no custom content security policy. Its background worker serves only its own translation and style files to the page, and requests to the site's backend always go to the page's own address, even if the page sets a `<base>` tag. Only real user input can drive the panel and the checkboxes: clicks and keys that a script on the site dispatches are ignored.
- The only data stored is the `settings` object and the small `supportNudge` timer. See [docs/PRIVACY.md](docs/PRIVACY.md) for the full, plain-language policy.

## Versions after 6.9.0, up to 8.10.6 (not itemized)

These versions were developed without a public changelog, so there is no per-version list. The last release before the rebuild (8.10.6) was a popup-based tool. From its source: tabs for Actions, Select, Tools, Logs and Help; Add Checkboxes, Select Visible, Clear, Invert and Show/Hide; select by part of a title or the oldest N chats; Delete on ChatGPT, Claude, Gemini and Grok and Archive on ChatGPT, each behind a preview; a Fast API mode; adding checkboxes automatically as you scroll; JSON and CSV export of the selected chats; an operation log; theme and accent color; the rotating footer; and a support reminder at most once a month.

## [6.9.0] - 2026-03-12

### Added

- A live operation log inside the popup, with Copy log and Clear log actions.
- New 16, 48 and 128 pixel icons.
- Copyright headers and the MIT license.

### Changed

- The package was cleaned up for publishing on GitHub.
- The working delete and archive code was left unchanged.

[Unreleased]: https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/compare/v9.0.0...HEAD
[9.0.0]: https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/releases/tag/v9.0.0
