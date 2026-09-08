"""Read-only, local preview for Buddy Creator Skill.

The bundled browser application is prebuilt static JavaScript: running it in a
browser does not require Node.js. Business writes belong exclusively to core.py.
"""

import contextlib
import datetime
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent.parent
RUNTIME_VERSION = "buddy-creator-" + json.loads((ROOT / "version.json").read_text(encoding="utf-8"))["version"]
COMPATIBLE_RUNTIME_VERSIONS = {RUNTIME_VERSION, "buddy-creator-1.2.0", "buddy-creator-1.1.0", "buddy-creator-1.0.0", "python-trial-1"}
STAGES = ("definition", "knowledge", "methods", "service")
STAGE_LABELS = dict(zip(STAGES, ("定义", "知识", "方法", "服务")))
LABELS = {"confirmed": "已确认", "accepted": "已采纳", "rejected": "未采纳",
          "pending": "待确认", "revised": "待重新确认"}
PATHS = {"acquisition-paid": "体验后订阅", "acquisition-maintenance": "暂不订阅",
         "paid-paid": "续费", "paid-maintenance": "停止续费", "maintenance-paid": "恢复订阅"}


def _read(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _optional(path):
    try:
        return _read(path)
    except FileNotFoundError:
        return None


def _write(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + "." + secrets.token_hex(8) + ".tmp")
    try:
        descriptor = os.open(str(temporary), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary), str(path))
        if os.name != "nt":
            directory = os.open(str(path.parent), os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def _fail(code, message):
    raise RuntimeError(code + ": " + message)


def _decision(state, artifact, decision="confirmed"):
    return any(c.get("objectId") == artifact["id"] and c.get("hash") == artifact.get("hash")
               and not c.get("invalidatedBy") and c.get("decision") == decision
               for c in state.get("confirmations", []))


def _status(state, artifact):
    for decision in ("confirmed", "accepted", "rejected"):
        if _decision(state, artifact, decision):
            return decision
    return "revised" if any(c.get("objectId") == artifact["id"]
                            for c in state.get("confirmations", [])) else "pending"


def _book_confirmed(state, stage, chapters):
    artifacts = state.get("artifacts", {})
    return bool(chapters[stage]) and all(
        artifacts.get(stage + "." + str(i + 1))
        and _decision(state, artifacts[stage + "." + str(i + 1)])
        for i in range(len(chapters[stage])))


def _object_for_target(state, target_id):
    candidate = None
    if re.fullmatch(r"H\d+", target_id):
        candidate = "hypothesis.H" + str(int(target_id[1:]))
    elif re.fullmatch(r"[ME]\d+", target_id):
        candidate = "scenario." + target_id
    elif target_id.startswith("T."):
        candidate = "transition." + target_id.split(".")[1]
    elif re.fullmatch(r"D\d+", target_id):
        candidate = "definition." + str(int(target_id[1:]))
    return candidate if candidate in state.get("artifacts", {}) else None


def _phase(target_id, stage):
    target_id = target_id or ""
    if target_id.startswith(("hypothesis.", "H")):
        return "候选校准"
    if target_id.startswith(("scenario.M", "M")):
        return "基础情境"
    if target_id.startswith(("scenario.E", "E")):
        return "拓展情境"
    if target_id.startswith(("T.", "transition.")):
        return "用户路径"
    if target_id == "service.blueprint":
        return "服务模式确认"
    if target_id == "R00":
        return "本次优化"
    if target_id == "S00":
        return "规划方式"
    if re.fullmatch(r"(definition|knowledge|methods|service)\.\d+", target_id):
        return "手册确认"
    return {"definition": "创作定义", "knowledge": "知识整理",
            "methods": "候选校准", "service": "服务规划"}[stage]


def _artifact_view(state, artifact):
    # Do not expose dependencies, raw turn input, archives, local paths or host
    # context. Only authored public content and its selected citations are sent.
    view = {key: artifact.get(key) for key in ("id", "stage", "kind", "title", "hash")}
    view.update(markdown=artifact.get("markdown", ""), data=artifact.get("data") or {},
                unresolved=artifact.get("unresolved") or [], status=_status(state, artifact))
    view["evidence"] = [{key: ref[key] for key in ("type", "id", "hash", "locator", "quote")
                         if key in ref} for ref in artifact.get("evidence", [])]
    return view


def _time(value):
    try:
        return datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError, OverflowError):
        return 0


def _activity(state, drafts):
    if state.get("paused"):
        return {"mode": "paused", "label": "已暂停"}
    pending = state.get("turns", {}).get(state.get("pendingTurnId"))
    if pending and pending.get("status") == "working":
        last_signal = max([_time(pending.get("updatedAt") or pending.get("createdAt"))]
                          + [_time(d.get("updatedAt")) for d in drafts])
        elapsed = max(0, time.time() - last_signal)
        if not last_signal or elapsed >= 120:
            return {"mode": "waiting", "label": "本轮还未完成", "detail": "回主对话查看进展"}
        result = {"mode": "working", "label": "正在整理手册" if drafts else "正在梳理你的想法"}
        if elapsed >= 30:
            result["detail"] = "可先阅读已有内容"
        return result
    selected = state.get("sourcePlan", {}).get("sourceIds", [])
    if any(s.get("status") == "failed" for s in state.get("sources", {}).values() if s.get("id") in selected):
        return {"mode": "attention", "label": "资料需要处理", "detail": "回主对话查看原因"}
    current_delivery = state.get("currentDeliveryId")
    if current_delivery and current_delivery not in state.get("presentations", []):
        return {"mode": "ready", "label": "回复已整理", "detail": "等待主对话展示"}
    return None


def snapshot(workspace, state=None):
    workspace = Path(workspace)
    state = state if state is not None else _read(workspace / "state.json")
    catalog = _read(ROOT / "references" / "catalog.json")
    cards, chapters = catalog["cards"], catalog["chapters"]
    stage = state["stage"]
    targets = state.get("targets", {})
    artifacts = [_artifact_view(state, a) for a in state.get("artifacts", {}).values()]
    by_id = {a["id"]: a for a in artifacts}
    delivery = state.get("deliveries", {}).get(state.get("currentDeliveryId"), {})
    if delivery.get("resumeDeliveryId"):
        delivery = state.get("deliveries", {}).get(delivery["resumeDeliveryId"], delivery)
    target_id = (delivery.get("question") or {}).get("targetId")
    if cards.get(target_id, {}).get("stage") != stage:
        target_id = None
    confirmation = delivery.get("confirmationTarget") or {}
    requested = [r["id"] for r in confirmation.get("objects", [])
                 if confirmation.get("stage") == stage and by_id.get(r.get("id"), {}).get("hash") == r.get("hash")]
    hypotheses = sorted([a for a in artifacts if a["kind"] == "hypothesis"], key=lambda a: a["id"])
    target_object = _object_for_target(state, target_id) if target_id else None
    complete = all(_book_confirmed(state, s, chapters) for s in STAGES)
    focus_ids = [target_object] if target_object else [a_id for a_id in requested
                                                    if by_id[a_id]["status"] in ("pending", "revised")]
    if not focus_ids and not target_id:
        candidate = next((a for a in artifacts if a["stage"] == stage and a["status"] in ("pending", "revised")), None)
        if candidate:
            focus_ids = [candidate["id"]]
    focus = by_id.get(focus_ids[0]) if focus_ids else None
    first_target = next((i for i, c in cards.items() if c["stage"] == stage
                         and not i.startswith(("H", "T.", "R00"))
                         and targets.get(i, {}).get("status", "unstarted") == "unstarted"), None)
    current_target = target_id or (first_target if not focus and not complete
                                    and not (stage == "methods" and not hypotheses) else None)
    topic_title = cards.get(current_target, {}).get("title")
    if current_target and current_target.startswith("T."):
        pieces = current_target.split(".")
        topic_title = PATHS.get(pieces[1], "用户路径") + " / " + ("时点", "权益", "表达")[int(pieces[2]) - 1]
    def target_summary(identifier):
        item = targets.get(identifier, {})
        summary = item.get("summary", "")
        gaps = item.get("gaps", [])
        return summary + (("\n\n" if summary else "") + "待补：" + "；".join(gaps) if gaps else "")

    current = {
        "stage": stage,
        "phase": "创作完成" if complete and not target_id and not focus else _phase(current_target or (focus or {}).get("id"), stage),
        "title": STAGE_LABELS[stage] + "手册" if len(focus_ids) > 1 else
                 (focus or {}).get("title") or topic_title or ("四本手册已完成" if complete else "整理方法候选" if stage == "methods" else "整理当前内容"),
        "targetId": current_target,
        "artifactIds": focus_ids,
        "summary": target_summary(current_target) if current_target else delivery.get("blocked", ""),
        "status": "已暂停" if state.get("paused") else "待补充" if delivery.get("blocked") else LABELS[focus["status"]] if focus else "已完成" if complete else "讨论中",
    }
    if focus and focus["kind"] == "hypothesis":
        current["position"] = {"index": next(i + 1 for i, a in enumerate(hypotheses) if a["id"] == focus["id"]), "total": len(hypotheses)}

    def topic(identifier):
        object_id = _object_for_target(state, identifier)
        artifact = by_id.get(object_id)
        target = targets.get(identifier, {})
        return {"id": identifier,
                "title": artifact["title"] if artifact and artifact["kind"] == "hypothesis" else cards.get(identifier, {}).get("title", identifier),
                "summary": target_summary(identifier), "artifactId": object_id,
                "current": identifier == current_target or bool(object_id and object_id in focus_ids),
                "status": LABELS[artifact["status"]] if artifact else "已记录" if target.get("status") == "sufficient"
                else "已跳过" if target.get("status") == "skipped" else "待补充" if target.get("summary") or target.get("status") in ("uncertain", "exhausted") else "未开始"}

    stages = []
    for index, stage_id in enumerate(STAGES):
        identifiers = [i for i, c in cards.items() if c["stage"] == stage_id]
        groups = []
        if stage_id == "methods":
            groups.extend([
                {"id": "candidates", "title": "方法候选", "topics": [topic("H" + a["id"].split("H")[-1].zfill(2)) for a in hypotheses]},
                {"id": "base", "title": "基础情境", "topics": [topic(i) for i in identifiers if i.startswith("M")]},
                {"id": "extended", "title": "拓展情境", "topics": [topic(i) for i in identifiers if i.startswith("E")]},
            ])
        elif stage_id == "service":
            groups.append({"id": "planning", "title": "服务规划", "topics": [topic(i) for i in identifiers if i.startswith("S")]})
            path_topics = []
            for path_id, title in PATHS.items():
                artifact = by_id.get("transition." + path_id)
                path_topics.append({"id": "path." + path_id, "title": title, "summary": "",
                                    "artifactId": artifact["id"] if artifact else None,
                                    "current": bool(current_target and current_target.startswith("T." + path_id + ".")) or "transition." + path_id in focus_ids,
                                    "status": LABELS[artifact["status"]] if artifact else "系统固定" if path_id == "maintenance-paid" else "未开始"})
            groups.append({"id": "paths", "title": "用户路径", "topics": path_topics})
        elif stage_id == "knowledge":
            groups.append({"id": "interview", "title": "知识整理", "topics": [topic(i) for i in identifiers]})
        book_topics = []
        for chapter_index, title in enumerate(chapters[stage_id]):
            identifier = stage_id + "." + str(chapter_index + 1)
            artifact = by_id.get(identifier)
            target_key = "D" + str(chapter_index + 1).zfill(2) if stage_id == "definition" else None
            target = targets.get(target_key, {})
            book_topics.append({"id": identifier, "title": title, "summary": target_summary(target_key) if target_key else "",
                                "artifactId": artifact["id"] if artifact else None,
                                "current": identifier in focus_ids or bool(target_key and target_key == current_target),
                                "status": LABELS[artifact["status"]] if artifact else "已记录" if target.get("status") == "sufficient" else "待补充" if target.get("summary") else "待形成"})
        groups.append({"id": "booklet", "title": "Booklet", "topics": book_topics})
        members = [a for a in artifacts if a["stage"] == stage_id]
        status = ("已确认" if _book_confirmed(state, stage_id, chapters)
                  else "待重新确认" if any(a["status"] == "revised" for a in members)
                  else "待确认" if any(a["kind"] == "chapter" for a in members)
                  else "进行中" if stage_id == stage or any(targets.get(i, {}).get("status", "unstarted") != "unstarted" for i in identifiers)
                  else "未开始")
        stages.append({"id": stage_id, "number": index + 1, "title": STAGE_LABELS[stage_id],
                       "current": stage_id == stage, "status": status, "groups": groups,
                       "confirmedChapters": sum(a["kind"] == "chapter" and a["status"] == "confirmed" for a in members),
                       "totalChapters": len(chapters[stage_id])})
    pending_id = state.get("pendingTurnId")
    drafts = [d for d in state.get("drafts", []) if pending_id and d.get("turnId") == pending_id
              and state.get("turns", {}).get(pending_id, {}).get("status") == "working"]
    drafts.sort(key=lambda d: d.get("sequence", 0))
    visible_drafts = []
    for draft in drafts[-1:]:
        visible_drafts.append({"id": draft.get("id", "draft." + pending_id), "stepId": pending_id,
                               "title": draft.get("title", "手册草稿"), "markdown": draft.get("markdown", ""),
                               "hash": draft.get("hash") or hashlib.sha256(draft.get("markdown", "").encode("utf-8")).hexdigest()})
    sources = []
    for source in state.get("sources", {}).values():
        # Source processing error objects may contain local paths. Keep the
        # browser message actionable but generic; details stay in the main chat.
        sources.append({"id": source["id"], "title": source.get("title", "知识资料"),
                        "kind": source.get("kind", "file"), "status": source.get("status", "failed"),
                        "version": source.get("version"), "warnings": [],
                        "error": "资料尚未完整处理，请在主对话中补充或重试。" if source.get("status") == "failed" else None})
    completion_view = None
    try:
        import completion
        completion_view = completion.snapshot(workspace, state)
    except (OSError, ValueError, ImportError):
        if complete:
            completion_view = {"revision": state["revision"], "status": "failed", "message": "四册已确认，成果暂时无法读取。"}
    if completion_view:
        completion_view = {k: completion_view.get(k) for k in ("revision", "status", "message")}
    return {"buddyId": state["buddyId"], "revision": state["revision"], "stage": stage,
            "paused": bool(state.get("paused")), "activity": _activity(state, drafts),
            "completion": completion_view, "current": current, "stages": stages,
            "artifacts": artifacts, "sources": sources, "drafts": visible_drafts}


def _endpoint(workspace, workspace_id):
    endpoint = _optional(workspace / "preview-endpoint.json")
    if endpoint is not None and not (isinstance(endpoint, dict) and endpoint.get("version") == 1
            and endpoint.get("workspaceId") == workspace_id and type(endpoint.get("port")) is int
            and 1 <= endpoint["port"] <= 65535
            and isinstance(endpoint.get("token"), str) and re.fullmatch(r"[a-f0-9]{48}", endpoint["token"])):
        _fail("PREVIEW_ADDRESS_INVALID", "固定预览地址无效或属于其他搭子；已保留原记录。")
    return endpoint


def _url(endpoint):
    return "http://127.0.0.1:%s/p/%s/" % (endpoint["port"], endpoint["token"])


def _listening(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def _identity(endpoint, workspace_id, record):
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, request, response, code, message, headers, new_url):
            return None

    try:
        # Loopback health requests must not pass through configured HTTP proxies.
        with build_opener(ProxyHandler({}), NoRedirect()).open(Request(_url(endpoint) + "api/health"), timeout=1.2) as response:
            if response.geturl() != _url(endpoint) + "api/health":
                _fail("PREVIEW_IDENTITY_MISMATCH", "预览身份不匹配，未接管此端口。")
            identity = json.loads(response.read(8192).decode("utf-8"))
    except (OSError, HTTPError, URLError, ValueError):
        return False
    if not isinstance(identity, dict) or identity.get("workspaceId") != workspace_id or identity.get("runtimeVersion") not in COMPATIBLE_RUNTIME_VERSIONS:
        _fail("PREVIEW_IDENTITY_MISMATCH", "端口上的服务不属于当前版本的搭子预览，未接管或停止它。")
    if not record or identity.get("pid") != record.get("pid") or record.get("workspaceId") != workspace_id or record.get("url") != _url(endpoint):
        _fail("PREVIEW_IDENTITY_MISMATCH", "预览进程记录与端口上的服务不一致，未接管或停止它。")
    return True


def _alive(pid):
    if type(pid) is not int or pid <= 0:
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, OSError):
        return True


@contextlib.contextmanager
def _lock(workspace, name):
    path = workspace / name
    owner = {"pid": os.getpid(), "token": secrets.token_hex(12)}
    deadline = time.monotonic() + 12
    while True:
        try:
            descriptor = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(owner, handle)
                handle.flush()
                os.fsync(handle.fileno())
            break
        except FileExistsError:
            try:
                observed = _read(path)
                if not _alive(observed.get("pid")) and _read(path) == observed:
                    path.unlink()
                    continue
            except (OSError, ValueError, AttributeError):
                pass
            if time.monotonic() >= deadline:
                _fail("PREVIEW_BUSY", "预览启动正在进行或锁记录需检查，请稍后重试。")
            time.sleep(0.1)
    try:
        yield
    finally:
        with contextlib.suppress(OSError, ValueError):
            if _read(path) == owner:
                path.unlink()


def start(workspace):
    workspace = Path(workspace).resolve()
    state = _read(workspace / "state.json")
    workspace_id = state["workspaceId"]
    with _lock(workspace, ".preview-lifecycle.lock"):
        endpoint = _endpoint(workspace, workspace_id)
        record = _optional(workspace / "preview-server.json")
        if endpoint and _identity(endpoint, workspace_id, record):
            return {"url": _url(endpoint), "readonly": True, "addressPolicy": "stable_per_workspace"}
        if endpoint and _listening(endpoint["port"]):
            _fail("PREVIEW_PORT_IN_USE", "当前搭子的固定端口已被其他进程占用；保留原地址，未切换端口或停止其他程序。")
        arguments = [sys.executable, str(ROOT / "scripts" / "buddy.py"), "serve", "--workspace", str(workspace)]
        options = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
                   "cwd": str(ROOT), "close_fds": True}
        if os.name == "nt":
            options["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            options["start_new_session"] = True
        process = subprocess.Popen(arguments, **options)
        for _ in range(80):
            time.sleep(0.1)
            if process.poll() is not None:
                _fail("PREVIEW_START_FAILED", "本地预览未启动。可在主对话中重试打开；固定地址与已保存内容保持不变。")
            endpoint = _endpoint(workspace, workspace_id)
            record = _optional(workspace / "preview-server.json")
            if endpoint and record and record.get("pid") == process.pid and _identity(endpoint, workspace_id, record):
                return {"url": _url(endpoint), "readonly": True, "addressPolicy": "stable_per_workspace"}
        # Only stop the still-running child created by this invocation. Never
        # signal a PID recovered from disk or another listener on the port.
        if process.poll() is None:
            process.terminate()
        _fail("PREVIEW_START_FAILED", "本地预览启动超时；请稍后重试，固定地址已保留。")


def serve(workspace):
    workspace = Path(workspace).resolve()
    state = _read(workspace / "state.json")
    workspace_id = state["workspaceId"]
    assets = (ROOT / "assets" / "preview").resolve()
    if not (assets / "index.html").is_file():
        _fail("PREVIEW_ASSETS_MISSING", "安装包中的预览文件缺失，请重新解压完整安装包。")
    endpoint = _endpoint(workspace, workspace_id)
    token = endpoint["token"] if endpoint else secrets.token_hex(24)
    base = "/p/" + token + "/"
    streams = threading.BoundedSemaphore(16)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "BuddyPreview"
        sys_version = ""

        def log_message(self, format, *args):
            pass

        def send_error(self, code, message=None, explain=None):
            self.reply(code, "请求无法处理。".encode("utf-8"), "text/plain; charset=utf-8")

        def reply(self, code, body=b"", content_type="text/plain; charset=utf-8"):
            self.send_response(code)
            self.headers_for(content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def headers_for(self, content_type):
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'")

        def do_GET(self):
            expected_host = "127.0.0.1:" + str(self.server.server_port)
            if self.headers.get("Host") != expected_host or self.headers.get("Origin") not in (None, "http://" + expected_host):
                self.reply(403)
                return
            route_path = urlsplit(self.path)
            if route_path.scheme or route_path.netloc or not route_path.path.startswith(base):
                self.reply(404)
                return
            route = unquote(route_path.path[len(base):])
            try:
                if route == "api/health":
                    self.json_reply({"workspaceId": workspace_id, "pid": os.getpid(), "runtimeVersion": RUNTIME_VERSION})
                elif route == "api/snapshot":
                    self.json_reply(snapshot(workspace))
                elif route == "api/events":
                    self.events()
                else:
                    file = (assets / (route or "index.html")).resolve()
                    if assets not in file.parents or not file.is_file():
                        self.reply(404)
                        return
                    content_type = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                                    ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2"}.get(file.suffix, mimetypes.guess_type(str(file))[0] or "application/octet-stream")
                    self.reply(200, file.read_bytes(), content_type)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                self.close_connection = True
            except Exception:
                self.reply(503, "内容暂时无法读取，请保留页面并回到主对话检查。".encode("utf-8"))

        def json_reply(self, data):
            self.reply(200, json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), "application/json; charset=utf-8")

        def events(self):
            if not streams.acquire(blocking=False):
                self.reply(503)
                return
            try:
                self.send_response(200)
                self.headers_for("text/event-stream; charset=utf-8")
                self.send_header("Connection", "keep-alive")
                self.end_headers()
                self.connection.settimeout(15)
                self.wfile.write(b"event: ready\ndata: {}\n\n")
                self.wfile.flush()
                previous = None
                unavailable = False
                while True:
                    try:
                        current = hashlib.sha256(json.dumps(snapshot(workspace), ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
                        if current != previous or unavailable:
                            payload = ('event: changed\ndata: {"version":"' + current + '"}\n\n').encode("utf-8")
                            previous, unavailable = current, False
                        else:
                            payload = b": heartbeat\n\n"
                    except Exception:
                        payload = b"event: unavailable\ndata: {}\n\n"
                        unavailable = True
                    self.wfile.write(payload)
                    self.wfile.flush()
                    time.sleep(1)
            except (OSError, TimeoutError):
                self.close_connection = True
            finally:
                streams.release()

        def readonly(self):
            self.reply(405, "预览只读，请回到主对话修改。".encode("utf-8"))

        do_POST = readonly
        do_PUT = readonly
        do_PATCH = readonly
        do_DELETE = readonly
        do_HEAD = readonly
        do_OPTIONS = readonly

    class Server(ThreadingHTTPServer):
        daemon_threads = True

        def handle_error(self, request, client_address):
            # HTTP errors must never print archive paths, input or tracebacks.
            pass

    with _lock(workspace, ".preview-binding.lock"):
        endpoint = _endpoint(workspace, workspace_id)
        if endpoint:
            token = endpoint["token"]
            base = "/p/" + token + "/"
        try:
            server = Server(("127.0.0.1", endpoint["port"] if endpoint else 0), Handler)
        except OSError:
            _fail("PREVIEW_PORT_IN_USE", "当前搭子的固定端口无法使用；未切换地址或停止其他程序。")
        endpoint = {"version": 1, "workspaceId": workspace_id, "port": server.server_port, "token": token}
        try:
            _write(workspace / "preview-endpoint.json", endpoint)
            _write(workspace / "preview-server.json", {"workspaceId": workspace_id, "pid": os.getpid(),
                                                       "url": _url(endpoint), "runtimeVersion": RUNTIME_VERSION})
        except Exception:
            server.server_close()
            raise
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
