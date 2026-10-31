# bloghexo

一个用 [Hexo](https://hexo.io/) 搭起来的静态博客，包含站点配置、示例文章和两个手写主题
（当前启用 `mono`，另一个 `paper` 保留备用）。

## 首页是什么效果

打开首页是一屏动效：

1. **ASCII 人像**：把你的照片降采样成字符网格，字符从画面四周飞入、拼成肖像；点击（或按回车）会把原图淡入，几秒后再淡出回字符
2. **打字机开场**：左侧人像、右侧逐字打出问候语与一句话，光标闪烁
3. **柏拉图立体**：底部一排缓缓旋转的五种正多面体线框
4. **向下滚动**进入索引屏：先逐字打出一句话，然后展开站点索引（最新文章、分类、标签、联系方式）

滚轮 / 触摸滑动 / ↑↓ PageUp PageDown 都能在两屏之间切换，地址栏加 `#overlay` 可直接进入索引屏。

照片和文案换成你自己的即可（见下文）。

## 环境要求

- Node.js 20 或更高（当前环境：v26）
- npm 10 或更高

> Windows PowerShell 下如果 `npm` 报「禁止运行脚本」，改用 `npm.cmd`，或执行
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 后重开终端。

## 快速开始

```bash
npm install        # 安装依赖（首次）
npm start          # 本地预览 http://localhost:4000
npm run build      # 生成静态文件到 public/
npm run check      # 检查站内失效链接（需先 build）
npm run clean      # 清空 public/ 和缓存
npm run portrait   # 重新生成默认的占位人像
npm run preview    # 在终端预览照片 → ASCII 的效果（换照片后先跑这个）
```

> `npm install` 首次可能提示 hexo-util 有待批准的安装脚本；本项目已在 `.npmrc`
> 里放行（`allow-scripts[]=hexo-util`）。若你的 npm 版本较老，忽略该警告即可。

## 写作

```bash
npm run new "文章标题"          # 新建文章 → source/_posts/
npm run draft "草稿标题"        # 新建草稿 → source/_drafts/（预览用 npm run dev）
npx hexo new page "关于"        # 新建独立页面 → source/关于/index.md
```

文章头部是 Front-matter，常用字段：

```yaml
---
title: 标题
date: 2026-10-30 10:00:00
tags: [Hexo, 随笔]
categories: [折腾]
---
```

正文里插入 `<!-- more -->`，它上方的内容就是首页摘要。

## 目录结构

```
.
├── _config.yml          # 站点配置（标题、作者、url、部署…）
├── package.json
├── scaffolds/           # 新建文件的模板
├── source/
│   ├── _posts/          # 文章
│   ├── _drafts/         # 草稿
│   ├── images/          # 图片，引用路径写 /images/xxx.png
│   └── about/index.md   # 独立页面
├── tools/
│   ├── check-links.mjs           # 站内链接自检
│   ├── make-placeholder-portrait.mjs  # 生成占位人像
│   └── shot.mjs                  # 用 CDP 给页面截图，检查首屏动效
└── themes/
    ├── mono/              # 当前启用的主题
    │   ├── _config.yml    # 开场文案、导航、邮箱、页脚
    │   ├── layout/        # EJS 模板（首页动效 + 内页）
    │   ├── languages/     # 界面文案（中/英）
    │   └── source/        # css/style.css、js/hero.js、js/decipher.js
    └── paper/             # 上一版主题，改 _config.yml 的 theme 可切回
```

## 上线前需要改的几处

1. `_config.yml` 里的 `title` / `subtitle` / `author` / `description` / `url`
2. `themes/mono/_config.yml`：
   - `hero.hello` / `hero.name`：开场那两行字
   - `hero.overlay`：进入索引屏时打出的那句话
   - `hero.portrait`：人像照片路径（默认 `/img/portrait.png`）
   - `email.address` / `email.masked`：联系邮箱与混淆文本
   - `menu`：内页导航
3. **换成你自己的照片**：把照片存成 `source/img/portrait.png` 覆盖同名文件即可。
   建议正面、纯色背景、头肩占满画面 —— 动效靠"四角取色"来抠背景，背景越干净越好看。
   换完先跑 `npm run preview`：它会打印主体占比、自动色阶范围和字符重量图，
   一眼就能看出背景有没有抠干净、层次够不够。
4. 部署方式二选一：
   - `hexo-deployer-git`：在 `_config.yml` 填 `deploy` 段，然后 `npm run deploy`
   - Cloudflare Pages / Vercel：构建命令 `npm run build`，输出目录 `public`

## mono 主题细节

- 纯黑白 + 等宽字体，内页按 12 栏编辑排版分栏，代码块浅灰底 + 黑色左标线
- 邮箱默认显示混淆文本，悬停 / 聚焦时逐字"破译"（`data-decipher`）
- 无任何第三方依赖、无外部字体与 CDN 请求；字体优先用 Maple Mono，否则回落到系统等宽字体
- 想用 Maple Mono：把它放到 `source/fonts/MapleMono-VF.woff2`，再打开 `themes/mono/source/css/style.css` 顶部那段 `@font-face`
- 尊重 `prefers-reduced-motion`；另外支持两个查询参数：
  - `?still` 关掉动效，直接显示最终画面
  - `?photo` 一进页面就显示照片

### ASCII 人像是怎么算出来的

1. **抠背景**：取顶部两角的平均色当背景色，再从四条边做洪水填充，只把「和边框连通的背景」抹掉。
   好处是主体本身是白色也不会被误删（只要它有深色描边圈住），纯色卡通和真人照片都能用。
   填充结果不可信时会退回「整张图 + 边缘羽化」，不会把主体抠没。
2. **落字**：按抠图遮盖率决定每个格子上不上字符，覆盖率超过 30% 就落。
3. **分层**：只统计落了字的格子，取其亮度的 5% / 95% 分位做自动色阶，
   再把明暗映射到三档字符重量（`. , : ;` → `+ = o x` → `λ { } [ ] @ # %`）。
   所以大面积纯色（帽子、衣服）也有层次，不会糊成一块死黑。
4. **动效**：每格按固定伪随机种子从画面外围飞入，落位后轻微呼吸；
   点击揭示照片，约 4.7 秒后照片淡出、字符逐批归位。

## 看一眼动效的最终状态

`npm start` 之后另开一个终端：

```bash
node tools/shot.mjs http://127.0.0.1:4000/ out/home.png --wait=5000
node tools/shot.mjs http://127.0.0.1:4000/ out/index.png --wait=5000 --after-wait=5000 \
  --script="document.getElementById('scroll-cue').click()"
```
