/* 写作客户端前端：可视化编辑 -> Markdown -> 提交 */

const $ = (id) => document.getElementById(id);

const els = {
  title: $('title'),
  tags: $('tags'),
  categories: $('categories'),
  date: $('date'),
  slug: $('slug'),
  editor: $('editor'),
  preview: $('preview'),
  toolbar: $('toolbar'),
  workspace: $('workspace'),
  status: $('status'),
  counter: $('counter'),
  toast: $('toast'),
  drawer: $('drawer'),
  postList: $('post-list'),
  currentFile: $('current-file'),
  btnPublish: $('btn-publish'),
  btnOpen: $('btn-open'),
  btnNew: $('btn-new'),
  btnWide: $('btn-wide'),
  btnCloseDrawer: $('btn-close-drawer'),
  fileImage: $('file-image'),
};

const DRAFT_KEY = 'mono-writer-draft-v1';
let editingFile = '';

/* ================================================================ *
 * HTML -> Markdown
 * ================================================================ */

const ESCAPE_RE = /([\\`*_[\]#])/g;
const escapeText = (text) => text.replace(ESCAPE_RE, '\\$1');

const INLINE_WRAP = {
  STRONG: '**', B: '**',
  EM: '*', I: '*',
  DEL: '~~', S: '~~', STRIKE: '~~',
};

function inlineMd(node) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeText(child.nodeValue.replace(/\s+/g, ' '));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName;
    if (tag === 'BR') { out += '  \n'; continue; }

    if (tag === 'IMG') {
      const src = child.getAttribute('src') || '';
      out += `![${child.getAttribute('alt') || ''}](${src})`;
      continue;
    }

    if (tag === 'A') {
      const href = child.getAttribute('href') || '';
      const label = inlineMd(child).trim() || href;
      out += href ? `[${label}](${href})` : label;
      continue;
    }

    if (tag === 'CODE') {
      out += '`' + child.textContent.replace(/`/g, '\\`') + '`';
      continue;
    }

    const wrap = INLINE_WRAP[tag];
    if (wrap) {
      const inner = inlineMd(child).trim();
      out += inner ? wrap + inner + wrap : '';
      continue;
    }

    out += inlineMd(child);
  }
  return out;
}

function listMd(listEl, depth) {
  const ordered = listEl.tagName === 'OL';
  const lines = [];
  let index = Number(listEl.getAttribute('start') || 1);

  for (const li of listEl.children) {
    if (li.tagName !== 'LI') continue;

    // 把嵌套列表摘出去，剩下的当这一条的内容
    const clone = li.cloneNode(true);
    const nested = [];
    for (const child of Array.from(clone.children)) {
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        nested.push(child);
        child.remove();
      }
    }

    const text = blockMd(clone).replace(/\n{2,}/g, '\n').trim();
    lines.push('  '.repeat(depth) + (ordered ? `${index++}. ` : '- ') + text);
    for (const sub of nested) lines.push(listMd(sub, depth + 1));
  }
  return lines.join('\n');
}

function blockMd(node) {
  const parts = [];

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.nodeValue.replace(/\s+/g, ' ').trim();
      if (text) parts.push(escapeText(text));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName;

    if (/^H[1-6]$/.test(tag)) {
      const text = inlineMd(child).trim();
      if (text) parts.push('#'.repeat(Number(tag[1])) + ' ' + text);
      continue;
    }

    if (tag === 'HR') { parts.push('---'); continue; }

    if (tag === 'BLOCKQUOTE') {
      const inner = blockMd(child);
      if (inner) parts.push(inner.split('\n').map((line) => (line ? '> ' + line : '>')).join('\n'));
      continue;
    }

    if (tag === 'PRE') {
      const codeEl = child.querySelector('code');
      const language = /language-([\w+#-]+)/.exec((codeEl && codeEl.className) || '');
      const code = (codeEl || child).textContent.replace(/\n+$/, '');
      parts.push('```' + (language ? language[1] : '') + '\n' + code + '\n```');
      continue;
    }

    if (tag === 'UL' || tag === 'OL') {
      const list = listMd(child, 0);
      if (list) parts.push(list);
      continue;
    }

    if (tag === 'BR') { parts.push(''); continue; }

    if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'BODY') {
      const inner = blockMd(child);
      if (inner) parts.push(inner);
      continue;
    }

    // 段落以及行内元素的裸文本
    const text = inlineMd(child).trim();
    if (text) parts.push(text);
  }

  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function htmlToMarkdown(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return blockMd(holder);
}

/* ================================================================ *
 * Markdown -> HTML（只用于把已有文章读回编辑器）
 * ================================================================ */

const escapeHtml = (text) => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

function inlineHtml(text) {
  // 先把 markdown 的反斜杠转义抠成占位符，否则 \* 之类的会被后面的行内规则误吃
  const escaped = [];
  let out = escapeHtml(text).replace(/\\([\\`*_[\]#])/g, (_, ch) => {
    escaped.push(ch);
    return `\u0000${escaped.length - 1}\u0000`;
  });

  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');

  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => escaped[Number(index)]);
}

const listMatch = (line) => /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);

// 按缩进还原嵌套列表
function buildList(lines, index) {
  const indent = listMatch(lines[index])[1].length;
  const ordered = /\d/.test(listMatch(lines[index])[2]);
  const items = [];

  while (index < lines.length) {
    const match = listMatch(lines[index]);
    if (!match) break;
    if (match[1].length < indent) break;

    if (match[1].length > indent) {
      const sub = buildList(lines, index);
      if (items.length) items[items.length - 1].children.push(sub.html);
      index = sub.next;
      continue;
    }

    const item = { text: match[3], children: [] };
    items.push(item);
    index += 1;

    while (index < lines.length) {
      const next = listMatch(lines[index]);
      if (!next || next[1].length <= indent) break;
      const sub = buildList(lines, index);
      item.children.push(sub.html);
      index = sub.next;
    }
  }

  const tag = ordered ? 'ol' : 'ul';
  const html = `<${tag}>`
    + items.map((item) => `<li>${inlineHtml(item.text)}${item.children.join('')}</li>`).join('')
    + `</${tag}>`;
  return { html, next: index };
}

function markdownToHtml(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let index = 0;

  const flushParagraph = (buffer) => {
    if (!buffer.length) return;
    out.push('<p>' + inlineHtml(buffer.join(' ')) + '</p>');
    buffer.length = 0;
  };
  const paragraph = [];

  while (index < lines.length) {
    const line = lines[index];

    if (/^```/.test(line)) {
      flushParagraph(paragraph);
      const language = line.slice(3).trim();
      const code = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      index++;
      out.push(
        `<pre><code${language ? ` class="language-${language}"` : ''}>`
        + escapeHtml(code.join('\n')) + '</code></pre>',
      );
      continue;
    }

    if (!line.trim()) { flushParagraph(paragraph); index++; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph);
      out.push(`<h${heading[1].length}>${inlineHtml(heading[2])}</h${heading[1].length}>`);
      index++;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph(paragraph);
      out.push('<hr>');
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph(paragraph);
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index++].replace(/^>\s?/, ''));
      }
      out.push('<blockquote>' + quote.map((line) => (line ? inlineHtml(line) : '')).join('<br>') + '</blockquote>');
      continue;
    }

    if (listMatch(line)) {
      flushParagraph(paragraph);
      const list = buildList(lines, index);
      out.push(list.html);
      index = list.next;
      continue;
    }

    paragraph.push(line.trim());
    index++;
  }

  flushParagraph(paragraph);
  return out.join('');
}

/* ================================================================ *
 * 界面状态
 * ================================================================ */

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = 'status-dot ' + kind;
}

let toastTimer = 0;
function toast(message, kind = '', duration = 5200) {
  els.toast.textContent = message;
  els.toast.className = 'toast' + (kind ? ' ' + kind : '');
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, duration);
}

function refreshPreview() {
  els.preview.innerHTML = els.editor.innerHTML || '';
  const text = els.editor.textContent.replace(/\s+/g, '');
  els.counter.textContent = text.length + ' 字';
}

function pad(n) { return String(n).padStart(2, '0'); }

function nowForInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ================================================================ *
 * 草稿自动保存
 * ================================================================ */

function snapshot() {
  return {
    file: editingFile,
    title: els.title.value,
    tags: els.tags.value,
    categories: els.categories.value,
    date: els.date.value,
    slug: els.slug.value,
    html: els.editor.innerHTML,
  };
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot())); } catch { /* 忽略 */ }
}

function restoreDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
  if (!draft || !(draft.html || draft.title)) return false;
  els.title.value = draft.title || '';
  els.tags.value = draft.tags || '';
  els.categories.value = draft.categories || '';
  els.date.value = draft.date || nowForInput();
  els.slug.value = draft.slug || '';
  els.editor.innerHTML = draft.html || '';
  editingFile = draft.file || '';
  els.currentFile.textContent = editingFile || '新文章（未发布草稿）';
  return true;
}

/* ================================================================ *
 * 编辑器
 * ================================================================ */

function focusEditor() {
  els.editor.focus();
}

function exec(command, value = null) {
  focusEditor();
  document.execCommand(command, false, value);
  refreshPreview();
  saveDraft();
}

els.toolbar.addEventListener('mousedown', (event) => {
  // 别让按钮抢走编辑区的选区
  if (event.target.closest('button')) event.preventDefault();
});

els.toolbar.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const block = button.dataset.block;
  if (block) return exec('formatBlock', block.toUpperCase());

  const command = button.dataset.cmd;
  if (command) return exec(command);

  const action = button.dataset.act;
  if (action === 'clear') return exec('removeFormat');

  if (action === 'link') {
    const selection = String(window.getSelection() || '');
    const url = window.prompt('链接地址（以 http:// 或 https:// 开头）', 'https://');
    if (!url || url === 'https://') return;
    if (selection) exec('createLink', url);
    else exec('insertHTML', `<a href="${url.replace(/"/g, '&quot;')}">${url}</a>`);
    return;
  }

  if (action === 'image') els.fileImage.click();
});

els.editor.addEventListener('input', () => { refreshPreview(); saveDraft(); });
els.editor.addEventListener('keyup', refreshPreview);
els.editor.addEventListener('mouseup', refreshPreview);
els.editor.addEventListener('paste', (event) => {
  // 只保留纯文本，避免把外部网页的样式带进来
  const text = event.clipboardData && event.clipboardData.getData('text/plain');
  if (text == null) return;
  event.preventDefault();
  document.execCommand('insertText', false, text);
});

[els.title, els.tags, els.categories, els.date, els.slug].forEach((input) => {
  input.addEventListener('input', saveDraft);
  input.addEventListener('change', saveDraft);
});

/* ================================================================ *
 * 图片上传
 * ================================================================ */

els.fileImage.addEventListener('change', async () => {
  const file = els.fileImage.files && els.fileImage.files[0];
  els.fileImage.value = '';
  if (!file) return;

  setStatus('正在插入图片…', 'busy');
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });

    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: file.name, dataUrl }),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || '上传失败');

    exec('insertImage', data.url);
    setStatus('图片已插入，提交时会一起上传', 'ok');
  } catch (error) {
    toast(String(error.message || error), 'bad');
    setStatus('图片上传失败', 'bad');
  }
});

/* ================================================================ *
 * 提交
 * ================================================================ */

const splitList = (value) => String(value || '')
  .split(/[,，、]/)
  .map((item) => item.trim())
  .filter(Boolean);

async function publish() {
  if (!els.title.value.trim()) {
    els.title.focus();
    return toast('先给文章起个标题吧');
  }

  const markdown = htmlToMarkdown(els.editor.innerHTML);
  if (!markdown) {
    focusEditor();
    return toast('正文还是空的，先写点内容');
  }

  els.btnPublish.disabled = true;
  setStatus('正在提交到博客…', 'busy');

  try {
    const response = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: editingFile,
        slug: els.slug.value.trim(),
        title: els.title.value.trim(),
        date: els.date.value,
        tags: splitList(els.tags.value),
        categories: splitList(els.categories.value),
        markdown,
      }),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || '提交失败');

    editingFile = data.file;
    els.currentFile.textContent = data.file;
    if (!els.slug.value.trim()) els.slug.value = data.file.replace(/\.md$/, '');
    saveDraft();

    setStatus('已提交，博客正在重新构建（约 1 分钟）', 'ok');
    toast(
      (data.note ? data.note + '\n\n' : '')
      + '已提交：' + data.file + '\n大约 1 分钟后自动上线。',
      data.note ? 'warn' : '',
      9000,
    );
  } catch (error) {
    setStatus('提交失败', 'bad');
    toast('提交失败：' + String(error.message || error), 'bad', 9000);
  } finally {
    els.btnPublish.disabled = false;
  }
}

els.btnPublish.addEventListener('click', publish);

/* ================================================================ *
 * 打开已有文章
 * ================================================================ */

async function openDrawer() {
  els.drawer.hidden = false;
  els.postList.innerHTML = '<li><button><span class="t">正在读取…</span></button></li>';
  try {
    const response = await fetch('/api/posts');
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || '读取失败');
    if (!data.posts.length) {
      els.postList.innerHTML = '<li><button><span class="t">还没有文章</span></button></li>';
      return;
    }
    els.postList.innerHTML = '';
    for (const post of data.posts) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.innerHTML = `<span class="t"></span><span class="d"></span>`;
      button.querySelector('.t').textContent = post.title;
      button.querySelector('.d').textContent = [post.date, post.file].filter(Boolean).join('  ·  ');
      button.addEventListener('click', () => loadPost(post.file));
      li.appendChild(button);
      els.postList.appendChild(li);
    }
  } catch (error) {
    toast('读取文章列表失败：' + String(error.message || error), 'bad');
  }
}

async function loadPost(file) {
  els.drawer.hidden = true;
  try {
    const response = await fetch('/api/post?file=' + encodeURIComponent(file));
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || '打开失败');

    editingFile = data.file;
    els.currentFile.textContent = data.file;
    els.title.value = data.meta.title || '';
    els.tags.value = (data.meta.tags || []).join(', ');
    els.categories.value = (data.meta.categories || []).join(', ');
    els.slug.value = data.file.replace(/\.md$/, '');
    if (typeof data.meta.date === 'string' && data.meta.date) {
      els.date.value = data.meta.date.replace(' ', 'T').slice(0, 16);
    }
    els.editor.innerHTML = markdownToHtml(data.markdown);
    refreshPreview();
    saveDraft();
    setStatus('已打开 ' + data.file, '');
  } catch (error) {
    toast('打开失败：' + String(error.message || error), 'bad');
  }
}

els.btnOpen.addEventListener('click', () => {
  if (els.drawer.hidden) openDrawer();
  else els.drawer.hidden = true;
});
els.btnCloseDrawer.addEventListener('click', () => { els.drawer.hidden = true; });

/* ================================================================ *
 * 新文章 / 预览切换
 * ================================================================ */

els.btnNew.addEventListener('click', () => {
  if (els.title.value.trim() || els.editor.textContent.trim()) {
    if (!window.confirm('当前内容会被清空，确定要写新文章吗？')) return;
  }
  editingFile = '';
  els.currentFile.textContent = '新文章';
  els.title.value = '';
  els.tags.value = '';
  els.categories.value = '';
  els.slug.value = '';
  els.date.value = nowForInput();
  els.editor.innerHTML = '';
  refreshPreview();
  saveDraft();
  setStatus('就绪', '');
  els.title.focus();
});

els.btnWide.addEventListener('click', () => {
  const narrow = window.matchMedia('(max-width: 900px)').matches;
  if (narrow) {
    els.workspace.classList.toggle('show-preview');
    els.btnWide.classList.toggle('on', els.workspace.classList.contains('show-preview'));
  } else {
    els.workspace.classList.toggle('hide-preview');
    els.btnWide.classList.toggle('on', !els.workspace.classList.contains('hide-preview'));
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    publish();
  }
  if (event.key === 'Escape') els.drawer.hidden = true;
});

window.addEventListener('beforeunload', saveDraft);

/* ================================================================ *
 * 初始化
 * ================================================================ */

(function init() {
  try { document.execCommand('styleWithCSS', false, false); } catch { /* 忽略 */ }

  if (!restoreDraft()) {
    els.date.value = nowForInput();
    els.currentFile.textContent = '新文章';
  }
  refreshPreview();
  setStatus('就绪', '');
})();
