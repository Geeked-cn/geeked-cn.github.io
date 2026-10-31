---
title: Markdown 速查
date: 2026-10-28 21:30:00
tags:
  - Markdown
  - 写作
categories:
  - 折腾
---

写博客 90% 的时间都在写 Markdown，把常用语法放在手边会舒服很多。

<!-- more -->

## 文本

| 想要的效果 | 写法 |
| --- | --- |
| **加粗** | `**加粗**` |
| *斜体* | `*斜体*` |
| ~~删除线~~ | `~~删除线~~` |
| `行内代码` | `` `行内代码` `` |
| [链接](https://hexo.io/) | `[链接](https://hexo.io/)` |

## 引用与分割线

> 引用可以写一整段，
> 也可以分多行。

---

## 列表

1. 有序列表
2. 第二项
   - 嵌套用两个空格缩进
   - 就这样

## 代码块

````markdown
```js
export const greet = (name) => `你好，${name}`;
```
````

渲染出来是：

```js
export const greet = (name) => `你好，${name}`;

const posts = await fetch('/posts.json').then((res) => res.json());
console.log(posts.map((post) => post.title));
```

## 图片

把图片放进 `source/images/`，然后这样引用：

```markdown
![说明文字](/images/example.png)
```
