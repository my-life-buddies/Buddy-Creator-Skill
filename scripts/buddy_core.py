"""Buddy Creator's deterministic, file-backed interview protocol (Python stdlib only).

The host supplies public assessments and text. This module never calls a model,
interprets external instructions, or infers consent from a keyword.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
METADATA = json.loads((ROOT / 'version.json').read_text(encoding='utf-8'))
SCHEMA = METADATA['workspaceFormat']
READABLE_SCHEMAS = {SCHEMA, 'buddy-python-trial-1'}
CLOSED = {'sufficient', 'uncertain', 'skipped', 'exhausted'}
KINDS = {'chapter', 'hypothesis', 'scenario', 'blueprint', 'transition'}
SOURCE_KINDS = {'file', 'webpage', 'history', 'mindmap', 'skill', 'oral', 'scan', 'audio', 'video'}


class BuddyError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.details = code, details


def require(value, code, message, details=None):
    if not value:
        raise BuddyError(code, message, details)


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def digest(value):
    value = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def catalog():
    return json.loads((ROOT / 'references' / 'catalog.json').read_text(encoding='utf-8'))


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name != 'nt':
            directory = os.open(str(path.parent), os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def workspace_lock(workspace):
    """OS-owned lock is released on process exit, including a killed process."""
    workspace = Path(workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    with (workspace / '.buddy.lock').open('a+b') as handle:
        try:
            if os.name == 'nt':
                import msvcrt
                handle.seek(0)
                if not handle.read(1):
                    handle.write(b'0')
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise BuddyError('WORKSPACE_BUSY', '另一个操作正在保存此搭子；保持同一操作编号，稍后重试。') from error
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def load(workspace):
    path = Path(workspace) / 'state.json'
    require(path.is_file(), 'WORKSPACE_NOT_FOUND', '这里没有 Buddy Creator 项目。请用 open 创建，或指定之前返回的 workspace。')
    try:
        state = json.loads(path.read_text(encoding='utf-8'))
    except (ValueError, OSError) as error:
        raise BuddyError('STATE_UNREADABLE', '项目状态无法读取；历史版本保留在 revisions/，请先保留现场再恢复，不要重新创建覆盖。') from error
    require(state.get('schemaVersion') in READABLE_SCHEMAS, 'WORKSPACE_FORMAT', '此版本支持 Buddy Creator 1.x 和此前 Python 试用项目；Node 0.x 的项目需要另建目录，不能直接迁移检查点。')
    return state


def save(workspace, state):
    state['updatedAt'] = now()
    state['revision'] = 'rev_' + digest({k: v for k, v in state.items() if k != 'revision'})[:32]
    atomic_json(Path(workspace) / 'revisions' / (state['revision'] + '.json'), state)
    atomic_json(Path(workspace) / 'state.json', state)
    return state


def book_ids(stage):
    return ['%s.%s' % (stage, i + 1) for i, _ in enumerate(catalog()['chapters'][stage])]


def confirmed(state, object_id, decision='confirmed'):
    artifact = state['artifacts'].get(object_id)
    return bool(artifact and any(c['objectId'] == object_id and c['hash'] == artifact['hash'] and c['decision'] == decision and not c.get('invalidatedBy') for c in state['confirmations']))


def book_confirmed(state, stage):
    return all(confirmed(state, key) for key in book_ids(stage))


def choose_stage(state):
    return next((s for s in catalog()['stages'] if not book_confirmed(state, s)), 'service')


def verify_ref(state, ref):
    require(isinstance(ref, dict), 'EVIDENCE_SCHEMA', '证据必须为 type、id、hash 组成的对象。')
    kind, key = ref.get('type'), ref.get('id')
    if kind == 'input':
        item = state['inputs'].get(key)
        require(item and item['hash'] == ref.get('hash'), 'EVIDENCE_VERSION', '用户原话不存在或哈希不匹配。', {'id': key})
        text = item['raw']
        require(isinstance(ref.get('quote'), str) and ref['quote'].strip(), 'EVIDENCE_QUOTE', '用户原话证据必须包含非空精确引用。')
    elif kind == 'artifact':
        item = state['artifacts'].get(key)
        require(item and item['hash'] == ref.get('hash'), 'EVIDENCE_VERSION', '产物证据不是当前已保存版本。', {'id': key})
        text = item['markdown']
    elif kind == 'source':
        source = state['sources'].get(key)
        require(source and source.get('status') == 'ready', 'SOURCE_NOT_READY', '所引用的来源尚未完整可用。', {'id': key})
        item = next((c for c in source.get('chunks', []) if c.get('hash') == ref.get('hash') and c.get('locator') == ref.get('locator')), None)
        require(item and digest(item['text']) == item['hash'], 'EVIDENCE_LOCATOR', '来源必须绑定真实文本块的哈希及 locator。', {'id': key})
        text = item['text']
    else:
        raise BuddyError('EVIDENCE_SCHEMA', '证据 type 只能为 input、source、artifact。')
    if ref.get('quote') is not None:
        require(isinstance(ref['quote'], str) and ref['quote'] in text, 'EVIDENCE_QUOTE', '引用必须与已存原文一致。', {'id': key})


def evidence(state, refs, input_id=None):
    require(isinstance(refs, list), 'EVIDENCE_SCHEMA', 'evidence/dependencies 必须是数组。')
    for ref in refs:
        verify_ref(state, ref)
    if input_id:
        require(any(r.get('type') == 'input' and r.get('id') == input_id and r.get('quote', '').strip() for r in refs), 'USER_EVIDENCE_REQUIRED', '此动作必须引用本轮用户原话，不能从宿主推测用户已认可。')


def text(value):
    return isinstance(value, str) and bool(value.strip())


def filled(value, keys):
    return isinstance(value, dict) and all(text(value.get(k)) for k in keys)


def text_list(value, empty=False):
    return isinstance(value, list) and (empty or bool(value)) and all(text(v) for v in value)


def service_gates(state):
    data = state['artifacts'].get('service.blueprint', {}).get('data', {})
    stages, transitions = data.get('stages', {}), data.get('transitions', {})
    loop, contract = data.get('serviceLoop', {}), data.get('acquisitionContract', {})
    checks = data.get('semanticChecks', {})
    def known(key):
        check = checks.get(key, {})
        return isinstance(check, dict) and check.get('pass') is True and bool(check.get('evidence'))
    period = data.get('billingCycle', {})
    valid_period = isinstance(period, dict) and set(period) == {'count', 'unit'} and type(period.get('count')) is int and period['count'] > 0 and period.get('unit') in {'day', 'week', 'month', 'year'}
    try:
        price = float(data.get('price', 0))
        valid_price = type(data.get('price')) is not bool and math.isfinite(price) and price > 0
    except (ValueError, TypeError, OverflowError):
        valid_price = False
    path_ids = ['acquisition-paid', 'acquisition-maintenance', 'paid-paid', 'paid-maintenance', 'maintenance-paid']
    maintenance = data.get('maintenanceContract', {})
    rows = [
        ('持续价值', text(data.get('valueStatement')) and text_list(data.get('recurrenceDrivers')) and text_list(data.get('renewalEvidence')) and text(loop.get('nextCycleUpdate'))),
        ('完整服务循环', filled(loop, ['trigger', 'requiredInput', 'decision', 'action', 'result', 'feedback', 'nextCycleUpdate']) and known('coherentLoop')),
        ('付费可交付', filled(stages.get('paid'), ['result', 'service', 'limit']) and text(data.get('deliveries')) and known('paidDeliverable')),
        ('免费体验范围明确', filled(contract, ['trigger', 'requiredInput', 'completionCriteria', 'conversionBridge']) and text_list(contract.get('includedSteps')) and text_list(contract.get('excludedSteps'), True) and known('freeScopeAgreed')),
        ('停付保留基础对话', filled(stages.get('maintenance'), ['service', 'limit']) and maintenance.get('basicConversation') is True and text(maintenance.get('allowedQuestions')) and known('maintenanceBoundary')),
        ('五条动线', all(filled(transitions.get(key), ['trigger', 'rightsChange', 'dataInheritance', 'message']) for key in path_ids) and known('transitionsConfirmed') and (state.get('serviceMode') != 'guided' or all(confirmed(state, 'transition.' + key) and state['artifacts']['transition.' + key].get('data') == transitions.get(key) for key in path_ids[:-1]))),
        ('价值后提示付费', known('valueBeforePaywall')),
        ('创作者复核有产能', data.get('humanReview') is False or data.get('humanReview') is True and text(data.get('reviewCapacity')) and known('creatorCapacity')),
        ('单档自定义周期订阅', valid_period and valid_price and data.get('platformRules') == catalog()['serviceRules'] and data.get('multiUser') is False and text(data.get('cadence')) and data.get('conversationLimit') == 'unlimited' and text(data.get('toolLimit')) and (data.get('experienceMode') == 'conversation' or data.get('experienceMode') == 'custom-component' and text(data.get('customComponentDescription'))) and known('executableContract')),
    ]
    return [{'label': label, 'pass': bool(passed)} for label, passed in rows]


def gates(state, stage):
    cards = catalog()['cards']
    def target_rows(ids):
        return [{'label': cards[key]['title'], 'pass': state['targets'][key]['status'] in CLOSED} for key in ids]
    if stage == 'definition':
        return target_rows([k for k, card in cards.items() if card['stage'] == stage])
    if stage == 'knowledge':
        plan = state['sourcePlan']
        selected = [state['sources'].get(key) for key in plan['sourceIds']]
        return target_rows(['K01', 'K03', 'K04']) + [
            {'label': '来源发现已明确结束', 'pass': plan['discoveryClosed']},
            {'label': '导入计划有实际内容', 'pass': bool(selected and plan['requiredKinds'])},
            {'label': '全部所选来源完整可用', 'pass': all(s and s.get('status') == 'ready' and s.get('chunks') for s in selected)},
            {'label': '每类必需来源有实际内容', 'pass': all(any(s and s.get('kind') == kind and s.get('status') == 'ready' for s in selected) for kind in plan['requiredKinds'])},
        ]
    if stage == 'methods':
        hypotheses = [a for a in state['artifacts'].values() if a['kind'] == 'hypothesis']
        return [
            {'label': '3—4 个不同方法候选已全部处理', 'pass': 3 <= len(hypotheses) <= 4 and len({re.sub(r'\s', '', a['markdown']) for a in hypotheses}) == len(hypotheses) and all(confirmed(state, a['id'], 'accepted') or confirmed(state, a['id'], 'rejected') for a in hypotheses)},
            {'label': '至少一个方法获认可', 'pass': any(confirmed(state, a['id'], 'accepted') for a in hypotheses)},
        ] + [{'label': cards[key]['title'], 'pass': confirmed(state, 'scenario.' + key)} for key in ['M01', 'M02', 'M03', 'M04', 'E01', 'E02', 'E03']]
    return service_gates(state)


def can_draft(state, stage):
    return all(g['pass'] for g in gates(state, stage)) and (stage != 'service' or confirmed(state, 'service.blueprint'))


def askable(state, target_id):
    cards = catalog()['cards']
    require(target_id in cards, 'UNKNOWN_TARGET', '未知采访目标。', {'targetId': target_id})
    card, target = cards[target_id], state['targets'][target_id]
    require(not state['paused'], 'PAUSED', '用户已暂停，先按用户原话恢复再提出新问题。')
    require(card['stage'] == state['stage'], 'STAGE_SCOPE', '不能提前采访其他阶段。')
    require(target['status'] not in CLOSED and len(target['answerInputIds']) < card['maxAnswers'], 'FOLLOWUP_CLOSED', '该问题已收敛或达到追问上限；请整理已有内容，不能反复追问。', {'targetId': target_id})
    if target_id == 'K02':
        require(not state['sourcePlan']['discoveryClosed'], 'SOURCE_DISCOVERY_CLOSED', '用户已结束本轮来源发现，不应重复询问。')
    if card['stage'] == 'methods':
        if target_id.startswith('H'):
            key = 'hypothesis.H' + str(int(target_id[1:]))
            require(key in state['artifacts'] and not confirmed(state, key, 'accepted') and not confirmed(state, key, 'rejected'), 'HYPOTHESIS_HANDLED', '候选尚未生成或已处理。')
        else:
            require(all(g['pass'] for g in gates(state, 'methods')[:2]), 'METHOD_HYPOTHESES', '请先完成全部方法候选校准，再讨论基础场景。')
            if target_id.startswith('E'):
                require(all(confirmed(state, 'scenario.M0' + str(i)) for i in range(1, 5)), 'BASE_SCENARIOS', '请先确认四个基础案例。')
            require(not confirmed(state, 'scenario.' + target_id), 'SCENARIO_HANDLED', '当前场景已经确认。')
    if card['stage'] == 'service' and target_id not in {'S00', 'R00'}:
        require(state.get('serviceModelExplained') and state.get('serviceMode') in {'smart', 'guided'}, 'SERVICE_INTRO', '先用通俗语言解释三阶段，再由用户选择智能规划或逐项讨论。')
    if target_id == 'R00':
        require(all(book_confirmed(state, s) for s in catalog()['stages']), 'REVISION_ENTRY', '先完成当前手册。')


def invalidate(state, changed, by):
    changed = set(changed)
    while True:
        if any(key.startswith('transition.') for key in changed):
            changed.add('service.blueprint')
        if 'service.blueprint' in changed:
            changed.update(book_ids('service'))
        if any(key.startswith(('hypothesis.', 'scenario.')) for key in changed):
            changed.update(book_ids('methods'))
        dependent = {a['id'] for a in state['artifacts'].values() if any(r.get('type') == 'artifact' and r.get('id') in changed for r in a.get('dependencies', []))}
        newer = changed | dependent
        if newer == changed:
            break
        changed = newer
    for record in state['confirmations']:
        if record['objectId'] in changed and not record.get('invalidatedBy'):
            record['invalidatedBy'] = by
    return changed


def put_artifacts(state, proposals, by, draft=False):
    require(isinstance(proposals, list), 'PATCH_SCHEMA', 'artifacts 必须为数组。')
    ids = [a.get('id') for a in proposals if isinstance(a, dict)]
    require(len(ids) == len(proposals) and len(set(ids)) == len(ids), 'PATCH_SCHEMA', '每个产物必须是对象，且一次只能修改同一 ID 一次。')
    changed = set()
    stages = catalog()['stages']
    for item in proposals:
        required = {'id', 'stage', 'kind', 'title', 'markdown', 'evidence', 'dependencies', 'unresolved'}
        require(required <= set(item) and not set(item) - (required | {'data'}), 'ARTIFACT_SCHEMA', '产物字段必须包含 id、stage、kind、title、markdown、evidence、dependencies、unresolved，可选 data；不要提交 hash/revision。')
        require(item['stage'] in stages and item['kind'] in KINDS and text(item['title']) and text(item['markdown']) and text_list(item['unresolved'], True), 'ARTIFACT_SCHEMA', '产物结构不完整。')
        require(stages.index(item['stage']) <= stages.index(state['stage']), 'STAGE_SCOPE', '上游手册尚未确认，不能生成后续阶段产物。')
        a = copy.deepcopy(item)
        a.setdefault('data', {})
        require(isinstance(a['data'], dict), 'ARTIFACT_DATA', 'data 必须为对象。')
        evidence(state, a['evidence'])
        evidence(state, a['dependencies'])
        require(a['evidence'] or a['dependencies'], 'EVIDENCE_REQUIRED', '产物必须记录实际依据，不能保存没有来源的结论。')
        for stage in stages[:stages.index(a['stage'])]:
            require(any(r.get('type') == 'artifact' and state['artifacts'][r['id']]['stage'] == stage for r in a['dependencies']), 'DEPENDENCY_REQUIRED', '下游产物必须引用每个上游阶段实际使用的已确认内容。', {'requiredStage': stage, 'id': a['id']})
        for ref in a['dependencies']:
            if ref['type'] == 'artifact':
                require(confirmed(state, ref['id']) or confirmed(state, ref['id'], 'accepted'), 'UNCONFIRMED_DEPENDENCY', '依赖内容必须已确认。', {'id': ref['id']})
        if a['kind'] == 'chapter':
            require(a['id'] in book_ids(a['stage']), 'CHAPTER_SCHEMA', '章节必须使用固定的 27 章编号。')
        elif a['kind'] == 'hypothesis':
            require(a['stage'] == 'methods' and re.fullmatch(r'hypothesis\.H[1-4]', a['id']), 'HYPOTHESIS_SCHEMA', '方法候选使用 hypothesis.H1 至 H4。')
        elif a['kind'] == 'scenario':
            require(a['stage'] == 'methods' and re.fullmatch(r'scenario\.(M0[1-4]|E0[1-3])', a['id']), 'SCENARIO_SCHEMA', '案例使用 scenario.M01—M04 / E01—E03。')
            require(all(g['pass'] for g in gates(state, 'methods')[:2]), 'METHOD_HYPOTHESES', '先校准方法候选。')
            if a['id'].startswith('scenario.M'):
                require(any(r['type'] == 'input' for r in a['evidence']), 'USER_ANSWERS_FIRST', '基础案例必须先有用户实际回答。')
            else:
                require(all(confirmed(state, 'scenario.M0' + str(i)) for i in range(1, 5)), 'BASE_SCENARIOS', '拓展案例前先确认四个基础案例。')
                require(any(r['type'] == 'artifact' and r['id'].startswith('scenario.M') for r in a['dependencies']), 'BASE_SCENARIO_REQUIRED', '拓展案例须引用对应基础案例。')
        elif a['kind'] == 'transition':
            require(a['stage'] == 'service' and a['id'] in {'transition.' + k for k in ['acquisition-paid', 'acquisition-maintenance', 'paid-paid', 'paid-maintenance']}, 'TRANSITION_SCHEMA', '仅四条非默认路径单独校准。')
            require(filled(a['data'], ['trigger', 'rightsChange', 'dataInheritance', 'message']), 'TRANSITION_INCOMPLETE', '路径须包含时点、权益、历史继承和表达。')
        elif a['kind'] == 'blueprint':
            require(a['id'] == 'service.blueprint' and a['stage'] == 'service', 'BLUEPRINT_SCHEMA', '服务蓝图 ID 必须为 service.blueprint。')
            data = a['data']
            require(data.get('platformRules') == catalog()['serviceRules'], 'FIXED_SERVICE_RULES', 'platformRules 必须复制 context.catalog.serviceRules 当前规则。')
            require(data.get('conversationLimit', 'unlimited') == 'unlimited' and data.get('maintenanceContract', {}).get('basicConversation', True) is True, 'SERVICE_CONVERSATION_POLICY', '付费期间 AI 对话不限次数，维持期间保留基础对话。')
            period = data.get('billingCycle')
            if period is not None:
                require(isinstance(period, dict) and set(period) == {'count', 'unit'} and type(period.get('count')) is int and period['count'] > 0 and period.get('unit') in {'day', 'week', 'month', 'year'}, 'SUBSCRIPTION_PERIOD', 'billingCycle 使用 {count:正整数,unit:day|week|month|year}。')
            for check in data.get('semanticChecks', {}).values():
                require(isinstance(check, dict) and isinstance(check.get('pass'), bool), 'SERVICE_EVIDENCE', 'semanticChecks 每项必须包含 pass 和 evidence。')
                evidence(state, check.get('evidence'))
                if check['pass']:
                    require(check['evidence'], 'SERVICE_EVIDENCE', '通过的业务判断需要真实依据；不能空写 pass:true。')
        a['hash'] = digest(a)
        if state['artifacts'].get(a['id'], {}).get('hash') != a['hash']:
            changed.add(a['id'])
        state['artifacts'][a['id']] = a
    invalidate(state, changed, by)
    state['stage'] = choose_stage(state)
    return sorted(changed)


def record_confirmations(state, turn, records, modifying):
    require(isinstance(records, list), 'CONFIRMATION_SCHEMA', 'confirmations 必须为数组。')
    if not records:
        return
    input_item = state['inputs'][turn['inputId']]
    delivery = state['deliveries'].get(input_item.get('replyToDeliveryId'))
    require(delivery and delivery['id'] in state['presentations'] and delivery.get('confirmationTarget'), 'CONFIRMATION_NOT_SHOWN', '用户尚未看到可核对的确切版本；先展示待确认内容，下轮引用用户回复。')
    shown = {o['id']: o['hash'] for o in delivery['confirmationTarget']['objects']}
    for record in records:
        key = record.get('objectId')
        require(key not in modifying, 'UNSEEN_CONFIRMATION', '同一轮修改和确认不能作用于同一产物；新版须展示后再确认。')
        evidence(state, record.get('evidence'), turn['inputId'])
        artifact = state['artifacts'].get(key)
        require(artifact and key in shown and artifact['hash'] == shown[key], 'CONFIRMATION_STALE', '确认只能对应上一条实际展示的当前版本，不能扩大范围或确认旧版。')
        require(not artifact['unresolved'], 'UNRESOLVED', '产物还有未决项，先完成或忠实标明待补，不得伪造确认。', {'id': key, 'unresolved': artifact['unresolved']})
        allowed = {'accepted', 'rejected'} if artifact['kind'] == 'hypothesis' else {'confirmed'}
        require(record.get('decision') in allowed, 'DECISION_SCOPE', '方法候选使用 accepted/rejected，其他产物使用 confirmed。')
        if artifact['kind'] == 'chapter':
            require(can_draft(state, artifact['stage']), 'STAGE_GATES', '当前手册的前置门槛尚未完成。', {'gates': gates(state, artifact['stage'])})
        if artifact['kind'] == 'blueprint':
            require(all(g['pass'] for g in service_gates(state)), 'SERVICE_GATES', '服务蓝图仍有待完成内容。', {'gates': service_gates(state)})
        entry = dict(record, id='confirmation_' + digest([turn['inputId'], key, artifact['hash'], record['decision']])[:24], hash=artifact['hash'], inputId=turn['inputId'], deliveryId=delivery['id'])
        if not any(c['id'] == entry['id'] for c in state['confirmations']):
            state['confirmations'].append(entry)
    state['stage'] = choose_stage(state)


def delivery_record(state, proposal, delivery_id, input_id=None, opening=False, explanation=False):
    require(isinstance(proposal, dict) and text(proposal.get('text')), 'DELIVERY_REQUIRED', '需要给用户的公开回复 text。')
    require(not set(proposal) - {'text', 'question', 'confirmationObjectIds', 'confirmationScope', 'mode'}, 'DELIVERY_SCHEMA', 'delivery 包含未支持字段；请按协议提交。')
    question, ids = proposal.get('question'), proposal.get('confirmationObjectIds')
    if explanation:
        require(not question and not ids, 'EXPLANATION_ONLY', '纯答疑保留原待答内容，不附加采访问题或确认。')
    require(not (question and ids), 'ONE_REPLY_TARGET', '每轮一个核心问题或一次确认，不要同时提交两种。')
    result = {'id': delivery_id, 'text': proposal['text'], 'hash': digest(proposal['text']), 'createdAt': now(), 'mode': proposal.get('mode', 'ordinary'), 'inputId': input_id}
    question_count = len(re.findall(r'[?？]', proposal['text']))
    if question:
        require(isinstance(question, dict) and set(question) == {'targetId'}, 'QUESTION_SCHEMA', 'question 使用 {targetId:目标编号}。')
        askable(state, question['targetId'])
        if result['mode'] == 'transition':
            parts = re.split(r'\n\s*\n', proposal['text'].strip())
            require(question['targetId'].startswith('T.') and len(parts) == 2 and re.match(r'^(接下来我们|这一轮我们|现在我们)', parts[0]) and parts[1].startswith('比如，') and question_count == 2 and 70 <= len(proposal['text']) <= 160, 'TRANSITION_STYLE', '路径采访使用两段、70—160 字，第二段以“比如，”开头；两个问句围绕同一个决定。')
        elif not opening:
            limit = 180 if result['mode'] == 'example' else 100
            require(question_count == 1 and len(proposal['text']) <= limit, 'QUESTION_STYLE', '普通采访每轮一个问题，不超过100字；结合场景 example 不超过180字。长案例用确认对象正文，不塞入短问题。')
        result['question'] = dict(question)
    elif ids:
        require(isinstance(ids, list) and ids and len(set(ids)) == len(ids), 'CONFIRMATION_SCHEMA', 'confirmationObjectIds 使用不重复的产物 ID 数组。')
        require(question_count <= 1, 'ONE_REPLY_TARGET', '确认正文后最多一个核心确认问题。')
        artifacts = [state['artifacts'].get(key) for key in ids]
        require(all(artifacts), 'CONFIRMATION_MISSING', '请先保存确切的待确认版本。')
        require(len({a['stage'] for a in artifacts}) == 1, 'CONFIRMATION_SCOPE', '一次不能跨阶段确认。')
        require(not any(a['kind'] == 'hypothesis' for a in artifacts) or len(artifacts) == 1, 'HYPOTHESIS_ONE_AT_A_TIME', '方法候选每轮只展示并校准一条。')
        scope = proposal.get('confirmationScope', 'object')
        require(scope in {'object', 'booklet'}, 'CONFIRMATION_SCOPE', 'confirmationScope 使用 object 或 booklet。')
        if scope == 'booklet':
            require(set(ids) == set(book_ids(artifacts[0]['stage'])), 'BOOKLET_INCOMPLETE', '整册确认必须包含该册全部固定章节。')
        result['confirmationTarget'] = {'scope': scope, 'stage': artifacts[0]['stage'], 'objects': [{'id': a['id'], 'hash': a['hash']} for a in artifacts]}
    else:
        require(question_count == 0, 'QUESTION_ID_REQUIRED', '回复中的采访问题必须绑定目标编号。')
    if not explanation and not question and not ids and not state['paused'] and not all(book_confirmed(state, s) for s in catalog()['stages']):
        raise BuddyError('CONTINUATION_REQUIRED', '访谈还未完成：请在本轮给出下一条有效问题或确切内容确认，不能只回复“已保存”。若需要后台整理，先 draft_publish，再继续完成同一轮。')
    state['deliveries'][delivery_id] = result
    state['currentDeliveryId'] = delivery_id
    if question or ids:
        state['questionDeliveryId'] = delivery_id
    elif explanation:
        result['resumeDeliveryId'] = state.get('questionDeliveryId')
    return result


def available(state):
    questions = []
    for target_id in catalog()['cards']:
        try:
            askable(state, target_id)
            questions.append(target_id)
        except BuddyError:
            pass
    return {'questionTargets': questions, 'confirmationObjects': [a['id'] for a in state['artifacts'].values() if a['stage'] == state['stage'] and not a['unresolved'] and not any(confirmed(state, a['id'], d) for d in ['confirmed', 'accepted', 'rejected'])], 'canDraftBooklet': can_draft(state, state['stage'])}


def context(workspace, state):
    return {'workspace': str(Path(workspace).resolve()), 'revision': state['revision'], 'stage': state['stage'], 'paused': state['paused'], 'pendingTurnId': state.get('pendingTurnId'), 'catalog': catalog(), 'gates': gates(state, state['stage']), 'continuation': available(state), 'state': state, 'contract': str(ROOT / 'references' / 'host-guide.md'), 'note': '宿主负责真实语义判断，runtime 仅校验结构、证据版本、状态与确认关系。每轮先保存原话，再整理、保存、展示并登记实际展示；不能替用户确认。'}


def open_workspace(creation_key=None, workspace=None):
    if workspace is None:
        require(text(creation_key), 'CREATION_KEY_REQUIRED', '宿主需为本次创作生成稳定 creation-key；重试沿用同一个值，不需要用户提供 buddyid。')
    if workspace:
        base = Path(workspace).expanduser().resolve()
    else:
        directory_name = 'buddy-' + digest(creation_key)[:16]
        base = (Path.cwd() / 'buddies' / directory_name).resolve()
        previous = (Path.cwd() / 'buddies-no-node' / directory_name).resolve()
        if not (base / 'state.json').exists() and (previous / 'state.json').is_file():
            existing = load(previous)
            require(existing.get('creationKeyHash') == digest(creation_key), 'CREATION_KEY_COLLISION', '旧项目的创建标识不匹配，请明确指定 workspace。')
            base = previous
    require(ROOT != base and ROOT not in base.parents, 'WORKSPACE_LOCATION', '项目资料应保存在 Skill 安装目录之外。')
    with workspace_lock(base):
        if (base / 'state.json').exists():
            state = load(base)
            if workspace is None:
                require(state.get('creationKeyHash') == digest(creation_key), 'CREATION_KEY_COLLISION', '创建标识不匹配，请换一个新标识。')
        else:
            require(text(creation_key), 'CREATION_KEY_REQUIRED', '创建新的 Buddy 项目需要稳定 creation-key；已有项目只需 workspace。')
            unexpected = [p.name for p in base.iterdir() if p.name != '.buddy.lock']
            require(not unexpected, 'WORKSPACE_NOT_EMPTY', '新项目需要空目录；不能覆盖已有资料或 Node 版项目。', {'files': unexpected[:10]})
            cards = catalog()['cards']
            state = {'schemaVersion': SCHEMA, 'buddyId': base.name, 'workspaceId': 'workspace_' + digest(str(base))[:24], 'creationKeyHash': digest(creation_key), 'revision': '', 'stage': 'definition', 'paused': False, 'inputs': {}, 'turns': {}, 'pendingTurnId': None, 'deliveries': {}, 'presentations': [], 'currentDeliveryId': None, 'targets': {key: {'id': key, 'status': 'unstarted', 'summary': '', 'gaps': [], 'evidence': [], 'answerInputIds': []} for key in cards}, 'artifacts': {}, 'confirmations': [], 'sources': {}, 'sourcePlan': {'sourceIds': [], 'requiredKinds': [], 'discoveryClosed': False}, 'serviceMode': None, 'serviceModelExplained': False, 'drafts': [], 'updatedAt': now()}
            opening = (ROOT / 'references' / 'opening.md').read_text(encoding='utf-8').strip()
            delivery_record(state, {'text': opening, 'question': {'targetId': 'D01'}, 'mode': 'opening'}, 'delivery_opening', opening=True)
            save(base, state)
    return base, state


def active_turn(state, turn_id):
    turn = state['turns'].get(turn_id)
    require(turn, 'TURN_NOT_FOUND', '未找到这一轮，先 turn_begin 保存原话。')
    require(turn['status'] == 'working' and state.get('pendingTurnId') == turn_id, 'TURN_NOT_ACTIVE', '这一轮不再处于处理中；不要创建重复输入，请读取已有结果。')
    return turn


def finish_turn(state, payload):
    turn = state['turns'].get(payload.get('turnId'))
    require(turn, 'TURN_NOT_FOUND', '未找到这一轮。')
    payload_hash = digest({k: v for k, v in payload.items() if k != 'operation'})
    if turn['status'] == 'finished':
        require(turn.get('finishHash') == payload_hash, 'IDEMPOTENCY_CONFLICT', '这一轮已用不同内容提交，不能重写；用户有新修改时开始新一轮。')
        return state['deliveries'][turn['result']['deliveryId']], False
    active_turn(state, turn['id'])
    intent = payload.get('intent', 'answer')
    require(intent in {'answer', 'revision', 'confirmation', 'explanation', 'pause', 'resume'}, 'INTENT_SCHEMA', 'intent 使用 answer/revision/confirmation/explanation/pause/resume。')
    patch = payload.get('patch', {})
    require(isinstance(patch, dict) and not set(patch) - {'targets', 'artifacts', 'confirmations', 'sourcePlan', 'serviceMode', 'serviceModelExplained', 'paused'}, 'PATCH_SCHEMA', 'patch 包含未支持字段。')
    inp = state['inputs'][turn['inputId']]
    if intent == 'explanation':
        require(not patch, 'EXPLANATION_ONLY', '纯答疑不修改采访目标、产物或确认；需要修订时使用 revision。')
    replied = state['deliveries'].get(inp.get('replyToDeliveryId'), {})
    target_id = replied.get('question', {}).get('targetId')
    if intent == 'answer' and target_id and inp['id'] not in state['targets'][target_id]['answerInputIds']:
        state['targets'][target_id]['answerInputIds'].append(inp['id'])
    for proposal in patch.get('targets', []):
        require(isinstance(proposal, dict) and set(proposal) == {'id', 'status', 'summary', 'gaps', 'evidence'}, 'TARGET_SCHEMA', 'targets 每项使用 id/status/summary/gaps/evidence。')
        key = proposal['id']
        require(key in state['targets'], 'UNKNOWN_TARGET', '未知采访目标。')
        require(catalog()['cards'][key]['stage'] == state['stage'] or catalog()['stages'].index(catalog()['cards'][key]['stage']) < catalog()['stages'].index(state['stage']), 'STAGE_SCOPE', '后续阶段信息可保留在原话中，不能提前完成采访。')
        require(proposal['status'] in CLOSED | {'unstarted', 'exploring'} and isinstance(proposal['summary'], str) and text_list(proposal['gaps'], True), 'TARGET_SCHEMA', 'status 使用 unstarted/exploring/sufficient/uncertain/skipped/exhausted。')
        evidence(state, proposal['evidence'], inp['id'] if proposal['status'] in {'skipped', 'uncertain'} else None)
        if proposal['status'] == 'sufficient':
            require(proposal['evidence'], 'EVIDENCE_REQUIRED', '充分性判断必须有真实依据。')
        old = state['targets'][key]
        if any(old.get(field) != proposal.get(field) for field in ('summary', 'status', 'gaps')):
            invalidate(state, book_ids(catalog()['cards'][key]['stage']), turn['id'])
        state['targets'][key].update(copy.deepcopy(proposal))
    for key, target in state['targets'].items():
        if len(target['answerInputIds']) >= catalog()['cards'][key]['maxAnswers'] and target['status'] not in CLOSED:
            target['status'] = 'exhausted'
    if 'sourcePlan' in patch:
        plan = patch['sourcePlan']
        require(isinstance(plan, dict) and set(plan) == {'sourceIds', 'requiredKinds', 'discoveryClosed'} and isinstance(plan['sourceIds'], list) and isinstance(plan['requiredKinds'], list) and isinstance(plan['discoveryClosed'], bool), 'SOURCE_PLAN_SCHEMA', 'sourcePlan 使用 sourceIds/requiredKinds/discoveryClosed。')
        require(all(k in state['sources'] for k in plan['sourceIds']) and set(plan['requiredKinds']) <= SOURCE_KINDS, 'SOURCE_PLAN_UNKNOWN', '来源计划必须使用真实导入 ID 和支持的类型。')
        if state['sourcePlan'] != plan:
            invalidate(state, book_ids('knowledge'), turn['id'])
        state['sourcePlan'] = copy.deepcopy(plan)
    if 'serviceModelExplained' in patch:
        require(isinstance(patch['serviceModelExplained'], bool), 'SERVICE_INTRO', 'serviceModelExplained 使用布尔值。')
        state['serviceModelExplained'] = patch['serviceModelExplained']
    if 'serviceMode' in patch:
        require(state['serviceModelExplained'] and patch['serviceMode'] in {'smart', 'guided'}, 'SERVICE_MODE', '先真实解释三阶段并由用户选择 smart/guided。')
        state['serviceMode'] = patch['serviceMode']
    if 'paused' in patch:
        require(isinstance(patch['paused'], bool), 'PAUSED_SCHEMA', 'paused 使用布尔值，仅按用户明确暂停/恢复意愿设置。')
        state['paused'] = patch['paused']
    proposals = patch.get('artifacts', [])
    record_confirmations(state, turn, patch.get('confirmations', []), {a.get('id') for a in proposals})
    put_artifacts(state, proposals, turn['id'])
    # Faithful base-case capture is a user answer, not invented consent to a new proposal.
    for proposal in proposals:
        if proposal['kind'] == 'scenario' and proposal['id'].startswith('scenario.M') and proposal.get('data', {}).get('capture') == 'faithful_user_answer':
            require(replied.get('question', {}).get('targetId') == proposal['id'][9:] and not proposal['unresolved'], 'SCENARIO_ANSWER_SCOPE', 'faithful_user_answer 只能忠实记录用户刚回答且完整的对应基础场景。')
            evidence(state, proposal['evidence'], inp['id'])
            artifact = state['artifacts'][proposal['id']]
            state['confirmations'].append({'id': 'confirmation_' + digest([inp['id'], artifact['hash']])[:24], 'objectId': artifact['id'], 'hash': artifact['hash'], 'inputId': inp['id'], 'deliveryId': replied['id'], 'decision': 'confirmed', 'evidence': proposal['evidence']})
    state['stage'] = choose_stage(state)
    result = delivery_record(state, payload.get('delivery'), 'delivery_' + digest(turn['id'])[:24], inp['id'], explanation=intent == 'explanation')
    turn.update(status='finished', updatedAt=now(), finishHash=payload_hash, result={'deliveryId': result['id']})
    state['pendingTurnId'] = None
    return result, True


def call(workspace, payload):
    require(isinstance(payload, dict), 'REQUEST_SCHEMA', '请求必须为 JSON 对象。')
    operation = payload.get('operation')
    require(operation in {'turn_begin', 'turn_finish', 'turn_continue', 'presentation_record', 'draft_publish', 'source_import', 'finalize', 'snapshot'}, 'OPERATION_UNKNOWN', '未知 operation。')
    workspace = Path(workspace).expanduser().resolve()
    completion_needed = False
    with workspace_lock(workspace):
        state = load(workspace)
        changed = False
        result = {}
        if operation == 'turn_begin':
            raw, client_key = payload.get('raw'), payload.get('clientKey')
            require(isinstance(raw, str) and raw.strip() and text(client_key), 'INPUT_REQUIRED', 'turn_begin 需要原样 raw 和本轮稳定 clientKey。')
            turn_id = 'turn_' + digest(client_key)[:24]
            existing = state['turns'].get(turn_id)
            if existing:
                require(state['inputs'][existing['inputId']]['raw'] == raw, 'IDEMPOTENCY_CONFLICT', '同一 clientKey 对应不同原话；新输入必须使用新 clientKey。')
                result = {'turn': existing, 'input': state['inputs'][existing['inputId']], 'directive': 'deliver_saved_result' if existing['status'] == 'finished' else 'continue_turn'}
                if existing['status'] == 'finished':
                    result['delivery'] = state['deliveries'][existing['result']['deliveryId']]
            else:
                require(not state.get('pendingTurnId'), 'TURN_IN_PROGRESS', '上一轮还没提交；先 turn_continue 恢复，不要丢弃原话或重复创建。', {'turnId': state.get('pendingTurnId')})
                presented = payload.get('presentedDeliveryId')
                if presented:
                    require(presented == state.get('currentDeliveryId') and presented in state['deliveries'], 'PRESENTATION_STALE', '只能登记实际已展示的当前回复。')
                    if presented not in state['presentations']:
                        state['presentations'].append(presented)
                question_id = state.get('questionDeliveryId') or state.get('currentDeliveryId')
                reply_id = question_id if question_id in state['presentations'] else None
                inp = {'id': 'input_' + digest(client_key)[:24], 'raw': raw, 'hash': digest(raw), 'createdAt': now(), 'replyToDeliveryId': reply_id}
                turn = {'id': turn_id, 'inputId': inp['id'], 'baseRevision': state['revision'], 'status': 'working', 'createdAt': now(), 'updatedAt': now()}
                state['inputs'][inp['id']], state['turns'][turn_id], state['pendingTurnId'] = inp, turn, turn_id
                atomic_json(workspace / 'inputs' / (inp['id'] + '.json'), inp)
                result = {'turn': turn, 'input': inp, 'directive': 'prepare_turn'}
                changed = True
        elif operation == 'turn_finish':
            delivery, changed = finish_turn(state, payload)
            result = {'delivery': delivery, 'turn': state['turns'][payload['turnId']], 'directive': 'present_delivery'}
            completion_needed = all(book_confirmed(state, stage) for stage in catalog()['stages'])
        elif operation == 'turn_continue':
            turn_id = payload.get('turnId') or state.get('pendingTurnId')
            turn = state['turns'].get(turn_id)
            require(turn, 'TURN_NOT_FOUND', '没有待恢复的轮次。使用当前 delivery 继续访谈；新原话使用 turn_begin。')
            result = {'turn': turn, 'input': state['inputs'][turn['inputId']], 'directive': 'deliver_saved_result' if turn['status'] == 'finished' else 'continue_turn'}
            if turn['status'] == 'finished':
                result['delivery'] = state['deliveries'][turn['result']['deliveryId']]
        elif operation == 'presentation_record':
            key = payload.get('deliveryId')
            require(key in state['deliveries'] and key == state.get('currentDeliveryId'), 'PRESENTATION_STALE', '只能登记已实际展示的当前 delivery。')
            if key not in state['presentations']:
                state['presentations'].append(key)
                changed = True
            result = {'deliveryId': key, 'presented': True}
        elif operation == 'draft_publish':
            turn = active_turn(state, payload.get('turnId'))
            operation_id = payload.get('operationId')
            require(text(operation_id), 'OPERATION_ID_REQUIRED', 'draft_publish 需要稳定 operationId，以便安全重试。')
            prior = next((d for d in state['drafts'] if d['operationId'] == operation_id), None)
            payload_hash = digest(payload)
            if prior:
                require(prior['payloadHash'] == payload_hash, 'IDEMPOTENCY_CONFLICT', '同一草稿操作编号已用于不同内容。')
                result = prior
            else:
                draft_state = copy.deepcopy(state)
                changed_ids = put_artifacts(draft_state, payload.get('artifacts', []), operation_id, draft=True)
                rendered = '\n\n'.join('## ' + item['title'] + '\n\n' + item['markdown'] for item in payload.get('artifacts', []))
                require(rendered.strip(), 'DRAFT_EMPTY', '请提供实际公开草稿。')
                result = {'id': 'draft_' + digest(operation_id)[:24], 'operationId': operation_id, 'payloadHash': payload_hash, 'turnId': turn['id'], 'artifactIds': changed_ids, 'createdAt': now(), 'updatedAt': now(), 'sequence': len(state['drafts']) + 1, 'title': '正在整理的内容', 'markdown': rendered, 'hash': digest(rendered)}
                state['drafts'].append(result)
                changed = True
        elif operation == 'source_import':
            import sources
            manifest = sources.import_source(workspace, state, payload)
            old = state['sources'].get(manifest['id'])
            state['sources'][manifest['id']] = manifest
            changed = old != manifest
            result = {'source': manifest, 'directive': 'source_ready' if manifest.get('status') == 'ready' else 'source_action_required'}
        elif operation == 'finalize':
            require(all(book_confirmed(state, stage) for stage in catalog()['stages']), 'BOOKLETS_UNCONFIRMED', '四册还未全部确认，暂不能完成交付。')
            completion_needed = True
        else:
            import preview
            result = {'snapshot': preview.snapshot(workspace, state)}
        if changed:
            save(workspace, state)
            completion_needed = completion_needed or (not state.get('pendingTurnId') and all(book_confirmed(state, s) for s in catalog()['stages']))
        result.update(workspace=str(workspace), revision=state['revision'])
        if operation not in {'snapshot', 'presentation_record'}:
            result['context'] = context(workspace, state)
        if completion_needed:
            try:
                import completion
                result['completion'] = completion.finalize(workspace, state)
            except Exception as error:
                result['completion'] = {'status': 'failed', 'message': str(error), 'recovery': '用户原话和确认已保存；用 finalize 重试交付生成。'}
    return result
