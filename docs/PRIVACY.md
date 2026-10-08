# Privacy Policy

**AI Bulk Chat Manager** (the "extension")
Last updated: 2026-10-08

AI Bulk Chat Manager is a browser extension for Chrome, Edge and Firefox. It lets you select many chats at once on ChatGPT, Claude, Gemini and Grok, and then delete, archive or export them. This policy explains what the extension reads, what it stores, and what leaves your device. The short version: **the extension has no server, collects nothing about you, and sends no data to its author or to any third party.**

## Summary

- The extension does not collect, transmit, sell or share personal data.
- There is no account, sign-in, analytics, telemetry, advertising or crash reporting.
- It never reads the text of your conversations. It only reads the chat list in each site's sidebar (the titles and links of your chats), and only while you are selecting chats.
- Only two things are stored, in your browser: your settings, and a small timer for the monthly support reminder.
- When you delete or archive chats, the extension asks the site you are on to do it. The request goes to that site, using the session you are already signed in with, and nowhere else.
- It works only on `chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com` and `grok.com`.

## How it works

The extension runs in your browser. A content script is loaded on the five sites above. It does nothing visible until you click the extension icon (or use the keyboard shortcut) and choose to start selecting chats. The only exception is an optional launcher button, which is off by default and which you can turn on in the Options page. Once you start selecting, the extension:

1. looks at the chat list in the site's sidebar and puts a checkbox next to each chat,
2. shows a small panel with your selection and the actions Export, Archive and Delete,
3. when you confirm Delete or Archive, performs the action for the chats you selected.

Chat titles and links are held in the page's memory while you are selecting, so the panel can list and count them. They are not saved to disk, are not sent anywhere and are forgotten when you finish selecting or close the page. The extension shows them as plain text and never as HTML.

## What the extension can access

| Data | Why | Where it goes |
| --- | --- | --- |
| The chat list in the site's sidebar: each chat's title, link and id | To add checkboxes, show your selection, and tell the site which chats to delete or archive | Kept in the page's memory only while you are selecting. Not stored. Not transmitted to the author or any third party. |
| The address and tab of the page you are on | To know whether the current tab is one of the supported sites, and to start the panel there | Used on your device. Not transmitted. |
| Your settings | To remember your choices | Browser extension storage on your device (see "What is stored"). |
| The clipboard (write only) | To copy the failure report or the diagnostics when you click the Copy button | Written to your clipboard on your click. The extension never reads your clipboard. |

The extension does not read the messages or the content of any conversation, your account details, your payment details or your cookies. It does not read pages other than the five supported sites.

## What is stored

The extension stores two small items in `storage.local`, the browser's local extension storage on your device. It does not use browser sync storage, so the extension itself does not copy this data to your other devices.

1. **`settings`**: your choices in the Options page and the panel: interface language, theme, accent color, Fast mode on or off, whether to add checkboxes as you scroll, the extra-confirmation threshold (a number), whether the launcher button is shown, and the position where you last dragged the panel (two numbers). It contains no chat titles, links or account information.
2. **`supportNudge`**: the timer for the monthly support reminder (see below): the time of installation, the time the reminder was last shown, how many times it was shown, and whether you chose "Don't show again".

Versions before 9.0.0 stored the Fast mode choice under a single key named `fastApiMode`. If it exists, the extension reads it once to carry your choice over to `settings`.

Nothing else is stored. In particular, the extension does not keep a history of your chats, your selections, your deletions, export files or logs.

## What the extension sends over the network

The extension has no server of its own and makes no requests to its author or to any third party. Its translations and style files are packaged inside it and are read from the extension itself.

The only network requests it causes are the following. They happen only after you have selected chats and confirmed **Delete** or **Archive**. They are sent from the chat page to the same site, using the session you are already signed in with (the same way the site's own buttons work). They contain no chat titles. The ones that change a chat contain only that chat's id and, for ChatGPT, a short flag saying "hidden" or "archived":

- **ChatGPT**: a request to `/api/auth/session` to obtain the short-lived access token that the site's own page uses, kept in the page's memory for up to five minutes and never stored; then a `PATCH` request to `/backend-api/conversation/<chat id>` to hide (delete) or archive the chat.
- **Claude**: a request to `/api/organizations` to find your organization id, then a `DELETE` request to `/api/organizations/<organization id>/chat_conversations/<chat id>`. Claude has no archive in this extension.
- **Grok**: a `DELETE` request to `/rest/app-chat/conversations/<chat id>`. Grok has no archive in this extension.
- **Gemini**: none. Deleting on Gemini is done by clicking through the page's own menu and confirmation dialog, as a person would.

These are the sites' own internal endpoints, which are not public or documented, and they can change without notice. This is **Fast mode**, which is on by default. You can turn it off in the Options page (Behavior) or in the panel's settings. With Fast mode off, or when a request fails, the extension performs the action by clicking through the site's own menus and dialogs instead, one chat at a time, and no extra request is made.

The sites' own privacy policies apply to what they do with these requests and with your data. For example, how long ChatGPT, Claude, Gemini or Grok keep a deleted or archived chat is decided by that site, not by the extension.

Two more things use the network, but not on the extension's initiative:

- **Links you choose to open.** The popup and the Options page contain links to this project's user guide, its GitHub page, the privacy policy, the developer's website (www.enaloo.com), a donation page (Buy Me a Coffee) and the page where you can rate the extension in your browser's store. They open in a new tab only when you click them. Those websites have their own privacy policies.
- **Your browser's update service.** Like all store extensions, your browser checks for new versions itself. That is a browser feature, not the extension's.

## Exporting

Export creates a file from the chats you selected, in JSON, CSV or Markdown format, and your browser saves it to your downloads folder. The file is created on your device and is not uploaded anywhere. It contains each selected chat's title, full link and id, and the site's name and the time of the export. It does not contain any conversation text. Because titles and links can be private, review the file before you share it.

## Copy report and Copy diagnostics

- **Copy report** (on the result screen after a failed run) puts the titles of the chats that failed and the reason for each on your clipboard, when you click it. It contains chat titles, so look at it before you paste it somewhere public.
- **Copy diagnostics** (Options, Privacy) puts the extension version, your browser name and user-agent string, the interface language and your settings on your clipboard, when you click it. It contains no chat titles, links or page content. It is meant for bug reports.

Neither is sent anywhere by the extension.

## Permissions and why each is needed

| Permission | Why it is needed |
| --- | --- |
| `storage` | To keep your settings and the support-reminder timer in the browser's local extension storage. |
| `activeTab` | So that when you click the toolbar icon or use the keyboard shortcut, the extension can work with the tab you are on. |
| `scripting` | To load the extension's own scripts into a chat tab that was already open before the extension was installed or updated, so you do not have to reload it. Only the extension's packaged files are injected. |
| Access to the five sites (`chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`, `grok.com`) | Through the extension's content script matches. This is what lets the extension add checkboxes to the chat list and send the delete or archive request on those sites. The browser may describe it as "Read and change your data on" those sites. The extension uses it only as described in this policy. In Firefox the same five sites are declared as host permissions and are requested when you install. |
| Keyboard shortcut (`Alt+Shift+B` by default) | Not a permission. It opens or closes the panel on the supported sites. You can change it in your browser's shortcut settings. |

The extension does not request access to your browsing history, bookmarks, downloads, cookies, tabs list or any other website. It does not use `web_accessible_resources`, so sites cannot detect it through its files.

## Monthly support reminder

AI Bulk Chat Manager is free and has no ads. About two weeks after you install it, and then at most once every 30 days, the extension shows a small heart on its toolbar icon and, when you open the popup, a short note with links to Buy Me a Coffee and to rate the extension. It only ever stores the timer described above, on your device. You can dismiss it with "Not now" or turn it off for good with "Don't show again". Nothing is sent when it is shown. The links open a third-party website only when you click them.

## Third parties

There are none. The extension has no analytics, advertising or crash-reporting service, and it loads no remote code, fonts or images. The interface icons are packaged in the extension; they come from the open-source [Lucide](https://lucide.dev) project (see [THIRD_PARTY_NOTICES.md](../extension/THIRD_PARTY_NOTICES.md)).

The extension is an independent project. It is not affiliated with, endorsed by or sponsored by OpenAI, Anthropic, Google or xAI.

## Chrome Web Store Limited Use

The use of information received from browser APIs and the supported sites adheres to the Chrome Web Store [User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Chat titles and links are used only to provide the user-facing features described above, are not transferred to anyone, are not sold, are not used for advertising or to judge creditworthiness, and are not read by humans.

## Firefox

The Firefox build works the same way and keeps its data in Firefox's local extension storage. Its manifest declares that it collects no data (`data_collection_permissions`: none).

## Removing your data

- **Settings:** Options, Privacy, **Reset settings** removes the `settings` item and restores the defaults.
- **Everything:** uninstall the extension. The browser then deletes its storage. You can also clear the extension's data from your browser's extension settings.
- **Chats you deleted or archived:** these changes were made on the site. The extension cannot undo them. Deleted chats generally cannot be restored; archived ChatGPT chats can be found in ChatGPT's own archive.
- **Export files:** files you exported are in your downloads folder. Delete them yourself.
- **The author holds no copy of anything**, so there is nothing to request from or delete at the author's end.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Open source

The full source code is public at <https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager>, under the MIT License, so that every statement above can be checked.

## Changes to this policy

If the extension's data practices change, this file will be updated in the same release and the change recorded in [CHANGELOG.md](../CHANGELOG.md). The "Last updated" date above will change.

## Contact

Questions or concerns about privacy: open an issue at <https://github.com/ehsanenaloo/AI-Bulk-Chat-Manager/issues>, and do not include personal data. For anything sensitive, use the private reporting process in [SECURITY.md](../.github/SECURITY.md).
