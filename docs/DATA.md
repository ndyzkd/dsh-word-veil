# 数据来源与许可

## ECDICT

- 项目：[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)
- 许可：MIT（见 ECDICT 仓库 LICENSE）
- 使用文件：`ecdict.csv`
- 构建期下载镜像：`https://ghfast.top/https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv`
- 源文件字节：66,009,548
- 源文件 SHA-256：`d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc`

## v1 内置包

| 包 | 成员来源 | 词数 | 核心层 | 音标覆盖 | 词性覆盖 |
|---|---|---:|---:|---:|---:|
| 小学 | PEP + Join In 小学词头（并集） | 1,230 | 250 | 1,208 | 1,194 |
| KET | Cambridge KET + 小学并集 | 1,698 | 500 | 1,664 | 1,652 |
| PET | Cambridge PET + KET 并集 | 2,223 | 650 | 2,161 | 2,169 |
| 高考 | 高考英语大纲词头 | 3,404 | 1,200 | 3,390 | 3,385 |
| 四级 | 四级大纲词表 | 4,535 | 1,162 | 4,528 | 4,526 |
| 六级 | 四级+六级大纲词表 | 5,684 | 1,500 | 5,675 | 5,675 |
| 考研 | 考研大纲词表 | 5,385 | 1,500 | 5,376 | 5,373 |

成员来自 `data/verified/` 的词头清单（来源与 B 站计数核对见
`data/verified/README.md`）；ECDICT 只提供音标、词性和中文释义。多词短语
（如 `according to`）不在单词本范围内，构建报告会单独计数。

### 小学/KET/PET/高考来源

- 小学：Qwerty Learner 的人教 PEP 1–6 分册 + Cambridge Join In 小学词表，合并去重后保留单词头；再补入 a/an/the、student/teacher 等课堂基础词，避免教材分册漏掉功能词。
- KET：小学并集 + Cambridge KET / KET for Schools（2009）官方词头；PDF 行尾碎片和短语已剔除。
- PET：KET 并集 + Qwerty Learner `pet-vacabulary-list-2024.json` 的单词头。
- 高考：`mahavivo/english-wordlists` 的 `Highschool_edited.txt` 单词头。
- 这些清单只保留词头；释义/音标/词性均由 ECDICT 提供，详见 `data/verified/README.md`。

核心层从上一版核心词种开始，再按 ECDICT 的 `frq`/`bnc` 词频补齐，
**不是官方真题核心词表**。插件不宣称与任何考试机构存在关联。

## 没有打包的数据

- 不打包个人 `词库.json`（来源 kajweb/dict / 有道，许可不适合再分发）。
- 不打包任何个人 `进度.json`、会话记录、截图或考试日期。
- 不打包例句/真题原句；上下文只在你真实遇到该词时记录在本地词本里。

## 社区考试包

新增考试包必须在其 JSON 中声明 `source` 与 `license`，并允许再分发。CI 与维护者会检查计数、中文覆盖、核心层和许可。数据只收 JSON，不收可执行代码。
