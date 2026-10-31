/**
 * 用 Chrome DevTools Protocol 给页面拍截图，方便检查首屏动效的最终状态。
 *
 * 为什么不用 chrome --screenshot：那种方式要么在页面刚加载时抓拍，
 * 要么只快进定时器（virtual time）而不快进 requestAnimationFrame 的时钟，
 * 动画永远停在半路。这里用 CDP 真实等待若干毫秒再抓。
 *
 * 用法：
 *   node tools/shot.mjs <url> <out.png> [--width=1440] [--height=900]
 *                       [--wait=4000] [--after-wait=3000]
 *                       [--script="document.getElementById('scroll-cue').click()"]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [key, ...rest] = a.replace(/^--/, '').split('=');
      return [key, rest.join('=') || 'true'];
    }),
);

const url = positional[0];
const out = positional[1];
if (!url || !out) {
  console.error('用法：node tools/shot.mjs <url> <out.png> [--width=1440] [--height=900] [--wait=4000]');
  process.exit(1);
}

const width = Number(flags.width || 1440);
const height = Number(flags.height || 900);
const wait = Number(flags.wait || 4000);
const afterWait = Number(flags['after-wait'] || 2500);
const script = flags.script;
const port = Number(flags.port || 9333);
const profile = path.resolve(flags.profile || '.shots/profile');

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('找不到 Chrome/Edge，可用 CHROME_PATH 环境变量指定。');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--in-process-gpu',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForBrowser() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      /* 浏览器还没起来，继续等 */
    }
    await sleep(250);
  }
  throw new Error('浏览器调试端口没有就绪');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 0;

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    socket.addEventListener('error', reject);
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          nextId += 1;
          const id = nextId;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
        },
      });
    });
  });
}

try {
  await waitForBrowser();

  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(
    (response) => response.json(),
  );
  const page = await connect(target.webSocketDebuggerUrl);

  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send('Page.navigate', { url });
  await sleep(wait);

  if (script) {
    await page.send('Runtime.evaluate', { expression: script, awaitPromise: true });
    await sleep(afterWait);
  }

  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`已保存 ${out} (${width}x${height}, 等待 ${wait}ms${script ? ` + ${afterWait}ms` : ''})`);

  page.close();
} finally {
  browser.kill();
}
