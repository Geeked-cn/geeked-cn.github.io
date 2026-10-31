/**
 * 生成一张"半身像"占位图，给首页 ASCII 人像动效用。
 *
 * 为什么要有这个脚本：动效需要一张「背景干净、主体高对比」的照片。
 * 还没有自己的照片时，用这个脚本画一张雕塑感的半身像先跑起来。
 * 换成真人照片：把照片放进 assets/portrait.png，再跑 npm run images 生成部署用的 webp
 * （建议正面、纯色背景、头肩占满画面）。
 *
 * 用法：npm run portrait
 * 放在 tools/ 而不是 scripts/：Hexo 会把 scripts/ 当作自己的插件目录来加载。
 *
 * 注意：脚本只写 assets/portrait-placeholder.png，不会覆盖你自己的照片。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WIDTH = 900;
const HEIGHT = 1200;
const OUT = path.resolve('assets/portrait-placeholder.png');

/* ---------- 极简 PNG 编码（RGB，无压缩之外的依赖） ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 位深
  header[9] = 2; // 真彩色 RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    pixels.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 造型与光照 ---------- */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, v) => {
  const t = clamp01((v - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
};

// 椭圆有符号距离的近似（足够做柔边和轮廓光）
function ellipse(x, y, cx, cy, rx, ry, angle = 0) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  const px = dx * cos + dy * sin;
  const py = -dx * sin + dy * cos;
  const k = Math.hypot(px / rx, py / ry);
  return (k - 1) * Math.min(rx, ry);
}

const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
const cx = WIDTH / 2;
const AA = 1.2; // 边缘柔化半径（像素）

// 背景：一整块纯色，方便动效按四角取样后抠掉
const BG = 0.93;

// 主光位于左上方：用它给每个块面算明暗，得到石膏像那样的渐变
const LIGHT = { x: cx - 300, y: 250 };
const keyLight = (x, y, spread) => {
  const d = Math.hypot(x - LIGHT.x, y - LIGHT.y) / spread;
  return 1 - smoothstep(0.05, 1.25, d);
};

for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    let value = BG + 0.008 * Math.sin(y * 0.017); // 纸面般的极轻颗粒

    // 逐层叠加：肩 → 脖子 → 头发 → 脸 → 耳 → 五官阴影（画家算法）
    const paint = (distance, color) => {
      const alpha = smoothstep(-AA, AA, -distance);
      value = value * (1 - alpha) + color * alpha;
    };

    // 肩与胸
    const dShoulder = ellipse(x, y, cx, 1205, 585, 345);
    const rimShoulder = 1 - smoothstep(0, WIDTH * 0.03, Math.max(0, -dShoulder));
    paint(dShoulder, 0.1 + 0.26 * rimShoulder + 0.1 * keyLight(x, y, WIDTH));

    // 脖子（中间稍亮，两侧入阴影）
    const dNeck = ellipse(x, y, cx, 742, 96, 142);
    const neckShade = 0.34 - 0.34 * keyLight(x, y, WIDTH * 0.7) + 0.22 * (Math.abs(x - cx) / 130);
    paint(dNeck, clamp01(neckShade) * 0.72 + 0.1);

    // 头发：整体压深，左上留一道高光
    const dHair = ellipse(x, y, cx, 392, 236, 244);
    const sheen = keyLight(x, y, WIDTH * 0.62);
    paint(dHair, 0.12 + 0.3 * sheen * (1 - smoothstep(0, 300, Math.abs(x - (cx - 150)))));

    // 脸：受光面亮、右侧转入暗部，边缘带轮廓光
    const dFace = ellipse(x, y, cx, 520, 178, 220);
    const faceRim = 1 - smoothstep(0, WIDTH * 0.028, Math.max(0, -dFace));
    const faceBase = 0.3 + 0.72 * keyLight(x, y, WIDTH * 0.78) + 0.28 * faceRim;
    paint(dFace, clamp01(faceBase) * 0.82 + 0.12);

    // 五官：只做极浅的凹陷阴影，让它更接近雕塑而不是卡通脸
    const socket = Math.min(
      ellipse(x, y, cx - 76, 508, 52, 24),
      ellipse(x, y, cx + 76, 508, 52, 24),
    );
    paint(socket, Math.max(0, value - 0.11));

    const nose = ellipse(x, y, cx + 14, 596, 24, 62);
    paint(nose, Math.max(0, value - 0.06));

    const mouth = ellipse(x, y, cx - 4, 672, 58, 14);
    paint(mouth, Math.max(0, value - 0.1));

    // 耳朵压在脸外侧之上
    paint(ellipse(x, y, cx - 188, 556, 24, 44), 0.46);
    paint(ellipse(x, y, cx + 188, 556, 24, 44), 0.4);

    const channel = Math.round(clamp01(value) * 255);
    const offset = (y * WIDTH + x) * 3;
    pixels[offset] = channel;
    pixels[offset + 1] = channel;
    pixels[offset + 2] = channel;
  }
}
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, encodePng(WIDTH, HEIGHT, pixels));
console.log(`已生成占位人像：${OUT} (${WIDTH}x${HEIGHT})`);
