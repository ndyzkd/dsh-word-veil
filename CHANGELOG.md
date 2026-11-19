# Changelog

## 1.0.0 (2026-11-19)

- Plugin scaffold, MIT license, zh/en metadata, icon, local bundle patch.
- ECDICT pack pipeline: CET-4, CET-6, postgraduate entrance exam; core layers by frequency; audited counts/license.
- Host wordbook as the single source of truth: atomic writes, daily backups, corruption recovery, command queue, idempotency, SRS, mastery, strength/stubbornness, notes, exams.
- Optional local auto-capture from desktop user messages: lookup/short/long routing, code/URL/path cleanup, enabled-pack filtering, daily caps, candidate pool, 3-day park, dismissal.
- Left sidebar entry and main panel: onboarding, today, wordbook (search/detail/note/speech/delete), review (en→cn and cn→en with hints, one in-round retry), re-check scopes, settings, diagnostics, badge.
- Pending dot state machine: due/new, acted today, opened today, disabled.
- Import of existing progress, JSON/Markdown export, free-form notes.
- Master on/off switch: onboarding uses a switch instead of “开始使用”; off keeps data and disables auto-capture/reminders/badge; header exposes the same switch.
- Conversation veil: while enabled, exam words in settled assistant replies are displayed in English with a hover/focus card for Chinese, POS, phonetic and mastery state; code, links, commands and paths are skipped, and turning the switch off restores the original text. The session log keeps the original Chinese.
- Conversation header adds a per-conversation veil switch at the end of the native header-actions row (`order: 100`, after background jobs), live today/due/next-exam text, and error-heat colors driven by error rate, attempts and lapses.
- Word heat now uses a researched semantic palette: warm red/orange reserved for errors, amber for needs-work, teal for newly collected, blue for stable, green for mastered, gray for not collected. Light/dark variants are chosen separately via `light-dark()` and word-color text pairs meet ≥ 4.5:1 contrast; bold weight plus tooltip/aria text keep the signal readable for color-vision deficiency.
- Switch contrast: the track now has explicit gray/blue fills, and the white thumb gets a dark rim plus layered shadow (following Ant Design's handle-shadow recipe); verified in dark and light fixtures. DSH's dark theme maps `--dsw-alias-brand-primary` to white, so the switch no longer uses that token for its checked fill.
- Veil scanning is cached per pack set and scheduled before paint; switching conversations no longer shows a Chinese-to-English flash.
- Direct exam switch in the header (Primary/KET/PET/Gaokao/CET-4/CET-6/postgraduate); advanced multi-pack selection remains in Settings.
- Verified pack membership from sourced syllabus headwords: Primary 1,230; KET 1,698; PET 2,223; Gaokao 3,404; CET-4 4,535; CET-6 5,684; postgraduate 5,385; ECDICT supplies phonetics/POS/Chinese meanings; missing 0.
- Full JSON backup restore, inbox backup recovery, review daily cap enforcement, dismiss-vs-candidate fix, command inbox rollback, strict loopback/Host checks, malformed pack-id 400.
- Stubbornness now uses recent wrong-streak/ratio and only treats lifetime lapses as a signal while the last grade is still wrong, so long-term mastery is reachable.
- Static checks, 54 tests, real local Host route integration test, conversation-veil pure-index/heat/meta test, fixture checks for switch/off/onboarding.
- Initial public source release.
