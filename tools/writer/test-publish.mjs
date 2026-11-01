/**
 * 发布链路自测：在一个临时 git 仓库上跑完整的"提交更新博客"流程，
 * 不会碰到真实博客。
 *
 * 用法：node tools/writer/test-publish.mjs
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4174;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '  — ' + detail : ''}`);
};

const git = (cwd, ...args) => execFileAsync('git', args, { cwd, windowsHide: true });

const scratch = await mkdtemp(path.join(os.tmpdir(), 'writer-pubtest-'));
const repo = path.join(scratch, 'site');
const origin = path.join(scratch, 'origin.git');

let server;

try {
  console.log('准备临时仓库…');
  await mkdir(path.join(repo, 'source', '_posts'), { recursive: true });
  await mkdir(path.join(repo, 'source', 'img'), { recursive: true });
  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.name', 'writer-test');
  await git(repo, 'config', 'user.email', 'writer-test@example.com');
  await writeFile(path.join(repo, 'README.md'), 'test\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'init');

  await git(scratch, 'init', '-q', '--bare', origin);
  await git(repo, 'remote', 'add', 'origin', origin);
  await git(repo, 'push', '-q', '-u', 'origin', 'main');

  console.log('启动写作服务…');
  server = spawn(process.execPath, [path.join(HERE, 'server.mjs'), '--no-open'], {
    env: { ...process.env, WRITER_ROOT: repo, WRITER_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let serverLog = '';
  server.stdout.on('data', (chunk) => { serverLog += chunk; });
  server.stderr.on('data', (chunk) => { serverLog += chunk; });

  let up = false;
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/posts`);
      if (response.ok) { up = true; break; }
    } catch { /* 继续等 */ }
    await sleep(250);
  }
  if (!up) throw new Error('服务没起来：' + serverLog);

  console.log('提交一篇文章…');
  const payload = {
    title: '自测：带正则的标题 * 和 [方括号]',
    date: '2026-11-01T20:30',
    tags: ['自测', '随笔'],
    categories: ['折腾'],
    slug: 'self-test-post',
    markdown: [
      '## 二级标题',
      '',
      '一段带 **加粗** 和 *斜体* 的正文。',
      '',
      '- 列表项一',
      '- 列表项二',
      '  - 嵌套项',
      '',
      '```js',
      'const a = 1;',
      '```',
    ].join('\n'),
  };

  const response = await fetch(`http://127.0.0.1:${PORT}/api/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json();

  check('接口返回成功', result.ok === true, result.error || `file=${result.file}`);
  check('走的是 git 推送', result.transport === 'git', `transport=${result.transport}`);
  check('没有待同步标记', result.pending === false);

  const postFile = path.join(repo, 'source', '_posts', 'self-test-post.md');
  check('文章文件已生成', existsSync(postFile));

  const content = await readFile(postFile, 'utf8');
  check('front matter 标题带引号', content.includes('title: "自测：带正则的标题 * 和 [方括号]"'),
    content.split('\n')[1]);
  check('标签写成列表', content.includes('tags:\n  - 自测\n  - 随笔'));
  check('分类写成列表', content.includes('categories:\n  - 折腾'));
  check('日期格式化正确', content.includes('date: 2026-11-01 20:30:00'));
  check('正文完整保留', content.includes('```js\nconst a = 1;\n```'));

  const { stdout: localLog } = await git(repo, 'log', '--oneline');
  check('本地已提交', /post: 自测/.test(localLog), localLog.trim().split('\n')[0]);

  const { stdout: remoteLog } = await execFileAsync('git',
    [`--git-dir=${origin}`, 'log', '--oneline', 'main'], { windowsHide: true });
  check('已推送到远端', /post: 自测/.test(remoteLog), remoteLog.trim().split('\n')[0]);

  const { stdout: status } = await git(repo, 'status', '--porcelain');
  check('工作区干净', status.trim() === '');

  // 改完再点一次提交，应该更新原文件而不是新建一个 -2
  const again = await (await fetch(`http://127.0.0.1:${PORT}/api/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, file: result.file, markdown: '改过的正文' }),
  })).json();
  check('再次提交复用同一文件', again.file === 'self-test-post.md', again.file);
  const updated = await readFile(postFile, 'utf8');
  check('内容已更新', updated.includes('改过的正文'));
} catch (error) {
  check('测试执行', false, String(error.message || error));
} finally {
  if (server) server.kill();
  await rm(scratch, { recursive: true, force: true }).catch(() => {});
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n结果：${checks.length} 项检查，${failed} 项失败`);
process.exitCode = failed ? 1 : 0;
