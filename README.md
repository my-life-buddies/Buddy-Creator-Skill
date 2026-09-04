# Buddy Journalist Skill

在 Codex、Claude Code 或 WorkBuddy 的主对话中，通过访谈创建自己的搭子。旁边的浏览器实时展示只读创作手册、访谈进度和服务模式图。

**直接说“帮我创建一个搭子”即可开始，无需提供 buddyid。** 工具会生成内部标识、保存项目，并在同一对话中接续创作。

## 一句话开始

把下面这句话交给宿主 agent：

> 请从 https://raw.githubusercontent.com/my-life-buddies/Buddy-Journalist-Skill/main/start.md 安装 Buddy Skill，开始创作一个搭子。

## 下载完整 Skill

- [下载 buddy-creator 0.2.1](https://github.com/my-life-buddies/Buddy-Journalist-Skill/releases/download/v0.2.1/buddy-creator-0.2.1.zip)
- [SHA-256 校验文件](https://github.com/my-life-buddies/Buddy-Journalist-Skill/releases/download/v0.2.1/buddy-creator-0.2.1.zip.sha256)

ZIP 内包含运行依赖和预览页面。解压后，将 `buddy-creator` 目录放入宿主的技能目录；WorkBuddy 可使用“添加技能 → 上传技能”导入。Skill 的调用名称是 **buddy-creator**。

通过 Git 获取本仓库也可以安装：仓库根目录就是 skill。Git 版本首次使用需要 `npm ci --omit=dev --ignore-scripts --prefix lib`，完整 ZIP 无需此步骤。

## 创作流程

| 阶段 | 一起整理的内容 |
| --- | --- |
| 定义 | 帮助谁、带来什么变化、角色与边界 |
| 知识 | 已有资料、实际经验、依据与待补充内容 |
| 方法 | 面对具体场景如何判断、执行和调整 |
| 服务 | 免费体验、订阅服务与维持期间的帮助 |

访谈采用专业、自然、循循善诱的表达。新建时先介绍搭子和流程，再进入首问。修改与确认发生在主对话中；预览只读。四册确认后，自动生成本地手册和服务模式图。

## 环境与续作

- macOS，Node.js 22.13+；本次完整包在 Apple Silicon 构建。
- 推理由宿主主 agent 提供，无需另配模型账号或注册企业 Expert。
- 新创作自动建立独立目录。继续当前项目使用已保存的 workspace；明确提供已有 buddyid 时也可按 ID 续作。
- 项目、原话、来源和确认记录保存在 skill 目录之外。更新 skill 不清空项目。
- 音视频处理需要相应 macOS 资源；视频另需 FFmpeg。三个宿主的实际导入、原生标注和完整交互仍需分别验收。

本版本不包含模拟 coding CLI 交接与小红书账号采集。用户自行提供的本地材料仍可整理。

## 仓库结构

```text
SKILL.md       skill 入口
references/    按阶段读取的访谈规则与宿主协议
scripts/       启动入口
lib/           构建好的本地工具与依赖锁定文件
assets/        只读预览
agents/        宿主显示信息
development/   维护源码、构建脚本与测试
```

完整安装包在 Releases；Git 中不提交 node_modules 或任何创作者项目数据。

维护源码位于 `development/`。安装开发依赖后运行 `npm run pack:skill` 可重新生成独立 skill 包。规则或源码改动应重新构建并同步根目录中的分发文件。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
