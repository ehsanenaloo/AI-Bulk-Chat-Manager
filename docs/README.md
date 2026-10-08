# AI Bulk Chat Manager user guide

This folder is the public user guide for AI Bulk Chat Manager. It is a static website, served by GitHub Pages at <https://ehsanenaloo.github.io/AI-Bulk-Chat-Manager/>. Start with [the overview](index.html) or [the guide library](guides/index.html).

It needs no build step and loads nothing from other websites: no fonts, scripts, analytics or images. Every page is complete without JavaScript. With JavaScript it adds site search, a light and dark theme switch, guide filtering and copy buttons.

## What is here

| Path | What it is |
| --- | --- |
| `index.html` | Home page: what the extension is, a three-step quick start, features, links |
| `guides/index.html` | The guide library, with a filter |
| `guides/*.html` | The guides (see the list below) |
| `privacy.html` | The privacy policy as a web page. Written by hand from `PRIVACY.md` |
| `PRIVACY.md` | The privacy policy source text (not part of the website) |
| `404.html` | The page GitHub Pages shows for an unknown address |
| `styles.css`, `app.js` | The only stylesheet and script. Colors follow `extension/src/shared/tokens.css` |
| `search-index.js` | The data behind the search box |
| `llms.txt` | A short summary and page list for language-model tools |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |
| `assets/` | Logo, screenshots, store images and `translations/` (README in Persian) |

## The guides

**Get started:** [Quick start](guides/quick-start.html), [Installation](guides/installation.html)

**Everyday use:** [Selecting chats](guides/selecting-chats.html), [Deleting and archiving](guides/deleting-and-archiving.html), [Exporting](guides/exporting.html)

**Reference:** [The toolbar popup](guides/popup-and-footer.html), [Settings reference](guides/settings-reference.html), [Languages and appearance](guides/languages-and-appearance.html), [Keyboard and shortcuts](guides/keyboard-and-shortcuts.html)

**Trust and support:** [Privacy and permissions](guides/privacy-and-permissions.html), [Privacy policy](privacy.html), [Troubleshooting and FAQ](guides/troubleshooting-faq.html), [Limits](guides/limits.html), [Reporting a problem](guides/reporting-a-problem.html)

## Preview locally

Opening `docs/index.html` straight from disk works, because every link is relative. To see it the way GitHub Pages serves it, run a small server from the repository root. With Node.js:

```sh
node -e "const h=require('http'),f=require('fs'),p=require('path');const r=p.resolve('docs');const t={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain'};h.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const x=p.join(r,u);if(!x.startsWith(r)||!f.existsSync(x)||f.statSync(x).isDirectory()){s.writeHead(404,{'content-type':'text/html'});return s.end(f.readFileSync(p.join(r,'404.html')))}s.writeHead(200,{'content-type':t[p.extname(x)]||'application/octet-stream'});s.end(f.readFileSync(x))}).listen(8766,'127.0.0.1',()=>console.log('http://127.0.0.1:8766/'))"
```

Or, if you have `npx`: `npx serve docs`. Open <http://127.0.0.1:8766/> and stop the server with Ctrl+C.

## Add or change a guide

1. Copy an existing page in `guides/`, for example `guides/exporting.html`, to a new file name. Keep the header, sidebar, footer and `data-root="../"` as they are.
2. Change the `<title>`, the `meta description`, the heading, the lead paragraph and the body. Give each `<h2>` an `id` and add it to the "On this page" list.
3. Add the page to the sidebar of every guide, to the card list in `guides/index.html`, and set the previous and next links of its neighbors.
4. Add an entry to `search-index.js` (title `t`, address `u`, description `d`, headings `h`, plain text `x`) and a line to `llms.txt`.
5. Update the "Last updated" date on every page you change.
6. Open the page in a browser and check the links, with JavaScript on and off.

Rules for the text:

- Name buttons and messages exactly as the extension shows them, in **bold**. The English labels are in `extension/src/i18n/locales/en.json`.
- Write for people who are not developers: short sentences, steps that start with a verb, no marketing words, no emoji.
- Say what is not known. If a statement cannot be traced to the code or to `technical-docs/`, do not publish it.
- Do not use logos or styling of ChatGPT, Claude, Gemini or Grok. Mention them as plain text and keep the independence notice in the footer.

## Keep `privacy.html` in sync

`privacy.html` is the web version of `PRIVACY.md`. Whenever `PRIVACY.md` changes, update `privacy.html`, its entry in `search-index.js` and its dates in the same pull request. The friendlier summary in `guides/privacy-and-permissions.html` must agree with both.

## After each release

Check these against the new version, and update the version and date in the footer of each page:

- the labels in bold against `en.json`;
- the settings and defaults in [Settings reference](guides/settings-reference.html);
- the supported sites and the warning in [Limits](guides/limits.html), which says what was and was not checked against the real sites.

The prose, HTML, CSS and JavaScript in this folder were written for this project. The logo in `assets/logo.svg` is the extension icon. The screenshots in `assets/screenshots/` show the extension with made-up chat titles.
