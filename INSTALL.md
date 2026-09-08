# 安装 Buddy Creator Skill 1.3.0

把完整 ZIP 交给当前宿主 agent，告诉它：

> 请安装这个 Buddy Creator Skill，并开始帮我创作一个搭子。

也可以让宿主从[公开安装入口](https://raw.githubusercontent.com/my-life-buddies/Buddy-Creator-Skill/main/start.md)获取 1.3.0 完整包并安装。开始创作无需填写 buddyid，也无需选择宿主类型。

## 环境与安装

本包使用 **Python 3.9+ 标准库**，不需要 Node、npm、pip 或第三方 Python 包。宿主应先查找并复用自己或系统已有的兼容 Python，读取实际版本并保存其绝对路径。没有可用 Python 时需先准备该环境；不能仅检查一次 `python3` 就认定没有 Python，也不能声称完全不需要执行环境。

将 ZIP 中的 `buddy-creator` 文件夹安装到当前宿主实际支持的 Skill 目录。Codex、Claude Code、WorkBuddy 的安装入口由各自宿主处理，不要求另注册 agent 或 Expert。无法自动发现 Skill 时，可以让宿主直接读取安装目录中的 `SKILL.md` 并按协议调用。

已有同名 `buddy-creator` 时，先备份旧 Skill 文件，再替换程序、规则和预览资源。**不要删除、移动或覆盖创作者工作目录。**若发现用户项目误存于旧安装目录，应先保留该目录并将新版安装到独立位置，不能把项目当作旧程序清理。旧 `buddy-creator-no-node` 试用版可保留；安装后明确使用 `$buddy-creator`，避免混用入口。

## 开始与继续

新项目从空白开始，宿主在创作目录中使用实际发现的 Python 调用 `scripts/buddy.py`，按 `SKILL.md` 自动分配项目身份；安装目录只存程序，不存作品。创作者不需要自行拼接命令。

已有 Python 无 Node 试用版项目，可由新版调用 `open --workspace <原项目绝对路径> --no-browser` 接续，保留原话、进度与确认。此前 Node 0.x 版本的项目及 SQLite/LangGraph 检查点不自动迁移；如需参考，只导入创作者明确选择的手册或资料，不继承历史确认。

采访、修改和确认都发生在宿主主对话；浏览器在本机地址展示只读预览。宿主环境需要允许启动本机预览服务，并具有访问该地址的浏览器能力。预览资源已包含在包内，浏览器不负责运行采访模型。

本版本未宣称所有宿主和系统组合已完成实机验收。资料读取依赖宿主实际可用工具；不包含小红书账号蒸馏或 coding CLI mock handoff。
