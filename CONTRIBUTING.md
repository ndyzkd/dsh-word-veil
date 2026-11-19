# Contributing

## What we accept

- **Exam-pack data PRs**: a `packs/<id>.json` file plus its `packs/index.json` entry.
- Bug reports and documentation fixes.
- We do **not** accept executable code in pack data. Packs are JSON only.

## Pack requirements

- Follow the schema in `docs/PACKS.md`.
- Declare `source`, `license`, `version`, `wordCount`, and `coreCount`.
- The license must allow redistribution; include attribution text.
- No personal data, no scraped private content, no copyrighted example sentences.
- Run `node tools/build-packs.mjs` and `node --test test/pack-data.test.mjs` before opening a PR.
- CI must pass; a maintainer reviews counts, Chinese meanings, phonetic coverage, and the core list.

## Development rules

- No runtime network access; no telemetry.
- Keep personal paths, exam dates, chat/messaging identifiers, and user progress out of the repository.
- Add a test for every behavior change; a test that cannot fail is not a test.
- Keep the wordbook file format versioned; destructive changes need migration and backup handling.

## Release policy

The maintainer controls every public release. A green CI, a completed pilot, or a passing install does **not** authorize publishing. npm, GitHub visibility, community listings, and sharing packages require explicit per-version approval.
