# 词纱 · Word Veil

> 给 DeepSeek Harness 加一层「词纱」：agent 回复里的考试词显示成英文，原中文仍留在会话记录里；旁边有自己的词本和间隔复习。

**状态：** 第一个正式版 `v1.0.0`。仅支持桌面版 DSH；无遥测、无运行期联网。

## 功能

- **对话词纱**：总开关开启后，已结束的 assistant 回复里命中的考试词显示成英文并带虚线下划线；悬停/键盘聚焦显示中文、词性、音标、学习状态和「点击加入单词本」。代码、路径、命令、链接不替换。
- **本对话临时开关**：对话顶栏有一个临时开关，默认跟随总开关；可以只让当前对话显示词纱，不改变自动收集、复习和红点。
- **七级词包**：小学（PEP + Join In）、KET、PET、高考、四级、六级、考研。音标、词性和中文释义来自 ECDICT。
- **错误热力**：按错误率、近期连错、lapses 和 retry 质量分成七档。暖色只给薄弱词，冷色表示学习进度；图例、悬浮卡和 `aria-label` 同时带文字状态。
- **复习**：英→中/中→英、轻量/标准/冲刺/自定义每日档位、长期 60 天上限、笔记、JSON/Markdown 导出、本机备份和损坏恢复。
- **本地优先**：词本数据在 `~/.dsh/plugins-data/dsh-word-veil/`；自动收集默认关闭，只在本机运行。

## 安装

### 从 GitHub 源码（当前）

```bash
git clone https://github.com/ndyzkd/dsh-word-veil.git
```

1. 在 DSH 打开 **Plugins > Add plugin**，选择克隆下来的目录。
2. **完全退出 DSH 再打开**（客户端模块在启动时扫描，只刷新页面不够）。
3. 从左侧栏打开 **词纱**，按引导选择词包和每日档位。

### 从 npm（`dsh-word-veil@1.0.0` 发布后）

在 DSH 插件管理器里安装 `dsh-word-veil`，然后完整重启 DSH。未实际发布前请用上面的源码安装；不要把这个 README 当成 npm 已发布的承诺。

## 环境

- 桌面版 DeepSeek Harness `0.2.2-rc.3` 或兼容版本。
- 运行期除 DSH 提供的 React 外无额外依赖。
- 构建/测试需要 Node.js 20+。

## 隐私

- 无遥测、分析或远端 API。
- 自动收集默认关闭；开启后只读本机会话，保存单词和短上下文片段，不保存整条消息。
- 词本、收件箱、备份只在本机 DSH 数据目录。
- Host 路由只监听 loopback，拒绝非本机请求。
- 不要在 issue、截图或 PR 里放个人路径、API key、考试日期或词本导出。

## 数据与许可

- **代码**：MIT，见 [`LICENSE`](LICENSE) 和 [`NOTICE.md`](NOTICE.md)。
- **考试包**：ECDICT（MIT）提供音标、词性和中文；成员词头来自公开词表，但这些词表的再分发条款尚未确认。发布或再分发词包前请阅读 [`docs/DATA.md`](docs/DATA.md) 和 [`data/verified/README.md`](data/verified/README.md)。
- 最保守的部署方式是只发布代码，用户在本地用自己有权使用的词表构建词包。
- 核心层按 ECDICT 词频补齐，不是官方大纲顺序；本项目与剑桥、任何中国考试机构、DeepSeek 均无隶属关系。

## 开发

```powershell
node tools/fetch-wordbank.mjs   # 构建期下载 ECDICT（约 66MB，一次）
node tools/build-packs.mjs      # 生成 packs/*.json + index + report
node tools/build-client.mjs     # 生成 lib/client.js
node tools/check.mjs            # 静态检查 + bundle 同步检查
npm test                        # Node 测试
```

仓库不包含用户数据、个人机器路径、个人截图或构建缓存。

## 限制

- 词纱是词级替换，不是全文翻译。
- 只替换已启用词包命中的词。
- 流式生成中的文本暂不替换，结束后统一生效。
- 复制包含词纱的选区会复制英文；需要干净原文时请关闭词纱。
- 它是 DSH Chat assistant row 的显示层适配器；Chat DOM 大改版时可能需要更新适配。

## 链接

- [详细行为与设计](docs/DETAIL.md)
- [词包格式](docs/PACKS.md)
- [数据来源与计数](docs/DATA.md)
- [安全与隐私](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)
