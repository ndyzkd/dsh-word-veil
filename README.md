# 词纱 · Word Veil

> A display-layer word veil for DeepSeek Harness. Exam words in assistant replies are shown in English while the original Chinese stays in the session; a wordbook and spaced review live beside it.

**Status:** first official release, `v1.0.0`. Desktop DSH only. No telemetry and no runtime network requests.

## What it does

- **Word veil:** with the master switch on, recognized exam words in settled assistant replies render in English with a dotted underline. Hover or focus shows Chinese, part of speech, phonetic, learning state and a click-to-collect action. Code, paths, commands and links are left alone.
- **Per-conversation switch:** a temporary switch in the conversation header follows the master switch by default. It can show the veil in one conversation without turning on collection, review or the pending badge.
- **Exam packs:** Primary (PEP + Join In), KET, PET, Gaokao, CET-4, CET-6 and the postgraduate entrance exam. All packs use ECDICT for phonetics, POS and Chinese meanings; pack membership is kept as headword lists.
- **Word heat:** error rate, recent wrong streaks, lapses and retry quality drive seven semantic bands. Warm colors are reserved for weak words; cool colors show progress. The legend, hover card and `aria-label` also carry the state as text.
- **Review:** recognition and production questions, light/standard/sprint/custom daily limits, a 60-day long-term interval cap, notes, JSON/Markdown export, local backups and corruption recovery.
- **Local by design:** wordbook data lives under `~/.dsh/plugins-data/dsh-word-veil/`. Auto-capture is off by default and only runs on this machine.

## Install

### From the GitHub source (current)

1. Clone the repository:

   ```bash
   git clone https://github.com/ndyzkd/dsh-word-veil.git
   ```

2. In DSH open **Plugins > Add plugin** and select the cloned directory.
3. **Fully quit and reopen DSH.** Client modules are scanned at startup; a page refresh alone is not enough.
4. Open **词纱** from the sidebar and complete the first-run setup.

### From npm (once `dsh-word-veil@1.0.0` is published)

Install the package `dsh-word-veil` through DSH's plugin manager, then fully restart DSH. Until the package is actually published, use the source install above; do not treat this README as a promise that the npm version already exists.

## Requirements

- Desktop DeepSeek Harness `0.2.2-rc.3` or a compatible release.
- No runtime dependencies beyond the React supplied by DSH.
- Node.js 20+ only for building and testing the source.

## Privacy

- No telemetry, analytics or remote API calls.
- Auto-capture is opt-in; it reads local session messages and stores only words plus a short context fragment, never a full message.
- Wordbook, inbox and backups stay in the local DSH data directory.
- The Host routes listen on loopback and reject non-loopback requests.
- Do not put personal paths, API keys, exam dates or wordbook exports in issues, screenshots or pull requests.

## Data and license

- **Code:** MIT. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).
- **Exam packs:** ECDICT (MIT) supplies phonetics, POS and Chinese meanings. Membership lists are derived from public wordlists; their redistribution terms are not established by this project. See [`docs/DATA.md`](docs/DATA.md) and [`data/verified/README.md`](data/verified/README.md) before redistributing the pack data.
- For a maximally conservative deployment, publish the code and build packs locally from sources you have the right to use.
- Core tiers are filled by ECDICT frequency; they are not official syllabus orders, and this project is not affiliated with Cambridge, any Chinese exam authority, or DeepSeek.

## Development

```powershell
node tools/fetch-wordbank.mjs   # one-time build-time ECDICT download (~66 MB)
node tools/build-packs.mjs      # packs/*.json + index + report
node tools/build-client.mjs     # lib/client.js
node tools/check.mjs            # static + generated-bundle checks
npm test                        # Node test suite
```

The repository does not contain user data, local paths, screenshots from a personal machine or build caches.

## Limitations

- The veil is word-level, not full-passage translation.
- Only words present in an enabled pack are replaced.
- Streaming text is left alone until the reply settles.
- Copying a selection that contains veiled words copies the English rendering; turn the veil off if you need clean source text.
- The code is a display-layer adapter over DSH Chat's assistant rows; a large Chat DOM change may require an adapter update.

## Links

- [Detailed behavior and design](docs/DETAIL.md)
- [Pack format](docs/PACKS.md)
- [Data sources and counts](docs/DATA.md)
- [Security and privacy policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
