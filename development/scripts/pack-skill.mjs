import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const release = join(root, 'release');
const output = join(release, 'buddy-creator');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(join(root, 'skill/buddy-creator'), output, { recursive: true });
const lib = join(output, 'lib');
mkdirSync(lib);
for (const name of ['dist', 'rules', 'integrations', 'native', 'THIRD_PARTY_NOTICES.md'])
  cpSync(join(root, name), join(lib, name), { recursive: true });
// Compatibility-only discovery is not part of the delivered skill's instructions.
rmSync(join(lib, 'integrations/SKILL.md'));
writeFileSync(join(lib, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', engines: pkg.engines, dependencies: pkg.dependencies }, null, 2)+'\n');
cpSync(join(root, 'package-lock.json'), join(lib, 'package-lock.json'));
mkdirSync(join(output, 'assets'), { recursive: true });
cpSync(join(root, 'preview-dist'), join(output, 'assets/preview'), { recursive: true });

// Copy only the locked production dependency closure, retaining Node's nested resolution layout.
const seen = new Set();
const missingOptional = new Set();
function dependencyDirectory(name, from) {
  let cursor = from;
  while (true) {
    const candidate = join(cursor, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (cursor === root || dirname(cursor) === cursor) break;
    cursor = dirname(cursor);
  }
}
function copyDependency(name, from, optional = false) {
  const directory = dependencyDirectory(name, from);
  if (!directory) {
    if (optional) { missingOptional.add(name); return; }
    throw new Error(`Missing installed production dependency: ${name}`);
  }
  if (seen.has(directory)) return;
  seen.add(directory);
  const key = relative(root, directory).split(sep).join('/');
  if (!key.startsWith('node_modules/')) throw new Error(`Dependency outside build root: ${key}`);
  const dep = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  if (lock.packages[key]?.version !== dep.version) throw new Error(`Lock mismatch: ${name}@${dep.version}`);
  cpSync(directory, join(lib, key), { recursive: true, filter: (path) =>
    path === directory || !relative(directory, path).split(sep).some((part) => ['node_modules', '.git', '.DS_Store'].includes(part)) });
  for (const child of Object.keys(dep.dependencies ?? {})) copyDependency(child, directory, child in (dep.optionalDependencies ?? {}));
  for (const child of Object.keys(dep.optionalDependencies ?? {})) copyDependency(child, directory, true);
  for (const child of Object.keys(dep.peerDependencies ?? {})) copyDependency(child, directory, dep.peerDependenciesMeta?.[child]?.optional === true);
}
for (const name of Object.keys(pkg.dependencies)) copyDependency(name, root);

const refs = join(output, 'references');
mkdirSync(refs, { recursive: true });
const rulebook = readFileSync(join(root, 'rules/interview.md'), 'utf8');
const sections = new Map([...rulebook.matchAll(/^## (\d+)\.[\s\S]*?(?=^## \d+\.|$(?![\s\S]))/gm)].map((match) => [Number(match[1]), match[0]]));
function reference(name, title, numbers) {
  const text = numbers.map((number) => {
    if (!sections.has(number)) throw new Error(`Rule section ${number} missing`);
    return sections.get(number);
  }).join('\n\n');
  writeFileSync(join(refs, name+'.md'), `# ${title}\n\n${text}`);
}
reference('interview', '访谈判断与表达', [1, 2, 3, 8, 10, 12]);
for (const [index, name] of ['definition', 'knowledge', 'methods', 'service'].entries()) reference(name, name, [index+4]);
reference('recovery', '中断与恢复', [9]);
writeFileSync(join(refs, 'recovery.md'), readFileSync(join(refs, 'recovery.md'), 'utf8') + '\n\n当前调用、固定地址恢复、旧来源处理与完成状态以 [宿主协议](host-guide.md) 为准。不修改旧检查点、输入和确认记录；失败工作局部恢复。\n');
cpSync(join(root, 'integrations/HOST_GUIDE.md'), join(refs, 'host-guide.md'));
chmodSync(join(output, 'scripts/buddy'), 0o755);

const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in skill: ${path}`);
    if (entry.isDirectory()) walk(path);
    else files.push({ path: relative(output, path).split(sep).join('/'), bytes: statSync(path).size, sha256: sha(readFileSync(path)) });
  }
}
walk(output);
for (const file of files) if (/\/(?:mock-coding-cli|coding-handoff|xiaohongshu)\.(?:js|d\.ts)$/.test(file.path)) throw new Error(`Removed capability in package: ${file.path}`);
const manifest = { name: 'buddy-creator', version: pkg.version, formatVersion: 1, platform: 'darwin', buildArchitecture: process.arch,
  node: '>=22.13', model: 'host-main-agent', workflow: 'langgraph-sqlite-1', completion: 'local-deliverables',
  missingOptionalDependencies: [...missingOptional].sort(), files };
writeFileSync(join(output, 'skill-manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
const archive = join(release, `buddy-creator-${pkg.version}.zip`);
rmSync(archive, { force: true });
execFileSync('/usr/bin/zip', ['-qr', archive, 'buddy-creator'], { cwd: release });
const digest = sha(readFileSync(archive));
writeFileSync(archive+'.sha256', `${digest}  buddy-creator-${pkg.version}.zip\n`);
console.log(JSON.stringify({ directory: output, archive, sha256: digest, bytes: statSync(archive).size, files: files.length,
  productionPackages: seen.size, buildArchitecture: process.arch }, null, 2));
