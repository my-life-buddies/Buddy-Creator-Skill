import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { Store, openWorkspace } from "../src/store.js";
import { TurnAPI } from "../src/turn-api.js";
import { CARDS, CHAPTERS, SERVICE_RULES } from "../src/rules.js";
import { bookIds, confirmed } from "../src/domain.js";
import { enqueueSource, processSource } from "../src/sources.js";
import { exportHandoff } from "../src/handoff.js";
import { completionSnapshot } from "../src/completion.js";
import type { ArtifactPatch, Input, Ref, Stage, WorkItem, WorkResult } from "../src/types.js";

for (const transport of ["protocol", "turn-api"] as const)
  for (const serviceMode of ["smart", "guided"] as const)
    test(`full ${transport} ${serviceMode} four-stage interview, exact confirmations, faithful scenarios, ZIP, and targeted major revision`, async () => {
      const root = mkdtempSync(join(tmpdir(), "buddy-full-"));
      const store = await openWorkspace("writing-coach", {
        home: join(root, "registry"),
        root: join(root, "projects"),
      });
      const session = store.connect("test"),
        api = new TurnAPI(store),
        flow = api.workflow;
      let sequence = 0;
      const evidence = (i: Input): Ref => ({
        type: "input",
        id: i.id,
        hash: i.hash,
        quote: i.raw,
      });
      const upstream = (stage: Stage): Ref[] =>
        ["definition", "knowledge", "methods"]
          .slice(0, ["definition", "knowledge", "methods", "service"].indexOf(stage))
          .map((s) => {
            const a = store.load().artifacts[`${s}.${s === "definition" ? 2 : 1}`]!;
            return { type: "artifact", id: a.id, hash: a.hash };
          });
      const patch = (
        stage: Stage,
        id: string,
        kind: ArtifactPatch["kind"],
        title: string,
        markdown: string,
        i: Input,
        data?: Record<string, unknown>,
      ): ArtifactPatch => ({
        id,
        stage,
        kind,
        title,
        markdown,
        data,
        evidence: [evidence(i)],
        dependencies: upstream(stage),
        unresolved: [],
      });
      const chapters = (stage: Stage, i: Input) =>
        CHAPTERS[stage].map((title, n) =>
          patch(stage, `${stage}.${n + 1}`, "chapter", title, `${title}：${i.raw}`, i),
        );
      const confirm = (
        i: Input,
        decision: "confirmed" | "accepted" | "rejected" = "confirmed",
      ) => ({
        target: store.delivery(i.replyToDeliveryId!).confirmationTarget!,
        decision,
        evidence: [evidence(i)],
      });
      async function turn(
        raw: string,
        build: (input: Input) => WorkResult,
        replyToDeliveryId?: string,
        forbiddenDelivery?: WorkResult["delivery"],
      ) {
        const clientKey = `message-${++sequence}`;
        let input: Input;
        let item: WorkItem;
        let workToken: string | undefined;
        if (transport === "turn-api") {
          const d = (await api.begin({
            sessionId: session.id,
            clientKey,
            raw,
            replyToDeliveryId,
          })) as any;
          input = d.context.input;
          item = JSON.parse(
            readFileSync(store.path("runtime-work", "items", `${d.work.stepId}.json`), "utf8"),
          );
          workToken = d.workToken;
        } else {
          const token = store.reserve(
            session.id,
            clientKey,
            replyToDeliveryId ??
              store.dialogue().questionDeliveryId ??
              store.dialogue().activeDeliveryId,
          );
          input = store.record(session.id, token.token, raw);
          const directive = await flow.prepare(session.id, input.id);
          item = directive.workItem as WorkItem;
        }
        const output = build(input);
        // A live host session tried to ask for all three candidate decisions at once.
        // Reject that delivery without losing this input or the accepted upstream books.
        const hypotheses = output.artifacts?.filter((a) => a.kind === "hypothesis");
        if (hypotheses?.length === 3) {
          const revision = store.load().revision;
          await assert.rejects(
            flow.complete(item.requestId, {
              stepId: item.stepId,
              operationId: `batch-hypotheses-${sequence}`,
              operationEpoch: item.operationEpoch,
              baseRevision: item.baseRevision,
              contextDigest: item.contextDigest,
              output: {
                ...output,
                delivery: {
                  text: "这三条方法候选都符合你的实际做法吗？",
                  confirmationObjectIds: hypotheses.map((a) => a.id),
                },
              },
            }),
            /一次只展示并校准一条/,
          );
          assert.equal(store.load().revision, revision);
          const retry = await flow.next(item.requestId);
          assert.equal((retry.workItem as WorkItem).stepId, item.stepId);
        }
        if (forbiddenDelivery) {
          const revision = store.load().revision;
          await assert.rejects(
            flow.complete(item.requestId, {
              stepId: item.stepId,
              operationId: `closed-candidate-${sequence}`,
              operationEpoch: item.operationEpoch,
              baseRevision: item.baseRevision,
              contextDigest: item.contextDigest,
              output: { ...output, delivery: forbiddenDelivery },
            }),
            /收敛|上限/,
          );
          assert.equal(store.load().revision, revision);
        }
        let committed: any;
        if (workToken) {
          committed = await api.finish({ sessionId: session.id, workToken, output });
        } else {
          await flow.complete(item.requestId, {
            stepId: item.stepId,
            operationId: `work-${sequence}`,
            operationEpoch: item.operationEpoch,
            baseRevision: item.baseRevision,
            contextDigest: item.contextDigest,
            output,
          });
          committed = await flow.commit(item.requestId, `commit-${sequence}`);
        }
        const d = committed.delivery as { id: string };
        assert.ok(d, JSON.stringify(committed));
        store.presentation(d.id, "host_reported");
        return input;
      }
      try {
        await turn("开始", () => ({
          intent: "supplement",
          delivery: {
            text: "你希望这个 Buddy 先帮哪类人完成一件什么事？",
            questionTargetId: "D01",
          },
        }));
        await turn(
          "我带新人写周报十年。这位搭子帮助刚入职、担心表达不清的新同事写清进展和求助事项，让她能独立判断重点。我会结合实际工作情境引导，温和但不替她决定，也不编造业绩。",
          (i) => ({
            intent: "answer",
            assessments: Object.keys(CARDS)
              .filter((k) => k.startsWith("D"))
              .map((targetId) => ({
                targetId,
                status: "sufficient",
                summary: i.raw,
                gaps: [],
                evidence: [evidence(i)],
              })),
            artifacts: chapters("definition", i),
            delivery: {
              text: "定位、用户、改变与边界已整理进六章定义手册，请查看是否符合你的意思。",
              confirmationObjectIds: bookIds("definition"),
              confirmationScope: "booklet",
            },
          }),
        );
        await turn("确认这六章定义手册。", (i) => ({
          intent: "confirm",
          confirmation: confirm(i),
          delivery: {
            text: "定义已经确认。你有哪些实际材料或经验，可以帮助搭子理解你的做法？",
            questionTargetId: "K01",
          },
        }));
        const oral = enqueueSource(store, {
          operationId: "oral-source",
          kind: "oral",
          text: "新人写周报时先分清实际进展、影响与所需协助。没有依据的成绩不补写；不清楚时先问具体情境。",
        });
        const source = await processSource(store, oral.id);
        assert.equal(source.status, "ready");
        await turn(
          "知识就从这份口述开始，目前只有这些，主题是周报判断与责任边界。我通常先问一件实际发生的事，再整理进展和需要帮助的地方。",
          (i) => ({
            intent: "answer",
            assessments: ["K01", "K02", "K03", "K04"].map((targetId) => ({
              targetId,
              status: "sufficient",
              summary: i.raw,
              gaps: [],
              evidence: [evidence(i)],
            })),
            sourcePlan: {
              requiredKinds: ["oral"],
              sourceIds: [source.id],
              discoveryClosed: true,
            },
            sourceVersions: [{ id: source.id, version: source.version }],
            artifacts: chapters("knowledge", i),
            delivery: {
              text: "口述已完整归档，七章知识手册已经形成，请校准内容。",
              confirmationObjectIds: bookIds("knowledge"),
              confirmationScope: "booklet",
            },
          }),
        );
        await turn("确认完整知识手册。", (i) => ({
          intent: "confirm",
          confirmation: confirm(i),
          artifacts: [1, 2, 3].map((n) =>
            patch(
              "methods",
              `hypothesis.H${n}`,
              "hypothesis",
              `判断假设 ${n}`,
              ["先问实际情境，再组织表达。", "行动受阻时保留事实，调整范围。", "不编造工作成果。"][
                n - 1
              ]!,
              i,
            ),
          ),
          delivery: {
            text: "第一条方法假设是先问实际情境，再组织表达。这符合你的做法吗？",
            confirmationObjectIds: ["hypothesis.H1"],
          },
        }));
        const firstCandidate = {
          text: "这条先看实际情境再组织表达的方法，符合你的判断吗？",
          confirmationObjectIds: ["hypothesis.H1"],
        };
        await turn("这一条暂时没有想清楚。", () => ({
          intent: "answer",
          delivery: firstCandidate,
        }));
        const firstCandidateDeliveryId = store.dialogue().activeDeliveryId!;
        assert.equal(store.load().targets.H01!.answerInputIds.length, 1);
        await turn("为什么先校准方法？", () => ({
          intent: "explain",
          delivery: {
            text: "先校准方法，是为了确认我从资料里整理出的判断顺序是否符合你的实际做法。文件中的一句话可能省略了适用条件，所以这里仍保留为候选，不把它自动当作你认可的规则。暂时没有想清楚也可以保留，已经确认的定位和知识手册不会因此被重新采访。",
          },
        }));
        assert.equal(store.load().targets.H01!.answerInputIds.length, 1);
        await turn(
          "仍然没有想清楚。",
          () => ({
            intent: "answer",
            delivery: { text: "这条先保留待补。第二条是受阻时保留事实并调整范围，符合你的做法吗？", confirmationObjectIds: ["hypothesis.H2"] },
          }),
          undefined,
          firstCandidate,
        );
        assert.equal(store.load().targets.H01!.answerInputIds.length, 2);
        assert.equal(store.load().targets.H01!.status, "exhausted");
        assert.equal(confirmed(store.load(), "hypothesis.H1", "accepted"), false);
        for (let n = 1; n <= 3; n++)
          await turn(
            `认可第 ${n} 条方法。`,
            (i) => ({
              intent: "confirm",
              confirmation: confirm(i, "accepted"),
              delivery:
                n < 3
                  ? {
                      text: `请校准第 ${n + 1} 条方法假设。`,
                      confirmationObjectIds: [`hypothesis.H${n + 1}`],
                    }
                  : {
                      text: "设想一位新同事第一次请你帮忙写周报，只有零散记录，你会先怎样了解情况？",
                      questionTargetId: "M01",
                      mode: "example",
                    },
            }),
            n === 1 ? firstCandidateDeliveryId : undefined,
          );
        for (let n = 1; n <= 4; n++)
          await turn(
            [
              "我先问这周实际做了哪件事和它的结果，再决定怎么写，因为事实是表达的基础。",
              "她时间不够时先留下最影响下一步的一件进展，其他内容可以下一次补齐。",
              "仍可帮她澄清事实和影响；一旦要求虚构业绩，我会停下并说明边界。",
              "我不会编造她没有取得的成绩，会请她说真实进展，再帮她明确表达。",
            ][n - 1]!,
            (i) => ({
              intent: "answer",
              artifacts: [
                patch("methods", `scenario.M0${n}`, "scenario", CARDS[`M0${n}`]!.title, i.raw, i, {
                  capture: "faithful_user_answer",
                }),
                ...(n === 4
                  ? [
                      patch(
                        "methods",
                        "scenario.E01",
                        "scenario",
                        "现实约束变化",
                        "只改变时间约束：保留一项有依据的真实进展。",
                        i,
                        { changedConditions: 1 },
                      ),
                    ]
                  : []),
              ],
              delivery:
                n < 4
                  ? {
                      text: [
                        "如果她没有时间完成原来的整理步骤，你会优先保留什么？",
                        "如果她希望你替她决定工作成果怎么夸大，你会帮到哪一步？",
                        "如果她明确要求编造没有发生的成绩，你会怎样处理？",
                      ][n - 1]!,
                      questionTargetId: `M0${n + 1}`,
                    }
                  : {
                      text: "时间缩短时，仍保留一项真实进展。这份拓展处理方式符合你的判断吗？",
                      confirmationObjectIds: ["scenario.E01"],
                    },
            }),
          );
        for (let n = 1; n <= 3; n++)
          await turn(`确认第 ${n} 个拓展场景的处理方式。`, (i) => ({
            intent: "confirm",
            confirmation: confirm(i),
            artifacts:
              n < 3
                ? [
                    patch(
                      "methods",
                      `scenario.E0${n + 1}`,
                      "scenario",
                      CARDS[`E0${n + 1}`]!.title,
                      "仅改变一个条件，仍以真实事实及明确责任为前提，必要时说明不能继续承担的部分。",
                      i,
                      { changedConditions: 1 },
                    ),
                  ]
                : chapters("methods", i),
            delivery:
              n < 3
                ? {
                    text: "下一情境只改变一个关键条件，请校准这份推导的处理方式。",
                    confirmationObjectIds: [`scenario.E0${n + 1}`],
                  }
                : {
                    text: "四个基础场景与三个拓展场景已校准，五章方法手册已整理完成。",
                    confirmationObjectIds: bookIds("methods"),
                    confirmationScope: "booklet",
                  },
          }));
        await turn("确认完整方法手册。", (i) => ({
          intent: "confirm",
          confirmation: confirm(i),
          serviceModelExplained: true,
          delivery: {
            text: "用户先按你设定的范围免费体验，再订阅持续服务；时长由你定义，AI对话不限次数。停付后保留历史与基础问答，到期前兑现已购服务，再订阅时恢复。你希望先看整套方案，还是逐项讨论？",
            questionTargetId: "S00",
            mode: "example",
          },
        }));
        const transitionIds = [
          "acquisition-paid",
          "acquisition-maintenance",
          "paid-paid",
          "paid-maintenance",
        ];
        const transitionData = (id: string) => ({
          id,
          trigger: "用户完成当前阶段后明确选择；停付在已购期结束后生效",
          rightsChange: "按所选订阅状态继续或暂停对应能力",
          dataInheritance: "保留历史并从原有进度继续",
          message: "这次结果会保留，需要继续时可以回来。",
        });
        if (serviceMode === "guided") {
          await turn(
            "选逐项规划，四条路径都在用户完成当前阶段后明确选择，停付于已购期结束生效，按订阅状态继续或暂停服务，历史保留，告诉用户这次结果会保留、需要时可以回来。",
            (i) => ({
              intent: "answer",
              serviceMode,
              artifacts: transitionIds.map((id) =>
                patch(
                  "service",
                  `transition.${id}`,
                  "transition",
                  id,
                  "路径的时点、权益、历史继承和表达。",
                  i,
                  transitionData(id),
                ),
              ),
              delivery: {
                text: "四条路径已有具体安排，我们先校准第一条。",
                confirmationObjectIds: [`transition.${transitionIds[0]}`],
              },
            }),
          );
          for (let n = 0; n < transitionIds.length; n++)
            await turn(`确认路径 ${transitionIds[n]} 的时点、权益、历史继承和表达。`, (i) => ({
              intent: "confirm",
              confirmation: confirm(i),
              delivery:
                n < 3
                  ? {
                      text: "请继续校准下一条具体路径。",
                      confirmationObjectIds: [`transition.${transitionIds[n + 1]}`],
                    }
                  : { text: "四条路径均已确认。一次订阅打算持续多长时间？", questionTargetId: "S04" },
            }));
        }
        const customPeriod = serviceMode === "guided";
        const paidDeliveries = customPeriod ? "8周内共8份，每周1份" : "每月4份";
        const freeExperience = customPeriod ? "第一次免费完成一份周报重点卡" : "免费体验7天，每天跟进、答疑并修改周报方案";
        const serviceInput =
          `${customPeriod ? "单档订阅8周，整个周期199元，8周内共8份周报复盘，每周1份" : "单档月费99元，每月4份周报复盘"}，周期内与搭子对话不限次数，工具仅整理结果时使用；${freeExperience}。每次输入真实记录，判断重点，整理行动，交付卡片，收集反馈，用于下次调整。停付后保留历史和基础提问，不再生成完整新结果，已购期间照常履约；四条路径的时点、权益和表达按这套安排。纯对话，不由我参与复核。`;
        await turn(serviceInput, (i) => {
          const stages = Object.fromEntries(
            ["acquisition", "paid", "maintenance"].map((id, n) => [
              id,
              {
                id,
                title: ["获客期", "付费期", "维持期"][n],
                goal: "帮助新人表达真实进展",
                result: n === 2 ? "历史与基础问题" : "周报重点卡",
                service: n === 2 ? "查看历史、理解已有结果" : "澄清输入并整理周报重点",
                limit: n === 0 ? freeExperience : n === 1 ? paidDeliveries : "不生成新完整结果",
              },
            ]),
          );
          const transitions = Object.fromEntries(
            [
              "acquisition-paid",
              "acquisition-maintenance",
              "paid-paid",
              "paid-maintenance",
              "maintenance-paid",
            ].map((id) => [
              id,
              {
                id,
                trigger: "用户完成当前阶段后明确选择；停付在已购期结束后生效",
                rightsChange: "按所选订阅状态继续或暂停对应能力",
                dataInheritance: "保留历史并从原有进度继续",
                message: "这次结果会保留，需要继续时可以回来。",
              },
            ]),
          );
          const semanticChecks = Object.fromEntries(
            [
              "coherentLoop",
              "paidDeliverable",
              "freeScopeAgreed",
              "maintenanceBoundary",
              "transitionsConfirmed",
              "valueBeforePaywall",
              "executableContract",
            ].map((k) => [k, { pass: true, evidence: [evidence(i)] }]),
          );
          const data = {
            platformRules: SERVICE_RULES,
            version: 1,
            billingCycle: customPeriod ? { count: 8, unit: "week" } : "monthly",
            multiUser: false,
            valueType: "periodic",
            valueStatement: "每次根据新进展调整表达",
            recurrenceDrivers: ["每周出现新的真实工作进展"],
            renewalEvidence: ["能独立说清进展与需要协助的点"],
            serviceLoop: {
              trigger: "新一周复盘",
              requiredInput: "真实工作记录",
              decision: "判断最重要的进展",
              action: "整理重点",
              result: "周报重点卡",
              feedback: "实际使用后的困难",
              nextCycleUpdate: "据反馈调整",
            },
            acquisitionContract: {
              trigger: "第一次求助",
              requiredInput: "一件真实工作记录",
              includedSteps: customPeriod ? ["澄清", "整理", "交付重点卡"] : ["记录进度", "连续7天每日跟进", "答疑", "根据反馈修改方案"],
              completionCriteria: customPeriod ? "有一件进展及需要协助的点" : "连续7天的跟进和方案调整完成",
              excludedSteps: [],
              conversionBridge: "后续每周继续调整",
            },
            stages,
            transitions,
            semanticChecks,
            price: customPeriod ? 199 : 99,
            cadence: "每周",
            deliveries: paidDeliveries,
            conversationLimit: "unlimited",
            maintenanceContract: { basicConversation: true, allowedQuestions: "日常交流、普通答疑、理解已有结果" },
            toolLimit: "仅整理结果",
            humanReview: false,
            experienceMode: "conversation",
            widget: "纯对话",
          };
          return {
            intent: "answer",
            serviceMode,
            artifacts: [
              patch(
                "service",
                "service.blueprint",
                "blueprint",
                "周报搭子的服务模式",
                serviceInput,
                i,
                data,
              ),
            ],
            delivery: {
              text: "三阶段、五条动线与订阅周期已整理为完整蓝图，请校准这套服务约定。",
              confirmationObjectIds: ["service.blueprint"],
            },
          };
        });
        await turn("确认整个服务蓝图，包括三阶段、五条动线和订阅周期约定。", (i) => ({
          intent: "confirm",
          confirmation: confirm(i),
          artifacts: chapters("service", i),
          delivery: {
            text: "服务蓝图已经确认，九章服务手册已整理完成。",
            confirmationObjectIds: bookIds("service"),
            confirmationScope: "booklet",
          },
        }));
        await turn("确认全部九章服务手册。", (i) => ({
          intent: "confirm",
          confirmation: confirm(i),
          delivery: {
            text: "四份手册已经确认，正在整理本地创作成果。",
          },
        }));
        const completion = completionSnapshot(store);
        assert.equal(completion?.status, "ready", "final confirmation automatically saves local deliverables");
        assert.equal(completion?.revision, store.load().revision);
        assert.equal(existsSync(store.path("handoffs")), false);
        assert.equal(existsSync(store.path("exports")), false, "completion does not create a ZIP");
        const receipt = exportHandoff(store, "export-1"),
          archive = unzipSync(readFileSync(receipt.path));
        assert.equal(Object.keys(archive).filter((k) => k.startsWith("booklets/")).length, 4);
        assert.ok(archive["sources/catalog.json"]);
        assert.ok(archive["service-diagram.svg"]);
        assert.ok(strFromU8(archive["service-diagram.svg"]!).includes(customPeriod ? "¥199 / 8周" : "¥99 / 1个月"));
        assert.deepEqual(JSON.parse(strFromU8(archive["service-blueprint.json"]!)).data.billingCycle,
          customPeriod ? { count: 8, unit: "week" } : "monthly");
        assert.ok(archive["interview/inputs.json"]);
        assert.equal(JSON.parse(strFromU8(archive["MANIFEST.json"]!)).complete, true);
        // Simulate missing completion-side records, then immediately receive a revision.
        // begin must not dispatch the old design while checking the previous turn.
        const oldDispatch = store.path("deliverables", completion!.revision);
        rmSync(oldDispatch, { recursive: true, force: true });
        const before = store.load(),
          d01 = structuredClone(before.targets.D01!),
          oldCycle = before.targets.D02!.cycleId;
        await turn("方向调整：用户改为独立老师，帮助她们把一周教学情况说清楚。", (i) => ({
          intent: "revise",
          majorChange: {
            affectedTargets: ["D02"],
            reason: "audience",
            evidence: [evidence(i)],
          },
          assessments: [
            {
              targetId: "D02",
              status: "sufficient",
              summary: "独立老师复盘教学情况",
              gaps: [],
              evidence: [evidence(i)],
            },
          ],
          artifacts: [
            patch(
              "definition",
              "definition.2",
              "chapter",
              "目标用户",
              "独立老师，希望把一周教学情况说清楚。",
              i,
            ),
          ],
          delivery: {
            text: "目标用户已改为独立老师，相关下游内容需要重新校准。请先查看这份用户定义。",
            confirmationObjectIds: ["definition.2"],
          },
        }));
        assert.notEqual(store.load().targets.D02!.cycleId, oldCycle);
        assert.deepEqual(store.load().targets.D01, d01);
        assert.equal(confirmed(store.load(), "definition.1"), true);
        assert.equal(confirmed(store.load(), "knowledge.1"), false);
        assert.equal(completionSnapshot(store), undefined, "old completion cannot represent an unconfirmed revision");
        assert.equal(existsSync(oldDispatch), false, "a newly received correction blocks finalizing the previous design");
        assert.throws(() => exportHandoff(store, "export-2"), /尚未完成确认/);
      } finally {
        flow.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
