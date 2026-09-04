# 安装 Buddy Skill，直接开始创作

本说明供当前宿主主 agent 执行。用户无需提供 buddyid 或项目名称。

1. 获取 [完整 Skill ZIP](https://github.com/my-life-buddies/Buddy-Journalist-Skill/releases/download/v0.2.3/buddy-creator-0.2.3.zip) 和 [SHA-256](https://github.com/my-life-buddies/Buddy-Journalist-Skill/releases/download/v0.2.3/buddy-creator-0.2.3.zip.sha256)，用当前系统实际可用的工具校验并解压。需要 Node.js 22.13+；包内已有运行依赖，无需构建前端。已移除 macOS 硬限制，各宿主与系统组合仍需实机验收。
2. 使用当前宿主的技能安装方式：Codex 的已配置 skills 目录；Claude Code 的 ~/.claude/skills 或项目 .claude/skills；WorkBuddy 的本地技能导入。根据自身身份处理，不要求用户选择宿主或注册 Expert。更新同名 skill 时只替换技能文件并保留备份，不删除搭子项目。
3. 当前会话读取安装目录的 SKILL.md，并用 Node 执行 scripts/buddy.mjs 的绝对路径。若宿主暂时无法自动导入，可从解压目录读取 SKILL.md 开始本次创作，如实区分“已运行”和“已安装”。不要调用旧本地启动器中配置的默认项目。
4. 保持用户当前创作工作目录，运行 `node <技能目录>/scripts/buddy.mjs open --no-browser --creation-key <本次启动的稳定身份>`。路径及参数独立传递，不套用其他系统的 shell 语法。启动身份由宿主生成并保存，重试复用；内部 buddyid 自动生成，不向用户提问。
5. 保存返回的 buddyId、workspace、sessionId、operationEpoch，读取 protocol.hostGuide，后续优先使用 protocol.entrypointCommand 的 executable 与 args。打开返回的 preview.url；支持内嵌预览时显示在旁边。按 next 完整呈现通俗开场、搭子例子、四步流程与首问。
6. 后续每条真实输入先 turn_begin 原样保存，再按上下文和阶段规则处理，turn_finish 保存并继续引导。只读预览随实际保存更新；修改和确认发生在主对话。
7. 四册确认后，根据 completion 提供本地手册入口。无模拟开发交接，无默认 ZIP 交付。继续当前项目使用 `open --workspace <已保存目录>`，不要再次无参数创建新项目。

PDF、Word、旧文档、扫描件、二进制导图、网页与音视频均使用当前宿主实际可用工具，按 SKILL.md 的 hostResult 协议将真实提取结果、来源、定位与覆盖范围交回本地保存。完整结果归档后直接继续采访；部分结果保留缺口，没有合适工具时可使用用户已有的导出文本、转写或可读原文。本地不再内置 OCR、文档转换、网页抓取或媒体处理；纯文本、选定历史可见消息与文本 Skill 可直接归档。

直接通过 Git 安装本仓库时，根目录就是 skill；缺少 lib/node_modules 时先执行 `npm ci --omit=dev --ignore-scripts --prefix lib`。仓库和完整包均不包含创作者项目数据。
