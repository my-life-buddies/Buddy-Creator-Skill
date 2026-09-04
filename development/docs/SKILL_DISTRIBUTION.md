# Buddy Creator Skill 0.2.2

本版本将 Buddy 的主对话采访、来源处理、工作项恢复与只读预览作为完整 skill 分发。四册确认后生成本地成果，不包含模拟开发交接和小红书账号采集。

## 构建与安装

开发目录运行 `npm run pack:skill`。输出 release/buddy-creator/ 与带 SHA-256 的版本 ZIP。包中包含编译后的工具、按需读取的规则、前端静态文件和锁定的生产依赖；安装后不需 npm install 或前端构建。当前支持范围为 macOS，Node.js 22.13+ 由宿主所在机器提供；扫描件 OCR 使用 Apple Vision 与 Xcode Command Line Tools。音视频改用宿主实际可用工具，不包含内置转写或抽帧处理，不要求 FFmpeg、macOS 26 或系统语音资源。发布清单记录构建架构及未携带的可选依赖；其他 macOS 架构的原生解析能力须单独验证，不能只凭 JavaScript 可运行宣称全部支持。

- Codex：将 buddy-creator 目录放入当前配置的 skills 目录（本机默认 ~/.codex/skills），重新加载技能后调用。
- Claude Code：将同一目录放入 ~/.claude/skills 或项目 .claude/skills，使用 /buddy-creator 或自然语言调用。
- WorkBuddy：通过“技能 → 添加技能 → 上传技能”导入 ZIP；若当前宿主支持自动安装本地技能，可让其使用原生安装能力。不要把 CodeBuddy CLI 的目录约定直接当作 WorkBuddy 的已验证目录。

WorkBuddy 官方安装说明：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market

启动话术：帮我创建一个搭子。

## 结构与数据

SKILL.md 管理发现与必要执行顺序，references 按阶段披露规则，scripts/buddy 调用 lib/dist 内本地工具，assets/preview 是只读预览。访谈语义由宿主主 agent 生成，LangGraph 负责既有依赖与检查点，无独立模型账号。

新项目仍写入当前任务目录的 .buddy/buddies/<buddyid>，已有项目使用本机注册表定位。不要在技能目录启动项目。升级时只替换技能目录，保留项目、注册表、检查点、preview-endpoint.json。规则版本与项目内容版本分别管理，不自动重置采访或迁移确认。

## 完成与兼容

最终确认自动写入 deliverables/<revision>/，按版本校验后发布 current.json。文件包括 BUDDY_MANUAL.md、四册、服务模式图、蓝图、来源资料和确认记录。写入失败不影响已提交的确认，通过 finalize 重试。文件缺失可以重新生成。旧派生目录需要替换时保留 previous 副本。

旧 handoffs/coding/ 只保留历史，不再读取为当前状态或执行接收；新协议无 handoff_start/handoff_status。export 为显式导出，handoff_export 仅作旧调用兼容，不是自动完成动作。

小红书来源新采集、普通网页入口及跳转绕行均拒绝。ready 历史归档可继续读取；未完成历史任务通过只读投影显示 SOURCE_UNSUPPORTED，不篡改来源清单。用户可替换为本地材料或明确调整来源计划。历史 sourcePlan 中的来源类型保留可解析，不能利用该兼容性创建新的采集任务。

音视频由宿主工具读取后，通过 source_import 的 hostResult 保存工具名称、真实转写或画面说明、定位和覆盖限制；complete 才作为完整来源，partial 保存片段但不通过知识门槛。缺少工具时可采用创作者已有转写文件等替代资料，不自动安装媒体资源。旧 ready 媒体归档可继续读取；旧未完成媒体任务不启动已移除的处理器，宿主重新处理后使用新 operationId 导入，保留原历史。

## 验证范围

既有检查记录覆盖四阶段流程、确认约束、局部恢复等部分路径，具体以记录的版本与结果为准。0.2.2 未追加自动测试，不能据此宣称新版宿主音视频处理或最终安装包已完整验收。实际宿主的 skill 发现、导入、内嵌预览、自然语言采访及媒体工具接入须分别验收；手动 --host 参数的启动测试不等于三个宿主的真实体验验收。

## 待讨论

推理由宿主主 agent 提供。不同宿主的模型能力、上下文窗口与调用额度是否需要统一最低要求和降级策略，继续保留为待讨论点。
