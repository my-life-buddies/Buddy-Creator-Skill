---
name: buddy-creator
description: 创建或完善搭子，无需提供 buddyid，通过主对话访谈与只读预览形成本地创作手册。
---

完整可分发 skill 由 `npm run pack:skill` 生成在 `release/buddy-creator/`，入口维护于 `skill/buddy-creator/SKILL.md`。

此文件仅兼容旧 CLI 安装：新创作运行已安装的 `buddy open`，自动生成 ID；明确接续已有项目时使用 `buddy open --workspace <已保存目录>`，读取返回的 hostGuide，在当前主对话中按 turn_begin / turn_finish 继续。四册确认后生成本地成果，根据 completion 提供手册入口；不发起开发交接。
