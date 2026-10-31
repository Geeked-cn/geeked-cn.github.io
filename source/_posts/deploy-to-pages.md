---
title: 把博客部署到 Pages
date: 2026-10-26 09:15:00
tags:
  - 部署
  - Hexo
categories:
  - 折腾
---

本地写得爽，最后一步是让它出现在互联网上。这里给两条常用路线。

<!-- more -->

## 路线一：GitHub Pages（用 hexo-deployer-git）

1. 在 GitHub 新建仓库，例如 `你的用户名.github.io`
2. 打开 `_config.yml`，把 `url` 改成 `https://你的用户名.github.io`，并填好 `deploy` 段：

```yaml
deploy:
  type: git
  repo: https://github.com/你的用户名/你的用户名.github.io.git
  branch: main
```

3. 一键生成并推送：

```bash
npm run clean
npm run build
npm run deploy
```

## 路线二：Cloudflare Pages / Vercel（更推荐）

把整个博客源码推到 GitHub 仓库，然后在平台上连接该仓库，构建配置填：

| 配置项 | 值 |
| --- | --- |
| 构建命令 | `npm run build` |
| 输出目录 | `public` |
| Node 版本 | 20 或更高 |

之后每次 `git push`，平台会自动构建并发布，还自带全球 CDN 和 HTTPS。

## 发布前检查

- [ ] `url` 和 `root` 与线上路径一致（部署在子路径时 `root` 要写成 `/repo/`）
- [ ] `npm run build` 没有报错
- [ ] 手机上打开看过一遍排版
