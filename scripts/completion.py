"""Create local deliverables from confirmed versions. No developer handoff."""
import hashlib
import copy
import html
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

LABELS = {'definition': '定义', 'knowledge': '知识', 'methods': '方法', 'service': '服务'}


def _bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False).encode('utf-8')


def _hash(raw):
    return hashlib.sha256(raw).hexdigest()


def _atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, str(path))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _confirmed(state, object_id):
    artifact = state.get('artifacts', {}).get(object_id)
    return bool(artifact and any(record.get('objectId') == object_id and record.get('hash') == artifact['hash']
                                and not record.get('invalidatedBy') and record.get('decision') == 'confirmed'
                                for record in state.get('confirmations', [])))


def _ready(state, catalog):
    return not state.get('paused') and not state.get('pendingTurnId') and all(
        _confirmed(state, '%s.%d' % (stage, index + 1))
        for stage in catalog['stages'] for index in range(len(catalog['chapters'][stage])))


def _line_chunks(text, columns=32, limit=3):
    text = ' '.join(str(text or '待补充').split())
    lines, line, width = [], '', 0
    for char in text:
        char_width = 1 if ord(char) < 128 else 2
        if width + char_width > columns * 2:
            lines.append(line)
            line, width = '', 0
        line += char
        width += char_width
    if line:
        lines.append(line)
    if len(lines) > limit:
        lines = lines[:limit]
        lines[-1] = lines[-1][:-1] + '…'
    return lines


def _blueprint(state):
    blueprint = copy.deepcopy(state['artifacts'].get('service.blueprint', {}).get('data') or {})
    transitions = blueprint.setdefault('transitions', {})
    for artifact in state['artifacts'].values():
        if artifact.get('kind') == 'transition' and artifact.get('data'):
            path_id = artifact['id'].removeprefix('transition.')
            transitions[path_id] = dict(transitions.get(path_id, {}), **artifact['data'])
    return blueprint


def _diagram(state):
    blueprint = _blueprint(state)
    stages = blueprint.get('stages', {})
    transitions = blueprint.get('transitions', {})
    boxes = []
    for key, title, meaning, y in [('acquisition', '获客期', '先免费体验', 90),
                                  ('paid', '付费期', '订阅后持续获得帮助 · AI 对话不限次数', 325),
                                  ('maintenance', '维持期', '未订阅或到期未续费 · 保留基础对话与历史', 560)]:
        config = stages.get(key, {})
        lines = _line_chunks(config.get('result') or config.get('service'), columns=32, limit=3)
        content = ''.join('<tspan x="76" dy="25">%s</tspan>' % html.escape(line) for line in lines)
        boxes.append('<g><rect x="48" y="%d" width="540" height="160" rx="12" fill="#20271b" stroke="#556446"/>'
                     '<text x="76" y="%d" fill="#b8d879" font-size="24" font-weight="700">%s</text>'
                     '<text x="76" y="%d" fill="#bac2b0" font-size="14">%s</text>'
                     '<text y="%d" fill="#edf0e8" font-size="17">%s</text></g>' %
                     (y, y + 35, title, y + 61, html.escape(meaning), y + 71, content))
    cycle = blueprint.get('billingCycle') or {}
    units = {'day': '天', 'week': '周', 'month': '个月', 'year': '年'}
    duration = str(cycle.get('count', '')) + units.get(cycle.get('unit'), '') if isinstance(cycle, dict) else str(cycle)
    terms = ('订阅：¥%s / %s' % (blueprint.get('price', '待定'), duration or '待定'))
    def caption(key, fallback):
        return html.escape(str(transitions.get(key, {}).get('title') or fallback))
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="980" height="810" viewBox="0 0 980 810" role="img" aria-labelledby="title desc">'
            '<title id="title">Buddy 服务模式</title><desc id="desc">免费体验、付费订阅和维持三阶段，以及五条用户路径。完整约定见服务手册。</desc>'
            '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            '<path d="M0 0L10 5L0 10Z" fill="#b8d879"/></marker></defs>'
            '<rect width="980" height="810" rx="16" fill="#151a13"/><g font-family="system-ui,sans-serif">'
            '<text x="48" y="43" fill="#edf0e8" font-size="25" font-weight="700">Buddy · 服务模式</text>'
            '<text x="48" y="69" fill="#bac2b0" font-size="15">%s</text>%s'
            '<g fill="none" stroke="#94aa76" stroke-width="2" marker-end="url(#arrow)">'
            '<path d="M260 250V325"/><path d="M260 485V560"/>'
            '<path d="M588 150H902V640H588"/>'
            '<path d="M588 355H682V445H588"/>'
            '<path d="M588 670H780V410H588" stroke-dasharray="6 5"/></g>'
            '<g fill="#dce8ca" font-size="16">'
            '<text x="278" y="292">%s</text><text x="278" y="527">%s</text>'
            '<text x="808" y="284">%s</text><text x="693" y="390">%s</text>'
            '<text x="793" y="555">%s</text></g>'
            '<text x="48" y="769" fill="#bac2b0" font-size="15">阶段卡片展示摘要；具体服务、权益和转换条件以已确认手册为准。</text></g></svg>') % (
                html.escape(terms), ''.join(boxes), caption('acquisition-paid', '体验后订阅'),
                caption('paid-maintenance', '到期未续费'), caption('acquisition-maintenance', '暂不订阅'),
                caption('paid-paid', '续费'), caption('maintenance-paid', '恢复订阅'))


def snapshot(workspace, state):
    path = Path(workspace) / 'completion.json'
    if not path.exists() or state.get('pendingTurnId') or state.get('paused'):
        return None
    try:
        record = json.loads(path.read_text(encoding='utf-8'))
        if record.get('revision') != state.get('revision'):
            return None
        if record.get('status') == 'ready' and not (Path(record['directory']) / 'BUDDY_MANUAL.md').is_file():
            record['status'] = 'failed'
            record['message'] = '四册确认已保留，本地成果需要重新生成。'
        return {key: record.get(key) for key in ('revision', 'status', 'message', 'fileCount', 'updatedAt')}
    except (OSError, ValueError, KeyError):
        return None


def finalize(workspace, state):
    workspace = Path(workspace)
    catalog = json.loads((Path(__file__).resolve().parent.parent / 'references' / 'catalog.json').read_text(encoding='utf-8'))
    if not _ready(state, catalog):
        return None
    revision = str(state['revision'])
    if not revision or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for char in revision):
        raise ValueError('REVISION_INVALID: 无法识别当前版本身份。')
    output = workspace / 'deliverables' / revision
    record = {'revision': revision, 'updatedAt': datetime.now(timezone.utc).isoformat()}
    staging = None
    try:
        files, manual = {}, ['# Buddy 创作手册', '', '搭子：' + state['buddyId'], '']
        for stage in catalog['stages']:
            parts = ['# ' + LABELS[stage] + '手册', '']
            for index, title in enumerate(catalog['chapters'][stage]):
                artifact = state['artifacts']['%s.%d' % (stage, index + 1)]
                parts.extend(['## %d. %s' % (index + 1, title), '', artifact['markdown'], ''])
                if artifact.get('unresolved'):
                    parts.extend(['待补充：' + '；'.join(artifact['unresolved']), ''])
            text = '\n'.join(parts)
            files['booklets/%s.md' % stage] = text.encode('utf-8')
            manual.extend([text, ''])
        manual.extend(['## 服务模式图', '', '![服务模式](SERVICE_MODEL.svg)', '',
                       '本手册记录已确认的创作设计，后续开发、内容核实和实际履约仍按具体项目推进。', ''])
        files['BUDDY_MANUAL.md'] = '\n'.join(manual).encode('utf-8')
        files['SERVICE_MODEL.svg'] = _diagram(state).encode('utf-8')
        files['service-blueprint.json'] = _bytes({
            'data': _blueprint(state),
            'sourceArtifact': {key: state['artifacts'].get('service.blueprint', {}).get(key) for key in ('id', 'hash')},
            'transitionArtifacts': [{key: artifact.get(key) for key in ('id', 'hash')} for artifact in state['artifacts'].values() if artifact.get('kind') == 'transition']})
        files['versions.json'] = _bytes({'buddyId': state['buddyId'], 'revision': revision,
                                        'artifacts': state['artifacts'], 'confirmations': state['confirmations']})
        files['sources.json'] = _bytes(list(state.get('sources', {}).values()))
        files['MANIFEST.json'] = _bytes({'format': 'buddy-creator-1', 'buddyId': state['buddyId'],
                                        'revision': revision, 'complete': True,
                                        'files': [{'path': path, 'sha256': _hash(raw), 'bytes': len(raw)} for path, raw in files.items()]})
        output.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix='.build-', dir=str(output.parent)))
        for path, raw in files.items():
            _atomic(staging / path, raw)
        if output.exists():
            # Reuse intact outputs; preserve manually edited exports as a separate directory.
            intact = all((output / path).is_file() and (output / path).read_bytes() == raw for path, raw in files.items())
            if intact:
                shutil.rmtree(str(staging))
                staging = None
            else:
                saved = output.with_name(output.name + '-previous-' + datetime.now().strftime('%Y%m%d%H%M%S%f'))
                os.replace(str(output), str(saved))
                os.replace(str(staging), str(output))
                staging = None
        else:
            os.replace(str(staging), str(output))
            staging = None
        record.update(status='ready', directory=str(output), manualPath=str(output / 'BUDDY_MANUAL.md'),
                      fileCount=len(files), message='四册已确认，创作手册和服务模式图已保存在本机。')
    except Exception as error:
        record.update(status='failed', error=str(error), message='四册确认已保留，本地成果生成需要重试。')
    finally:
        if staging:
            shutil.rmtree(str(staging), ignore_errors=True)
    _atomic(workspace / 'completion.json', _bytes(record))
    return record
