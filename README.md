# Sakugo Studio

An anime theme for [qoj.ac](https://qoj.ac), [cses.fi](https://cses.fi) and [oj.uz](https://oj.uz), for Firefox. Not affiliated with any of them.

- **Anime scenes under glass.** Every page sits on frosted glass above one of the bundled anime scenes, or any picture you give it. Glass opacity is solved from the picture, so handles and statements stay readable at any visibility up to 100%; past that the glass thins further on request.
- **Three styles.** Glass, Manga (one spot colour on tinted paper) and Battle Poster (everything on the diagonal).
- **Four views of a problem.** Cinema, Reader, Split (statement beside the submit form) and Classic.
- **PDF statements as real text.** QOJ's PDF statements become selectable text with typeset math, sample blocks with Copy buttons, rebuilt tables and inked figures. Text, inked PDF pages and the original PDF are one click apart.
- **Cutscenes.** A title card when a problem opens, a broadcast while the judge runs (with a bar that stays on screen if you click away), a different scene for each verdict. All skippable, off during live contests by default.
- **Fully editable.** Scenes per difficulty, glass, colours, fonts, every word on screen, every sound (replace any of them with your own file), particles, layout, your own CSS. Themes save to a file.

## Try it

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. **Load Temporary Add-on**, and pick `manifest.json` in this folder.
3. Open qoj.ac. The Studio is behind the toolbar button.

## Layout

| Path | What |
| --- | --- |
| `src/content/` | Runs on the sites: theme, statements, cutscenes. `pages.js` and `watch.js` are QOJ's page rebuilds and submission watcher; `sites.js` is what `cses.js` and `ojuz.js` share |
| `src/bg/` | PDF conversion (pdf.js in a real worker) and sound playback |
| `src/shared/` | Settings, the glass solver, the sound synth, scene data |
| `src/studio/`, `src/popup/` | The editor and the toolbar popup |
| `scenes/`, `fonts/`, `icons/` | Bundled art and subsetted fonts |
| `vendor/pdfjs/` | Unmodified pdf.js build from the `pdfjs-dist` npm package |
| `tools/` | How the bundled files were made. Not part of the package |

## Rebuilding bundled files

Requires Python 3 with numpy, Pillow, fonttools and brotli.

```sh
python3 tools/art/horde.py <folder> <jobs.json>             # generates scene art, recording prompt, model and seed
python3 tools/art/finish.py <art folder> .                  # builds what tools/art/catalog.json lists: crops, frosts, analyses, writes scenes.js and credits
python3 tools/build_fonts.py <folder of source .ttf> fonts  # subsets the fonts
python3 tools/pack.py                                       # writes dist/sakugo-studio-<version>.xpi
```

## Notes for add-on review

- Permissions: `storage` and `unlimitedStorage` hold settings, the user's own pictures and sounds, and converted statements. The hosts are `https://qoj.ac/*`, `https://cses.fi/*`, `https://oj.uz/*`, and `https://static.oj.uz/*`, where oj.uz keeps statement PDFs.
- Network: requests only to the site being viewed, made with the user's own login, plus statement PDFs from static.oj.uz, and nothing else. On QOJ: No analytics, no remote code, no data leaves the browser.
  - the statement PDF of the problem being viewed, once, then cached
  - `/problems?search=` once per newly opened problem, for its solve count (can be switched off)
  - the top of `/contests` at most every 30 minutes, and `/` at most every 12 hours
  - `/submission-status-details` every 2 seconds, only while the user's own submission is being judged
  - on CSES: the problem list at most once a day, and the result page every 2 seconds while a run is judged
  - on oj.uz: the submission page every 6 seconds while a run is judged
- Third-party code: pdf.js 6.5.438 (Apache-2.0), files unchanged from the npm package. Fonts are under the SIL OFL, see `LICENSES/`.
- All art in `scenes/` is AI generated; see `LICENSES/scene-credits.md` for how each scene was made. All default sounds are synthesised at runtime in `src/shared/synth.js`.
- Nothing is inserted with `innerHTML`; pages are built with DOM calls through `QS.el`.
# coolQOJmod
