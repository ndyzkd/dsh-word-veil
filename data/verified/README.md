# Verified exam headwords

This directory contains **headword-only** lists used to verify and rebuild the exam packs.
It does not contain the source files' translations, phonetics or formatting.

## Sources

- CET-4: `CET4_edited.txt` from
  [mahavivo/english-wordlists](https://github.com/mahavivo/english-wordlists);
  its README says the list comes from a university transcription of the CET-4 syllabus,
  with the original phonetic font repaired.
- CET-6: `CET6_edited.txt` from the same repository, described there as the
  “全国大学英语四、六级考试大纲 (2016年版)” list. `cet6.txt` here is the
  **union of CET-4 + CET-6** headwords, because the CET-6 exam includes the CET-4 base.
- 考研: `NPEE_Wordlist.txt` from the same repository (National Postgraduate Entrance Examination).
- 小学: the union of the PEP (人教版) grade 1–6 chapter dictionaries and the
  Cambridge Join In primary dictionary from
  [Qwerty Learner](https://qwerty.kaiyi.cool/); only single-word headwords are kept.
- KET: the official Cambridge KET / KET for Schools vocabulary list
  [PDF](https://www.cambridgeenglish.org/images/23387-ket-schools-vocabulary-list.pdf)
  unioned with the primary list; example sentences, PDF line-wrap fragments
  (`n`, `v`, `nt`, `ts`) and multi-word phrases are filtered out.
- PET: Qwerty Learner's `pet-vacabulary-list-2024.json`
  ([source](https://qwertylearner.cn/dicts/pet-vacabulary-list-2024.json)),
  unioned with the KET list; headwords only.
- 高考: `Highschool_edited.txt` from the `english-wordlists` repository.
- Independent count checks from public study material:
  - Bilibili, “英语四级大纲4500单词速刷”:
    <https://www.bilibili.com/video/av472267240>
  - Bilibili, “词根词缀记忆 考研词汇5500词”:
    <https://www.bilibili.com/video/av407366727>

## Counts

| file | single headwords | notes |
|---|---:|---|
| `primary.txt` | 1,230 | PEP + Join In, phrases skipped |
| `ket.txt` | 1,698 | primary ∪ Cambridge KET, fragments/phrases skipped |
| `pet.txt` | 2,223 | KET ∪ PET 2024, phrases skipped |
| `gaokao.txt` | 3,404 | Highschool list, phrases skipped |
| `cet4.txt` | 4,535 | 0 phrases |
| `cet6.txt` | 5,684 (CET-4 ∪ CET-6) | 104 phrases |
| `kaoyan.txt` | 5,385 | 4 phrases |

The app's wordbook stores **single words**, so multi-word phrases such as
`according to`, `air-conditioning`, `motor-racing` and `sideroad` are either
reported or removed when ECDICT has no usable single-word row. Section letters
and a few malformed header lines are skipped.

## Reproducibility

`report.json` records the SHA-256 of each downloaded source file. The generated
headword files are committed so pack builds do not need network access. The
source repository has no explicit license file; only factual headwords are kept
here, with attribution. Before a public release, review this attribution and the
source terms again.

The Bilibili links above are independent count checks, not data sources.
