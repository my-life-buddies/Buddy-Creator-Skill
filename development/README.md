# Buddy Creator Skill

在 Codex、Claude Code 或 WorkBuddy 的主对话中，通过采访创建自己的 Buddy。浏览器实时展示只读 booklet、访谈结构和服务模式图；回答、修改与确认都在主对话中完成。

当前为 **0.2.2 macOS Skill 试用版**。完整三宿主体验仍在验收，具体范围见 RELEASE_NOTES.md。

## 开始使用

将分发包中的 buddy-creator 目录安装到宿主的技能目录，或在 WorkBuddy 中导入 Skill ZIP。然后说：“帮我创建一个搭子。”当前会话也可直接读取解压目录的 SKILL.md 开始使用。完整安装方式见 docs/SKILL_DISTRIBUTION.md。

Skill 内部使用随附 scripts/buddy，无需全局安装 CLI。新建时先介绍搭子的含义、例子、四步创建流程和价值，再进入首问；同一项目续作按已保存进度继续。访谈语气、专业引导、举例、追问与收敛均已内置。

宿主须读取 open 返回的 `protocol.hostGuide`，然后按照 `next` 继续采访。普通回答默认通过标准输入调用 `turn_begin` / `turn_finish`，由 CLI 管理中间凭据并直接返回本轮上下文和阶段规则。完整 rulebook、结果 schema 和历史按需读取。CLI 负责保存和业务规则，由当前宿主主 agent 完成理解、归纳和表达；无需另一个模型账号、原生 subagent 或 Expert。

## 环境

- macOS，Node.js 22.13 或以上版本。Skill 包已携带运行依赖，安装后无需 npm install；获取网页资料仍需联网。本版不支持 Windows。
- 文字采访和本地预览可直接开始。扫描件 OCR 使用 Apple Vision 与 Xcode Command Line Tools。
- 音视频由宿主当前实际可用的工具读取或转写，Skill 保存其结果与原件，不内置媒体处理，不要求 FFmpeg、macOS 26 或系统语音资源。

`buddy doctor` 可检查本地环境；宿主工具是否可用，由当前宿主实际发现并判断。

## 保存、续作与修正

新项目默认工作目录为当前宿主任务目录下的 `.buddy/buddies/<buddyid>/`，注册表为 `~/.buddy-assistant/registry.json`。再次打开相同 buddyid，会在注册表和已登记根目录中查找并复用已有成果，包括旧版 `~/Buddy/buddies/`。同名目录冲突时明确选择；不会扫描整台电脑。新创作直接 open 自动创建独立 ID；明确接续已有 ID 时才 locate；旧项目在当前任务之外时，按 workspaceAccess 取得仅该目录的授权，或将其作为宿主项目打开。CLI 不能代替宿主授予写权限。

换宿主继续时，用 `--takeover` 接管已存在的连接，旧连接失去写入资格。普通重新打开不清空进度、访谈次数和确认记录。输入、工作项和资料处理进度保存在本机，失败时从已保存的部分恢复。

预览只允许阅读、展开和复制定位。修正通过主对话提交，修改后受影响内容需要重新确认；Buddy 不替使用者确认。宿主原生标注仅在实际可用时作为修正入口。

## 知识来源

支持选定的文本、Markdown、JSON、CSV、DOCX、DOC、RTF、PDF、网页、历史会话文件、XMind/FreeMind/OPML 导图、Skill 文件、口述、扫描件，以及宿主工具处理后的音视频结果。

保留原件、完整提取文本和来源定位。历史会话只处理使用者选定文件，可见消息进入交付，原始会话留在本机私有归档；外部资料和 Skill 内的指令不执行。资料失败或部分成功不会当作完整来源，重试会复用已完成且校验一致的结果。

音视频通过 `source_import` 的 `hostResult` 保存真实转写、画面说明和时间或段落定位，保留使用的工具名称与覆盖限制。完整结果才计为可用来源；片段结果保存为部分处理，不当作整份资料已读完。宿主没有可用工具时，可使用创作者已有的转写文件等替代材料，不自动安装媒体工具。旧 ready 媒体归档仍可读，未完成旧任务需要宿主处理后重新导入。

小红书账号采集已移除，已有归档可读，未完成采集不会自动恢复。

## 完成本地创作

四册确认后自动生成项目内的 `deliverables/<revision>/`，包含四册、汇总手册、服务模式图和来源版本记录。预览显示创作完成，主对话提供本地手册入口。无开发交接、无默认 ZIP 下载。

`completion_status` 查询结果，`finalize` 在失败后重试。`export` 仅供用户明确要求导出时使用。相同版本可恢复，历史确认不被重写。

## Skill 分发

`npm run pack:skill` 构建 `release/buddy-creator/` 和 `release/buddy-creator-0.2.2.zip`。包内包含规则、脚本、预览和运行依赖，不含用户项目、内置音视频处理器、mock 接收器或小红书采集器。安装后对宿主说“帮我创建一个搭子”。具体安装与验证见 `docs/SKILL_DISTRIBUTION.md`。
