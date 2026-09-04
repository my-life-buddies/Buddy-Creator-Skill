import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, BookOpen, CaretDown, ChatCircle, Check, Copy, ListBullets } from "@phosphor-icons/react";
import { ServicePreview } from "./ServicePreview";
import { StructureDialog } from "./StructureDialog";
import type { previewSnapshot } from "../src/preview";
import type { Stage } from "../src/types";
import "./style.css";
import "./service.css";

type Snapshot = ReturnType<typeof previewSnapshot>;
type ReadingView = "interview" | "booklet";
type Connection = "connecting" | "online" | "offline";
function ActivityStatus({ activity, connection }: { activity: Snapshot["activity"]; connection: Connection }) {
  const visible = connection === "online" ? activity : null;
  const label = connection === "offline" ? "正在重新连接" : connection === "connecting" ? "连接中" : visible?.label ?? "已同步";
  const animated = visible?.mode === "working";
  return <div className={`activity-status ${visible?.mode ?? connection}`} role="status" aria-live="polite" aria-atomic="true">
    <span className="activity-line">
      {animated ? <span className="activity-dots" aria-hidden="true"><i /><i /><i /></span> : <span className="activity-dot" aria-hidden="true" />}
      <span>{label}</span>
    </span>
    {connection === "offline" ? <small>已保留最近内容，恢复后自动同步</small> : visible?.detail && <small>{visible.detail}</small>}
  </div>;
}
function CompletionNotice({ completion }: { completion: NonNullable<Snapshot["completion"]> }) {
  return <section className={`completion-notice ${completion.status}`} data-reading-anchor aria-label="创作成果" aria-live="polite">
    <h2>{completion.status === "ready" ? "创作完成" : "手册已确认，成果待生成"}</h2>
    <p>{completion.message}{completion.status === "failed" ? "回主对话说“重试生成”即可继续。" : "可在下方查看四册内容。"}</p>
  </section>;
}
function preferredView(data: Snapshot, stage = data.stage): ReadingView {
  const chapters = data.artifacts.filter((a) => a.stage === stage && a.kind === "chapter");
  const reviewingBooklet = chapters.some((a) => data.current.artifactIds.includes(a.id));
  return (stage !== data.stage && chapters.length > 0) || reviewingBooklet ||
    (stage === data.stage && data.current.phase === "创作完成") ? "booklet" : "interview";
}
export type VisibleArtifact = Snapshot["artifacts"][number];
export const labels: Record<string, string> = {
  queued: "等待读取", running: "正在读取", ready: "资料就绪", failed: "需要处理",
  confirmed: "已确认", accepted: "已采纳", pending: "待确认", revised: "待重新确认", rejected: "未采纳",
};
function Prose({ text }: { text: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: () => null,
  }}>{text}</Markdown>;
}
function Status({ status }: { status: string }) {
  return <span className={`status ${status}`}>{["confirmed", "accepted"].includes(status) && <Check size={13} />}{labels[status] ?? status}</span>;
}
function ArtifactBody({ artifact: a }: { artifact: VisibleArtifact }) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`请修改《${a.title}》：\n[Buddy 对象 ${a.id}；版本 ${a.hash}]\n需要修改的内容：`);
      setCopied(true); setCopyError("");
      clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2400);
    } catch { setCopyError("未能复制，请在对话中提及本节标题和修改内容。"); }
  }
  return <>
    <div className="prose"><Prose text={a.markdown} />
      {a.kind === "transition" && a.data && <dl>{Object.entries({ trigger: "何时发生", rightsChange: "服务权益", dataInheritance: "历史与进度", message: "对用户的表达" }).map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{String(a.data![key] ?? "待讨论")}</dd></React.Fragment>)}</dl>}
    </div>
    {a.unresolved.length > 0 && <div className="unresolved"><strong>待补充</strong>{a.unresolved.map((x, i) => <p key={i}>{x}</p>)}</div>}
    <footer className="paper-footer">
      {a.evidence.length > 0 && <details><summary>查看引用</summary>{a.evidence.map((r, i) => <blockquote key={i}>{r.quote || "已归档内容"}<small>{r.type === "input" ? "创作者原话" : r.type === "source" ? "知识来源" : "已形成内容"} · {r.locator || r.id}</small></blockquote>)}</details>}
      <button className="text-button" onClick={() => void copy()}><Copy size={14} />{copied ? "已复制引用" : "复制修改引用"}</button>
    </footer>
    {copyError && <p className="copy-error" role="status">{copyError}</p>}
  </>;
}
function Drafts({ drafts }: { drafts: Snapshot["drafts"] }) {
  return <>{drafts.map((d) => d && <section key={d.stepId} className="draft" data-buddy-draft-id={d.id} data-buddy-version={d.hash}>
    <span className="status">正在整理 · 尚未确认</span><h2>{d.title}</h2><div className="prose"><Prose text={d.markdown} /></div>
  </section>)}</>;
}
function App() {
  const [live, setLive] = useState<Snapshot>(), [reading, setReading] = useState<Snapshot>();
  const [selected, setSelected] = useState<Stage>(), [following, setFollowing] = useState(true);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [openObjects, setOpenObjects] = useState<string[]>([]);
  const [view, setView] = useState<ReadingView>("interview"), [structureOpen, setStructureOpen] = useState(false);
  const followingRef = useRef(true), latestRef = useRef<Snapshot>(undefined), headerRef = useRef<HTMLElement>(null);
  const readingAnchor = useRef<{ id?: string; offset: number; scroll: number } | undefined>(undefined);
  const stageStartPending = useRef(false);
  const [headerHeight, setHeaderHeight] = useState(155);
  useLayoutEffect(() => {
    if (stageStartPending.current) {
      stageStartPending.current = false;
      readingAnchor.current = undefined;
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    const anchor = readingAnchor.current;
    readingAnchor.current = undefined;
    if (!anchor) return;
    const element = anchor.id ? document.getElementById(anchor.id) : null;
    const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0;
    window.scrollTo({ top: element ? window.scrollY + element.getBoundingClientRect().top - headerBottom - anchor.offset : anchor.scroll, behavior: "instant" });
  }, [reading]);
  useEffect(() => {
    if (!following) return;
    const section = document.querySelector(view === "booklet" ? ".booklet-cover" : ".current-section");
    if (!section) return;
    const observer = new IntersectionObserver(([entry]) => {
      // Ignore a queued observation of the previous stage after a transition.
      if (latestRef.current?.stage !== reading?.stage) return;
      if (entry && !entry.isIntersecting && entry.boundingClientRect.bottom <= headerHeight) {
        followingRef.current = false; setFollowing(false);
      }
    }, { rootMargin: `-${headerHeight}px 0px 0px 0px` });
    observer.observe(section); return () => observer.disconnect();
  }, [following, headerHeight, reading?.stage, view]);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.getBoundingClientRect().height));
    observer.observe(header); return () => observer.disconnect();
  }, [Boolean(live)]);
  useEffect(() => {
    let active = true, queued = false, failures = 0, streamUnavailable = false;
    let request: AbortController | undefined, events: EventSource | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let requestTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSnapshot = "";
    const schedule = (delay: number) => {
      clearTimeout(refreshTimer);
      if (active) refreshTimer = setTimeout(() => void update(), delay);
    };
    const update = async () => {
      if (!active) return;
      // Coalesce focus, SSE and timer refreshes; an older response can never
      // overtake a newer one or keep an unbounded queue of requests alive.
      if (request) { queued = true; return; }
      clearTimeout(refreshTimer);
      const controller = new AbortController();
      request = controller;
      requestTimer = setTimeout(() => controller.abort(), 8000);
      let succeeded = false;
      try {
        const response = await fetch("./api/snapshot", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("读取中断");
        const next: Snapshot = await response.json();
        if (!active || controller.signal.aborted) return;
        succeeded = true; failures = 0; setConnection("online");
        // Native SSE reconnects while CONNECTING. Only replace a permanently
        // closed stream, closing its old handle before opening another one.
        if (events?.readyState === EventSource.CLOSED) connectEvents();
        const serialized = JSON.stringify(next);
        if (serialized === lastSnapshot) return;
        lastSnapshot = serialized;
        const stageChanged = latestRef.current && latestRef.current.stage !== next.stage;
        if (stageChanged) {
          // A real interview-stage transition takes precedence over browsing.
          // Same-stage updates continue to preserve the reader's chosen position.
          readingAnchor.current = undefined;
          stageStartPending.current = true;
          followingRef.current = true; setFollowing(true);
          setOpenObjects([]); setStructureOpen(false);
        } else if (!followingRef.current) {
          const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0;
          const anchor = Array.from(document.querySelectorAll<HTMLElement>("[data-buddy-object-id], [data-reading-anchor]"))
            .find((element) => element.id && element.getBoundingClientRect().bottom > headerBottom && element.getBoundingClientRect().top < window.innerHeight);
          readingAnchor.current = { id: anchor?.id, offset: anchor ? anchor.getBoundingClientRect().top - headerBottom : 0, scroll: window.scrollY };
        }
        latestRef.current = next; setLive(next);
        // Reading controls navigation only. Saved content must always stay live.
        setReading(next);
        if (followingRef.current) { setSelected(next.stage); setView(preferredView(next)); }
      } catch {
        if (active) { failures += 1; setConnection("offline"); }
      } finally {
        clearTimeout(requestTimer);
        request = undefined;
        if (active) {
          const nextDelay = succeeded ? (queued ? 0 : 30000) : Math.min(2000 * 2 ** Math.min(Math.max(failures - 1, 0), 3), 15000);
          queued = false;
          schedule(nextDelay);
        }
      }
    };
    const connectEvents = () => {
      events?.close();
      const stream = new EventSource("./api/events");
      events = stream;
      streamUnavailable = false;
      const changed = () => {
        if (!active || events !== stream) return;
        streamUnavailable = false;
        void update();
      };
      const disconnected = () => {
        if (!active || events !== stream) return;
        const firstFailure = !streamUnavailable;
        streamUnavailable = true;
        setConnection("offline");
        // Repeated SSE errors must not continually reset the HTTP backoff.
        if (firstFailure && !request && failures === 0) schedule(2000);
      };
      stream.addEventListener("ready", changed);
      stream.addEventListener("changed", changed);
      stream.addEventListener("unavailable", disconnected);
      stream.onerror = disconnected;
    };
    connectEvents();
    void update();
    const refreshVisible = () => { if (!document.hidden) void update(); };
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false; events?.close(); request?.abort();
      clearTimeout(refreshTimer); clearTimeout(requestTimer);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);
  function browse() { followingRef.current = false; setFollowing(false); }
  function goCurrent() {
    const next = latestRef.current;
    if (!next) return;
    readingAnchor.current = undefined;
    followingRef.current = true; setFollowing(true); setReading(next); setSelected(next.stage); setView(preferredView(next)); setOpenObjects([]);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function navigate(stage: Stage) {
    readingAnchor.current = undefined;
    browse(); setSelected(stage); setOpenObjects([]);
    // Keep the chosen stage until the interview itself moves to another stage.
    if (latestRef.current) { setReading(latestRef.current); setView(preferredView(latestRef.current, stage)); }
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function switchView(next: ReadingView) {
    readingAnchor.current = undefined;
    browse(); setView(next); setOpenObjects([]);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function reveal(id: string) {
    readingAnchor.current = undefined;
    browse(); setStructureOpen(false);
    const artifact = reading?.artifacts.find((a) => a.id === id);
    if (artifact) setView(artifact.kind === "chapter" ? "booklet" : "interview");
    setOpenObjects((old) => [...new Set([...old, id])]);
    requestAnimationFrame(() => {
      const element = document.getElementById(id);
      element?.scrollIntoView({ block: "start", behavior: "instant" });
      element?.focus({ preventScroll: true });
    });
  }
  if (!reading || !live || !selected) return <main className="loading" aria-busy={connection !== "offline"}>
    <h1>{connection === "offline" ? "暂时无法打开手册" : "正在打开创作手册"}</h1>
    <p>{connection === "offline" ? "正在自动重试。" : ""}</p><div className="loading-lines" aria-hidden="true"><i /><i /><i /></div>
  </main>;
  const stage = reading.stages.find((s) => s.id === selected)!;
  const focus = selected === reading.current.stage ? reading.artifacts.filter((a) => reading.current.artifactIds.includes(a.id)) : [];
  const chapters = reading.artifacts.filter((a) => a.stage === selected && a.kind === "chapter");
  const working = reading.artifacts.filter((a) => a.stage === selected && ["hypothesis", "scenario", "transition"].includes(a.kind));
  const focusIds = new Set(focus.map((a) => a.id));
  const currentTitle = live.stages.find((s) => s.id === live.current.stage)!.title;
  const onCurrent = selected === reading.current.stage;
  const completion = live.completion?.revision === live.revision ? live.completion : undefined;
  const position = live.current.position;
  const blueprint = reading.artifacts.find((a) => a.id === "service.blueprint");
  const drafts = onCurrent ? reading.drafts.filter((d) => Boolean(d)) : [];
  const primary = focus.length === 1 ? focus[0] : undefined;
  const records = [
    { kind: "hypothesis", title: primary?.kind === "hypothesis" ? "其他方法候选" : "方法候选" },
    { kind: "scenario", title: "情境记录" },
    { kind: "transition", title: "用户路径" },
  ].map((group) => ({ ...group, artifacts: working.filter((a) => a.kind === group.kind && !focusIds.has(a.id)) })).filter((group) => group.artifacts.length);
  const notes = stage.groups.filter((g) => g.id !== "booklet" || selected === "definition")
    .flatMap((g) => g.topics).filter((t) => t.summary && !t.current && !t.artifactId);
  const pendingChapters = chapters.filter((a) => ["pending", "revised"].includes(a.status)).length;
  const currentIsBooklet = focus.some((a) => a.kind === "chapter");
  const renderChapter = (a: VisibleArtifact) => <article id={a.id} tabIndex={-1} data-buddy-object-id={a.id} data-buddy-version={a.hash} key={a.id} className={`chapter ${onCurrent && focusIds.has(a.id) ? "chapter-current" : ""}`}>
    <div className="chapter-head"><span className="chapter-number">{a.id.split(".").at(-1)?.padStart(2, "0")}</span><h3>{a.title}</h3><Status status={a.status} /></div>
    <div className="chapter-body"><ArtifactBody artifact={a} /></div>
  </article>;
  return <div className="shell" style={{ "--header-height": `${headerHeight}px` } as React.CSSProperties}
    onWheelCapture={() => browse()} onTouchMove={() => browse()}
    onKeyDownCapture={(event) => { if (["PageDown", "PageUp", "End", "Home"].includes(event.key)) browse(); }}>
    <header className="preview-header" ref={headerRef}>
      <div className="header-inner">
        <div className="brand-row"><div className="brand"><strong>Buddy</strong><span className="project-name" title={live.buddyId}>{live.buddyId}</span></div>
          <ActivityStatus activity={live.activity} connection={connection} />
        </div>
        <nav aria-label="访谈阶段" className="stage-nav">{live.stages.map((s) => <button key={s.id} aria-label={`${s.title}，${s.status}${s.current ? "，当前阶段" : ""}`} aria-current={selected === s.id ? "page" : undefined} className={`stage-link ${selected === s.id ? "selected" : ""} ${s.current ? "in-progress" : ""}`} onClick={() => navigate(s.id)}>
          <span className="step-number">{s.status === "已确认" ? <Check size={14} /> : s.number}</span>
          <span className="stage-copy"><span className="stage-name">{s.title}</span><small>{s.current ? "当前阶段" : s.status}</small></span>
        </button>)}</nav>
        {!following && <div className="position-row"><span><span className="muted">访谈进行到</span> {currentTitle} / {live.current.phase}{position && <span className="position-count">{position.index} / {position.total}</span>}</span>
          <button className="text-button" onClick={goCurrent}><ArrowUp size={13} />回到当前内容</button>
        </div>}
      </div>
    </header>
    <main className="workspace">
      {connection === "offline" && <div className="notice" role="status">连接中断，当前显示最近的内容。恢复后自动更新。</div>}
      {reading.continuation && <div className="notice" role="status">{reading.continuation}</div>}
      {completion && <CompletionNotice completion={completion} />}
      <div className="stage-heading"><div><h1>{stage.title}</h1><span className="stage-heading-status">{reading.paused && onCurrent ? "已暂停" : stage.status}</span></div>
        <button className="structure-button" onClick={() => { browse(); setStructureOpen(true); }}><ListBullets size={16} />访谈结构</button>
      </div>
      <div className="view-tabs" role="tablist" aria-label="内容视图" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next: ReadingView = event.key === "Home" ? "interview" : event.key === "End" ? "booklet" : view === "interview" ? "booklet" : "interview";
        switchView(next); requestAnimationFrame(() => document.getElementById(`view-tab-${next}`)?.focus());
      }}>
        <button role="tab" id="view-tab-interview" aria-controls="view-panel" aria-selected={view === "interview"} tabIndex={view === "interview" ? 0 : -1} onClick={() => switchView("interview")}><ChatCircle size={16} />访谈内容</button>
        <button role="tab" id="view-tab-booklet" aria-controls="view-panel" aria-selected={view === "booklet"} tabIndex={view === "booklet" ? 0 : -1} onClick={() => switchView("booklet")}><BookOpen size={16} />Booklet{pendingChapters > 0 ? <span className="tab-count">{pendingChapters} 待确认</span> : chapters.length > 0 ? <span className="tab-count">{chapters.length}</span> : null}</button>
      </div>
      <div id="view-panel" role="tabpanel" aria-labelledby={`view-tab-${view}`}>
        {view === "interview" ? <>
          {onCurrent && !(completion && reading.current.phase === "创作完成") && <section className="current-section" id="current-discussion" data-reading-anchor aria-label="当前讨论">
            <div className="focus-paper" id={primary && !currentIsBooklet && primary.kind !== "blueprint" ? primary.id : undefined} tabIndex={-1} data-buddy-object-id={primary && !currentIsBooklet && primary.kind !== "blueprint" ? primary.id : undefined} data-buddy-version={primary && !currentIsBooklet ? primary.hash : undefined}>
              <div className="focus-context"><strong>{reading.paused ? "已暂停" : "当前讨论"}</strong><span>{reading.current.phase}{reading.current.position && ` · 第 ${reading.current.position.index} 项 / 共 ${reading.current.position.total} 项`}</span></div>
              <div className="focus-content">
                {primary && !currentIsBooklet && primary.kind !== "blueprint" ? <><div className="focus-title"><h2>{primary.title}</h2><Status status={primary.status} /></div><ArtifactBody artifact={primary} /></>
                  : currentIsBooklet ? <div className="focus-summary"><h2>{stage.title}手册待确认</h2><p>讨论内容已整理为章节。</p><button className="text-button" onClick={() => switchView("booklet")}>查看 Booklet</button></div>
                  : <div className="focus-summary"><h2>{reading.current.title}</h2>{reading.current.summary && <p>{reading.current.summary}</p>}{!reading.current.summary && <p>{reading.current.phase === "创作完成" ? "四本手册已确认，可继续在对话中提出优化。" : "在主对话中继续，内容会同步到这里。"}</p>}</div>}
              </div>
            </div>
          </section>}
          <Drafts drafts={drafts} />
          {selected === "service" && <ServicePreview artifact={blueprint} paths={working.filter((a) => a.kind === "transition")} onBrowse={browse} />}
          {records.map((group) => <section className="record-group" key={group.kind} aria-label={group.title}>
            <div className="record-heading"><h2>{group.title}</h2><span>{group.artifacts.length} 项</span></div>
            {group.artifacts.map((a) => <details className="artifact-fold" id={a.id} tabIndex={-1} data-buddy-object-id={a.id} data-buddy-version={a.hash} key={a.id} open={openObjects.includes(a.id)}>
              <summary onClick={(event) => { event.preventDefault(); browse(); setOpenObjects((old) => old.includes(a.id) ? old.filter((id) => id !== a.id) : [...old, a.id]); }}><span>{a.title}</span><Status status={a.status} /><CaretDown size={14} /></summary><div className="fold-body"><ArtifactBody artifact={a} /></div>
            </details>)}
          </section>)}
          {notes.length > 0 && <section className="notes-group"><div className="record-heading"><h2>已记录要点</h2></div><dl>{notes.map((note) => <div key={note.id} id={`topic.${note.id}`} data-reading-anchor><dt>{note.title}</dt><dd>{note.summary}</dd></div>)}</dl></section>}
          {!onCurrent && !records.length && !notes.length && selected !== "service" && <div className="view-empty"><ChatCircle size={25} /><h2>{chapters.length ? "本阶段访谈已整理" : "本阶段尚未开始"}</h2><p>{chapters.length ? "完整内容可在 Booklet 中阅读。" : "开始讨论后，关键内容会记录在这里。"}</p>{chapters.length > 0 && <button className="text-button" onClick={() => switchView("booklet")}>阅读 Booklet</button>}</div>}
          {selected === "knowledge" && <section className="sources"><div className="record-heading"><h2>知识资料</h2><span>{reading.sources.length} 项</span></div>{!reading.sources.length ? <p className="empty">尚未选择资料，也可以在对话中补充口述经验。</p> : reading.sources.map((s) => <article key={s.id}><div><strong>{s.title}</strong>{s.error && <p>{s.error}</p>}{s.warnings.map((w, i) => <p key={i}>{w}</p>)}</div><Status status={s.status} /></article>)}</section>}
        </> : <section className="booklet" aria-label={`${stage.title}手册`}>
          <Drafts drafts={drafts} />
          {chapters.length > 0 ? <div className="booklet-document">
            <div className="booklet-cover" id={`booklet.${selected}`} data-reading-anchor><BookOpen size={25} /><div><h2>{stage.title}手册</h2><p>{stage.confirmedChapters === stage.totalChapters ? "全部章节已确认" : `${stage.confirmedChapters} / ${stage.totalChapters} 章已确认`}</p></div><span className="document-count">{chapters.length} 章</span></div>
            {chapters.map(renderChapter)}
          </div> : <div className="booklet-empty"><BookOpen size={28} /><h2>{stage.title}手册尚未形成</h2><p>本阶段讨论完成后，将整理为以下章节。</p><ol>{stage.groups.find((g) => g.id === "booklet")?.topics.map((topic) => <li key={topic.id}>{topic.title}</li>)}</ol></div>}
        </section>}
      </div>
      <footer className="page-footer">只读预览，修改与确认请在主对话中提出。</footer>
    </main>
    {structureOpen && <StructureDialog stage={stage} onReveal={reveal} onClose={() => setStructureOpen(false)} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<App />);
