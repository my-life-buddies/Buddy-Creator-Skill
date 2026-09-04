# Buddy Creator Skill 1.0.0

在你正在使用的 coding agent 主对话中，把一个搭子想法逐步整理成可确认的创作手册。旁边的只读预览同步呈现访谈进度、已经形成的内容和服务模式图。

**无需 Node。** 使用 Python 3.9+ 标准库，无需 npm、pip、第三方 Python 包或独立模型账号。理解、采访与撰写由宿主主 agent 完成，本地工具负责保存、版本确认、恢复和预览。

## 一句话开始

将下面这句话发给宿主 agent：

> 请从 https://raw.githubusercontent.com/my-life-buddies/Buddy-Creator-Skill/main/start.md 安装 Buddy Creator Skill，并开始帮我创作一个搭子。

也可以下载[完整安装包](https://github.com/my-life-buddies/Buddy-Creator-Skill/releases/download/v1.0.0/buddy-creator-1.0.0.zip)，交给宿主安装。[SHA-256 校验文件](https://github.com/my-life-buddies/Buddy-Creator-Skill/releases/download/v1.0.0/buddy-creator-1.0.0.zip.sha256)

不需要提供 buddyid。宿主自动创建空白项目、打开预览，再用通俗的介绍开始访谈。安装与升级细节见 [INSTALL.md](INSTALL.md)。

## 创作流程

| 阶段 | 一起明确的内容 |
| --- | --- |
| 定义 | 帮谁、解决什么问题、带来什么改变，以及搭子的角色 |
| 知识 | 可用资料、创作者经验、适用范围与知识缺口 |
| 方法 | 判断方法、具体执行案例，以及条件变化时如何调整 |
| 服务 | 免费体验、付费服务、维持期的具体帮助和订阅方式 |

采访会根据你的实际场景适时举例，充分时进入下一步。内容与版本在对话中校准；四册确认后形成本地手册、服务模式图和来源记录。预览只读，修订和确认通过对话完成；宿主实际提供原生标注时，也可把标注作为修订输入。

服务订阅时长由创作者定义。付费期间 AI 对话不限次数，真人服务另行约定；免费体验可以持续跟进，维持期保留历史和基础对话。

## 保存与接续

- 保存真实输入、中间草稿、产物版本和对应确认，已保存回合可恢复。
- 每个作品使用独立工作目录，安装包不附带个人草稿。
- 再次打开同一工作目录时接续进度，并复用本机预览入口。
- 此前 Python 无 Node 试用版项目可用 `open --workspace` 原路径继续；旧 Node 0.x 项目及 LangGraph 检查点不自动迁移。
- 升级同名 Skill 时先备份程序文件，保留用户项目；旧试用版入口可以共存，使用时明确选择 `$buddy-creator`。

宿主必须把每轮输入交给本地工具才能同步。本地工具不能恢复从未提交的消息，也不会代替宿主在后台推理。

## 使用条件

宿主需能够读取 Skill、执行 Python、读写创作目录，并访问本机只读预览。可在 Codex、Claude Code、WorkBuddy 中由主 agent 调用；各宿主的安装方式和可用工具由其实际环境决定，尚未完成全部宿主与系统组合的完整实机验收。

网页、PDF、Word、扫描件和音视频交给宿主已有工具读取，再保留实际结果与来源定位。不包含小红书账号蒸馏、coding CLI mock handoff，也不把设计完成表述为应用已经开发上线。

## 仓库内容

| 路径 | 用途 |
| --- | --- |
| `SKILL.md` | 宿主入口、采访闭环与主要规则 |
| `references/` | 四阶段规则、调用协议、产物字段与恢复说明 |
| `scripts/` | Python 本地工具 |
| `assets/` | 随包提供的只读预览资源 |
| `agents/openai.yaml` | Skill 展示名称与启动提示 |
| `version.json` | 产品版本与工作区格式 |
| `development/package_skill.py` | 使用 Python 生成 ZIP 与 SHA-256 |

维护者可在仓库目录运行 `python3 development/package_skill.py`，产物写入 `release/`。安装使用不需要执行此步骤。旧 Node 实现保留在 v0.2.x 标签的 Git 历史中。

完整安装包见 [v1.0.0 Release](https://github.com/my-life-buddies/Buddy-Creator-Skill/releases/tag/v1.0.0)。
