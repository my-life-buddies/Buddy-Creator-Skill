"""Archive original sources and actual host-tool extracts; no document converters."""
import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

KINDS = {'file', 'webpage', 'history', 'mindmap', 'skill', 'oral', 'scan', 'audio', 'video'}
TEXT_EXTENSIONS = {'.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.opml', '.mm', '.html', '.htm', '.log'}
MAX_BYTES = 512 * 1024 * 1024
MAX_TEXT = 32 * 1024 * 1024


def digest(value):
    if isinstance(value, str):
        value = value.encode('utf-8')
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def fail(code, message):
    raise ValueError(code + ': ' + message)


def _part(text, locator):
    if not isinstance(text, str) or not text.strip() or not isinstance(locator, str) or not locator.strip():
        fail('SOURCE_PART', '每段提取结果需要真实原文和来源位置。')
    if len(text.encode('utf-8')) > MAX_TEXT:
        fail('SOURCE_PART_SIZE', '单段资料过大，请按实际来源分段。')
    return {'text': text, 'locator': locator}


def _text(path):
    if path.stat().st_size > MAX_TEXT:
        fail('SOURCE_TEXT_SIZE', '文本过大，请由宿主分段读取后提交 hostResult。')
    try:
        result = path.read_text(encoding='utf-8-sig')
    except UnicodeError:
        fail('HOST_SOURCE_REQUIRED', '资料不是 UTF-8 文本，请由宿主读取后提交 hostResult。')
    if '\x00' in result:
        fail('HOST_SOURCE_REQUIRED', '这份资料需要宿主工具读取，不能当作普通文本。')
    return result


def _history(text):
    try:
        data = json.loads(text)
        rows = data.get('messages', []) if isinstance(data, dict) else data
    except json.JSONDecodeError:
        try:
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        except json.JSONDecodeError:
            fail('HISTORY_FORMAT', '历史资料须为用户选定的可见消息 JSON/JSONL，或由宿主提取可见原文。')
    if not isinstance(rows, list):
        fail('HISTORY_FORMAT', '没有找到选定的可见消息列表。')
    parts = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or row.get('role') not in ('user', 'assistant'):
            continue
        if row.get('channel') not in (None, 'final') or row.get('hidden') or row.get('visibility') == 'hidden':
            continue
        content = row.get('content', row.get('text', ''))
        if isinstance(content, list):
            content = '\n'.join(item.get('text', '') for item in content if isinstance(item, dict) and item.get('type') in ('text', 'input_text', 'output_text'))
        if isinstance(content, str) and content.strip():
            parts.append(_part(content, '选定可见消息 %s / %s' % (index + 1, row['role'])))
    if not parts:
        fail('HISTORY_EMPTY', '没有可导入的用户或助手可见正文。')
    return parts


def _copy_file(path, destination):
    if not path.is_file() or path.is_symlink():
        fail('SOURCE_FILE', '请提供实际文件，不能用符号链接替代原件。')
    size = path.stat().st_size
    if size > MAX_BYTES:
        fail('SOURCE_SIZE', '单份原件超过 512 MiB 归档上限，请选定必要部分。')
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    sha = hashlib.sha256()
    with path.open('rb') as incoming, destination.open('xb') as outgoing:
        while True:
            block = incoming.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > MAX_BYTES:
                fail('SOURCE_SIZE', '读取过程中资料超过大小上限。')
            sha.update(block)
            outgoing.write(block)
        outgoing.flush()
        os.fsync(outgoing.fileno())
    return {'hash': sha.hexdigest(), 'bytes': total}


def import_source(workspace, state, payload):
    """Called under the workspace writer lock. Returns an immutable manifest."""
    workspace = Path(workspace)
    op_id = payload.get('operationId')
    if not isinstance(op_id, str) or not op_id.strip() or len(op_id) > 256:
        fail('OPERATION_ID_REQUIRED', '资料导入需要稳定的 operationId；重试沿用，补充结果使用新身份。')
    kind = payload.get('kind')
    if kind not in KINDS:
        fail('SOURCE_UNSUPPORTED', '不支持这类来源；此包不包含小红书账号采集。')
    uri = payload.get('uri', '')
    if not isinstance(uri, str):
        fail('SOURCE_URI', '资料位置必须是字符串。')
    if kind == 'webpage':
        url = urlsplit(uri)
        host = (url.hostname or '').lower().rstrip('.')
        if url.scheme not in ('http', 'https') or not host or url.username or url.password:
            fail('SOURCE_URL', '网页来源需要不含账号密码的 HTTP(S) 地址。')
        if any(host == domain or host.endswith('.' + domain) for domain in ('xiaohongshu.com', 'xhslink.com')):
            fail('SOURCE_UNSUPPORTED', '此包不采集小红书网页或账号；用户自行提供的原文可作为本地资料。')
    request_hash = digest(encoded({key: value for key, value in payload.items() if key not in ('operation', 'operationId')}))
    source_id = 'source_' + digest(op_id)[:24]
    directory = workspace / 'sources' / source_id
    manifest_path = directory / 'manifest.json'
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding='utf-8'))
        if previous.get('requestHash') != request_hash:
            fail('IDEMPOTENCY_CONFLICT', '同一资料导入身份对应的内容已改变，请为新结果使用新的 operationId。')
        return previous
    host_result = payload.get('hostResult')
    parts, extraction = [], None
    if host_result is not None:
        if not isinstance(host_result, dict) or not isinstance(host_result.get('tool'), str) or not host_result['tool'].strip():
            fail('HOST_SOURCE_TOOL', '请注明实际读取资料的宿主工具。')
        if host_result.get('coverage') not in ('complete', 'partial'):
            fail('HOST_SOURCE_COVERAGE', 'coverage 必须如实填写 complete 或 partial。')
        rows = host_result.get('parts')
        if not isinstance(rows, list) or not rows or len(rows) > 10000:
            fail('HOST_SOURCE_PARTS', '请提供真实提取的正文和定位。')
        for row in rows:
            if not isinstance(row, dict):
                fail('HOST_SOURCE_PARTS', '每段资料必须是 text 和 locator 组成的对象。')
            parts.append(_part(row.get('text'), row.get('locator')))
        notes = host_result.get('notes', [])
        if not isinstance(notes, list) or any(not isinstance(note, str) for note in notes):
            fail('HOST_SOURCE_NOTES', 'notes 须为实际处理说明的文本列表。')
        extraction = {'provider': 'host', 'tool': host_result['tool'], 'coverage': host_result['coverage'], 'notes': notes}
    elif kind in ('webpage', 'scan', 'audio', 'video'):
        fail('HOST_SOURCE_REQUIRED', '请先用宿主实际可用工具读取资料，再提交 hostResult。')
    source_root = workspace / 'sources'
    source_root.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.incoming-', dir=str(source_root)))
    files = []
    try:
        if kind == 'webpage':
            raw = encoded({'url': uri, 'hostResult': host_result, 'description': '宿主提取快照，不是完整网页原件'})
            (staging / 'webpage-snapshot.json').write_bytes(raw)
            files.append({'path': 'webpage-snapshot.json', 'hash': digest(raw), 'bytes': len(raw)})
        elif uri:
            path = Path(uri).expanduser()
            if not path.is_absolute():
                fail('SOURCE_ABSOLUTE_PATH', '本地资料请使用绝对路径。')
            if path.is_symlink():
                fail('SOURCE_FILE', '请提供实际原件路径。')
            if path.is_dir() and kind == 'skill':
                total, count = 0, 0
                for folder, dirs, names in os.walk(str(path), followlinks=False):
                    dirs[:] = [name for name in sorted(dirs) if name not in ('.git', 'node_modules', '__pycache__', '.venv') and not (Path(folder) / name).is_symlink()]
                    for name in sorted(names):
                        item = Path(folder) / name
                        if item.is_symlink() or item.suffix.lower() not in TEXT_EXTENSIONS:
                            continue
                        count += 1
                        total += item.stat().st_size
                        if count > 5000 or total > MAX_BYTES:
                            fail('SOURCE_SIZE', 'Skill 资料超出文本归档上限，请选定相关文档。')
                        relative = item.relative_to(path).as_posix()
                        saved = _copy_file(item, staging / 'original' / relative)
                        files.append(dict(saved, path='original/' + relative))
                        if host_result is None:
                            text = _text(staging / 'original' / relative)
                            if text.strip():
                                parts.append(_part(text, relative))
            elif path.is_file():
                saved = _copy_file(path, staging / 'original' / path.name)
                files.append(dict(saved, path='original/' + path.name))
                if host_result is None:
                    if path.suffix.lower() not in TEXT_EXTENSIONS:
                        fail('HOST_SOURCE_REQUIRED', '此格式请先由宿主工具读取，再提交 hostResult。')
                    text = _text(staging / 'original' / path.name)
                    parts = _history(text) if kind == 'history' else [_part(text, path.name)]
            else:
                fail('SOURCE_FILE', '资料文件不存在，或该来源类型不支持目录。')
        elif payload.get('text') is not None:
            text = payload['text']
            part = _part(text, '创作者提供的原文' if kind == 'oral' else '用户选定原文')
            raw = text.encode('utf-8')
            (staging / 'original.txt').write_bytes(raw)
            files.append({'path': 'original.txt', 'hash': digest(raw), 'bytes': len(raw)})
            if host_result is None:
                parts = _history(text) if kind == 'history' else [part]
        else:
            fail('SOURCE_ORIGINAL_REQUIRED', '请提供本地原件路径、网页地址或用户实际提供的原文。')
        if not parts:
            fail('SOURCE_EMPTY', '资料中没有可归档的可读正文。')
        if sum(len(part['text'].encode('utf-8')) for part in parts) > MAX_BYTES:
            fail('SOURCE_SIZE', '提取结果总量超过 512 MiB，请按实际范围分批。')
        if host_result is not None:
            raw = encoded(host_result)
            (staging / 'host-result.json').write_bytes(raw)
            files.append({'path': 'host-result.json', 'hash': digest(raw), 'bytes': len(raw)})
        chunks = [dict(part, id='chunk_%04d' % (index + 1), hash=digest(part['text'])) for index, part in enumerate(parts)]
        complete = extraction is None or extraction['coverage'] == 'complete'
        title = payload.get('title') or (Path(uri).name if uri and kind != 'webpage' else uri or '口述资料')
        manifest = {'id': source_id, 'version': digest(encoded({'files': files, 'chunks': chunks})),
                    'operationId': op_id, 'requestHash': request_hash, 'kind': kind, 'title': str(title), 'uri': uri,
                    'status': 'ready' if complete else 'failed', 'files': files, 'chunks': chunks,
                    'extraction': extraction, 'warnings': [] if complete else ['仅保存已提取部分，尚未完整读取。'],
                    'parser': 'host-tools' if extraction else 'python-text-archive',
                    'acquiredAt': datetime.now(timezone.utc).isoformat(),
                    'error': None if complete else 'HOST_SOURCE_INCOMPLETE',
                    'processing': {'acquisition': 'complete' if complete else 'partial',
                                   'parsing': 'complete' if complete else 'partial', 'semanticReview': 'requires_host_calibration'}}
        (staging / 'manifest.json').write_bytes(encoded(manifest))
        for file in staging.rglob('*'):
            if file.is_file():
                with file.open('rb') as handle:
                    os.fsync(handle.fileno())
        os.replace(str(staging), str(directory))
        if os.name != 'nt':
            fd = os.open(str(source_root), os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        return manifest
    except BaseException:
        shutil.rmtree(str(staging), ignore_errors=True)
        raise
