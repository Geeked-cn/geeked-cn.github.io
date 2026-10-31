/**
 * 把 assets/ 里的原图转成部署用的 WebP，输出到 source/img/。
 *
 * 为什么要分两个目录：assets/ 是原图（不部署，多大都无所谓），
 * source/img/ 是 Hexo 会复制进 public/ 的目录，只放压缩后的成品。
 * 首页人像是首屏最大的一张图，压完能省几百 KB。
 *
 * 用法：npm run images
 */
import { readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.resolve('assets');
const OUT = path.resolve('source/img');
const MAX_WIDTH = 1080; // 首屏人像显示宽度不到 700px，1080 够 2x 屏用

if (!existsSync(SRC)) {
  console.error('找不到 assets/ 目录');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

const entries = await readdir(SRC, { withFileTypes: true });
const images = entries.filter(
  (entry) => entry.isFile() && /\.(png|jpe?g|webp|avif|tiff)$/i.test(entry.name),
);

if (!images.length) {
  console.log('assets/ 里没有图片');
  process.exit(0);
}

for (const entry of images) {
  const input = path.join(SRC, entry.name);
  const base = path.basename(entry.name, path.extname(entry.name));
  const output = path.join(OUT, `${base}.webp`);

  const before = (await stat(input)).size;
  const meta = await sharp(input).metadata();

  await sharp(input)
    .resize({ width: Math.min(meta.width || MAX_WIDTH, MAX_WIDTH), withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toFile(output);

  const after = (await stat(output)).size;
  const saved = Math.round((1 - after / before) * 100);
  console.log(
    `${entry.name} → source/img/${base}.webp  ` +
      `${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB（省 ${saved}%）` +
      (meta.width > MAX_WIDTH ? `，宽度 ${meta.width} → ${MAX_WIDTH}` : ''),
  );
}
