"""Adaptive method coverage, stop, version and recovery regressions."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

SKILL = Path(os.environ.get('CREATOR_TEST_SKILL_ROOT') or Path(__file__).resolve().parents[1])
sys.path.insert(0, str(SKILL / 'scripts'))
import buddy_core as core
import interview
import methods
import preview
import completion


class AdaptiveMethods(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace, state = core.open_workspace('adaptive-methods', Path(self.temp.name) / 'work')
        for stage in ('definition', 'knowledge'):
            for key in core.book_ids(stage):
                artifact = self.artifact(key, stage, 'chapter', [], [])
                artifact['hash'] = core.digest(artifact)
                state['artifacts'][key] = artifact
                self.confirm(state, key)
        state['stage'] = 'methods'
        self.sequence = 0
        core.save(self.workspace, state)

    def state(self):
        return core.load(self.workspace)

    def assert_code(self, expected, function, *args):
        with self.assertRaises(core.BuddyError) as caught:
            function(*args)
        self.assertEqual(expected, caught.exception.code)

    def begin(self, raw='这是本轮真实内容'):
        self.sequence += 1
        state = self.state()
        return core.call(self.workspace, {'operation': 'turn_begin', 'raw': raw,
            'clientKey': 'round-' + str(self.sequence), 'presentedDeliveryId': state['currentDeliveryId']})

    def ref_input(self, inp):
        return {'type': 'input', 'id': inp['id'], 'hash': inp['hash'], 'quote': inp['raw']}

    def ref(self, state, key):
        return {'type': 'artifact', 'id': key, 'hash': state['artifacts'][key]['hash']}

    def deps(self, state):
        return [self.ref(state, key + '.1') for key in ('definition', 'knowledge')]

    def artifact(self, key, stage='methods', kind='scenario', evidence=None, deps=None, data=None):
        return {'id': key, 'kind': kind, 'stage': stage, 'title': key, 'markdown': '具体判断与操作：' + key,
                'evidence': evidence or [], 'dependencies': deps or [], 'unresolved': [], 'data': data or {}}

    def confirm(self, state, key, decision='confirmed'):
        state['confirmations'].append({'id': 'fixture-' + key, 'objectId': key, 'hash': state['artifacts'][key]['hash'], 'decision': decision})

    def register(self, key):
        return {'id': key, 'title': '校准 ' + key, 'purpose': '独立任务分支 ' + key,
                'evidence': self.deps(self.state())}

    def close(self, state, status='sufficient', ref=None):
        refs = [self.ref(state, 'scenario.M01')]
        return {'status': status, 'summary': '关键判断、行动、变化与边界已有校准依据。' if status == 'sufficient' else '按创作者请求先整理已确认范围。',
                'coverage': {key: {'status': 'covered', 'reason': '本场景已验证该判断。', 'evidence': refs} for key in methods.DIMENSIONS} if status == 'sufficient' else {},
                'unresolved': [], 'evidence': [ref] if ref else refs}

    def seed_methods(self, hypotheses=1, base=1, extensions=0):
        state = self.state()
        inp = {'id': 'fixture-input', 'raw': '真实校准内容', 'hash': core.digest('真实校准内容')}
        state['inputs'][inp['id']] = inp
        ref = self.ref_input(inp)
        for prefix, count in [('H', hypotheses), ('M', base), ('E', extensions)]:
            for index in range(1, count + 1):
                target = prefix + str(index).zfill(2)
                methods.prepare(state, {'register': [self.register(target)]}, inp, 'revision')
                key = methods.object_id(target)
                deps = self.deps(state)
                if prefix != 'H':
                    deps.append(self.ref(state, 'hypothesis.H1'))
                if prefix == 'E':
                    deps.append(self.ref(state, 'scenario.M01'))
                a = self.artifact(key, kind='hypothesis' if prefix == 'H' else 'scenario', evidence=[ref], deps=deps)
                core.put_artifacts(state, [a], 'fixture')
                self.confirm(state, key, 'accepted' if prefix == 'H' else 'confirmed')
        core.save(self.workspace, state)
        return state, inp

    def finish(self, begin, patch, delivery, intent='revision'):
        return core.call(self.workspace, {'operation': 'turn_finish', 'turnId': begin['turn']['id'],
                                         'intent': intent, 'patch': patch, 'delivery': delivery})

    def test_simple_case_ends_with_one_method_and_one_base_through_real_turns(self):
        begin = self.begin('我会先判断条件，再安排动作；条件不符就停止。')
        state = self.state()
        a = self.artifact('hypothesis.H1', kind='hypothesis', evidence=[self.ref_input(begin['input'])], deps=self.deps(state))
        self.finish(begin, {'methods': {'register': [self.register('H01')]}, 'artifacts': [a]},
                    {'text': '先判断条件，再行动，条件不符时停止。这条方法对吗？', 'confirmationObjectIds': ['hypothesis.H1']})
        begin = self.begin('对，这就是我的方法。')
        self.finish(begin, {'confirmations': [{'objectId': 'hypothesis.H1', 'decision': 'accepted', 'evidence': [self.ref_input(begin['input'])]}],
                            'methods': {'register': [self.register('M01')]}},
                    {'text': '这次真实经历你怎么判断和处理的？', 'question': {'targetId': 'M01'}}, 'confirmation')
        begin = self.begin('先看输入条件，符合就做第一步；做不到则换备用动作，超出能力就停止。')
        state = self.state()
        ref = self.ref_input(begin['input'])
        a = self.artifact('scenario.M01', evidence=[ref], deps=self.deps(state) + [self.ref(state, 'hypothesis.H1')], data={'capture': 'faithful_user_answer'})
        predicted = copy.deepcopy(state)
        predicted['artifacts'][a['id']] = dict(a, hash=core.digest(a))
        conclusion = self.close(predicted)
        chapters = [self.artifact(key, kind='chapter', evidence=[ref], deps=self.deps(state) + [self.ref(predicted, a['id'])]) for key in core.book_ids('methods')]
        self.finish(begin, {'artifacts': [a] + chapters, 'targets': [{'id': 'M01', 'status': 'sufficient', 'summary': '判断、执行、调整和停止条件清楚。', 'gaps': [], 'evidence': [ref]}],
            'interview': {'assessment': {'hasNewInformation': True, 'resolved': True, 'summary': '案例提供了明确处理方式', 'evidence': [ref]}},
            'methods': {'conclude': conclusion}}, {'text': '本版关键问题已覆盖，请查看并确认五章。', 'confirmationScope': 'booklet', 'confirmationObjectIds': core.book_ids('methods')}, 'answer')
        state = self.state()
        self.assertTrue(core.can_draft(state, 'methods'))
        self.assertEqual([], core.available(state)['questionTargets'])
        self.assertEqual(1, interview.count(state, 'M01'))
        prior = state['questionDeliveryId']
        begin = self.begin('为什么已经够了？')
        self.finish(begin, {}, {'text': '已覆盖关键判断、动作、调整和边界。'}, 'explanation')
        self.assertEqual(prior, self.state()['questionDeliveryId'])
        begin = self.begin('我确认这五章。')
        refs = [self.ref_input(begin['input'])]
        self.finish(begin, {'confirmations': [{'objectId': key, 'decision': 'confirmed', 'evidence': refs} for key in core.book_ids('methods')]},
                    {'text': '接下来讨论服务方式。', 'question': {'targetId': 'S00'}}, 'confirmation')
        self.assertEqual('service', self.state()['stage'])

    def test_complex_case_more_methods_and_cases_and_numeric_preview_order(self):
        state, inp = self.seed_methods(hypotheses=12, base=10, extensions=11)
        methods.finish(state, {'conclude': self.close(state)}, inp)
        self.assertTrue(core.can_draft(state, 'methods'))
        projection = preview.snapshot(self.workspace, state)
        group = next(s for s in projection['stages'] if s['id'] == 'methods')['groups']
        self.assertEqual(['H' + str(i).zfill(2) for i in range(1, 13)], [t['id'] for t in next(g for g in group if g['id'] == 'candidates')['topics']])
        self.assertEqual(10, len(next(g for g in group if g['id'] == 'base')['topics']))
        self.assertEqual(11, len(next(g for g in group if g['id'] == 'extended')['topics']))
        self.assert_code('METHOD_CLOSED', methods.prepare, state, {'register': [self.register('M11')]}, inp, 'revision')

    def test_sufficiency_needs_coverage_confirmations_and_no_pending_targets(self):
        state, inp = self.seed_methods()
        incomplete = self.close(state)
        incomplete['coverage'].pop('boundaries')
        self.assert_code('METHOD_COVERAGE', methods.finish, state, {'conclude': incomplete}, inp)
        methods.prepare(state, {'register': [self.register('E01')]}, inp, 'revision')
        self.assert_code('METHOD_INCOMPLETE', methods.finish, state, {'conclude': self.close(state)}, inp)
        a = self.artifact('scenario.E01', evidence=[self.ref_input(inp)], deps=self.deps(state) + [self.ref(state, 'hypothesis.H1'), self.ref(state, 'scenario.M01')])
        core.put_artifacts(state, [a], 'fixture')
        incomplete = self.close(state)
        incomplete['coverage']['adaptation']['evidence'] = [self.ref(state, 'scenario.E01')]
        self.assert_code('METHOD_COVERAGE', methods.finish, state, {'conclude': incomplete}, inp)

    def test_user_stop_does_not_confirm_pending_cases_and_can_confirm_limited_booklet(self):
        state, inp = self.seed_methods()
        methods.prepare(state, {'register': [self.register('E01')]}, inp, 'revision')
        core.delivery_record(state, {'text': '限制改变时怎么处理？', 'question': {'targetId': 'E01'}}, 'extension-question')
        a = self.artifact('scenario.E01', evidence=[self.ref_input(inp)], deps=self.deps(state) + [self.ref(state, 'hypothesis.H1'), self.ref(state, 'scenario.M01')])
        core.put_artifacts(state, [a], 'fixture')
        core.save(self.workspace, state)
        begin = self.begin('先到这里，不再补案例，整理已有内容吧。')
        close = self.close(state, 'user_stopped', self.ref_input(begin['input']))
        self.finish(begin, {'methods': {'conclude': close}}, {'text': '已停止追问，将整理已确认内容并标明待补。'})
        state = self.state()
        self.assertTrue(methods.stopped(state))
        self.assertEqual('访谈收口', preview.snapshot(self.workspace, state)['current']['phase'])
        self.assertFalse(core.confirmed(state, 'scenario.E01'))
        self.assertFalse(core.confirmation_ready(state, state['artifacts']['scenario.E01']))
        self.assertNotIn('questionDeliveryId', state)
        self.assertEqual([], core.available(state)['questionTargets'])
        self.assertTrue(core.can_draft(state, 'methods'))
        chapters = [self.artifact(key, kind='chapter', deps=self.deps(state) + [self.ref(state, 'scenario.M01')]) for key in core.book_ids('methods')]
        core.put_artifacts(state, chapters, 'draft')
        for key in core.book_ids('methods'):
            self.assertIn('E01', state['artifacts'][key]['markdown'])
            self.assertTrue(state['artifacts'][key]['unresolved'])
            self.assertTrue(core.confirmation_ready(state, state['artifacts'][key]))
        core.delivery_record(state, {'text': '请确认有范围限制的本版五章。', 'confirmationScope': 'booklet', 'confirmationObjectIds': core.book_ids('methods')}, 'limited-booklet')
        core.save(self.workspace, state)
        begin = self.begin('确认这一版，未验证部分以后补充。')
        self.finish(begin, {'confirmations': [{'objectId': key, 'decision': 'confirmed', 'evidence': [self.ref_input(begin['input'])]} for key in core.book_ids('methods')]},
                    {'text': '接下来讨论服务方式。', 'question': {'targetId': 'S00'}}, 'confirmation')
        self.assertEqual('service', self.state()['stage'])
        state = self.state()
        state.pop('widgetDesignVersion', None)
        for key in core.book_ids('service'):
            a = self.artifact(key, stage='service', kind='chapter')
            state['artifacts'][key] = dict(a, hash=core.digest(a))
            self.confirm(state, key)
        core.save(self.workspace, state)
        completion.finalize(self.workspace, state)
        exported = self.workspace / 'deliverables' / state['revision']
        self.assertIn('尚未有效校准', (exported / 'booklets/methods.md').read_text())
        self.assertEqual('user_stopped', json.loads((exported / 'versions.json').read_text())['methodInterview']['conclusion']['status'])

    def test_stop_requires_current_user_evidence_and_resume_retains_counters(self):
        state, inp = self.seed_methods()
        methods.prepare(state, {'register': [self.register('M02')]}, inp, 'revision')
        interview.ensure(state, 'M02')
        state['targets']['M02']['answerInputIds'] = ['one', 'two', 'three', 'four', 'five', 'six']
        state['targets']['M02']['status'] = 'exhausted'
        request = {'id': 'stop-input', 'raw': '到这里', 'hash': core.digest('到这里')}
        state['inputs'][request['id']] = request
        self.assert_code('USER_EVIDENCE_REQUIRED', methods.finish, state, {'conclude': self.close(state, 'user_stopped', self.ref_input(inp))}, request)
        methods.finish(state, {'conclude': self.close(state, 'user_stopped', self.ref_input(request))}, request)
        core.save(self.workspace, state)
        before = self.state()
        core.open_workspace(workspace=self.workspace)
        self.assertEqual(before, self.state())
        self.assert_code('METHOD_CLOSED', core.askable, state, 'M01')
        resume = {'id': 'resume-input', 'raw': '继续补充这个方法', 'hash': core.digest('继续补充这个方法')}
        state['inputs'][resume['id']] = resume
        methods.prepare(state, {'resume': {'reason': '用户要求补充', 'evidence': [self.ref_input(resume)]}}, resume, 'resume')
        self.assertEqual(6, interview.count(state, 'M02'))
        self.assert_code('TARGET_LIMIT', interview.target_open, state, 'M02')
        self.assertFalse(methods.conclusion(state))
        self.assertEqual('user_stopped', state['methodInterview']['history'][-1]['previous']['status'])

    def test_stop_retry_is_atomic_and_idempotent(self):
        state, inp = self.seed_methods()
        methods.prepare(state, {'register': [self.register('M02')]}, inp, 'revision')
        core.delivery_record(state, {'text': '第二个场景怎么处理？', 'question': {'targetId': 'M02'}}, 'next-case')
        core.save(self.workspace, state)
        begin = self.begin('先到这里，结束访谈。')
        record = self.close(state, 'user_stopped', self.ref_input(begin['input']))
        patch = {'methods': {'conclude': record}}
        self.assert_code('METHOD_CLOSED', self.finish, begin, patch,
                         {'text': '再问一个问题？', 'question': {'targetId': 'M02'}})
        self.assertFalse(methods.stopped(self.state()))
        self.assertEqual('working', self.state()['turns'][begin['turn']['id']]['status'])
        result = self.finish(begin, patch, {'text': '已停止追问，保留待补。'})
        saved = self.state()
        repeated = self.finish(begin, patch, {'text': '已停止追问，保留待补。'})
        self.assertEqual(result['delivery'], repeated['delivery'])
        self.assertEqual(saved, self.state())

    def test_duplicate_target_stale_assessment_and_legacy_recovery(self):
        state, inp = self.seed_methods()
        duplicate = self.register('M02')
        duplicate['purpose'] = self.register('M01')['purpose']
        self.assert_code('DUPLICATE_METHOD_TARGET', methods.prepare, state, {'register': [duplicate]}, inp, 'revision')
        methods.finish(state, {'conclude': self.close(state)}, inp)
        chapters = [self.artifact(key, kind='chapter', deps=self.deps(state)) for key in core.book_ids('methods')]
        core.put_artifacts(state, chapters, 'draft')
        self.assertTrue(core.confirmation_ready(state, state['artifacts']['methods.1']))
        core.invalidate(state, ['hypothesis.H1'], 'changed')
        self.assertFalse(methods.conclusion(state))
        self.assertFalse(core.confirmation_ready(state, state['artifacts']['methods.1']))
        state.pop('methodInterview')
        self.confirm(state, 'methods.1')
        state['targets']['M01']['answerInputIds'] = ['old-answer']
        # Opening old projects does not upgrade/rewrite the workspace.
        core.save(self.workspace, state)
        _, restored = core.open_workspace(workspace=self.workspace)
        self.assertNotIn('methodInterview', restored)
        methods.prepare(state, {}, inp, 'revision')
        self.assertEqual({'H01', 'M01'}, set(state['methodInterview']['targets']))
        self.assertFalse(core.confirmed(state, 'methods.1'))
        self.assertEqual(['old-answer'], state['targets']['M01']['answerInputIds'])
        self.assertEqual(6, core.catalog(state)['cards']['M01']['maxAnswers'])


if __name__ == '__main__':
    unittest.main()
