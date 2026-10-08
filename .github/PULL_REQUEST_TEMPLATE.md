## Summary

<!-- What does this change and why? Keep it to one topic. -->

## Related issue

<!-- For example "Fixes #123". For a small typo or fix, write "None". -->

## Type of change

- [ ] Bug fix
- [ ] Site selectors or labels updated after a site changed
- [ ] New feature
- [ ] Translation
- [ ] Documentation
- [ ] Maintenance or CI

## How I tested it

<!-- Browser and version, the site you tried, steps you followed, what you saw, and one failure case you tried.
Use a test account or the mock site in the browser tests, and never paste real chat titles.
Say what you ran, such as `node scripts/test.mjs`, and what you tried by hand. -->

## Screenshots (no real chat titles)

<!-- Optional. Add before and after images for visible changes. Crop out the chat list. -->

## Translations only

<!-- Language and screens checked. Say whether you are a native speaker, fluent, or used a tool and checked it yourself. -->

## Checklist

- [ ] `node scripts/validate.mjs` and `node scripts/test.mjs` pass
- [ ] I added or updated a test, or I explained why the change cannot be tested
- [ ] The change is focused and does one thing
- [ ] I tried the change in a real browser on the affected site, including a failure case (or I explained why not)
- [ ] Commit messages follow the Conventional Commits style
- [ ] No new permissions, site matches, network requests or storage keys (or they were agreed in an issue first)
- [ ] Interface text uses `t()` with a key from `en.json`, and chat titles are shown as text, not HTML
- [ ] The change works with the keyboard and in a right-to-left language
- [ ] User-visible changes are recorded in `CHANGELOG.md`
- [ ] `docs/PRIVACY.md` and the docs are updated if behavior or data handling changed
- [ ] Screenshots, logs and test files contain no real chat titles or personal data
- [ ] I wrote this change or I have the right to submit it under the MIT License
