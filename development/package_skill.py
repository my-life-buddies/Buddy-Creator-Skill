"""Create a portable Skill ZIP with Python alone; exclude all creator projects."""
from pathlib import Path
import ast
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
METADATA = json.loads((ROOT / 'version.json').read_text(encoding='utf-8'))
TOP_FILES = {'SKILL.md', 'INSTALL.md', 'THIRD_PARTY_NOTICES.md', 'version.json'}
TOP_DIRS = {'references', 'scripts', 'assets', 'agents'}
REQUIRED = ['SKILL.md', 'INSTALL.md', 'references/host-guide.md', 'references/catalog.json',
            'scripts/buddy.py', 'scripts/buddy_core.py', 'scripts/sources.py',
            'scripts/preview.py', 'scripts/completion.py', 'assets/preview/index.html', 'version.json']


def main():
    for relative in REQUIRED:
        if not (ROOT / relative).is_file():
            raise SystemExit('Missing package file: ' + relative)
    files = []
    paths = [ROOT / name for name in sorted(TOP_FILES)]
    for directory in sorted(TOP_DIRS):
        paths.extend(sorted((ROOT / directory).rglob('*')))
    for path in paths:
        relative = path.relative_to(ROOT)
        if any(part in ('__pycache__', '.DS_Store', 'node_modules', '.git') for part in relative.parts):
            continue
        if path.is_symlink():
            raise SystemExit('Symlink in package: ' + str(relative))
        if not path.is_file():
            continue
        raw = path.read_bytes()
        if path.suffix == '.py':
            ast.parse(raw, filename=str(relative), feature_version=(3, 9))
        if path.suffix in ('.node', '.dylib', '.dll', '.so', '.pyc', '.sqlite'):
            raise SystemExit('Unexpected runtime or project file: ' + str(relative))
        files.append((relative.as_posix(), raw))
    catalog = json.loads((ROOT / 'references/catalog.json').read_text(encoding='utf-8'))
    manifest = dict(METADATA, format=METADATA['workspaceFormat'], thirdPartyPythonDependencies=[],
                    entrypoint='scripts/buddy.py', model='host-main-agent', sourceProcessing='host-tools',
                    bookletChapters=sum(map(len, catalog['chapters'].values())),
                    previousPythonTrialWorkspaceSupport=True, existingNodeWorkspaceMigration=False,
                    files=[{'path': path, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()} for path, raw in files])
    files.append(('skill-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8')))
    output = ROOT / 'release'
    output.mkdir(parents=True, exist_ok=True)
    archive = output / (METADATA['name'] + '-' + METADATA['version'] + '.zip')
    with zipfile.ZipFile(str(archive), 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for path, raw in files:
            info = zipfile.ZipInfo(METADATA['name'] + '/' + path, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(info, raw, compresslevel=9)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(digest + '  ' + archive.name + '\n', encoding='ascii')
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size,
                      'files': len(files), 'sha256': digest}, indent=2))


if __name__ == '__main__':
    main()
