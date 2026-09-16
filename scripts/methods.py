"""Evidence-bound, adaptive method interviews. No model or inferred consent."""
import copy
import re

from buddy_core import book_ids, confirmed, digest, evidence, invalidate, require, text

DIMENSIONS = ('decisions', 'actions', 'adaptation', 'boundaries')


def enabled(state):
    return state.get('methodInterview', {}).get('version') == 1


def active(state, target_id):
    return not enabled(state) or target_id in state['methodInterview']['targets']


def object_id(target_id):
    return 'hypothesis.H' + str(int(target_id[1:])) if target_id.startswith('H') else 'scenario.' + target_id


def handled(state, target_id):
    key = object_id(target_id)
    return any(confirmed(state, key, decision) for decision in
               (('accepted', 'rejected') if target_id.startswith('H') else ('confirmed',)))


def fingerprint(state):
    """Booklet drafts are outputs, so cannot invalidate their own assessment."""
    artifacts = {key: item['hash'] for key, item in state['artifacts'].items()
                 if item['stage'] in {'definition', 'knowledge'} or item['kind'] in {'hypothesis', 'scenario'}}
    confirmations = sorted((c['objectId'], c['hash'], c['decision']) for c in state['confirmations']
                           if c['objectId'] in artifacts and not c.get('invalidatedBy'))
    targets = state['methodInterview']['targets']
    return digest({'artifacts': artifacts, 'confirmations': confirmations, 'plan': targets,
                   'targets': {key: state['targets'][key] for key in targets},
                   'gaps': {key: gap for key, gap in state.get('interview', {}).get('gaps', {}).items()
                            if gap['targetId'] in targets}})


def conclusion(state):
    record = state.get('methodInterview', {}).get('conclusion')
    return record if record and record['fingerprint'] == fingerprint(state) else None


def stopped(state):
    # User stop survives stale evidence; only an explicit resume lifts it.
    return state.get('methodInterview', {}).get('conclusion', {}).get('status') == 'user_stopped'


def pending(state):
    items = []
    for key, card in state['methodInterview']['targets'].items():
        if not handled(state, key):
            items.append(key + ' ' + card['title'] + '：尚未有效校准')
        artifact = state['artifacts'].get(object_id(key), {})
        items.extend(key + '：' + gap for gap in artifact.get('unresolved', []))
        items.extend(key + '：' + gap for gap in state['targets'][key]['gaps'])
    items.extend(gap['targetId'] + '：' + gap['description']
                 for gap in state.get('interview', {}).get('gaps', {}).values()
                 if gap['targetId'] in state['methodInterview']['targets'] and gap['status'] != 'resolved'
                 and not handled(state, gap['targetId']))
    return list(dict.fromkeys(items))


def prepare(state, patch, inp, intent):
    from buddy_core import catalog
    if patch is None:
        return
    require(isinstance(patch, dict) and not set(patch) - {'register', 'conclude', 'resume'},
            'METHOD_SCHEMA', 'methods 使用 register/conclude/resume。')
    require(state['stage'] == 'methods', 'STAGE_SCOPE', '方法计划在方法阶段调整。')
    if not enabled(state):
        # Adopt unfinished legacy work without throwing away IDs, answers or limits.
        cards = catalog()['cards']
        targets = {key: copy.deepcopy(card) for key, card in cards.items()
                   if card['stage'] == 'methods' and (state['targets'][key]['status'] != 'unstarted'
                   or object_id(key) in state['artifacts'] or state['targets'][key]['answerInputIds'])}
        state['methodInterview'] = {'version': 1, 'targets': targets, 'history': []}
        invalidate(state, book_ids('methods'), inp['id'])
    plan = state['methodInterview']
    resume = patch.get('resume')
    if resume is not None:
        require(isinstance(resume, dict) and set(resume) == {'reason', 'evidence'} and text(resume['reason'])
                and intent in {'resume', 'revision'}, 'METHOD_RESUME', '续谈需本轮明确请求、理由及 resume/revision。')
        evidence(state, resume['evidence'], inp['id'])
        previous = plan.pop('conclusion', None)
        plan['history'].append({'resume': copy.deepcopy(resume), 'previous': previous, 'inputId': inp['id']})
        invalidate(state, book_ids('methods'), inp['id'])
    registrations = patch.get('register', [])
    require(isinstance(registrations, list), 'METHOD_SCHEMA', 'register 使用数组。')
    require(not registrations or not plan.get('conclusion'), 'METHOD_CLOSED', '方法访谈已收口，明确续谈后才新增目标。')
    for proposal in registrations:
        require(isinstance(proposal, dict) and set(proposal) == {'id', 'title', 'purpose', 'evidence'}
                and all(text(proposal.get(k)) for k in ('id', 'title', 'purpose')),
                'METHOD_TARGET', '目标使用 id/title/purpose/evidence，说明新增案例解决什么不同问题。')
        key = proposal['id']
        require(re.fullmatch(r'[HME](?:0[1-9]|[1-9][0-9]+)', key), 'METHOD_TARGET', '目标使用 H01/M01/E01 起的连续数字编号。')
        evidence(state, proposal['evidence'])
        require(proposal['evidence'], 'EVIDENCE_REQUIRED', '新增方法或案例必须有依据及明确目的。')
        template = copy.deepcopy(catalog()['cards'][key[0] + '01'])
        template.update(title=proposal['title'], minimum=proposal['purpose'], purpose=proposal['purpose'], evidence=proposal['evidence'])
        old = plan['targets'].get(key)
        if old:
            require(old == template, 'METHOD_TARGET_IMMUTABLE', '沿用目标编号和目的；新增表述不能重置次数。')
            continue
        normalized = re.sub(r'\s+', '', proposal['purpose'])
        require(not any(re.sub(r'\s+', '', c.get('purpose', c['minimum'])) == normalized for c in plan['targets'].values()),
                'DUPLICATE_METHOD_TARGET', '同一缺口沿用原目标，不得换编号重复采访。')
        plan['targets'][key] = template
        state['targets'].setdefault(key, {'id': key, 'status': 'unstarted', 'summary': '', 'gaps': [], 'evidence': [], 'answerInputIds': []})
        invalidate(state, book_ids('methods'), inp['id'])


def finish(state, patch, inp):
    if not patch or 'conclude' not in patch:
        return
    import interview
    record = patch['conclude']
    require(isinstance(record, dict) and set(record) == {'status', 'summary', 'coverage', 'unresolved', 'evidence'}
            and record['status'] in {'sufficient', 'user_stopped'} and text(record['summary'])
            and isinstance(record['unresolved'], list) and all(text(item) for item in record['unresolved'])
            and isinstance(record['coverage'], dict), 'METHOD_CONCLUSION', '收口需要 status/summary/coverage/unresolved/evidence。')
    evidence(state, record['evidence'], inp['id'] if record['status'] == 'user_stopped' else None)
    require(record['evidence'], 'EVIDENCE_REQUIRED', '收口须有真实依据，不能以数量达标代替判断。')
    if record['status'] == 'sufficient':
        require(not stopped(state), 'METHOD_STOPPED', '用户叫停不能自动改成内容充分。')
        require(set(record['coverage']) == set(DIMENSIONS), 'METHOD_COVERAGE', '说明判断、行动、调整、边界四个维度是否充分或为何不适用。')
        for value in record['coverage'].values():
            require(isinstance(value, dict) and set(value) == {'status', 'reason', 'evidence'}
                    and value['status'] in {'covered', 'not_applicable'} and text(value['reason']),
                    'METHOD_COVERAGE', '每个维度使用 status=covered/not_applicable、reason、evidence。')
            evidence(state, value['evidence'])
            require(value['evidence'] and all(ref['type'] == 'artifact' and
                    (confirmed(state, ref['id']) or confirmed(state, ref['id'], 'accepted')) for ref in value['evidence']),
                    'METHOD_COVERAGE', '覆盖判断必须引用实际已确认内容，不引用未验证推导。')
        require(any(a['kind'] == 'hypothesis' and confirmed(state, a['id'], 'accepted') for a in state['artifacts'].values())
                and any(key.startswith('scenario.M') and confirmed(state, key) for key in state['artifacts']),
                'METHOD_EVIDENCE', '充分收口至少需要认可的方法及用户校准的基础案例。')
        require(not pending(state) and not record['unresolved'] and not interview.blockers(state, 'methods'),
                'METHOD_INCOMPLETE', '仍有未校准目标或关键缺口，不能标记充分。')
    else:
        require(not record['coverage'], 'METHOD_CONCLUSION', '用户叫停不代替充分性判断；coverage 留空。')
    saved = copy.deepcopy(record)
    saved['unresolved'] = list(dict.fromkeys(saved['unresolved'] + pending(state)))
    if record['status'] == 'user_stopped':
        saved['unresolved'].insert(0, '访谈由创作者主动结束，整体覆盖尚未判定充分；仅采用已确认的方法与案例。')
    saved.update(inputId=inp['id'], fingerprint=fingerprint(state))
    previous = state['methodInterview'].get('conclusion')
    if previous:
        state['methodInterview']['history'].append(previous)
    state['methodInterview']['conclusion'] = saved
    invalidate(state, book_ids('methods'), inp['id'])


def gates(state):
    record = conclusion(state)
    return [{'label': '方法访谈已按覆盖充分或创作者主动结束收口', 'pass': bool(record)}]


def scoped_stop(state):
    record = conclusion(state)
    return bool(record and record['status'] == 'user_stopped')


def scope_chapter(state, artifact):
    """Keep limitations in the shown, hashed, confirmed and exported version."""
    record = conclusion(state)
    if not record:
        return
    artifact['data']['methodConclusion'] = digest(record)
    if record['status'] == 'user_stopped':
        artifact['unresolved'] = list(dict.fromkeys(artifact['unresolved'] + record['unresolved']))
        note = '\n\n### 本版方法范围与待补\n\n' + record['summary'] + '\n\n' + '\n'.join('- ' + item for item in artifact['unresolved'])
        if not artifact['markdown'].endswith(note):
            artifact['markdown'] += note


def chapter_scoped(state, artifact):
    record = conclusion(state)
    return bool(record and artifact.get('data', {}).get('methodConclusion') == digest(record))
