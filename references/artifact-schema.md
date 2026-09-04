# 产物与服务蓝图字段

此文件只在形成章节、方法候选、案例或服务方案时读取。所有内容由当前项目真实原话和来源生成；这里定义字段，不提供默认作品或默认服务方案。

## 公共产物结构

每个 artifacts 数组元素严格包含以下必填字段：

- id、stage、kind、title、markdown：字符串。
- evidence：Ref 数组，记录真实输入或资料依据。
- dependencies：Ref 数组，记录已确认的上游产物。
- unresolved：未决事项字符串数组，没有待处理事项时为 []。
- data：可选对象；没有特殊结构时使用 {}。

不要提交 hash 或 revision，工具负责计算。evidence 或 dependencies 至少有一项实际依据。知识、方法、服务产物的 dependencies 应分别引用每个上游阶段实际使用的已确认章节；下游章节还要引用实际使用的方法候选、场景或蓝图。引用对象 hash 必须是当前版本。未决项如允许延后，应在正文准确说明缺口并让创作者校准这个范围；不能为了确认清空仍待解决的具体问题。

| kind | stage | 固定 id | data |
| --- | --- | --- | --- |
| chapter | definition | definition.1 至 definition.6 | 可留 {}，正文对应 catalog 的六章 |
| chapter | knowledge | knowledge.1 至 knowledge.7 | 可留 {}，正文对应七章 |
| chapter | methods | methods.1 至 methods.5 | 可留 {}，正文对应五章 |
| chapter | service | service.1 至 service.9 | 可留 {}，正文对应九章 |
| hypothesis | methods | hypothesis.H1 至 hypothesis.H4 | 可留 {}；先形成 3—4 条不同候选 |
| scenario | methods | scenario.M01 至 scenario.M04；scenario.E01 至 scenario.E03 | 具体执行写 markdown |
| blueprint | service | service.blueprint | 使用下节结构 |
| transition | service | transition.acquisition-paid、transition.acquisition-maintenance、transition.paid-paid、transition.paid-maintenance | trigger、rightsChange、dataInheritance、message 均为非空字符串 |

四册是固定章节的组合，没有 kind:booklet 产物，也不使用 data.chapters。整册确认通过 delivery.confirmationScope=booklet 和该册全部章节 ID；逐章确认用 scope=object 及对应章节。一次不能跨册。

方法候选正式反馈使用 decision:accepted 或 rejected，其他对象使用 confirmed。3—4 条候选均处理且至少一条 accepted 才进入基础场景。基础场景可在创作者回答足够具体时忠实记录，其 data.capture=faithful_user_answer 仅用于刚回答的对应 M01—M04，必须引用本轮精确原话，正文不能新增条件、顺序或推断。新增推导应走正常展示、下一轮确认。E01—E03 必须在四基础有效确认之后生成，并依赖对应基础场景；每次只变一个条件。

## service.blueprint 的 data

可以先保存带未决项的草案；以下字段与业务判断齐备后才能正式确认。字段是内部记录格式，不把这张表变成一次询问用户的清单。智能规划基于已有信息给完整建议，只有实际缺口才追问。

| 字段 | 形状与含义 |
| --- | --- |
| platformRules | 原样使用 context.catalog.serviceRules；不能复制旧限制 |
| valueStatement | 非空字符串：持续使用能得到什么 |
| recurrenceDrivers | 非空字符串数组：持续求助的真实原因 |
| renewalEvidence | 非空字符串数组：1—3 项可观察成果、变化或下一周期目标 |
| serviceLoop | 对象，trigger、requiredInput、decision、action、result、feedback、nextCycleUpdate 均为非空字符串 |
| acquisitionContract | 对象，trigger、requiredInput、completionCriteria、conversionBridge 均为非空字符串；includedSteps 非空字符串数组；excludedSteps 字符串数组，可为 [] |
| stages | acquisition、paid、maintenance 三个阶段对象；各用 result/service/limit 描述帮助和范围，付费阶段不能将 limit 写成 AI 对话次数 |
| transitions | 五个键：acquisition-paid、acquisition-maintenance、paid-paid、paid-maintenance、maintenance-paid；每项含 trigger、rightsChange、dataInheritance、message 非空字符串，可另给 title |
| billingCycle | 严格为 {count:正整数,unit:"day"或"week"或"month"或"year"}；用户定义，不默认月度 |
| price | 这一整个订阅周期对应的正数价格 |
| cadence | 非空字符串：交付频率，与订阅周期分开 |
| deliveries | 非空字符串：交付内容与明确时间范围；不能限制普通 AI 对话 |
| toolLimit | 非空字符串：工具范围及对应时间，未使用额度限制时如实说明，不变相限制聊天 |
| conversationLimit | 固定为 "unlimited" |
| humanConversationLimit | 真人服务次数、时长和响应安排的具体说明，与 AI 对话分开；没有真人服务如实说明 |
| maintenanceContract | basicConversation:true；allowedQuestions 非空字符串，说明实际可答的基础问题，不能只留历史或付费提示 |
| humanReview | 布尔值，表示是否创作者本人复核 |
| reviewCapacity | 有本人复核时必填非空字符串，基于真实产能与时间范围；没有依据则保留未决，不能编造 |
| multiUser | 固定 false，当前单用户单档订阅设计 |
| experienceMode | "conversation" 或 "custom-component"；后者另填 customComponentDescription 具体说明组件 |
| semanticChecks | 下节各项公开业务判断与真实证据 |

semanticChecks 包含 coherentLoop、paidDeliverable、freeScopeAgreed、maintenanceBoundary、transitionsConfirmed、valueBeforePaywall、executableContract；存在本人复核时还包含 creatorCapacity。每项结构为 `{pass:布尔值,evidence:Ref数组}`。pass=true 必须有非空真实依据，不能靠通过结构校验证明语义正确。未通过写 false 并在产物 unresolved 说明待明确内容。

guided 模式需四条非默认 transition 产物逐条有效确认，其 data 与 blueprint.data.transitions 中对应对象保持一致。maintenance-paid 为恢复订阅默认路径，保留完整权益与历史继承说明，不新增第五组采访。smart 模式整体展示蓝图、根据反馈修订；正式确认前仍核对五条路径、产能和服务约定，不以模型推测替代创作者意见。

服务蓝图正式确认且门槛满足后，才能定稿九章服务手册。订阅时长变化同步核对价格、交付、工具或真人额度和路径文案，不自动等比例涨价或扩大承诺。付费 AI 对话不限次数、维持基础对话与历史、免费范围可持续跟进始终有效。
