<!-- Copyright (c) 2026 Ehsan Enaloo. Released under the MIT License. -->
# ChatGPT Bulk Tools Clean+

A local-only Chrome extension for bulk-selecting, archiving, and deleting ChatGPT conversations.

## What it does
- Adds checkboxes to visible conversations
- Supports select visible, invert, clear, oldest-visible selection, and title filtering
- Supports dry-run preview before bulk actions
- Supports auto-attach on scroll for newly loaded sidebar rows
- Keeps the fast working delete/archive core from the original UI workflow
- Shows a live operation log inside the popup
- Exports selected rows to JSON or CSV

## Privacy model
This build is local-only:
- no tracking
- no payment checks
- no remote calls
- no `chrome.identity`

## Install
1. Download or clone this repository.
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this project folder

## GitHub release packaging
To publish a release zip:
1. Make sure `manifest.json` has the right version.
2. Zip the repository contents.
3. Do **not** include parent folders with duplicate old versions.

## License
MIT. See `LICENSE`.
