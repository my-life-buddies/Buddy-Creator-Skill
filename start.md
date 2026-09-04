# 安装 Buddy Skill，直接开始创作

本说明供当前宿主主 agent 执行。用户无需提供 buddyid 或项目名称。

1. 获取 [完整 Skill ZIP](https://github.com/my-life-buddies/Buddy-Journalist-Skill/releases/download/v0.2.1/buddy-creator-0.2.1.zip) 和 [SHA-256](https://github.com/my-life-buddies/Buddy-Journalist-Skill/releases/download/v0.2.1/buddy-creator-0.2.1.zip.sha256)，校验后解压。需要 macOS 和 Node.js 22.13+；包内已有运行依赖，无需构建前端。
2. 使用当前宿主的技能安装方式：Codex 的已配置 skills 目录；Claude Code 的 ~/.claude/skills 或项目 .claude/skills；WorkBuddy 的本地技能导入。根据自身身份处理，不要求用户选择宿主或注册 Expert。更新同名 skill 时只替换技能文件并保留备份，不删除搭子项目。
3. 当前会话读取安装目录的 SKILL.md 并使用其中 scripts/buddy 的绝对路径。若宿主暂时无法自动导入，可从解压目录读取 SKILL.md 开始本次创作，如实区分“已运行”和“已安装”。不要调用旧本地启动器中配置的默认项目。
4. 保持用户当前创作工作目录，运行包内 `scripts/buddy open --no-browser --creation-key <本次启动的稳定身份>`。该身份由宿主生成并保存，重试复用；内部 buddyid 自动生成，不向用户提问。
5. 保存返回的 buddyId、workspace、sessionId、operationEpoch，读取 protocol.hostGuide，打开返回的 preview.url；支持内嵌预览时显示在旁边。按 next 完整呈现通俗开场、搭子例子、四步流程与首问。
6. 后续每条真实输入先 turn_begin 原样保存，再按上下文和阶段规则处理，turn_finish 保存并继续引导。只读预览随实际保存更新；修改和确认发生在主对话。
7. 四册确认后，根据 completion 提供本地手册入口。无模拟开发交接，无默认 ZIP 交付。继续当前项目使用 `open --workspace <已保存目录>`，不要再次无参数创建新项目。

直接通过 Git 安装本仓库时，根目录就是 skill；缺少 lib/node_modules 时先执行 `npm ci --omit=dev --ignore-scripts --prefix lib`。仓库和完整包均不包含创作者项目数据。
