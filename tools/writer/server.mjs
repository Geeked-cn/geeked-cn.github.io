#!/usr/bin/env node
/**
 * 本地写作客户端（零依赖，只用 Node 内置模块）。
 *
 * 给不熟悉 Markdown 的人用：在浏览器里可视化写文章，点"提交更新博客"之后
 * 它负责把内容转成 Markdown、写进 source/_posts、提交 git 并推到 GitHub，
 * GitHub Actions 随即自动构建发布。
 *
 * 网络（github.com）在国内经常被重置，所以推送失败时会退回 GitHub HTTP API，
 * 那条路走 api.github.com，通常还是通的。
 */
import http from 'node:http';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
// WRITER_ROOT 只在自测时用（指向一个临时仓库），平时留空
const ROOT = process.env.WRITER_ROOT
  ? path.resolve(process.env.WRITER_ROOT)
  : path.resolve(HERE, '..', '..');
const POSTS_DIR = path.join(ROOT, 'source', '_posts');
const UPLOAD_DIR = path.join(ROOT, 'source', 'img', 'uploads');
const TMP_DIR = path.join(ROOT, '.writer-tmp');

const REPO = 'Geeked-cn/geeked-cn.github.io';
const BRANCH = 'main';
const BASE_PORT = Number(process.env.WRITER_PORT || 4173);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 * 执行外部命令
 * ------------------------------------------------------------------ */

async function run(cmd, args, options = {}) {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd: ROOT,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  return stdout;
}

const git = (...args) => run('git', args);

/* ------------------------------------------------------------------ *
 * Markdown / front matter 处理
 * ------------------------------------------------------------------ */

// YAML 里有些字符必须加引号，否则解析会出错
function yamlValue(value) {
  const s = String(value ?? '').trim();
  if (!s) return "''";
  if (/^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5 .\-/]*$/.test(s)) return s;
  return JSON.stringify(s);
}

function buildFrontMatter({ title, date, tags = [], categories = [] }) {
  const lines = ['---', `title: ${yamlValue(title)}`, `date: ${date}`];
  const list = (key, values) => {
    if (!values.length) return lines.push(`${key}: []`);
    lines.push(`${key}:`);
    for (const v of values) lines.push(`  - ${yamlValue(v)}`);
  };
  list('tags', tags);
  list('categories', categories);
  lines.push('---', '');
  return lines.join('\n');
}

// 只解析我们自己写出去的 front matter，够用就行
function parsePost(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = { title: '', date: '', tags: [], categories: [] };
  if (!match) return { meta, body: text };

  let key = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(rawLine);
    if (kv) {
      key = kv[1];
      const value = kv[2].trim();
      if (!value) meta[key] = [];
      else if (value === '[]') meta[key] = [];
      else meta[key] = value.replace(/^['"]|['"]$/g, '');
      continue;
    }
    const item = /^\s*-\s*(.+)$/.exec(rawLine);
    if (item && key && Array.isArray(meta[key])) {
      meta[key].push(item[1].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return { meta, body: text.slice(match[0].length) };
}

// 纯中文标题没法转拼音，就保留中文；URL 里会被编码，但显示正常
function makeSlug(title) {
  const base = String(title || '').trim();
  const ascii = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();

  if (/[a-z0-9]/.test(ascii)) return ascii.slice(0, 60).replace(/^-|-$/g, '');

  const chinese = base
    .replace(/[\s/\\:*?"<>|]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return chinese || 'post';
}

async function uniqueFilename(slug) {
  let candidate = slug;
  let n = 2;
  while (existsSync(path.join(POSTS_DIR, `${candidate}.md`))) {
    candidate = `${slug}-${n++}`;
  }
  return `${candidate}.md`;
}

function normalizeDate(input) {
  if (!input) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  const s = String(input).replace('T', ' ').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
  return s;
}

/* ------------------------------------------------------------------ *
 * 发布：本地提交 + 推送，推不动就退回 GitHub API
 * ------------------------------------------------------------------ */

async function commitLocally(file, title) {
  await git('add', '-A', '--', 'source');
  const staged = await git('diff', '--cached', '--name-only');
  if (!staged.trim()) return false;
  await git('commit', '-q', '-m', `post: ${title}`);
  return true;
}

async function pushWithRetry(attempts = 4) {
  let lastError = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      await git('push', 'origin', `HEAD:${BRANCH}`);
      return { ok: true };
    } catch (error) {
      lastError = String(error.stderr || error.stdout || error.message).trim().split('\n').pop();
      if (i < attempts) await sleep(4000);
    }
  }
  return { ok: false, error: lastError };
}

async function publishViaApi(relPath, content, message) {
  await mkdir(TMP_DIR, { recursive: true });
  const bodyFile = path.join(TMP_DIR, 'body.json');

  let sha = null;
  try {
    sha = (await run('gh', ['api', `repos/${REPO}/contents/${relPath}`, '--jq', '.sha'])).trim();
  } catch {
    // 文件还不存在，正常
  }

  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH,
  };
  if (sha && !sha.includes('Not Found')) body.sha = sha;

  await writeFile(bodyFile, JSON.stringify(body), 'utf8');
  await run('gh', ['api', '--method', 'PUT', `repos/${REPO}/contents/${relPath}`, '--input', bodyFile]);
  await unlink(bodyFile).catch(() => {});
}

/** API 发布之后本地会领先远端一个提交，把本地对齐到远端（内容一致，不会丢东西） */
async function realignWithRemote() {
  try {
    await git('fetch', 'origin', BRANCH);
    const diff = await git('diff', '--stat', 'HEAD', `origin/${BRANCH}`);
    if (diff.trim()) return false;
    await git('reset', '--soft', `origin/${BRANCH}`);
    return true;
  } catch {
    return false;
  }
}

async function publish(payload) {
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('请先填写标题');

  const markdown = String(payload.markdown || '').trim();
  if (!markdown) throw new Error('正文还是空的，先写点内容吧');

  const date = normalizeDate(payload.date);
  const tags = (payload.tags || []).map((t) => String(t).trim()).filter(Boolean);
  const categories = (payload.categories || []).map((c) => String(c).trim()).filter(Boolean);

  let filename = String(payload.file || '').trim();
  if (filename) {
    filename = path.basename(filename);
    if (!filename.endsWith('.md')) filename += '.md';
  } else {
    const slug = String(payload.slug || '').trim() || makeSlug(title);
    filename = await uniqueFilename(makeSlug(slug) || slug);
  }

  const relPath = `source/_posts/${filename}`;
  const fullPath = path.join(POSTS_DIR, filename);
  const content = buildFrontMatter({ title, date, tags, categories }) + markdown + '\n';

  await mkdir(POSTS_DIR, { recursive: true });
  await writeFile(fullPath, content, 'utf8');

  const committed = await commitLocally(relPath, title);
  const push = await pushWithRetry();
  if (push.ok) {
    return { ok: true, file: filename, transport: committed ? 'git' : 'git(noop)', pending: false };
  }

  // git 推不动 —— 换 API
  await publishViaApi(relPath, content, `post: ${title}`);
  const realigned = await realignWithRemote();
  return {
    ok: true,
    file: filename,
    transport: 'api',
    pending: !realigned,
    note: realigned
      ? 'git 推送被网络重置，已改用 GitHub API 发布，线上照常更新。'
      : 'git 推送被网络重置，已改用 GitHub API 发布；本地仓库下次联网时再自动对齐。',
  };
}

/* ------------------------------------------------------------------ *
 * HTTP 服务
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error('内容太大了');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function listPosts() {
  if (!existsSync(POSTS_DIR)) return [];
  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  const posts = [];
  for (const file of files) {
    const text = await readFile(path.join(POSTS_DIR, file), 'utf8');
    const { meta } = parsePost(text);
    posts.push({
      file,
      title: meta.title || file.replace(/\.md$/, ''),
      date: typeof meta.date === 'string' ? meta.date : '',
      tags: Array.isArray(meta.tags) ? meta.tags : [],
    });
  }
  return posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function serveStatic(res, name) {
  const file = path.join(HERE, name);
  if (!file.startsWith(HERE) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  const body = await readFile(file);
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return serveStatic(res, 'ui.html');
    }
    if (req.method === 'GET' && (url.pathname === '/ui.css' || url.pathname === '/ui.js')) {
      return serveStatic(res, url.pathname.slice(1));
    }

    if (req.method === 'GET' && url.pathname === '/api/posts') {
      return sendJson(res, 200, { ok: true, posts: await listPosts() });
    }

    if (req.method === 'GET' && url.pathname === '/api/post') {
      const file = path.basename(url.searchParams.get('file') || '');
      const full = path.join(POSTS_DIR, file);
      if (!file || !existsSync(full)) return sendJson(res, 404, { ok: false, error: '文章不存在' });
      const { meta, body } = parsePost(await readFile(full, 'utf8'));
      return sendJson(res, 200, { ok: true, file, meta, markdown: body.trim() });
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const { name, dataUrl } = await readJsonBody(req);
      const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
      if (!match) return sendJson(res, 400, { ok: false, error: '只支持图片文件' });

      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' }[match[1]] || '.png';
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const safe = String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 40) || 'image';
      const filename = `${stamp}-${safe}${ext}`;

      await mkdir(UPLOAD_DIR, { recursive: true });
      await writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(match[2], 'base64'));
      return sendJson(res, 200, { ok: true, url: `/img/uploads/${filename}` });
    }

    if (req.method === 'POST' && url.pathname === '/api/publish') {
      const payload = await readJsonBody(req);
      const result = await publish(payload);
      return sendJson(res, 200, result);
    }

    res.writeHead(404).end('not found');
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error.stderr || error.message || error) });
  }
});

/* ------------------------------------------------------------------ *
 * 启动：端口被占就直接把已有窗口唤出来
 * ------------------------------------------------------------------ */

function openWindow(url) {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const browser = candidates.find((p) => existsSync(p));
  const extra = browser
    ? ['--app=' + url, '--window-size=1280,900', '--window-position=80,60']
    : [];
  try {
    if (browser) spawn(browser, extra, { detached: true, stdio: 'ignore' }).unref();
    else spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    console.log(`请手动打开 ${url}`);
  }
}

async function main() {
  for (let port = BASE_PORT; port < BASE_PORT + 10; port++) {
    const taken = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.once('error', () => resolve(true));
      probe.once('listening', () => probe.close(() => resolve(false)));
      probe.listen(port, '127.0.0.1');
    });

    if (taken && port === BASE_PORT) {
      // 之前已经开着，直接把窗口叫出来就行
      console.log(`写作客户端已经在运行：http://localhost:${port}/`);
      openWindow(`http://localhost:${port}/`);
      return;
    }
    if (taken) continue;

    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const url = `http://localhost:${port}/`;
    console.log(`写作客户端已启动：${url}`);
    console.log('关掉这个窗口就会停止服务。');
    if (!process.argv.includes('--no-open')) openWindow(url);
    return;
  }
  console.error('端口被占用太多，没能启动。');
  process.exit(1);
}

main();
