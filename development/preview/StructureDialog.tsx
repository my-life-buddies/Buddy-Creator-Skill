import { useEffect, useRef } from "react";
import { ArrowUpRight, Check, X } from "@phosphor-icons/react";
import type { previewSnapshot } from "../src/preview";

type PreviewStage = ReturnType<typeof previewSnapshot>["stages"][number];

export function StructureDialog({ stage, onReveal, onClose }: {
  stage: PreviewStage;
  onReveal: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();
    return () => { modal.close(); document.body.style.overflow = overflow; };
  }, []);
  return <dialog ref={dialog} className="structure-dialog" aria-labelledby="structure-title" onClose={onClose}>
    <header className="dialog-header">
      <div><span className="dialog-context">{stage.title}</span><h2 id="structure-title">访谈结构</h2></div>
      <button className="icon-button" aria-label="关闭访谈结构" onClick={() => dialog.current?.close()} autoFocus><X size={20} /></button>
    </header>
    <div className="structure-content">
      {stage.groups.map((group, index) => <section key={group.id} className="structure-group">
        <div className="structure-group-title"><span className="structure-index">{index + 1}</span><h3>{group.title}</h3></div>
        {!group.topics.length && <p className="empty">尚未形成候选</p>}
        <div className="structure-topics">{group.topics.map((topic) => <div className={`outline-topic ${topic.current ? "current" : ""}`} key={topic.id}>
          {topic.artifactId ? <button onClick={() => { dialog.current?.close(); onReveal(topic.artifactId!); }}>{topic.title}<ArrowUpRight size={13} /></button> : <span>{topic.title}</span>}
          <small>{topic.current ? "当前" : ["已确认", "已采纳"].includes(topic.status) ? <><Check size={12} />{topic.status}</> : topic.status}</small>
        </div>)}</div>
      </section>)}
    </div>
  </dialog>;
}
