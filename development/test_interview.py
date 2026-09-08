"""Focused protocol checks; all creator state lives in temporary directories."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import buddy_core as core
import interview
import preview


class InterviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace, _ = core.open_workspace('test', Path(self.temp.name) / 'project')
        self.serial = 0

    def state(self):
        return core.load(self.workspace)

    def focus(self, target_id):
        state = self.state()
        stage = core.catalog()['cards'][target_id]['stage']
        # Minimal upstream fixtures isolate pacing from unrelated service setup.
        for previous in core.catalog()['stages'][:core.catalog()['stages'].index(stage)]:
            for key in core.book_ids(previous):
                artifact = {'id': key, 'stage': previous, 'kind': 'chapter', 'title': key,
                            'markdown': '已校准的上游测试内容', 'unresolved': [], 'data': {},
                            'evidence': [], 'dependencies': []}
                artifact['hash'] = core.digest(artifact)
                state['artifacts'][key] = artifact
                state['confirmations'].append({'objectId': key, 'hash': artifact['hash'], 'decision': 'confirmed'})
        state['stage'] = stage
        core.delivery_record(state, {'text': '你通常怎样处理这个情况？', 'question': {'targetId': target_id}}, 'fixture')
        core.save(self.workspace, state)

    def begin(self, raw='这是我的实际回答。'):
        self.serial += 1
        result = core.call(self.workspace, {'operation': 'turn_begin', 'raw': raw,
                    'clientKey': 'message-' + str(self.serial),
                    'presentedDeliveryId': self.state()['currentDeliveryId']})
        inp = result['input']
        return result, {'type': 'input', 'id': inp['id'], 'hash': inp['hash'], 'quote': raw}

    def payload(self, begin, ref, gain=True, resolved=False, status='exploring',
                next_target=None, next_gap=None, new_gap=None, blocking=False):
        state = begin['context']['state']
        question = state['deliveries'][begin['input']['replyToDeliveryId']]['question']
        target_id = question['targetId']
        update = {'assessment': {'hasNewInformation': gain, 'resolved': resolved,
                                 'summary': '已得到新的判断条件' if gain else '尚无新增条件', 'evidence': [ref]}}
        if new_gap:
            update['gaps'] = [{'id': new_gap, 'targetId': target_id,
                'description': '待补条件 ' + new_gap, 'impact': '会改变本情境的处理动作',
                'blocking': blocking, 'evidence': [ref]}]
        question = {'targetId': next_target or target_id}
        if next_gap:
            question['gapId'] = next_gap
        return {'operation': 'turn_finish', 'turnId': begin['turn']['id'], 'intent': 'answer',
                'patch': {'interview': update, 'targets': [{'id': target_id, 'status': status,
                    'summary': '已有的真实判断', 'gaps': [], 'evidence': [ref]}]},
                'delivery': {'text': '接下来你会关注哪个条件？', 'question': question}}

    def answer(self, **kwargs):
        begin, ref = self.begin()
        payload = self.payload(begin, ref, **kwargs)
        return core.call(self.workspace, payload), payload

    def assert_code(self, code, function, *args):
        with self.assertRaises(core.BuddyError) as raised:
            function(*args)
        self.assertEqual(code, raised.exception.code)

    def test_short_sufficient_continues_and_retry_is_idempotent(self):
        result, payload = self.answer(resolved=True, status='sufficient', next_target='D02')
        revision = self.state()['revision']
        again = core.call(self.workspace, payload)
        self.assertEqual(result['delivery'], again['delivery'])
        self.assertEqual(revision, self.state()['revision'])
        self.assertEqual(1, len(self.state()['targets']['D01']['answerInputIds']))

    def test_context_and_quoted_questions_are_saved_without_truncation(self):
        content = (
            '你想帮新人把周报里的进展和卡点说清楚。假设有位新人，每周都会认真记下做过的事，'
            '但写成周报后，主管还是会问“这件事现在推进到哪儿了？”他就开始往里面补更多细节，'
            '最后写了很长一段，也拿不准哪些该留。他不一定缺写作技巧，也可能还没理清事情的进展，'
            '或者不知道主管这次最需要了解什么。这只是方便讨论的假设，不一定和你遇到的情况一样。'
            '就想想你最先想到帮助的那位新人，他当时写周报，最让他犯难的是什么？')
        self.assertGreater(len(content), 180)
        for mode in ('ordinary', 'example'):
            with self.subTest(mode=mode):
                begin, ref = self.begin('我想帮新人写清楚周报。')
                payload = self.payload(begin, ref, resolved=True, status='sufficient', next_target='D02')
                payload['delivery'] = {'text': content, 'mode': mode, 'question': {'targetId': 'D02'}}
                result = core.call(self.workspace, payload)
                delivery = result['delivery']
                self.assertEqual(content, delivery['text'])
                self.assertEqual(core.digest(content), delivery['hash'])
                self.assertEqual('D02', delivery['question']['targetId'])
                self.assertEqual(delivery, self.state()['deliveries'][delivery['id']])
                # Start an independent project for the second expression mode.
                self.workspace, _ = core.open_workspace('next', Path(self.temp.name) / ('next-' + mode))

    def test_reply_binding_does_not_require_question_punctuation(self):
        state = self.state()
        result = core.delivery_record(state, {'text': '就从最近一次帮新人改周报的经历聊起，说说他当时遇到了什么。',
            'question': {'targetId': 'D01'}}, 'spoken-prompt')
        self.assertEqual('D01', result['question']['targetId'])
        self.assertEqual(result['id'], state['questionDeliveryId'])

    def test_flexible_expression_keeps_binding_and_stage_guards(self):
        state = self.state()
        self.assert_code('CONTINUATION_REQUIRED', core.delivery_record, state,
                         {'text': '他当时遇到了什么？'}, 'unbound')
        self.assert_code('ONE_REPLY_TARGET', core.delivery_record, state,
                         {'text': '说说实际经历，并确认这本手册。', 'question': {'targetId': 'D01'},
                          'confirmationObjectIds': ['definition.positioning']}, 'two-targets')
        self.assert_code('STAGE_SCOPE', core.delivery_record, state,
                         {'text': '最近一次用到了哪份材料？', 'question': {'targetId': 'K01'}}, 'early-stage')
        self.assert_code('TRANSITION_TARGET', core.delivery_record, state,
                         {'text': '你希望什么时候发生？', 'mode': 'transition',
                          'question': {'targetId': 'D01'}}, 'wrong-transition')
        state['paused'] = True
        self.assert_code('PAUSED', core.delivery_record, state,
                         {'text': '再聊一下这个情况。', 'question': {'targetId': 'D01'}}, 'while-paused')

    def test_service_path_accepts_natural_and_previous_expression(self):
        state = self.state()
        state['stage'] = 'service'
        proposal = {'text': '假设这次订阅快结束了，你希望搭子什么时候和用户聊要不要继续？',
                    'mode': 'transition', 'question': {'targetId': 'T.paid-paid.1'}}
        self.assert_code('SERVICE_INTRO', core.delivery_record, state, proposal, 'before-intro')
        state['serviceModelExplained'] = True
        state['serviceMode'] = 'guided'
        natural = core.delivery_record(state, proposal, 'natural-path')
        proposal['text'] = ('接下来我们讨论已约定的服务周期快结束时的安排，你希望什么时候邀请用户继续订阅？\n\n'
                            '比如，用户刚完成这次周期的最后一次复盘，你希望在什么情况下和他聊要不要继续？')
        previous = core.delivery_record(state, proposal, 'previous-path')
        self.assertEqual(natural['question'], previous['question'])
        self.assertEqual(0, interview.count(state, 'T.paid-paid.1'))

    def test_two_no_gain_answers_defer_without_claiming_sufficiency(self):
        self.answer(gain=False)
        self.answer(gain=False, next_target='D02')
        state = self.state()
        self.assertEqual('exhausted', state['targets']['D01']['status'])
        self.assertTrue(state['targets']['D01']['gaps'])
        self.assert_code('FOLLOWUP_CLOSED', core.askable, state, 'D01')
        self.assertFalse(any(c.get('objectId', '').startswith('definition.') for c in state['confirmations']))

    def test_same_gap_stops_at_three_even_with_new_information(self):
        self.focus('K03')
        self.answer()
        self.answer()
        self.answer(next_target='K01')
        self.assertEqual('exhausted', self.state()['targets']['K03']['status'])
        self.assertEqual(3, len(self.state()['interview']['gaps']['K03.initial']['answers']))

    def reach_review(self):
        self.focus('K03')
        for index in range(1, 4):
            key = 'K03.g' + str(index)
            self.answer(resolved=True, new_gap=key, next_gap=key, blocking=True)

    def test_different_gaps_share_six_answer_limit(self):
        self.reach_review()
        for index in (4, 5):
            key = 'K03.g' + str(index)
            self.answer(resolved=True, new_gap=key, next_gap=key, blocking=True)
        self.answer(next_target='K01')
        state = self.state()
        self.assertEqual(6, interview.count(state, 'K03'))
        self.assertEqual('exhausted', state['targets']['K03']['status'])
        self.assert_code('FOLLOWUP_CLOSED', core.askable, state, 'K03')
        self.assertFalse(core.can_draft(state, 'knowledge'))

    def test_review_does_not_extend_an_optional_detail(self):
        self.reach_review()
        begin, ref = self.begin()
        payload = self.payload(begin, ref, resolved=True, new_gap='K03.detail', next_gap='K03.detail')
        self.assert_code('EXTENSION_REQUIRES_BLOCKER', core.call, self.workspace, payload)
        self.assertEqual(3, interview.count(self.state(), 'K03'))
        # Repair the failed finish, without replaying the user's answer.
        payload['delivery']['question'] = {'targetId': 'K01'}
        payload['patch']['targets'][0]['status'] = 'exhausted'
        core.call(self.workspace, payload)
        self.assertEqual(4, interview.count(self.state(), 'K03'))

    def test_no_gain_at_review_stops_even_before_two_in_a_row(self):
        self.reach_review()
        self.answer(gain=False, next_target='K01')
        self.assertEqual('exhausted', self.state()['targets']['K03']['status'])

    def test_explanation_and_pause_preserve_binding_and_counts(self):
        self.answer()
        before = copy.deepcopy(self.state()['interview'])
        pending = self.state()['questionDeliveryId']
        begin, _ = self.begin('这个问题是什么意思？')
        core.call(self.workspace, {'operation': 'turn_finish', 'turnId': begin['turn']['id'],
            'intent': 'explanation', 'patch': {}, 'delivery': {'text': '“最想帮助完成什么？”是问具体的一件事，比如把周报里的进展说清楚。', 'mode': 'explanation'}})
        self.assertEqual(before, self.state()['interview'])
        self.assertEqual(pending, self.state()['questionDeliveryId'])
        self.assertEqual(pending, self.state()['deliveries'][self.state()['currentDeliveryId']]['resumeDeliveryId'])
        begin, _ = self.begin('先暂停。')
        core.call(self.workspace, {'operation': 'turn_finish', 'turnId': begin['turn']['id'],
            'intent': 'pause', 'patch': {'paused': True}, 'delivery': {'text': '已保存，之后从这里继续。'}})
        self.assertEqual(before, self.state()['interview'])
        begin, _ = self.begin('继续创作。')
        core.call(self.workspace, {'operation': 'turn_finish', 'turnId': begin['turn']['id'],
            'intent': 'resume', 'patch': {'paused': False}, 'delivery': {'text': '你最想帮助完成什么？', 'question': {'targetId': 'D01'}}})
        self.answer(resolved=True, status='sufficient', next_target='D02')
        self.assertEqual(2, interview.count(self.state(), 'D01'))

    def test_explicit_reopen_preserves_history_and_plain_reset_is_rejected(self):
        self.answer(gain=False)
        self.answer(gain=False, next_target='D02')
        begin, ref = self.begin('我想继续具体聊刚才的定位问题。')
        target = {'id': 'D01', 'status': 'exploring', 'summary': '已有判断', 'gaps': [], 'evidence': [ref]}
        payload = {'operation': 'turn_finish', 'turnId': begin['turn']['id'], 'intent': 'resume',
            'patch': {'targets': [target]}, 'delivery': {'text': '你希望帮助完成什么？', 'question': {'targetId': 'D01'}}}
        self.assert_code('REOPEN_REQUIRED', core.call, self.workspace, payload)
        payload['patch']['interview'] = {'reopen': {'targetId': 'D01', 'gapId': 'D01.initial',
            'reason': '用户明确选择继续定位', 'evidence': [ref]}}
        core.call(self.workspace, payload)
        state = self.state()
        self.assertEqual(2, len(state['targets']['D01']['answerInputIds']))
        self.assertEqual(0, interview.count(state, 'D01'))
        self.assertEqual(1, len(state['interview']['targets']['D01']['reopens']))
        self.answer(resolved=True, status='sufficient', next_target='D02')
        self.assertEqual(3, len(self.state()['targets']['D01']['answerInputIds']))

    def test_supplement_resolves_deferred_gap_without_reinterview(self):
        self.answer(gain=False)
        self.answer(gain=False, next_target='D02')
        begin, ref = self.begin('定位就是帮新人把周报写清楚。')
        core.call(self.workspace, {'operation': 'turn_finish', 'turnId': begin['turn']['id'], 'intent': 'revision',
            'patch': {'interview': {'resolutions': [{'gapId': 'D01.initial', 'summary': '用户补齐定位', 'evidence': [ref]}]},
                      'targets': [{'id': 'D01', 'status': 'sufficient', 'summary': '帮助新人写清周报', 'gaps': [], 'evidence': [ref]}]},
            'delivery': {'text': '这位新人目前遇到什么困难？', 'question': {'targetId': 'D02'}}})
        state = self.state()
        self.assertEqual('sufficient', state['targets']['D01']['status'])
        self.assertEqual(2, interview.count(state, 'D01'))
        self.assertEqual([], state['targets']['D01']['gaps'])

    def test_cannot_mark_unresolved_gap_sufficient(self):
        begin, ref = self.begin()
        payload = self.payload(begin, ref, status='sufficient', next_target='D02')
        self.assert_code('UNRESOLVED_GAP', core.call, self.workspace, payload)

    def test_confirmed_booklet_still_continues_after_ok(self):
        state = self.state()
        for target in state['targets'].values():
            if target['id'].startswith('D'):
                target['status'] = 'sufficient'
        state['interview'] = {'targets': {}, 'gaps': {}}
        for key in core.book_ids('definition'):
            artifact = {'id': key, 'stage': 'definition', 'kind': 'chapter', 'title': key,
                        'markdown': '用户先前已经校准的定义内容', 'unresolved': [], 'data': {}, 'evidence': [], 'dependencies': []}
            artifact['hash'] = core.digest(artifact)
            state['artifacts'][key] = artifact
        core.delivery_record(state, {'text': '这六章定义整理了“帮谁？”和“帮什么？”等内容。是否确认当前完整的定义手册？', 'confirmationObjectIds': core.book_ids('definition'),
                                     'confirmationScope': 'booklet'}, 'confirm-definition')
        core.save(self.workspace, state)
        begin, ref = self.begin('ok，确认这六章。')
        core.call(self.workspace, {'operation': 'turn_finish', 'turnId': begin['turn']['id'], 'intent': 'confirmation',
            'patch': {'confirmations': [{'objectId': key, 'decision': 'confirmed', 'evidence': [ref]} for key in core.book_ids('definition')]},
            'delivery': {'text': '最近一次别人带着什么问题找你？', 'question': {'targetId': 'K01'}}})
        self.assertEqual('knowledge', self.state()['stage'])
        self.assertEqual('K01', self.state()['deliveries'][self.state()['currentDeliveryId']]['question']['targetId'])

    def test_legacy_read_is_unchanged_and_closed_targets_stay_closed(self):
        state = self.state()
        state.pop('interview', None)
        state['targets']['D01']['status'] = 'exhausted'
        state['deliveries'][state['currentDeliveryId']]['question'].pop('gapId', None)
        core.save(self.workspace, state)
        before = (self.workspace / 'state.json').read_bytes()
        core.open_workspace(workspace=self.workspace)
        self.assertEqual(before, (self.workspace / 'state.json').read_bytes())
        self.assert_code('FOLLOWUP_CLOSED', core.askable, self.state(), 'D01')

    def test_legacy_pending_answer_keeps_old_count(self):
        self.answer()
        state = self.state()
        state.pop('interview', None)
        state['deliveries'][state['currentDeliveryId']]['question'].pop('gapId', None)
        core.save(self.workspace, state)
        self.answer(resolved=True, status='sufficient', next_target='D02')
        self.assertEqual(2, interview.count(self.state(), 'D01'))
        self.assertEqual(2, len(self.state()['interview']['gaps']['D01.initial']['answers']))

    def test_hard_method_gap_cannot_be_bypassed_by_empty_artifact_unresolved(self):
        state = self.state()
        state['stage'] = 'methods'
        interview.ensure(state, 'M01')
        self.assertTrue(state['interview']['gaps']['M01.initial']['blocking'])
        artifact = {'id': 'scenario.M01', 'stage': 'methods', 'kind': 'scenario',
                    'title': '基础案例', 'markdown': '尚未补齐的案例', 'hash': 'fixture', 'unresolved': []}
        state['artifacts'][artifact['id']] = artifact
        self.assertFalse(core.confirmation_ready(state, artifact))
        self.assert_code('CONFIRMATION_BLOCKED', core.delivery_record, state,
                         {'text': '是否确认？', 'confirmationObjectIds': ['scenario.M01']}, 'invalid-confirmation')

    def test_preview_only_exposes_public_content(self):
        self.answer(gain=False)
        self.answer(gain=False, next_target='D02')
        projection = json.dumps(preview.snapshot(self.workspace), ensure_ascii=False)
        self.assertIn('待补', projection)
        for private in ('hasNewInformation', 'windowStart', 'noGainStreak', 'gapId', 'reopens'):
            self.assertNotIn(private, projection)

    def test_real_blockage_can_end_without_fabricating_pause(self):
        self.focus('K03')
        state = self.state()
        for key, target in state['targets'].items():
            if core.catalog()['cards'][key]['stage'] == 'knowledge':
                target['status'] = 'exhausted'
        delivery = core.delivery_record(state, {'text': '约定资料还未取得，请提供该文件后继续。',
                     'blocked': '约定资料未提供；取得文件后继续整理。'}, 'blocked')
        self.assertTrue(delivery['blocked'])
        self.assertFalse(state['paused'])
        state['targets']['K01']['status'] = 'unstarted'
        self.assert_code('NOT_BLOCKED', core.delivery_record, state,
                         {'text': '尚未完成。', 'blocked': '缺资料。'}, 'wrong-block')


if __name__ == '__main__':
    unittest.main()
