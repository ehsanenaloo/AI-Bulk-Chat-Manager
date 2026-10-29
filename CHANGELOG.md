# Changelog

All notable changes to AI Bulk Chat Manager are listed here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [9.1.0] - 2026-10-29

### Changed

- The Support button and the monthly support note now open the support page at enaloo.com, and their text no longer mentions coffee.

### Fixed

- A chat that could not be confirmed (the site timed out, the connection dropped, or the chat stayed in the list) is no longer counted as done. It is deselected and listed as not confirmed, so it is not repeated by mistake. Retry only repeats chats that failed for sure.
- Archive no longer reports success when the chat is still in the list.
- A server error or a lost connection no longer makes the extension try the same chat a second time through the page menus.
- Stop now also stops chats that were waiting for their turn or for a rate limit to end.
- Requests to the site now time out instead of waiting forever.
- After a rate limit the extension waits as long as the site asks, and gives up on a chat after a few tries.
- On Claude accounts with several organizations, the extension uses the organization you are working in.
- The extension only clicks a menu or dialog that it opened itself.
- A chat counts as deleted only if it is gone from the list and does not come back.
- Load all older chats now says when the list may not be complete, when it was stopped, and when the site hides older rows so they cannot be selected.
- Delete now checks the confirmation window that it clicked, not any window on the page, and does not click twice when the first click may have worked.
- Changing two settings at the same time no longer loses one of them. If saving is too slow, it reports a failure instead of writing twice.

### Added

- A welcome page opens once in a background tab after a fresh install.
- A short survey page opens after you remove the extension.
- The Options page has links to report a problem and to suggest a feature.
- The confirmation dialog has a tick box for every chat, so you can leave single chats out before you confirm.
- After a run, Report (JSON) and Report (CSV) save the result of every chat.
- After a run, Check again looks at the chat list for chats that were not confirmed and tells you which are no longer listed, which are still listed and which could not be checked. It does not ask the site and does not select anything.
- Reports say how each finished chat was confirmed and what Check again saw.
- After archiving on ChatGPT, Undo archive restores the archived chats.

## [9.0.1] - 2026-10-12

### Changed

- The links to rate the extension and to install it now open the Edge Add-ons and Firefox Add-ons pages.
- The guide link now opens the user guide at enaloo.com.

### Fixed

- The monthly support note now opens as a dialog over the popup. Before, it opened inside the popup and pushed the other content out of place.

## [9.0.0] - 2026-10-08

Version 9.0.0 is a full rebuild. It does the same job (select many chats on ChatGPT, Claude, Gemini and Grok, then delete, archive or export them), and it now also runs in Edge and Firefox. The permissions are the same: `activeTab`, `scripting` and `storage`, on the same five sites.

### Added

- A floating panel inside the chat page. You select, export, archive and delete there, next to the real chat list. You can drag it, minimize it and close it. It follows your light or dark theme and accent color.
- More ways to select: click a row, Shift-click a range, Select all, Clear, Invert, match part of a title, or pick the oldest N chats. A live count shows how many are selected.
- "Load all older chats" scrolls the sidebar until your whole history is loaded, so Select all can reach every chat. You can stop it at any time.
- A confirmation dialog that lists the chats that will change. The focus starts on Cancel. Large deletes (over 20 chats by default, adjustable from 1 to 500) need an extra tick.
- Live progress, a Stop button and a result summary. Chats that fail stay selected with a short reason, and you can use **Retry failed** or **Copy report**.
- Export as JSON, CSV or Markdown. Files contain full links, work in Excel with non-Latin titles, and protect titles that start with `=`, `+`, `-` or `@`.
- A new toolbar popup and a new Options page (language, theme, accent color, Fast mode, confirmation threshold, optional launcher button, **Copy diagnostics**, **Reset settings**).
- The shortcut `Alt+Shift+B` opens or closes the panel. You can change it in the browser's shortcut settings.
- 11 interface languages: English, Persian, Spanish, French, German, Brazilian Portuguese, Russian, Simplified Chinese, Japanese, Arabic and Hindi, with right-to-left layouts.
- Firefox support (desktop, version 140 or newer). Edge uses the Chrome package.
- Release packages: `ai-bulk-chat-manager-<version>.zip` for Chrome and Edge and `ai-bulk-chat-manager-<version>-firefox.zip` for Firefox, each with a SHA-256 file.

### Changed

- Menu items and buttons are chosen by their text, never by position. An item such as "Remove from project" can never be picked for Delete, and the dialog button must match too.
- A chat's "..." button is searched only inside that chat's own row.
- A delete counts as done only when the chat has really left the list. Otherwise it is reported as failed and stays selected.
- Fast mode works the same way on every site that supports it: the site is asked directly first, and the page's own menus are used if that fails or if Fast mode is off. Before, Claude and Grok ignored the switch.
- Failed and unfinished chats stay selected after an error or Stop, so you can retry them.
- Archive is offered on ChatGPT only, because the other sites have no archive.
- Checkboxes no longer change the layout of the site. New chats get checkboxes as you scroll, and the selection survives when the site redraws the list.
- Chat tabs that were already open work after an install or update without a reload.
- Settings are validated, and damaged values are repaired. The Fast mode choice from version 8 is kept.
- The manifest has no `key` or `update_url`, because the stores set them. An unpacked copy has a different extension id from a store install.

### Removed

- The old popup tabs (Actions, Select, Tools, Logs, Help), the in-popup single-letter shortcuts, the operation log and the separate preview window. The in-page panel and the confirmation dialog replace them.

### Security

- Chat titles and links from the page are shown as text only, never as HTML.
- No `host_permissions` on Chrome and Edge, no `web_accessible_resources`, no remote code.
- Clicks and keys sent by scripts on the website are ignored by the panel, so a page cannot confirm a delete for you.
- Requests to a site always go to that site's own address.
- The only data stored is your settings and a small reminder timer. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Versions after 6.9.0, up to 8.10.6 (not itemized)

These versions were published without a changelog. The last one, 8.10.6, was a popup-based tool with Delete on four sites, Archive on ChatGPT, a preview before each action, a Fast mode, automatic checkboxes while scrolling, JSON and CSV export, an operation log, themes and a support reminder at most once a month.

## [6.9.0] - 2026-03-12

### Added

- A live operation log in the popup, with Copy log and Clear log.
- New 16, 48 and 128 pixel icons.
- The MIT license.

[Unreleased]: https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/compare/v9.1.0...HEAD
[9.1.0]: https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/compare/v9.0.1...v9.1.0
[9.0.1]: https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/compare/v9.0.0...v9.0.1
[9.0.0]: https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/releases/tag/v9.0.0
