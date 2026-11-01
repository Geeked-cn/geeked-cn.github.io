/**
 * 用真实浏览器验证写作客户端的 HTML <-> Markdown 转换。
 * 需要本地服务已经跑起来（node tools/writer/server.mjs）。
 *
 * 用法：node tools/writer/test-converter.mjs [url]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const port = Number(process.env.CDP_PORT || 9334);
const profile = path.resolve('.writer-tmp/test-profile');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('找不到 Chrome/Edge');
  process.exit(1);
}

const browser = spawn(chrome, [
  '--headless=new',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

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
    socket.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = ++nextId;
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }));
  });
}

async function waitForBrowser() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch { /* 继续等 */ }
    await sleep(250);
  }
  throw new Error('浏览器调试端口没有就绪');
}

const cases = [
  {
    name: '标题与段落',
    html: '<h2>小标题</h2><p>这是一段<strong>加粗</strong>和<em>斜体</em>的正文。</p>',
  },
  {
    name: '无序列表（含嵌套）',
    html: '<ul><li>第一项</li><li>第二项<ul><li>子项 A</li><li>子项 B</li></ul></li></ul>',
  },
  {
    name: '有序列表',
    html: '<ol><li>先做这个</li><li>再做那个</li></ol>',
  },
  {
    name: '引用',
    html: '<blockquote>引用的一句话<br>第二行</blockquote>',
  },
  {
    name: '代码块',
    html: '<pre><code class="language-js">const a = 1;\nconsole.log(a);</code></pre>',
  },
  {
    name: '链接与图片',
    html: '<p>看<a href="https://hexo.io/">这里</a></p><p><img src="/img/uploads/a.png" alt="配图"></p>',
  },
  {
    name: '分隔线',
    html: '<p>上</p><hr><p>下</p>',
  },
  {
    name: '特殊字符转义',
    html: '<p>价格 3*4 和 a_b 以及 [方括号]</p>',
  },
];

try {
  await waitForBrowser();
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
    .then((response) => response.json());
  const page = await connect(target.webSocketDebuggerUrl);

  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.navigate', { url });
  await sleep(2500);

  const evaluate = async (expression) => {
    const result = await page.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'JS 执行出错');
    }
    return result.result.value;
  };

  const ready = await evaluate('typeof htmlToMarkdown === "function" && typeof markdownToHtml === "function"');
  if (!ready) throw new Error('页面里找不到转换函数，ui.js 可能没加载成功');

  let failures = 0;

  for (const testCase of cases) {
    const payload = JSON.stringify(testCase.html);
    const markdown = await evaluate(`htmlToMarkdown(${payload})`);
    // 回程：markdown -> html -> markdown，正常应该稳定
    const roundTrip = await evaluate(
      `htmlToMarkdown(markdownToHtml(${JSON.stringify(markdown)}))`,
    );
    const stable = roundTrip === markdown;
    if (!stable) failures += 1;

    console.log(`\n▌${testCase.name}${stable ? '' : '   ← 回程不稳定'}`);
    console.log('  输入  : ' + testCase.html.replace(/\n/g, '\\n'));
    console.log('  输出  : ' + markdown.replace(/\n/g, '\n          '));
    if (!stable) console.log('  回程后: ' + roundTrip.replace(/\n/g, '\n          '));
  }

  // 真实浏览器里走一遍"输入 -> 转换"，确认编辑器产出的是我们预期的结构
  const fromEditor = await evaluate(`
    (() => {
      const editor = document.getElementById('editor');
      editor.innerHTML = '<h2>真实编辑器</h2><p>一段话<strong>加粗</strong></p><ul><li>项目</li></ul>';
      return htmlToMarkdown(editor.innerHTML);
    })()
  `);
  console.log('\n▌从编辑器 DOM 导出');
  console.log('  ' + fromEditor.replace(/\n/g, '\n  '));

  console.log(`\n结果：${cases.length} 个用例，${failures} 个回程不稳定`);
  page.close();
  process.exitCode = failures ? 1 : 0;
} catch (error) {
  console.error('测试失败：' + error.message);
  process.exitCode = 1;
} finally {
  browser.kill();
}
