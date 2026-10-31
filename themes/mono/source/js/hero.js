/*!
 * mono 主题首页动效
 *
 * 1. ASCII 人像：把照片降采样成字符网格，字符从画面四周飞入拼成肖像；点击/回车揭示原图
 * 2. 打字机开场：逐字打出问候语与名字，光标闪烁
 * 3. 柏拉图立体：底部一排旋转的五种正多面体线框
 * 4. 两屏切换：滚轮 / 触摸 / 方向键在 hero 与 overlay 之间切换
 *
 * 支持 prefers-reduced-motion 与 ?still（静态）/?photo（直接显示照片）两个查询参数。
 */
(function () {
  'use strict';

  var settings = Object.assign(
    {
      hello: 'Hello,',
      name: '',
      overlayText: '',
      portrait: '/img/portrait.png',
      keepPhoto: false
    },
    window.MONO_HERO || {}
  );

  var params = new URLSearchParams(location.search);
  var still =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    params.has('still') ||
    settings.keepPhoto;
  document.body.classList.toggle('reduce-motion', still);

  /* ---------------- 通用小工具 ---------------- */

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - clamp(t, 0, 1), 4);
  }

  function easeInOutQuart(t) {
    var x = clamp(t, 0, 1);
    return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
  }

  /* 稳定伪随机：同一个种子永远得到同一个值，用来打散字符与飞入轨迹 */
  function noise(seed) {
    var value = Math.sin(seed * 91.3458) * 47453.5453;
    return value - Math.floor(value);
  }

  /* ---------------- 一、ASCII 人像 ---------------- */

  /* 字符按"视觉重量"分三档，由明暗决定用哪一档：
     浅色用点线、中间调用符号与数字、深色用大块头符号。
     这样即使原图是大面积纯色（卡通、插画），也能看出层次而不是糊成一块。 */
  var GLYPH_SETS = ['.,:;~^_-', '+=ox01()<>', 'λ{}[]/\\|@#%&*'];

  function initPortrait() {
    var canvas = document.getElementById('portrait');
    var source = document.getElementById('portrait-source');
    if (!canvas || !source) return;

    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var cutout = document.createElement('canvas'); // 抠掉背景后的照片
    var glyphs = [];
    var fontSize = 11;
    var cellWidth = 7;
    var cellHeight = 12;
    /* 抠图结果（全分辨率）：字符网格直接按它决定哪里落字 */
    var maskData = null;
    var maskWidth = 0;
    var maskHeight = 0;
    var maskTrusted = false;
    var photoBox = { x: 0, y: 0, width: 0, height: 0 };
    var bornAt = performance.now();
    var revealAt = null;
    var frame = 0;
    var resizeTimer = 0;

    var PHOTO_IN = 80; // 照片开始淡入
    var PHOTO_HOLD = 4650; // 照片开始淡出
    var RESET_AT = 6500; // 回到可点击状态
    var FADE = 1150; // 淡入淡出时长

    function resizeCanvas() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = 'top';
    }

    /* 抠背景：
       先取顶部两角得到背景色，再从四条边做洪水填充，只把「和边框连通的背景」抹成透明。
       这样主体本身是白色也没关系 —— 只要它被深色描边包住，填充就进不去。
       如果填充结果不可信（几乎没抠掉、或几乎全被抠掉），就退回整张图 + 边缘羽化。 */
    function cutBackground() {
      var width = source.naturalWidth;
      var height = source.naturalHeight;
      cutout.width = width;
      cutout.height = height;

      var paint = cutout.getContext('2d', { willReadFrequently: true });
      if (!paint) return;
      paint.drawImage(source, 0, 0);

      var image = paint.getImageData(0, 0, width, height);
      var data = image.data;
      var patch = Math.max(4, Math.floor(Math.min(width, height) * 0.035));
      var corners = [
        [0, 0],
        [width - patch, 0]
      ];
      var red = 0;
      var green = 0;
      var blue = 0;
      var count = 0;

      corners.forEach(function (corner) {
        for (var y = corner[1]; y < corner[1] + patch; y += 1) {
          for (var x = corner[0]; x < corner[0] + patch; x += 1) {
            var index = (y * width + x) * 4;
            red += data[index] === undefined ? 255 : data[index];
            green += data[index + 1] === undefined ? 255 : data[index + 1];
            blue += data[index + 2] === undefined ? 255 : data[index + 2];
            count += 1;
          }
        }
      });

      red /= count;
      green /= count;
      blue /= count;

      var tolerance = 60; // 背景色容差：能吃掉底部那层淡淡的阴影
      var total = width * height;
      var isBackground = new Uint8Array(total);
      var stack = new Int32Array(total);
      var pointer = 0;

      function similar(index) {
        var offset = index * 4;
        return (
          Math.hypot(
            (data[offset] || 255) - red,
            (data[offset + 1] || 255) - green,
            (data[offset + 2] || 255) - blue
          ) < tolerance
        );
      }

      function seed(index) {
        if (isBackground[index] || !similar(index)) return;
        isBackground[index] = 1;
        stack[pointer++] = index;
      }

      for (var x = 0; x < width; x += 1) {
        seed(x);
        seed((height - 1) * width + x);
      }
      for (var y = 0; y < height; y += 1) {
        seed(y * width);
        seed(y * width + width - 1);
      }

      while (pointer > 0) {
        var index = stack[--pointer];
        var col = index % width;
        var row = (index - col) / width;
        if (col > 0) seed(index - 1);
        if (col < width - 1) seed(index + 1);
        if (row > 0) seed(index - width);
        if (row < height - 1) seed(index + width);
      }

      var subject = 0;
      for (var i = 0; i < total; i += 1) {
        if (!isBackground[i]) subject += 1;
      }
      var ratio = subject / total;

      if (ratio < 0.08 || ratio > 0.985) {
        maskTrusted = false;
        /* 抠图不可信：整张图留着，只把四条边羽化掉 */
        var fade = Math.min(width, height) * 0.075;
        for (var r = 0; r < height; r += 1) {
          for (var c = 0; c < width; c += 1) {
            var edge = Math.min(c, r, width - 1 - c, height - 1 - r);
            data[(r * width + c) * 4 + 3] = Math.round(255 * smooth(0, fade, edge));
          }
        }
      } else {
        maskTrusted = true;
        /* 3x3 均值把硬边磨一下，放大后不会看到锯齿 */
        for (var ry = 0; ry < height; ry += 1) {
          for (var rx = 0; rx < width; rx += 1) {
            var sum = 0;
            var samples = 0;
            for (var dy = -1; dy <= 1; dy += 1) {
              var yy = ry + dy;
              if (yy < 0 || yy >= height) continue;
              for (var dx = -1; dx <= 1; dx += 1) {
                var xx = rx + dx;
                if (xx < 0 || xx >= width) continue;
                sum += isBackground[yy * width + xx] ? 0 : 255;
                samples += 1;
              }
            }
            data[(ry * width + rx) * 4 + 3] = sum / samples;
          }
        }
      }

      maskData = isBackground;
      maskWidth = width;
      maskHeight = height;
      paint.putImageData(image, 0, 0);
    }

    function smooth(edge0, edge1, value) {
      var t = clamp((value - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
      return t * t * (3 - 2 * t);
    }

    /* 把照片降采样成 cols × rows 的灰度网格，再决定每个格子放什么字符 */
    function build() {
      var mobile = window.innerWidth < 760;
      var boxWidth = window.innerWidth * (mobile ? 0.9 : 0.46);
      var boxHeight = window.innerHeight * (mobile ? 0.48 : 0.72);

      fontSize = clamp(Math.min(boxWidth / 60, boxHeight / 46), 7, 14);
      cellWidth = fontSize * 0.62;
      cellHeight = fontSize * 1.08;

      var aspect = source.naturalHeight / source.naturalWidth;
      var cols = clamp(
        Math.floor(Math.min(boxWidth / cellWidth, boxHeight / (aspect * cellWidth))),
        24,
        112
      );
      var rows = Math.max(24, Math.floor((cols * aspect * cellWidth) / cellHeight));

      var sample = document.createElement('canvas');
      sample.width = cols;
      sample.height = rows;
      var paint = sample.getContext('2d', { willReadFrequently: true });
      if (!paint) return;
      paint.drawImage(source, 0, 0, cols, rows);

      var data = paint.getImageData(0, 0, cols, rows).data;

      /* 主体覆盖率：ne 格里有几成像素是"非背景" */
      function coverage(col, row) {
        if (!maskTrusted || !maskData) return -1;
        var x0 = Math.floor((col / cols) * maskWidth);
        var x1 = Math.max(x0 + 1, Math.floor(((col + 1) / cols) * maskWidth));
        var y0 = Math.floor((row / rows) * maskHeight);
        var y1 = Math.max(y0 + 1, Math.floor(((row + 1) / rows) * maskHeight));
        var subject = 0;
        var seen = 0;
        for (var my = y0; my < y1; my += 1) {
          for (var mx = x0; mx < x1; mx += 1) {
            seen += 1;
            if (!maskData[my * maskWidth + mx]) subject += 1;
          }
        }
        return subject / Math.max(1, seen);
      }

      function luminance(col, row) {
        var x = clamp(col, 0, cols - 1);
        var y = clamp(row, 0, rows - 1);
        var offset = (y * cols + x) * 4;
        return (
          (data[offset] || 0) * 0.2126 +
          (data[offset + 1] || 0) * 0.7152 +
          (data[offset + 2] || 0) * 0.0722
        );
      }

      var corners = [
        luminance(0, 0),
        luminance(cols - 1, 0),
        luminance(0, rows - 1),
        luminance(cols - 1, rows - 1)
      ];
      var background =
        corners.reduce(function (sum, value) {
          return sum + value;
        }, 0) / corners.length;
      var darkOnLight = background >= 128;

      var width = cols * cellWidth;
      var height = rows * cellHeight;
      var centerX = mobile ? window.innerWidth / 2 : window.innerWidth * 0.245;
      var centerY = mobile ? window.innerHeight * 0.31 : window.innerHeight * 0.44;
      var left = centerX - width / 2;
      var top = centerY - height / 2;

      photoBox = { x: left, y: top, width: width, height: height };

      /* 第一遍：判断每一格要不要落字（和背景的明暗差 + 边缘强度） */
      var cells = [];
      for (var row = 0; row < rows; row += 1) {
        for (var col = 0; col < cols; col += 1) {
          var value = luminance(col, row);
          var contrast = darkOnLight
            ? (background - value) / Math.max(background, 1)
            : (value - background) / Math.max(255 - background, 1);
          var edge =
            Math.max(
              Math.abs(value - luminance(col + 1, row)),
              Math.abs(value - luminance(col, row + 1))
            ) / 255;
          var covered = coverage(col, row);
          cells.push({
            value: value,
            shade: clamp(contrast, 0, 1),
            edgeness: clamp(edge * 1.45, 0, 1),
            /* 有抠图就用抠图决定落字：整块剪影都铺上字符，靠字符重量分层；
               抠图不可信时退回"和背景的明暗差" */
            include: covered < 0 ? false : covered > 0.3
          });
        }
      }

      /* 自动色阶：只看落了字的那些格子，用 5%/95% 分位把主体内部的明暗拉开。
         纯色为主的图（卡通、插画）也能分出层次，而不只是一整块同一种字符。 */
      var used = [];
      cells.forEach(function (cell) {
        var strength = Math.max(cell.shade, cell.edgeness);
        if (maskTrusted ? cell.include : strength > 0.055) used.push(cell.value);
      });
      used.sort(function (a, b) {
        return a - b;
      });

      var low = used.length ? used[Math.floor(used.length * 0.05)] : 0;
      var high = used.length ? used[Math.floor(used.length * 0.95)] : 255;
      if (high - low < 24) {
        low = used.length ? used[0] : 0;
        high = used.length ? used[used.length - 1] : 255;
      }
      var span = Math.max(1, high - low);

      glyphs = [];

      /* 第二遍：定字符重量与位置 */
      cells.forEach(function (cell, index) {
        var strength = Math.max(cell.shade, cell.edgeness);
        if (maskTrusted ? !cell.include : strength <= 0.055) return;

        var tone = darkOnLight
          ? clamp((high - cell.value) / span, 0, 1)
          : clamp((cell.value - low) / span, 0, 1);
        var level = tone > 0.72 ? 2 : tone > 0.32 ? 1 : 0;
        if (cell.edgeness > 0.35 && cell.edgeness > tone) level = Math.min(2, level + 1);

        var set = GLYPH_SETS[level];
        var seed = noise(index + 1);
        var angle = seed * Math.PI * 2 + noise(index + 97) * 0.7;
        var radius = Math.max(width, height) * (0.58 + noise(index + 211) * 0.62);
        var col = index % cols;
        var row = (index - col) / cols;

        glyphs.push({
          /* 字符用伪随机挑，而不是按下标循环 —— 否则整片会排出斜条纹 */
          char: set[Math.floor(noise(index + 7) * set.length)] || '.',
          x: left + col * cellWidth,
          y: top + row * cellHeight,
          fromX: centerX + Math.cos(angle) * radius,
          fromY: centerY + Math.sin(angle) * radius,
          strength: Math.pow(Math.max(tone, strength), 0.72),
          seed: seed,
          /* 每格固定的纹理系数：大面积纯色也不会糊成一块死黑 */
          texture: 0.94 + noise(index + 331) * 0.12
        });
      });
    }

    /* resetClock=false：只是重算网格（例如字体加载完成后），不要让字符重新飞一遍 */
    function layout(resetClock) {
      resizeCanvas();
      build();
      setFont();
      if (resetClock !== false) bornAt = performance.now();
    }

    function setFont() {
      ctx.font =
        '500 ' +
        fontSize +
        "px 'Maple Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    }

    function flyIn(seed, elapsed) {
      if (still) return 1;
      return easeOutQuart((elapsed - seed * 620) / 2350);
    }

    function armInteraction() {
      revealAt = null;
      canvas.setAttribute(
        'aria-label',
        '一幅由字符拼成的人像，选中可以看原图。'
      );
      canvas.setAttribute('role', 'button');
      canvas.setAttribute('tabindex', '0');
      canvas.style.cursor = 'pointer';
    }

    function draw(now) {
      frame = window.requestAnimationFrame(draw);

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      if (!glyphs.length) return;

      var elapsed = now - bornAt;
      var sinceReveal = revealAt === null ? -1 : now - revealAt;

      if (sinceReveal >= RESET_AT) {
        armInteraction();
        sinceReveal = -1;
      }

      /* 照片淡入 → 停一会儿 → 淡出，字符随后逐批回到原位 */
      var photoAlpha =
        sinceReveal < 0
          ? 0
          : easeInOutQuart((sinceReveal - PHOTO_IN) / FADE) *
            (1 - easeInOutQuart((sinceReveal - PHOTO_HOLD) / FADE));

      if (photoAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = photoAlpha;
        ctx.drawImage(cutout, photoBox.x, photoBox.y, photoBox.width, photoBox.height);
        ctx.restore();
      }

      setFont();

      for (var i = 0; i < glyphs.length; i += 1) {
        var glyph = glyphs[i];
        var progress = flyIn(glyph.seed, elapsed);
        var x = glyph.fromX + (glyph.x - glyph.fromX) * progress;
        var y = glyph.fromY + (glyph.y - glyph.fromY) * progress;

        var alpha = (0.16 + glyph.strength * 0.62) * glyph.texture * progress;
        var shimmer = 1;

        if (sinceReveal >= 0) {
          var leave = easeOutQuart((sinceReveal - glyph.seed * 360) / 900);
          var stagger = (i / glyphs.length) * 750;
          var back = easeOutQuart((sinceReveal - PHOTO_HOLD - stagger) / 620);
          alpha *= Math.max(1 - leave, back);
        } else if (!still) {
          shimmer = 0.92 + 0.08 * Math.sin(now * 0.0028 + glyph.seed * 30);
        }

        alpha *= shimmer;
        if (alpha <= 0.005) continue;

        ctx.fillStyle = 'rgba(0, 0, 0, ' + alpha + ')';
        ctx.fillText(glyph.char, x, y);
      }
    }

    function revealPhoto() {
      if (revealAt !== null) return;
      revealAt = performance.now();
      canvas.setAttribute('aria-label', 'ASCII 人像背后显示出来的照片。');
      canvas.removeAttribute('role');
      canvas.removeAttribute('tabindex');
      canvas.style.cursor = 'default';
    }

    canvas.addEventListener('click', revealPhoto);
    canvas.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        revealPhoto();
      }
    });

    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(layout, 120);
    });

    function start() {
      cutBackground();
      layout();
      window.cancelAnimationFrame(frame);
      armInteraction();
      /* 顺序不能反：armInteraction 会把 revealAt 归零 */
      if (params.has('photo')) {
        revealPhoto();
        revealAt = performance.now() - 1600;
      }
      draw(performance.now());
    }

    if (source.complete) start();
    else source.addEventListener('load', start, { once: true });
    if (document.fonts && document.fonts.load) {
      document.fonts.load('500 16px "Maple Mono"').then(function () {
        if (glyphs.length) layout(false);
      });
    }
  }

  /* ---------------- 二、打字机开场 ---------------- */

  function initIntro(onDone) {
    var hello = document.getElementById('hello-line');
    var name = document.getElementById('name-line');
    var cursor = document.getElementById('typing-cursor');
    if (!hello || !name || !cursor) {
      onDone();
      return;
    }

    var lines = [
      { element: hello, text: settings.hello, gap: 0 },
      { element: name, text: settings.name, gap: 360 }
    ];

    function finish() {
      cursor.classList.add('is-finished');
      onDone();
    }

    if (still) {
      hello.textContent = lines[0].text;
      name.textContent = lines[1].text;
      name.appendChild(cursor);
      finish();
      return;
    }

    var lineIndex = 0;
    var charIndex = 0;
    hello.appendChild(cursor);

    function step() {
      var line = lines[lineIndex];
      if (!line) {
        finish();
        return;
      }

      var char = line.text[charIndex];
      if (char === undefined) {
        lineIndex += 1;
        charIndex = 0;
        var next = lines[lineIndex];
        if (!next) {
          finish();
          return;
        }
        next.element.appendChild(cursor);
        window.setTimeout(step, next.gap);
        return;
      }

      line.element.insertBefore(document.createTextNode(char), cursor);
      charIndex += 1;
      window.setTimeout(step, char === ',' || char === '.' ? 240 : 58);
    }

    window.setTimeout(step, 520);
  }

  /* ---------------- 三、柏拉图立体 ---------------- */

  var PHI = (1 + Math.sqrt(5)) / 2;
  var INV_PHI = 1 / PHI;
  var SIGNS = [-1, 1];
  var CUBE = SIGNS.flatMap(function (a) {
    return SIGNS.flatMap(function (b) {
      return SIGNS.map(function (c) {
        return [a, b, c];
      });
    });
  });

  /* 正四面体 / 正方体 / 正八面体 / 正十二面体 / 正二十面体 */
  var SOLIDS = [
    [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1]
    ],
    CUBE,
    [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ],
    CUBE.concat(
      SIGNS.flatMap(function (a) {
        return SIGNS.map(function (b) {
          return [0, a * INV_PHI, b * PHI];
        });
      }),
      SIGNS.flatMap(function (a) {
        return SIGNS.map(function (b) {
          return [a * INV_PHI, b * PHI, 0];
        });
      }),
      SIGNS.flatMap(function (a) {
        return SIGNS.map(function (b) {
          return [a * PHI, 0, b * INV_PHI];
        });
      })
    ),
    SIGNS
      .flatMap(function (a) {
        return SIGNS.map(function (b) {
          return [0, a, b * PHI];
        });
      })
      .concat(
        SIGNS.flatMap(function (a) {
          return SIGNS.map(function (b) {
            return [a, b * PHI, 0];
          });
        }),
        SIGNS.flatMap(function (a) {
          return SIGNS.map(function (b) {
            return [a * PHI, 0, b];
          });
        })
      )
  ];

  /* 最长的那些顶点两两连线就是棱：先取最小距离，再留出 1.5% 容差 */
  function findEdges(vertices) {
    var shortest = Infinity;
    var pairs = [];

    for (var i = 0; i < vertices.length; i += 1) {
      for (var j = i + 1; j < vertices.length; j += 1) {
        var a = vertices[i];
        var b = vertices[j];
        var distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (distance > 0.001) shortest = Math.min(shortest, distance);
        pairs.push({ edge: [i, j], distance: distance });
      }
    }

    return pairs
      .filter(function (pair) {
        return pair.distance <= shortest * 1.015;
      })
      .map(function (pair) {
        return pair.edge;
      });
  }

  var SOLID_MESHES = SOLIDS.map(function (vertices) {
    return { vertices: vertices, edges: findEdges(vertices) };
  });

  function initSolids() {
    var canvas = document.getElementById('solids-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var frame = 0;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function project(point, yaw, pitch) {
      var cosY = Math.cos(yaw);
      var sinY = Math.sin(yaw);
      var x1 = point[0] * cosY - point[2] * sinY;
      var z1 = point[0] * sinY + point[2] * cosY;
      var cosX = Math.cos(pitch);
      var sinX = Math.sin(pitch);
      var y1 = point[1] * cosX - z1 * sinX;
      var z2 = point[1] * sinX + z1 * cosX;
      return [x1, y1, z2];
    }

    function draw(now) {
      frame = window.requestAnimationFrame(draw);
      var width = canvas.clientWidth;
      var height = canvas.clientHeight;
      if (!width || !height) return;

      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';

      for (var i = 0; i < SOLID_MESHES.length; i += 1) {
        var mesh = SOLID_MESHES[i];
        var centerX = ((i + 0.5) / SOLID_MESHES.length) * width;
        var centerY = height / 2;
        var scale = Math.min(14, width / SOLID_MESHES.length / 4.6);
        var yaw = now * (0.00022 + i * 0.000018) * 0.83;
        var pitch = now * (0.00022 + i * 0.000018);

        var points = mesh.vertices.map(function (vertex) {
          var rotated = project(vertex, yaw, pitch);
          var perspective = 3.8 / (3.8 - rotated[2] * 0.34);
          return {
            x: centerX + rotated[0] * scale * perspective,
            y: centerY + rotated[1] * scale * perspective
          };
        });

        ctx.beginPath();
        mesh.edges.forEach(function (edge) {
          var a = points[edge[0]];
          var b = points[edge[1]];
          if (!a || !b) return;
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        });
        ctx.stroke();
      }
    }

    resize();
    draw(performance.now());
    window.addEventListener('resize', resize);
  }

  /* ---------------- 四、hero / overlay 两屏切换 ---------------- */

  function initStates() {
    var overlay = document.getElementById('overlay');
    var copy = document.getElementById('overlay-copy');
    var copyText = document.getElementById('overlay-text');
    var copyCursor = document.getElementById('overlay-cursor');
    var sheet = document.getElementById('sheet-scroll');
    var cue = document.getElementById('scroll-cue');
    if (!overlay || !sheet) return;

    var state = 'hero';
    var switching = false;
    var typed = false;
    var expanded = false;
    var unlockTimer = 0;
    var touchStartY = null;

    function scrollOffset() {
      if (copy) copy.style.setProperty('--overlay-scroll-y', -sheet.scrollTop + 'px');
    }

    /* 长句是 nowrap 的：边打边把它往左推，保证刚打出来的字一直在视野里 */
    function track() {
      if (!copy) return;
      if (expanded) {
        copy.style.removeProperty('--overlay-track-x');
        return;
      }
      var box = copy.getBoundingClientRect().width;
      var rightEdge = window.innerWidth / 2 - box / 2 + copy.scrollWidth;
      var margin = Math.max(16, window.innerWidth * 0.04);
      var shift = Math.min(0, window.innerWidth - margin - rightEdge);
      copy.style.setProperty('--overlay-track-x', shift + 'px');
    }

    function showSheet() {
      sheet.scrollTop = 0;
      scrollOffset();
      if (expanded) return;
      expanded = true;
      overlay.classList.add('is-expanded');
      if (copy) copy.style.removeProperty('--overlay-track-x');
      sheet.focus({ preventScroll: true });
    }

    function typeOverlay() {
      if (typed) return;
      typed = true;
      if (copy) copy.classList.add('is-active');

      if (still) {
        if (copy) copy.style.transition = 'none';
        if (copyText) copyText.textContent = settings.overlayText;
        if (copyCursor) copyCursor.classList.add('is-finished');
        showSheet();
        return;
      }

      var index = 0;
      (function step() {
        var char = settings.overlayText[index];
        if (char === undefined) {
          if (copyCursor) copyCursor.classList.add('is-finished');
          window.setTimeout(showSheet, 650);
          return;
        }
        if (copyText) copyText.textContent += char;
        track();
        index += 1;
        window.setTimeout(step, char === ' ' ? 28 : 44);
      })();
    }

    function go(next) {
      if (next === state || switching) return false;
      if (next === 'overlay') {
        sheet.scrollTop = 0;
        scrollOffset();
      }
      state = next;
      switching = true;
      document.body.classList.toggle('view-overlay', next === 'overlay');
      overlay.classList.toggle('is-visible', next === 'overlay');
      if (next === 'overlay') typeOverlay();
      window.clearTimeout(unlockTimer);
      unlockTimer = window.setTimeout(
        function () {
          switching = false;
        },
        still ? 0 : 820
      );
      return true;
    }

    if (cue) {
      cue.addEventListener('click', function () {
        go('overlay');
      });
    }

    document.addEventListener(
      'wheel',
      function (event) {
        if (event.deltaY === 0 || switching) return;
        if (state === 'overlay' && expanded) {
          var canScrollUp = sheet.scrollTop > 1;
          var canScrollDown = sheet.scrollTop + sheet.clientHeight < sheet.scrollHeight - 1;
          if ((event.deltaY < 0 && canScrollUp) || event.deltaY > 0 || canScrollDown) return;
        }
        var next = event.deltaY > 0 ? 'overlay' : 'hero';
        if (next !== state) {
          event.preventDefault();
          go(next);
        }
      },
      { passive: false, capture: true }
    );

    window.addEventListener(
      'touchstart',
      function (event) {
        touchStartY = event.touches[0] ? event.touches[0].clientY : null;
      },
      { passive: true }
    );

    window.addEventListener(
      'touchend',
      function (event) {
        var endY = event.changedTouches[0] ? event.changedTouches[0].clientY : undefined;
        if (touchStartY === null || endY === undefined) return;
        var delta = touchStartY - endY;
        if (state === 'overlay' && expanded && (delta > 0 || sheet.scrollTop > 1)) {
          touchStartY = null;
          return;
        }
        touchStartY = null;
        if (Math.abs(delta) < 24 || switching) return;
        go(delta > 0 ? 'overlay' : 'hero');
      },
      { passive: true }
    );

    window.addEventListener('keydown', function (event) {
      var down = event.key === 'ArrowDown' || event.key === 'PageDown';
      var up = event.key === 'ArrowUp' || event.key === 'PageUp';
      if (!down && !up) return;

      if (state === 'overlay' && expanded) {
        var step = event.key.indexOf('Page') === 0 ? sheet.clientHeight * 0.8 : 80;
        if (down) {
          event.preventDefault();
          sheet.scrollBy({ top: step, behavior: 'smooth' });
          return;
        }
        if (sheet.scrollTop > 1) {
          event.preventDefault();
          sheet.scrollBy({ top: -step, behavior: 'smooth' });
          return;
        }
      }

      event.preventDefault();
      go(down ? 'overlay' : 'hero');
    });

    sheet.addEventListener('scroll', scrollOffset, { passive: true });
    window.addEventListener('resize', function () {
      track();
      scrollOffset();
    });

    if (location.hash === '#overlay') go('overlay');
  }

  /* ---------------- 启动 ---------------- */

  function showCue() {
    var cue = document.getElementById('scroll-cue');
    if (!cue) return;
    cue.classList.add('is-visible');
    cue.setAttribute('tabindex', '0');
  }

  initPortrait();
  initSolids();
  initStates();
  initIntro(showCue);
})();
