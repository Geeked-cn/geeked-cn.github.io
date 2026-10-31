/*!
 * 邮箱地址"破译"动画：默认显示混淆文本，鼠标悬停或键盘聚焦时逐字换成真地址。
 * 用法：<a data-decipher="you@example.com">混淆文本</a>
 */
(function () {
  'use strict';

  var NOISE = 'λ0123456789@._-#%&*+=<>[]{}/\\';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('[data-decipher]').forEach(function (element) {
    var address = element.getAttribute('data-decipher');
    var masked = element.textContent;
    if (!address) return;

    var timer = 0;
    var frame = 0;

    function stop() {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      timer = 0;
      frame = 0;
    }

    function settle() {
      element.textContent = address;
      element.setAttribute('href', 'mailto:' + address);
      element.classList.remove('is-deciphering');
    }

    function reset() {
      stop();
      element.textContent = masked;
      element.removeAttribute('href');
      element.classList.remove('is-deciphering');
    }

    function decipher() {
      stop();
      element.removeAttribute('href');
      element.classList.add('is-deciphering');

      if (reduceMotion) {
        settle();
        return;
      }

      timer = window.setTimeout(function () {
        var start = performance.now();
        (function tick(now) {
          var revealed = Math.min(address.length, Math.floor((now - start) / 38));
          element.textContent = Array.from(address, function (char, index) {
            if (index < revealed || char === '@' || char === '.') return char;
            return NOISE[Math.floor(now / 44 + index * 3) % NOISE.length];
          }).join('');

          if (revealed < address.length) {
            frame = window.requestAnimationFrame(tick);
          } else {
            settle();
          }
        })(start);
      }, 200);
    }

    element.addEventListener('mouseenter', decipher);
    element.addEventListener('mouseleave', reset);
    element.addEventListener('focus', decipher);
    element.addEventListener('blur', reset);
    reset();
  });
})();
