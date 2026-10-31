---
title: 你好，Hexo
date: 2026-10-30 10:00:00
tags:
  - Hexo
  - 随笔
categories:
  - 折腾
---

这是博客的第一篇文章。它由 [Hexo](https://hexo.io/) 生成：你只写 Markdown，它负责把 Markdown、模板和数据渲染成一整站静态 HTML。

<!-- more -->

## 为什么用静态博客

- 内容就是一堆 `.md` 文件，放在 Git 里，永不被平台绑架
- 没有数据库、没有运行时，部署到 CDN 上又快又便宜
- 想改样式就改主题模板，想加功能就加插件

## 三步开始写作

```bash
# 1. 新建文章
npx hexo new "我的第二篇文章"

# 2. 本地预览（默认 http://localhost:4000）
npm start

# 3. 生成静态文件到 public/
npm run build
```

> 提示：文章里写 `<!-- more -->` 的位置，就是首页摘要的截断点。

接下来，去 `source/_posts/` 里把这篇换成你自己的话吧。
