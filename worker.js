/**
 * 把自定义域名（www.xhxh.eu.cc）反向代理到 GitHub Pages 上托管的 Hexo 博客。
 *
 * 为什么不直接在 GitHub 后台填自定义域名：
 * 这台机器上的 Cloudflare API token 没有 Zone:DNS:Edit 权限，建不了指向
 * geeked-cn.github.io 的 CNAME 记录。而 Workers 自定义域名走的是另一套权限，
 * 所以用 Worker 反代 + 边缘缓存来实现同样的对外效果。
 */
const ORIGIN = 'https://geeked-cn.github.io';

// 内容带哈希的文件可以长期缓存，HTML 之类短缓存
const IMMUTABLE = /\.(?:css|js|mjs|webp|png|jpe?g|gif|svg|ico|woff2?|ttf|otf|avif|mp4)$/i;

// 原来写在 static/_redirects 里的老链接兜底（GitHub Pages 不认 _redirects）
const REDIRECTS = {
  '/feed': '/atom.xml',
  '/rss': '/atom.xml',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    if (REDIRECTS[url.pathname]) {
      return Response.redirect(new URL(REDIRECTS[url.pathname], url.origin).toString(), 301);
    }

    if (url.pathname.startsWith('/blog/')) {
      return Response.redirect(new URL(url.pathname.slice('/blog'.length), url.origin).toString(), 301);
    }

    // 转发原始请求头，但必须去掉 host —— 否则 GitHub Pages 会按自定义域名
    // 去找站点并返回 404。cf-* 头也一并去掉，避免影响上游。
    const headers = new Headers();
    for (const [key, value] of request.headers) {
      if (key === 'host' || key.startsWith('cf-')) continue;
      headers.set(key, value);
    }

    const upstream = await fetch(new URL(url.pathname + url.search, ORIGIN), {
      method: request.method,
      headers,
      redirect: 'manual',
      cf: {
        cacheEverything: true,
        cacheTtl: IMMUTABLE.test(url.pathname) ? 31536000 : 300,
      },
    });

    const response = new Response(upstream.body, upstream);

    // GitHub Pages 的跳转地址改回自定义域名，避免访客被甩到 github.io
    const location = response.headers.get('location');
    if (location && location.startsWith(ORIGIN)) {
      response.headers.set('location', location.replace(ORIGIN, url.origin));
    }

    response.headers.set('x-proxied-from', 'github-pages');
    return response;
  },
};
