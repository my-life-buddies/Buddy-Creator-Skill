"""Bound interview depth by both a concrete gap and its parent target.

The host assesses meaning and novelty with evidence; code owns counters, bounds
and history. No model calls and no keyword-based inference of user consent.
"""
from __future__ import annotations

import copy
import re

from buddy_core import CLOSED, catalog, evidence, require, text

POLICY = catalog()['interviewPolicy']
GAP_LIMIT = POLICY['gapMaxAnswers']
NO_GAIN_LIMIT = POLICY['noGainLimit']

def tracked(target_id):
    # Source discovery still ends by the creator's explicit choice.
    return target_id != 'K02'


def initial_id(target_id):
    return target_id + '.initial'


def ensure(state, target_id):
    history = state.setdefault('interview', {'targets': {}, 'gaps': {}})
    if target_id not in history['targets']:
        answers = state['targets'][target_id]['answerInputIds']
        history['targets'][target_id] = {
            'windowStart': 0, 'noGainStreak': 0, 'lastGain': False,
            'stopReason': None, 'reopens': [],
        }
        history['gaps'][initial_id(target_id)] = {
            'id': initial_id(target_id), 'targetId': target_id,
            'description': catalog(state)['cards'][target_id]['minimum'],
            'impact': '当前目标的必要内容', 'blocking': catalog(state)['cards'][target_id]['hard'], 'evidence': [],
            'status': 'open', 'windowStart': 0, 'noGainStreak': 0,
            'answers': [{'inputId': key, 'hasNewInformation': None} for key in answers],
        }
    return history['targets'][target_id]


def count(state, target_id):
    progress = state.get('interview', {}).get('targets', {}).get(target_id, {})
    return len(state['targets'][target_id]['answerInputIds']) - progress.get('windowStart', 0)


def target_open(state, target_id):
    card = catalog(state)['cards'][target_id]
    require(count(state, target_id) < card['maxAnswers'], 'TARGET_LIMIT',
            '本目标已到本轮回答上限；保留待补，转到其他目标。更换缺口或案例不会重置次数。', {'targetId': target_id})
    progress = state.get('interview', {}).get('targets', {}).get(target_id, {})
    require(not progress.get('stopReason'), 'TARGET_DEFERRED',
            '本轮已收口；只能依据用户明确针对该目标的续谈请求重新展开。', {'targetId': target_id})
    review = card.get('reviewAfter', card['maxAnswers'])
    if count(state, target_id) >= review:
        require(progress.get('lastGain') is True, 'NO_EXTENSION',
                '整理节点后没有实质新增，不能继续延长本目标。', {'targetId': target_id})


def question_gap(state, question):
    target_id = question['targetId']
    ensure(state, target_id)
    gap_id = question.get('gapId', initial_id(target_id))
    gap = state['interview']['gaps'].get(gap_id)
    require(gap and gap['targetId'] == target_id, 'GAP_NOT_FOUND',
            '问题必须绑定本目标已登记的具体缺口。', {'gapId': gap_id})
    require(gap['status'] == 'open' and len(gap['answers']) - gap['windowStart'] < GAP_LIMIT
            and gap['noGainStreak'] < NO_GAIN_LIMIT, 'GAP_CLOSED',
            '该缺口已讲清、暂放或达到边界；不要换一种问法重复追问。', {'gapId': gap_id})
    card = catalog(state)['cards'][target_id]
    if count(state, target_id) >= card.get('reviewAfter', card['maxAnswers']):
        require(gap['blocking'], 'EXTENSION_REQUIRES_BLOCKER',
                '四轮整理后只补影响当前结论或执行的关键缺口，其他细节留待补充。')
    return {'targetId': target_id, 'gapId': gap_id}


def prepare(state, patch, inp, intent):
    require(isinstance(patch, dict) and not set(patch) - {'gaps', 'assessment', 'reopen', 'resolutions'},
            'INTERVIEW_SCHEMA', 'interview 仅使用 gaps、assessment、reopen、resolutions。')
    changed = set()
    proposals = patch.get('gaps', [])
    require(isinstance(proposals, list), 'GAP_SCHEMA', 'gaps 使用数组。')
    for proposal in proposals:
        require(isinstance(proposal, dict) and set(proposal) ==
                {'id', 'targetId', 'description', 'impact', 'blocking', 'evidence'},
                'GAP_SCHEMA', '缺口使用 id/targetId/description/impact/blocking/evidence。')
        key, target_id = proposal['id'], proposal['targetId']
        require(target_id in state['targets'] and tracked(target_id), 'GAP_TARGET', '缺口必须属于现有采访目标。')
        require(catalog(state)['cards'][target_id]['stage'] == state['stage'], 'STAGE_SCOPE', '只登记当前阶段的采访缺口。')
        require(text(key) and re.fullmatch(re.escape(target_id) + r'\.[a-z0-9_-]{1,48}', key)
                and text(proposal['description']) and text(proposal['impact'])
                and type(proposal['blocking']) is bool, 'GAP_SCHEMA', '缺口须有稳定编号、具体内容和对本目标的影响。')
        evidence(state, proposal['evidence'])
        require(proposal['evidence'], 'EVIDENCE_REQUIRED', '新增缺口必须有真实原话、资料或产物依据。')
        ensure(state, target_id)
        gaps = state['interview']['gaps']
        old = gaps.get(key)
        if old:
            require(all(old[field] == proposal[field] for field in proposal), 'GAP_IMMUTABLE',
                    '沿用已有缺口编号和含义，不能改写它以重置采访。')
            continue
        target_open(state, target_id)
        require(state['targets'][target_id]['status'] not in CLOSED, 'FOLLOWUP_CLOSED', '目标已收敛，不能靠新增缺口重开。')
        normalized = re.sub(r'\s+', '', proposal['description'])
        require(not any(g['targetId'] == target_id and re.sub(r'\s+', '', g['description']) == normalized
                        for g in gaps.values()), 'DUPLICATE_GAP', '相同缺口沿用原编号。')
        gaps[key] = dict(copy.deepcopy(proposal), status='open', windowStart=0, noGainStreak=0, answers=[])
        changed.add(target_id)
    resolutions = patch.get('resolutions', [])
    require(isinstance(resolutions, list), 'RESOLUTION_SCHEMA', 'resolutions 使用数组。')
    for resolution in resolutions:
        require(isinstance(resolution, dict) and set(resolution) == {'gapId', 'summary', 'evidence'}
                and text(resolution['summary']), 'RESOLUTION_SCHEMA', '补充解决使用 gapId/summary/evidence。')
        evidence(state, resolution['evidence'], inp['id'])
        gap = state.get('interview', {}).get('gaps', {}).get(resolution['gapId'])
        require(gap, 'GAP_NOT_FOUND', '未找到待补缺口。')
        require(catalog()['stages'].index(catalog(state)['cards'][gap['targetId']]['stage']) <=
                catalog()['stages'].index(state['stage']), 'STAGE_SCOPE', '不能提前解决后续阶段目标。')
        gap['status'] = 'resolved'
        gap.setdefault('resolutions', []).append(dict(copy.deepcopy(resolution), inputId=inp['id']))
        changed.add(gap['targetId'])
    reopen = patch.get('reopen')
    if reopen is not None:
        require(isinstance(reopen, dict) and set(reopen) == {'targetId', 'gapId', 'reason', 'evidence'}
                and intent in {'resume', 'revision'} and text(reopen['reason']),
                'REOPEN_SCHEMA', '续谈须为 resume/revision，指定 targetId/gapId/reason/evidence。')
        target_id = reopen['targetId']
        require(target_id in state['targets'] and tracked(target_id)
                and catalog(state)['cards'][target_id]['stage'] == state['stage'], 'REOPEN_SCOPE', '仅恢复当前阶段的指定目标。')
        evidence(state, reopen['evidence'], inp['id'])
        progress = ensure(state, target_id)
        gap = state['interview']['gaps'].get(reopen['gapId'])
        require(gap and gap['targetId'] == target_id and state['targets'][target_id]['status'] in CLOSED,
                'REOPEN_SCOPE', '仅恢复已经收口的目标及其已记录缺口。')
        progress['reopens'].append(dict(copy.deepcopy(reopen), inputId=inp['id'],
                                       previousWindowStart=progress['windowStart']))
        progress.update(windowStart=len(state['targets'][target_id]['answerInputIds']),
                        noGainStreak=0, lastGain=False, stopReason=None)
        gap.update(windowStart=len(gap['answers']), noGainStreak=0, status='open')
        state['targets'][target_id]['status'] = 'exploring'
        changed.add(target_id)
    return changed


def assess(state, target_id, gap_id, assessment, inp):
    require(isinstance(assessment, dict) and set(assessment) ==
            {'hasNewInformation', 'resolved', 'summary', 'evidence'}
            and type(assessment['hasNewInformation']) is bool and type(assessment['resolved']) is bool
            and text(assessment['summary']), 'ASSESSMENT_REQUIRED',
            '采访回答须提交 interview.assessment：hasNewInformation/resolved/summary/evidence。')
    evidence(state, assessment['evidence'], inp['id'])
    progress = ensure(state, target_id)
    gap = state['interview']['gaps'].get(gap_id or initial_id(target_id))
    require(gap and gap['targetId'] == target_id, 'GAP_NOT_FOUND', '未找到本轮实际展示的待答缺口。')
    gain = assessment['hasNewInformation']
    gap['answers'].append(dict(copy.deepcopy(assessment), inputId=inp['id']))
    gap['noGainStreak'] = 0 if gain else gap['noGainStreak'] + 1
    progress['noGainStreak'] = 0 if gain else progress['noGainStreak'] + 1
    progress['lastGain'] = gain
    if assessment['resolved']:
        gap['status'] = 'resolved'
    elif gap['noGainStreak'] >= NO_GAIN_LIMIT or len(gap['answers']) - gap['windowStart'] >= GAP_LIMIT:
        gap['status'] = 'deferred'


def settle(state):
    for target_id, progress in state.get('interview', {}).get('targets', {}).items():
        target, card = state['targets'][target_id], catalog(state)['cards'][target_id]
        gaps = [g for g in state['interview']['gaps'].values() if g['targetId'] == target_id]
        unresolved = [g for g in gaps if g['status'] != 'resolved'
                      and (g['answers'] or g['id'] != initial_id(target_id))]
        require(target['status'] != 'sufficient' or not unresolved, 'UNRESOLVED_GAP',
                '已记录的缺口仍未解决，不能将目标标为充分；可暂放并保留范围说明。', {'targetId': target_id})
        reason = ('target_limit' if count(state, target_id) >= card['maxAnswers'] else
                  'no_new_information' if progress['noGainStreak'] >= NO_GAIN_LIMIT else
                  'review_without_gain' if count(state, target_id) >= card.get('reviewAfter', card['maxAnswers'])
                  and not progress['lastGain'] else None)
        if target['status'] not in CLOSED:
            if reason:
                progress['stopReason'] = reason
                target['status'] = 'exhausted'
            elif any(g['status'] == 'deferred' for g in gaps) and not any(g['status'] == 'open' for g in gaps):
                progress['stopReason'] = 'gap_limit'
                target['status'] = 'exhausted'
        if target['status'] in CLOSED:
            for gap in gaps:
                if gap['status'] == 'open':
                    gap['status'] = 'resolved' if target['status'] == 'sufficient' else 'deferred'
                if gap['status'] == 'deferred' and gap['description'] not in target['gaps']:
                    target['gaps'].append(gap['description'])
        resolved = {g['description'] for g in gaps if g['status'] == 'resolved'}
        target['gaps'] = [description for description in target['gaps'] if description not in resolved]


def blockers(state, stage, target_id=None):
    return [g for g in state.get('interview', {}).get('gaps', {}).values()
            if g['blocking'] and g['status'] != 'resolved'
            and catalog(state)['cards'][g['targetId']]['stage'] == stage
            and (target_id is None or g['targetId'] == target_id)]


def guidance(state):
    import methods
    result = {}
    for target_id, target in state['targets'].items():
        if catalog(state)['cards'][target_id]['stage'] != state['stage'] or not tracked(target_id):
            continue
        card = catalog(state)['cards'][target_id]
        if card['stage'] == 'methods' and not methods.active(state, target_id):
            continue
        result[target_id] = {
            'answersThisWindow': count(state, target_id), 'maxAnswers': card['maxAnswers'],
            'reviewDue': count(state, target_id) >= card.get('reviewAfter', card['maxAnswers']),
            'initialGapId': initial_id(target_id),
        }
    return result
