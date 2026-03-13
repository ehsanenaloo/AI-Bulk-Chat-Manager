# Contributing

## Development rules
- Do not change the delete/archive core casually. That is the fragile part.
- Prefer improving UX, logging, and safety around the working core.
- Keep the extension local-only. Do not add tracking, payments, remote calls, or identity hooks.

## Local testing
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder
5. Test on `https://chatgpt.com/` or `https://chat.openai.com/`

## Release checklist
- Update `manifest.json` version.
- Test add/remove/toggle/invert/select visible.
- Test auto attach on scroll.
- Test bulk archive and bulk delete on 1-2 chats first.
- Zip the repository contents, not a parent folder with duplicates.
