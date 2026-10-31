/**
 * 在终端里预览"照片 → ASCII 人像"的效果，不用开浏览器。
 *
 * 换照片之后先跑一下它，能立刻看出：背景有没有被正确抠掉、主体占比是否合理、
 * 字符层次够不够。输出的重量图就是首页动效实际会用的那套数据。
 * 用 sharp 解码，PNG / JPEG / WebP / AVIF 都能读。
 *
 * 用法：npm run preview [assets/portrait.png] [-- --map]
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const file = path.resolve(process.argv[2] || 'assets/portrait.png');
const showMap = process.argv.includes('--map');

if (!existsSync(file)) {
  console.error(`找不到图片：${file}`);
  process.exit(1);
}

const { data: pixels, info } = await sharp(file)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height } = info;
const at = (x, y) => {
  const offset = (y * width + x) * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
};
const luminanceAt = (x, y) => {
  const [r, g, b] = at(x, y);
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
};

/* ---------- 和 hero.js 一致：顶部两角取背景色 → 边框洪水填充 ---------- */

const patch = Math.max(4, Math.floor(Math.min(width, height) * 0.035));
let red = 0;
let green = 0;
let blue = 0;
let count = 0;
for (const corner of [
  [0, 0],
  [width - patch, 0],
]) {
  for (let y = corner[1]; y < corner[1] + patch; y += 1) {
    for (let x = corner[0]; x < corner[0] + patch; x += 1) {
      const [r, g, b] = at(x, y);
      red += r;
      green += g;
      blue += b;
      count += 1;
    }
  }
}
red /= count;
green /= count;
blue /= count;

const tolerance = 60;
const total = width * height;
const isBackground = new Uint8Array(total);
const stack = new Int32Array(total);
let pointer = 0;

const similar = (index) => {
  const offset = index * 4;
  return (
    Math.hypot(pixels[offset] - red, pixels[offset + 1] - green, pixels[offset + 2] - blue) <
    tolerance
  );
};

const seed = (index) => {
  if (isBackground[index] || !similar(index)) return;
  isBackground[index] = 1;
  stack[pointer++] = index;
};

for (let x = 0; x < width; x += 1) {
  seed(x);
  seed((height - 1) * width + x);
}
for (let y = 0; y < height; y += 1) {
  seed(y * width);
  seed(y * width + width - 1);
}
while (pointer > 0) {
  const index = stack[--pointer];
  const col = index % width;
  const row = (index - col) / width;
  if (col > 0) seed(index - 1);
  if (col < width - 1) seed(index + 1);
  if (row > 0) seed(index - width);
  if (row < height - 1) seed(index + width);
}

let subjectCount = 0;
for (let i = 0; i < total; i += 1) if (!isBackground[i]) subjectCount += 1;
const subjectRatio = subjectCount / total;
const maskTrusted = subjectRatio >= 0.08 && subjectRatio <= 0.985;

/* ---------- 按首页那套参数生成字符网格 ---------- */

const COLS = 88;
const ROWS = Math.max(24, Math.round((COLS * height * 0.62) / (width * 1.08)));
const lum = (col, row) => {
  const x = Math.min(width - 1, Math.max(0, Math.floor(((col + 0.5) / COLS) * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(((row + 0.5) / ROWS) * height)));
  return luminanceAt(x, y);
};

const corners = [lum(0, 0), lum(COLS - 1, 0), lum(0, ROWS - 1), lum(COLS - 1, ROWS - 1)];
const background = corners.reduce((sum, value) => sum + value, 0) / corners.length;
const darkOnLight = background >= 128;
const GLYPH_SETS = ['.,:;~^_-', '+=ox01()<>', 'λ{}[]/\\|@#%&*'].map((set) => set.split(''));
const noise = (seedValue) => {
  const value = Math.sin(seedValue * 91.3458) * 47453.5453;
  return value - Math.floor(value);
};

/* 第一遍：要不要落字（有可信抠图就按遮盖率） */
const cells = [];
for (let row = 0; row < ROWS; row += 1) {
  for (let col = 0; col < COLS; col += 1) {
    const value = lum(col, row);
    const contrast = darkOnLight
      ? (background - value) / Math.max(background, 1)
      : (value - background) / Math.max(255 - background, 1);
    const edge =
      Math.max(Math.abs(value - lum(col + 1, row)), Math.abs(value - lum(col, row + 1))) / 255;
    const shade = Math.min(1, Math.max(0, contrast));
    const edgeness = Math.min(1, Math.max(0, edge * 1.45));

    let include = false;
    if (maskTrusted) {
      const x0 = Math.floor((col / COLS) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) / COLS) * width));
      const y0 = Math.floor((row / ROWS) * height);
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) / ROWS) * height));
      let subject = 0;
      let seen = 0;
      for (let my = y0; my < y1; my += 1) {
        for (let mx = x0; mx < x1; mx += 1) {
          seen += 1;
          if (!isBackground[my * width + mx]) subject += 1;
        }
      }
      include = subject / Math.max(1, seen) > 0.3;
    }
    cells.push({ value, shade, edgeness, include });
  }
}

/* 自动色阶：只用落了字的格子，取 5%/95% 分位 */
const used = cells
  .filter((cell) => (maskTrusted ? cell.include : Math.max(cell.shade, cell.edgeness) > 0.055))
  .map((cell) => cell.value)
  .sort((a, b) => a - b);
let low = used.length ? used[Math.floor(used.length * 0.05)] : 0;
let high = used.length ? used[Math.floor(used.length * 0.95)] : 255;
if (high - low < 24) {
  low = used.length ? used[0] : 0;
  high = used.length ? used[used.length - 1] : 255;
}
const span = Math.max(1, high - low);

/* 第二遍：定字符重量 */
let kept = 0;
const glyphLines = [];
const toneLines = [];
cells.forEach((cell, index) => {
  const strength = Math.max(cell.shade, cell.edgeness);
  const row = Math.floor(index / COLS);
  if (maskTrusted ? !cell.include : strength <= 0.055) {
    glyphLines[row] = (glyphLines[row] || '') + ' ';
    toneLines[row] = (toneLines[row] || '') + ' ';
    return;
  }
  kept += 1;
  const tone = darkOnLight
    ? Math.min(1, Math.max(0, (high - cell.value) / span))
    : Math.min(1, Math.max(0, (cell.value - low) / span));
  let level = tone > 0.72 ? 2 : tone > 0.32 ? 1 : 0;
  if (cell.edgeness > 0.35 && cell.edgeness > tone) level = Math.min(2, level + 1);
  const set = GLYPH_SETS[level];
  glyphLines[row] += set[Math.floor(noise(index + 7) * set.length)];
  toneLines[row] += String(level);
});

console.log(`图片        ${path.relative(process.cwd(), file)} (${width}x${height})`);
console.log(
  `背景色      rgb(${red.toFixed(0)}, ${green.toFixed(0)}, ${blue.toFixed(0)})  容差 ${tolerance}`,
);
console.log(
  `主体占比    ${(subjectRatio * 100).toFixed(1)}%  ${
    maskTrusted ? '（正常，按遮盖率落字）' : '（异常，动效会退回"整张图+边缘羽化"）'
  }`,
);
console.log(`网格        ${COLS} x ${ROWS}，落字 ${kept} / ${COLS * ROWS}`);
console.log(`色阶        主体亮度 ${low.toFixed(0)} → ${high.toFixed(0)} 被拉伸到全黑全白`);

if (showMap) {
  console.log('');
  console.log('亮度地图（0 黑 → 9 白）：');
  const mapCols = 64;
  const mapRows = 24;
  for (let row = 0; row < mapRows; row += 1) {
    let line = '';
    for (let col = 0; col < mapCols; col += 1) {
      const x = Math.floor(((col + 0.5) / mapCols) * width);
      const y = Math.floor(((row + 0.5) / mapRows) * height);
      line += Math.min(9, Math.max(0, Math.round(luminanceAt(x, y) / 25.6)));
    }
    console.log(line);
  }
}

console.log('');
console.log('字符重量（0 轻 . , : / 1 中 + = o / 2 重 @ # %）：');
console.log(toneLines.join('\n'));
console.log('');
console.log('实际字符：');
console.log(glyphLines.join('\n'));
