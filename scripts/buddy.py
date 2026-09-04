#!/usr/bin/env python3
"""Run Buddy Creator Skill using only the Python standard library."""
import argparse
import json
import re
import sys
from pathlib import Path

if sys.version_info < (3, 9):
    print(json.dumps({'ok': False, 'error': {'code': 'PYTHON_VERSION', 'message': '需要 Python 3.9 或更高版本；无需 Node、npm 或 pip。'}}, ensure_ascii=False))
    sys.exit(1)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import buddy_core as core


def parse_input(path):
    try:
        raw = sys.stdin.read() if path == '-' else Path(path).expanduser().read_text(encoding='utf-8')
        return json.loads(raw)
    except (OSError, ValueError) as error:
        raise core.BuddyError('INPUT_JSON', '无法读取请求 JSON；--input 使用 UTF-8 文件路径或 - 表示标准输入。') from error


def main():
    parser = argparse.ArgumentParser(description='Buddy Creator Skill：宿主采访、Python 本地保存与只读预览。')
    parser.add_argument('--version', action='version', version=core.METADATA['displayName'] + ' ' + core.METADATA['version'])
    sub = parser.add_subparsers(dest='command', required=True)
    opened = sub.add_parser('open', help='创建或恢复 Buddy 项目')
    opened.add_argument('--creation-key')
    opened.add_argument('--workspace')
    opened.add_argument('--no-browser', action='store_true', help='由宿主打开预览，不调用系统浏览器（默认行为）')
    call = sub.add_parser('call', help='提交协议请求')
    call.add_argument('--workspace', required=True)
    call.add_argument('--input', default='-')
    for name in ['serve', 'status']:
        command = sub.add_parser(name)
        command.add_argument('--workspace', required=True)
    args = parser.parse_args()
    if args.command == 'serve':
        import preview
        preview.serve(Path(args.workspace).expanduser().resolve())
        return
    if args.command == 'open':
        workspace, state = core.open_workspace(args.creation_key, args.workspace)
        import preview
        try:
            endpoint = preview.start(workspace)
        except Exception as error:
            endpoint = {'status': 'unavailable', 'message': str(error), 'recovery': '项目已经保存。允许本地端口后重试同一 open；不要更换 creation-key。'}
        result = {'workspace': str(workspace), 'buddyId': state['buddyId'], 'preview': endpoint, 'delivery': state['deliveries'].get(state.get('currentDeliveryId')), 'directive': 'continue_turn' if state.get('pendingTurnId') else 'present_delivery', 'context': core.context(workspace, state), 'entrypointCommand': {'executable': sys.executable, 'args': [str(Path(__file__).resolve())]}}
    elif args.command == 'status':
        workspace = Path(args.workspace).expanduser().resolve()
        with core.workspace_lock(workspace):
            state = core.load(workspace)
        import preview
        result = {'workspace': str(workspace), 'context': core.context(workspace, state), 'snapshot': preview.snapshot(workspace, state)}
    else:
        result = core.call(args.workspace, parse_input(args.input))
    print(json.dumps(dict(ok=True, product=core.METADATA['displayName'], version=core.METADATA['version'], **result), ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except core.BuddyError as error:
        print(json.dumps({'ok': False, 'error': {'code': error.code, 'message': str(error), 'details': error.details}}, ensure_ascii=False, indent=2))
        sys.exit(1)
    except Exception as error:
        match = re.match(r'^([A-Z][A-Z0-9_]+):\s*(.*)', str(error), re.DOTALL)
        code, message = match.groups() if match else ('UNEXPECTED_ERROR', str(error))
        print(json.dumps({'ok': False, 'error': {'code': code, 'message': message, 'recovery': '已提交的原话和历史版本仍保留。读取 status 或 turn_continue 恢复，勿创建重复项目。'}}, ensure_ascii=False, indent=2))
        sys.exit(1)
