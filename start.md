# 安装并启动 Buddy Creator Skill 1.5.0

这是给当前宿主 agent 的安装入口。目标是在主对话中帮助创作者完成定义、知识、方法、服务四阶段创作，并打开本机只读预览。用户不需要填写 buddyid、选宿主或额外指定说话风格。

## 获取完整包

- 安装包：[buddy-creator-1.5.0.zip](https://github.com/my-life-buddies/Buddy-Creator-Skill/releases/download/v1.5.0/buddy-creator-1.5.0.zip)
- 校验文件：[buddy-creator-1.5.0.zip.sha256](https://github.com/my-life-buddies/Buddy-Creator-Skill/releases/download/v1.5.0/buddy-creator-1.5.0.zip.sha256)
- 仓库：[my-life-buddies/Buddy-Creator-Skill](https://github.com/my-life-buddies/Buddy-Creator-Skill)

下载完整 ZIP 和校验文件，用可用工具核对 SHA-256 后解压。包内根目录为 `buddy-creator`，包含工具和预览资源，无需执行构建或安装第三方依赖。下载或校验失败时报告实际错误，不把未取得的包说成已安装。

## 安装

1. 查找宿主或系统实际可用的 Python 3.9+，读取真实版本，保存并复用其绝对路径。本包不需要 Node、npm、pip 或独立模型账号。缺少兼容 Python 时需准备该环境；不要仅凭命令名猜测版本或写死某台机器的路径。
2. 将 `buddy-creator` 安装到当前宿主实际支持的 Skill 目录。已有同名 Skill 时先备份旧程序文件，再替换为新版。保留所有用户工作目录；若项目误存于旧安装目录，保留该目录并另行安装新版，不能随程序清理。已有 `buddy-creator-no-node` 试用版可以保留，但本次明确使用 `$buddy-creator`。
3. 读取安装后的 `SKILL.md`，并按其中的宿主调用协议启动。宿主没有自动发现 Skill 的能力时，直接读取该文件并调用随附工具即可；不要求注册额外 agent 或 Expert。

## 开始创作

在当前创作目录运行，不切换到 Skill 安装目录。新建时使用实际 Python 路径调用 `scripts/buddy.py open --creation-key <本条启动消息的稳定身份> --no-browser`。creation-key 由宿主取得或生成一次，重试沿用，不询问创作者。工具自动生成独立项目身份，从空白开始。

保存返回的 workspace，后续所有回合使用这一目录。打开返回的 `preview.url`；宿主支持侧边浏览器时在旁边打开。完整呈现返回的开场介绍，说明搭子是什么、创作四步和实际价值，然后自然进入第一问。后续每轮按照 `SKILL.md` 先保存用户输入、再提交整理结果并展示交付。

用户明确继续已有 Python 无 Node 试用版项目时，使用 `open --workspace <原项目绝对路径> --no-browser` 接续，不另建项目。旧 Node 0.x 项目及 SQLite/LangGraph 检查点不自动迁移；仅在创作者明确选择后将其手册或资料导入新项目，不能继承旧确认。

采访、修订和确认都留在主对话中。预览只能展示，不自行修改内容；本机预览服务需要宿主环境允许启动并访问。各宿主与系统组合尚未全部完成实机验收；无法执行的环节要说明具体原因。此版本不包含小红书账号蒸馏或 coding CLI mock handoff。
