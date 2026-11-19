# 考试包格式

一个考试包是一份 JSON 数据，放在 `packs/<id>.json`；`packs/index.json` 是插件启动时读取的元数据清单。

## `packs/index.json`

```json
[
  {
    "id": "cet4",
    "name": "四级",
    "nameEn": "CET-4",
    "category": "国内考试",
    "version": "2026.11",
    "wordCount": 4535,
    "coreCount": 1162,
    "source": "四级大纲词表 + ECDICT",
    "license": "MIT (ECDICT metadata); 大纲词表仅保留词头，见 data/verified/README.md",
    "updatedAt": "2026.11",
    "file": "cet4.json"
  }
]
```

## `packs/<id>.json`

```json
{
  "schema": 1,
  "id": "cet4",
  "name": "四级",
  "nameEn": "CET-4",
  "category": "国内考试",
  "version": "2026.11",
  "source": "四级大纲词表 + ECDICT",
  "license": "MIT (ECDICT metadata); 大纲词表仅保留词头，见 data/verified/README.md",
  "updatedAt": "2026.11",
  "wordCount": 4535,
  "coreCount": 1162,
  "core": ["ability", "..."],
  "words": [
    { "w": "ability", "ph": "əˈbiliti", "pos": "n.", "cn": "n. 能力, 才干", "rank": 783 }
  ]
}
```

字段：

| 字段 | 说明 |
|---|---|
| `schema` | 包格式版本，当前为 1 |
| `id` | 小写稳定标识；同时是文件名与设置里的键 |
| `name` / `nameEn` | 界面名称 |
| `category` | 分组，如「国内考试」「出国考试」 |
| `version` / `updatedAt` | 数据版本与更新日期（字符串） |
| `source` | 数据来源，必须可追溯 |
| `license` | 数据许可，必须允许再分发 |
| `wordCount` / `coreCount` | 必须与实际数组长度一致 |
| `core` | 高频优先子集；必须是 `words` 的子集、无重复 |
| `words[].w` | 小写单词，单包内唯一 |
| `words[].ph` | 音标（可读 IPA 风格；允许空） |
| `words[].pos` | 词性短码，如 `n.`、`v.`、`adj.` |
| `words[].cn` | 中文释义 |
| `words[].rank` | 词频排序，越小越常见；缺失用 999999 |

## 考试包成员校验

`packs.config.json` 的 `verification` 指向 `data/verified/<id>.txt` 的词头清单。
构建时，成员来自清单而不是 ECDICT tag；ECDICT 只提供音标、词性和中文释义。
清单来源、B 站计数核对和 SHA-256 见 `data/verified/README.md`。

## 新增考试包

1. 把词头清单放到 `data/verified/<id>.txt`（一行一个单词），在
   `packs.config.json` 的 `verification` 加入来源/许可，并在 `packs` 数组加入目标：

```json
{ "id": "ielts", "tag": "ielts", "name": "雅思", "nameEn": "IELTS",
  "category": "出国考试", "coreSize": 1500, "minWords": 3500 }
```

2. 运行构建：

```powershell
node tools/fetch-wordbank.mjs
node tools/build-packs.mjs
```

3. 检查 `data/report.json` 的计数、音标/词性覆盖率。
4. 运行 `node --test test/pack-data.test.mjs`。
5. 更新 `docs/DATA.md` 的来源/计数。
6. 客户端不需要改代码：首次引导/设置页会自动读取 `packs/index.json`。

## 质量规则

- 中文释义覆盖率必须 100%（构建脚本会跳过无中文的词）。
- 音标覆盖率 ≥85%，词性覆盖率 ≥90%。
- 核心层从上一版核心词种开始，再按 `rank` 升序补齐；不宣称是官方真题核心。
- 成员来自 `data/verified/` 词头清单；ECDICT 只提供释义/音标/词性。
- 不打包例句（避免来源许可问题）；上下文由用户真实遇到时记录。
- 社区包必须是数据，不能含可执行代码；维护者审核来源/许可/计数。
