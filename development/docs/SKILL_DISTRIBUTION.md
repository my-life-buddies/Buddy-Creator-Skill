# Buddy Creator Skill 0.2.3

本版本将 Buddy 的主对话采访、来源处理、工作项恢复与只读预览作为完整 skill 分发。四册确认后生成本地成果，不包含模拟开发交接和小红书账号采集。

## 构建与安装

开发目录运行 `npm run pack:skill`。输出 release/buddy-creator/ 与带 SHA-256 的版本 ZIP。包中包含编译后的工具、按需读取的规则、前端静态文件和锁定的生产依赖；安装后不需 npm install 或前端构建。通过 Git 安装仓库且缺少 lib/node_modules 时，在技能目录运行 `npm ci --omit=dev --ignore-scripts --prefix lib`。Node.js 22.13+ 由宿主所在机器提供，已移除 macOS 硬限制与平台绑定的资料处理依赖；各宿主与系统组合仍需实机验收。

- Codex：将 buddy-creator 目录放入当前配置的 skills 目录（本机默认 ~/.codex/skills），重新加载技能后调用。
- Claude Code：将同一目录放入 ~/.claude/skills 或项目 .claude/skills，使用 /buddy-creator 或自然语言调用。
- WorkBuddy：通过“技能 → 添加技能 → 上传技能”导入 ZIP；若当前宿主支持自动安装本地技能，可让其使用原生安装能力。不要把 CodeBuddy CLI 的目录约定直接当作 WorkBuddy 的已验证目录。

WorkBuddy 官方安装说明：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market

启动话术：帮我创建一个搭子。

## 结构与数据

SKILL.md 管理发现与必要执行顺序，references 按阶段披露规则，Node 执行 scripts/buddy.mjs 调用 lib/dist 内本地工具，assets/preview 是只读预览。scripts/buddy 与 scripts/buddy.cmd 分别提供 macOS/Linux 和 Windows 便捷入口。下载、解压和参数传递由宿主按当前系统处理；入口存在不代表 Windows 完整体验已支持。访谈语义由宿主主 agent 生成，LangGraph 负责既有依赖与检查点，无独立模型账号。

新项目仍写入当前任务目录的 .buddy/buddies/<buddyid>，已有项目使用本机注册表定位。不要在技能目录启动项目。升级时只替换技能目录，保留项目、注册表、检查点、preview-endpoint.json。规则版本与项目内容版本分别管理，不自动重置采访或迁移确认。

## 完成与兼容

最终确认自动写入 deliverables/<revision>/，按版本校验后发布 current.json。文件包括 BUDDY_MANUAL.md、四册、服务模式图、蓝图、来源资料和确认记录。写入失败不影响已提交的确认，通过 finalize 重试。文件缺失可以重新生成。旧派生目录需要替换时保留 previous 副本。

旧 handoffs/coding/ 只保留历史，不再读取为当前状态或执行接收；新协议无 handoff_start/handoff_status。export 为显式导出，handoff_export 仅作旧调用兼容，不是自动完成动作。

小红书来源新采集、普通网页入口及跳转绕行均拒绝。ready 历史归档可继续读取；未完成历史任务通过只读投影显示 SOURCE_UNSUPPORTED，不篡改来源清单。用户可替换为本地材料或明确调整来源计划。历史 sourcePlan 中的来源类型保留可解析，不能利用该兼容性创建新的采集任务。

PDF、Word、旧文档、扫描件、二进制导图、网页与音视频均使用宿主实际可用工具，通过 source_import 的 hostResult 保存工具名称、真实提取结果、定位和覆盖限制。本地原件或带 URL 的网页提取快照一并归档；网页快照不冒充原始 HTML。complete 才作为完整来源，partial 保存片段但不通过知识门槛。缺少工具时可采用创作者已有导出文本、转写等替代资料。旧 ready 归档可继续读取；需要已移除处理器的旧未完成任务交给宿主取得结果后以新 operationId 导入，保留历史。本地继续归档纯文本、选定历史的可见消息和文本 Skill，不执行导入资料中的脚本。

## 验证范围

既有检查记录覆盖四阶段流程、确认约束、局部恢复等部分路径，具体以记录的版本与结果为准。0.2.3 未追加自动测试，不能据此宣称各宿主与系统组合、宿主资料处理或最终安装包已完整验收。实际宿主的 skill 发现、导入、内嵌预览、自然语言采访及资料工具接入须分别验收；手动 --host 参数的启动测试不等于三个宿主的真实体验验收。

## 待讨论

推理由宿主主 agent 提供。不同宿主的模型能力、上下文窗口与调用额度是否需要统一最低要求和降级策略，继续保留为待讨论点。
