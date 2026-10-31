/**
 * 检查 public/ 里所有站内链接是否指向真实存在的文件。
 * 用法：npm run check（先执行 npm run build）
 * 放在 tools/ 而不是 scripts/：Hexo 会把 scripts/ 当作自己的插件目录来加载。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('public');

if (!existsSync(root)) {
  console.error('找不到 public/，请先运行 npm run build');
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

const files = await walk(root);
const pages = files.filter((f) => f.endsWith('.html'));
const known = new Set(files.map((f) => f.replace(/\\/g, '/')));

const problems = [];

for (const page of pages) {
  const html = await readFile(page, 'utf8');
  const hrefs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map((m) => m[1]);

  for (const href of hrefs) {
    if (/^(https?:|mailto:|data:|#|\/\/)/.test(href)) continue;

    const decoded = decodeURIComponent(href.split('#')[0].split('?')[0]);
    const target = path.join(root, decoded);
    const candidates = [target, path.join(target, 'index.html'), target + '.html'];

    if (!candidates.some((c) => existsSync(c) && stat(c))) {
      problems.push(`${path.relative(root, page)} -> ${href}`);
    }
  }
}

if (problems.length) {
  console.error(`发现 ${problems.length} 个失效的站内链接：`);
  for (const p of [...new Set(problems)]) console.error('  ' + p);
  process.exit(1);
}

console.log(`检查通过：${pages.length} 个页面，未发现失效的站内链接。`);
