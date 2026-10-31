/**
 * 生产构建的后处理，部署前跑（npm run build 已经带上它）。
 *
 * 1. 给 css / js 文件名加上内容哈希，并同步改掉 HTML 里的引用
 *    → CDN 可以对这些文件下一年强缓存，内容一变文件名就变，不会读到旧文件
 * 2. 把 static/ 里的 _headers、_redirects 复制进 public/
 * 3. 按 _config.yml 里的 url 生成 robots.txt
 */
import { readdir, readFile, writeFile, unlink, copyFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('public');
const staticDir = path.resolve('static');

if (!existsSync(root)) {
  console.error('找不到 public/，请先运行 hexo generate');
  process.exit(1);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/* ---------- 1. 给 css / js 加内容哈希 ---------- */

const files = await walk(root);
const assets = files.filter((file) => /\.(css|js)$/.test(file));
const renames = new Map();

for (const file of assets) {
  const source = await readFile(file);
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 8);
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  const next = path.join(dir, `${base}.${hash}${ext}`);
  await writeFile(next, source);
  await unlink(file);

  const from = '/' + path.relative(root, file).split(path.sep).join('/');
  const to = '/' + path.relative(root, next).split(path.sep).join('/');
  renames.set(from, to);
}

if (renames.size) {
  const html = files.filter((file) => file.endsWith('.html'));
  for (const file of html) {
    let content = await readFile(file, 'utf8');
    let changed = false;
    for (const [from, to] of renames) {
      if (content.includes(from)) {
        content = content.split(from).join(to);
        changed = true;
      }
    }
    if (changed) await writeFile(file, content);
  }
}

/* ---------- 2. 复制 static/ 下的部署配置 ---------- */

const copied = [];
if (existsSync(staticDir)) {
  for (const entry of await readdir(staticDir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    await copyFile(path.join(staticDir, entry.name), path.join(root, entry.name));
    copied.push(entry.name);
  }
}

/* ---------- 3. 生成 robots.txt ---------- */

const siteConfig = await readFile(path.resolve('_config.yml'), 'utf8');
const urlMatch = siteConfig.match(/^url:\s*(\S+)/m);
const siteUrl = urlMatch ? urlMatch[1].replace(/\/$/, '') : '';

await writeFile(
  path.join(root, 'robots.txt'),
  [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    '',
  ].join('\n'),
);

console.log(
  `构建后处理完成：${renames.size} 个静态资源已加哈希` +
    (copied.length ? `，复制 ${copied.join('、')}` : '') +
    `，robots.txt 指向 ${siteUrl || '(未配置 url)'}`,
);
