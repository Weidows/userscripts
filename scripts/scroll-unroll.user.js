// ==UserScript==
// @name         卷轴滚动
// @name:zh-CN   卷轴滚动
// @namespace    https://github.com/Weidows/userscripts
// @version      1.4.0
// @description  让网页像卷轴一样平滑展开：接管滚轮 / 键盘 / 锚点，用临界阻尼动画匀速「展卷」；右侧 VSCode 风格缩略图（可点击拖动跳转、双击右键暂隐 20s），出纸阴影 / 卷芯进度可分别开关；所有子功能都能在脚本管理器配置面板里调。
// @author       Weidows
// @license      MIT
// @homepageURL  https://github.com/Weidows/userscripts
// @supportURL   https://github.com/Weidows/userscripts/issues
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* ==UserConfig==
scroll:
  enabled:
    title: 平滑滚动总开关
    description: 关掉后完全交还浏览器原生滚动（等价 Alt+S 或脚本菜单）
    type: checkbox
    default: true
  keys:
    title: 接管键盘翻页键
    description: 空格 / PageUp / PageDown / 方向键 / Home / End 走展卷动画；输入框内一律放行
    type: checkbox
    default: true
  anchors:
    title: 锚点跳转动画
    description: "点击页内 #锚点 链接时也用展卷动画滚过去"
    type: checkbox
    default: true
  smoothTime:
    title: 顺滑度
    description: 阻尼时间，越大越绵长（0.34 约 1 秒收敛）
    type: select
    default: 0.34
    values: [0.2, 0.34, 0.52, 0.8]
  distScale:
    title: 滚动距离倍率
    description: 滚轮 / 按键一次滚多远
    type: select
    default: 1
    values: [0.6, 1, 1.4, 2]
decor:
  shadows:
    title: 出纸阴影
    description: 滚动前沿的暗边，强度随速度变化
    type: checkbox
    default: true
  core:
    title: 卷芯进度条
    description: 右侧细进度条；缩略图开启时自动让位
    type: checkbox
    default: true
  minimap:
    title: 缩略图（VSCode 风格）
    description: 右侧一栏按比例重绘的页面骨架 + 视口指示器
    type: checkbox
    default: true
  minimapInteractive:
    title: 缩略图可点击 / 拖动
    description: 关掉则只展示、不响应点击（也不遮挡页面右侧的点选）
    type: checkbox
    default: true
  minimapWidth:
    title: 缩略图宽度
    description: 窄屏（<720px）自动隐藏
    type: number
    default: 88
    min: 48
    max: 200
    unit: px
  minimapOpacity:
    title: 缩略图静息不透明度
    description: 鼠标移上去会变成 1
    type: number
    default: 0.32
    min: 0.1
    max: 1
  minimapDoubleClick:
    title: 双击右键暂时隐藏缩略图
    description: 在缩略图上连按两下鼠标右键即可收起，到时自动回来；该区域内右键不弹系统菜单
    type: checkbox
    default: true
  minimapHideSeconds:
    title: 缩略图隐藏时长
    description: 双击右键收起后多久自动恢复（秒）
    type: number
    default: 20
    min: 5
    max: 300
    unit: 秒
site:
  blacklist:
    title: 站点黑名单
    description: 每行一个域名，命中则整站不接管（脚本菜单「本页开关」也写这里）
    type: textarea
    default: ''
==/UserConfig== */

(function () {
  'use strict';

  if (window.__scrollUnrollLoaded) return;
  window.__scrollUnrollLoaded = true;

  const VERSION = '1.4.0';
  const HOST_ID = 'scroll-unroll-layer';
  const PANEL_ID = 'scroll-unroll-panel';
  const PFX = 'su:'; // localStorage 镜像前缀（GM 存储不可用时兜底）

  // ==========================================================================
  // 0. 配置：扁平存储键 ←→ 内部路径
  //    键名同时就是 ScriptCat @UserConfig 的「组.键」，所以扩展控制面板里的配置
  //    和脚本菜单 / 站内设置面板改的是同一份数据，不会各说各话。
  //    [存储键, 内部路径, 默认值, 类型]
  // ==========================================================================
  const SPEC = [
    ['scroll.enabled', 'enabled', true, 'bool'],
    ['scroll.keys', 'keys', true, 'bool'],
    ['scroll.anchors', 'anchors', true, 'bool'],
    ['scroll.smoothTime', 'smoothTime', 0.34, 'num'],
    ['scroll.distScale', 'distScale', 1, 'num'],
    ['decor.shadows', 'ui.shadows', true, 'bool'],
    ['decor.core', 'ui.core', true, 'bool'],
    ['decor.minimap', 'ui.minimap', true, 'bool'],
    ['decor.minimapInteractive', 'ui.minimapInteractive', true, 'bool'],
    ['decor.minimapWidth', 'ui.minimapWidth', 88, 'num'],
    ['decor.minimapOpacity', 'ui.minimapOpacity', 0.32, 'num'],
    ['decor.minimapDoubleClick', 'ui.minimapDoubleClick', true, 'bool'],
    ['decor.minimapHideSeconds', 'ui.minimapHideSeconds', 20, 'num'],
    ['site.blacklist', 'siteOff', [], 'lines'],
    ['internal.seen', 'seen', false, 'bool'], // 不进 @UserConfig：不在扩展面板露出
  ];
  const BY_PATH = {};
  SPEC.forEach((s) => (BY_PATH[s[1]] = s));

  function setPath(obj, path, v) {
    const parts = path.split('.');
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = v;
  }

  const getPath = (obj, path) =>
    path.split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);

  function coerce(v, type, def) {
    if (type === 'bool') {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return !!v;
      return String(v) !== 'false' && String(v) !== '0' && String(v) !== '';
    }
    if (type === 'num') {
      const n = Number(v);
      return isFinite(n) ? n : def;
    }
    if (type === 'lines') {
      if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
      return String(v)
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return v;
  }

  function rawGet(key) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key, undefined);
        if (v !== undefined && v !== null && v !== '') return v;
      }
    } catch (e) {
      /* 忽略 */
    }
    try {
      const s = localStorage.getItem(PFX + key);
      if (s !== null) {
        const v = JSON.parse(s);
        if (v !== null && v !== '') return v;
      }
    } catch (e) {
      /* 忽略 */
    }
    return undefined;
  }

  function rawHas(key) {
    try {
      if (typeof GM_getValue === 'function' && GM_getValue(key, undefined) !== undefined) return true;
    } catch (e) {
      /* 忽略 */
    }
    try {
      return localStorage.getItem(PFX + key) !== null;
    } catch (e) {
      return false;
    }
  }

  function rawSet(key, val) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, val);
    } catch (e) {
      /* 忽略 */
    }
    try {
      localStorage.setItem(PFX + key, JSON.stringify(val));
    } catch (e) {
      /* 忽略 */
    }
  }

  const cfg = { ui: {} };
  SPEC.forEach((s) => setPath(cfg, s[1], s[2]));
  SPEC.forEach((s) => {
    const v = rawGet(s[0]);
    if (v !== undefined) setPath(cfg, s[1], coerce(v, s[3], s[2]));
  });

  // 尊重系统「减少动态效果」；用户显式配过就以用户的为准
  const prefersReduce =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduce && !rawHas('scroll.enabled')) cfg.enabled = false;

  // file:// 下 hostname 为空串，退化用 origin，否则「本页开关」会把整站都匹配上
  const myHost = location.hostname || location.origin || location.protocol;
  if (myHost && cfg.siteOff.indexOf(myHost) >= 0) cfg.enabled = false;

  // 改一项：写回扁平键（= 扩展配置面板读的那份）+ 收口到运行时
  function setVal(path, value) {
    const spec = BY_PATH[path];
    if (!spec) return value;
    const v = coerce(value, spec[3], spec[2]);
    setPath(cfg, path, v);
    rawSet(spec[0], v);
    applyRuntime();
    return v;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ==========================================================================
  // 1. 滚动目标（root）：既能滚 window，也能滚「body overflow:hidden + 主容器滚动」的页面
  // ==========================================================================
  const nativeScrollTo = window.scrollTo.bind(window); // 先存原生，后面会被我们接管
  const isWinScroll = (el) => el === document.documentElement || el === document.body;

  const maxOf = (el) => (el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0);

  function readY(el) {
    if (!el) return 0;
    return isWinScroll(el)
      ? window.pageYOffset || document.documentElement.scrollTop || 0
      : el.scrollTop;
  }

  function writeY(el, y) {
    // 必须用保存下来的原生 scrollTo，否则会被下面自己的 hook 递归
    if (isWinScroll(el)) nativeScrollTo(0, y);
    else el.scrollTop = y;
  }

  function scrollableY(el) {
    if (!el || el.nodeType !== 1) return false;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
    return el.scrollHeight - el.clientHeight > 2;
  }

  const winRoot = () => document.scrollingElement || document.documentElement;

  // 从事件目标往上找「整屏滚动的那个容器」，找不到就用窗口
  function pickRoot(from) {
    const se = winRoot();
    if (maxOf(se) > 4) return se;
    let el = from;
    while (el && el.nodeType === 1 && el !== se) {
      if (scrollableY(el) && el.clientHeight >= window.innerHeight * 0.65) return el;
      el = el.parentElement;
    }
    return se;
  }

  // 事件目标所在的小滚动容器（正文里的滚动框），命中则交还浏览器原生处理
  function nestedScroller(from, root) {
    let el = from;
    while (el && el.nodeType === 1 && el !== root && el !== document.documentElement) {
      if (scrollableY(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ==========================================================================
  // 2. 动画引擎：临界阻尼（SmoothDamp）——不重启、可中途改道、无过冲
  // ==========================================================================
  const st = { root: null, target: 0, cur: 0, v: 0, raf: 0, last: 0, selfY: -1 };

  function curRoot() {
    if (st.root && st.root.isConnected && maxOf(st.root) > 1) return st.root;
    st.root = winRoot();
    return st.root;
  }

  function frame(t) {
    const el = curRoot();
    const dt = clamp(st.last ? (t - st.last) / 1000 : 1 / 60, 1 / 240, 0.064);
    st.last = t;

    const omega = 2 / clamp(cfg.smoothTime, 0.06, 2);
    const x = omega * dt;
    const expo = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = st.cur - st.target;
    const temp = (st.v + omega * change) * dt;
    st.v = (st.v - omega * temp) * expo;
    let out = st.target + (change + temp) * expo;

    const max = maxOf(el);
    st.target = clamp(st.target, 0, max);
    if (out > max) out = max;
    if (out < 0) out = 0;

    st.cur = out;
    st.selfY = Math.round(out * 100) / 100;
    writeY(el, st.selfY);

    if (Math.abs(st.target - st.cur) < 1.2) {
      st.cur = st.selfY = st.target;
      st.v = 0;
      st.raf = 0;
      st.last = 0;
      writeY(el, st.target);
      return;
    }
    st.raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (st.raf) return;
    st.last = 0;
    st.raf = requestAnimationFrame(frame);
  }

  function stopTween() {
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
    st.last = 0;
    st.v = 0;
  }

  // instant = 拖缩略图这类需要 1:1 跟手的场景：直接写、不做动画
  function scrollToY(y, from, instant) {
    const el = pickRoot(from || document.body);
    st.root = el;
    if (!st.raf) {
      st.selfY = readY(el);
      st.cur = st.target = st.selfY;
      st.v = 0;
    }
    st.target = clamp(y, 0, maxOf(el));
    if (instant) {
      stopTween();
      st.cur = st.selfY = st.target;
      writeY(el, st.target);
      return;
    }
    kick();
  }

  // ==========================================================================
  // 3. 滚轮接管
  // ==========================================================================
  function wheelDelta(e) {
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16; // 行
    else if (e.deltaMode === 2) d *= window.innerHeight * 0.9; // 页
    return d;
  }

  // 事件是否落在「我们自己 UI 内部真正的滚动容器」里。Shadow DOM 会把 target 重定向成宿主，
  // 所以只能靠 composedPath 才看得见里面那一层，否则会误把面板内的滚动当成页面滚动。
  function inOurScroller(e) {
    if (!e.composedPath) return false;
    const path = e.composedPath();
    for (let i = 0; i < path.length; i++) {
      const n = path[i];
      if (!n || n.nodeType !== 1) continue;
      if (n === lhost || n === panelHost) return false;
      if (n.classList && n.classList.contains('su-scroll') && scrollableY(n)) return true;
    }
    return false;
  }

  function onWheel(e) {
    if (!cfg.enabled || e.defaultPrevented || e.ctrlKey || e.metaKey) return; // ctrl = 缩放
    if (e.altKey) return; // 按住 Alt 临时用原生滚动
    if (!e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // 横向滚动别管
    if (inOurScroller(e)) return; // 设置面板自己的滚动

    const root = pickRoot(e.target);
    const max = maxOf(root);
    if (max <= 1) return;
    if (nestedScroller(e.target, root)) return; // 正文内小滚动框：保留原生手感

    const vh = window.innerHeight;
    const dy = clamp(wheelDelta(e) * cfg.distScale, -vh * 1.2, vh * 1.2);
    if (!dy) return;

    e.preventDefault(); // 非 passive 才能生效
    st.root = root;
    if (!st.raf) {
      st.selfY = readY(root);
      st.cur = st.target = st.selfY;
      st.v = 0;
    }
    st.target = clamp(st.target + dy, 0, max);
    kick();
    decorKick();
  }

  // ==========================================================================
  // 4. 键盘 / 锚点 / 站点自身的 scrollTo
  // ==========================================================================
  const EDITABLE = /^(INPUT|TEXTAREA|SELECT|OPTION)$/;

  function isEditing(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.isContentEditable) return true;
    return EDITABLE.test(node.tagName);
  }

  function onKey(e) {
    if (!cfg.keys || !cfg.enabled || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditing(e.target) || isEditing(document.activeElement)) return;
    const el = curRoot();
    const vh = window.innerHeight;
    const k = cfg.distScale;
    let y = null;
    switch (e.key) {
      case 'PageDown':
        y = readY(el) + vh * 0.9 * k;
        break;
      case 'PageUp':
        y = readY(el) - vh * 0.9 * k;
        break;
      case ' ':
      case 'Spacebar':
        y = readY(el) + (e.shiftKey ? -1 : 1) * vh * 0.85 * k;
        break;
      case 'ArrowDown':
        y = readY(el) + 44 * k;
        break;
      case 'ArrowUp':
        y = readY(el) - 44 * k;
        break;
      case 'Home':
        y = 0;
        break;
      case 'End':
        y = maxOf(el);
        break;
      default:
        return;
    }
    e.preventDefault();
    scrollToY(y, el);
  }

  function onAnchors(e) {
    if (!cfg.anchors || !cfg.enabled) return;
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = curRoot();
    if (maxOf(el) <= 4) return;
    let a = e.target;
    while (a && a.nodeType === 1 && a.tagName !== 'A') a = a.parentElement;
    if (!a || !a.getAttribute) return;
    const href = a.getAttribute('href') || '';
    if (href.charAt(0) !== '#' || href.length < 2) return;
    if (a.target && a.target !== '_self') return;
    let id;
    try {
      id = decodeURIComponent(href.slice(1));
    } catch (err) {
      id = href.slice(1);
    }
    const dst = document.getElementById(id) || document.getElementsByName(id)[0];
    if (!dst) return;
    e.preventDefault();
    scrollToY(dst.getBoundingClientRect().top + readY(el) - 8, dst);
    try {
      history.pushState(null, '', href);
    } catch (err) {
      /* file:// 等受限场景忽略 */
    }
  }

  // 站点自己调 scrollTo / scrollTo({behavior:'smooth'}) 时，同样走我们的动画
  function hookScrollTo() {
    if (window.scrollTo.__scrollUnrollHooked) return;
    const hooked = function (a, b) {
      try {
        let y = null;
        if (a && typeof a === 'object') {
          if (a.behavior === 'smooth' && typeof a.top === 'number') y = a.top;
        } else if (typeof b === 'number') {
          y = b;
        }
        if (y !== null && maxOf(curRoot()) > 4) {
          scrollToY(y);
          return;
        }
      } catch (err) {
        /* 落到原生 */
      }
      return nativeScrollTo(a, b);
    };
    hooked.__scrollUnrollHooked = true;
    window.scrollTo = hooked;
  }

  // 用户拖动滚动条 / 触摸滑动 / 站点直接改 scrollTop 时，别跟它抢
  function onScroll(e) {
    const t = e.target;
    const el = !t || t === document || t === document.documentElement || t === document.body
      ? curRoot()
      : t;
    if (el !== curRoot()) return; // 内部滚动容器，忽略
    const y = readY(el);
    if (Math.abs(y - st.selfY) > 2 || !st.raf) {
      st.target = y;
      st.v = 0;
      st.selfY = y;
    }
    st.cur = y;
    decorKick();
  }

  // ==========================================================================
  // 5. 装饰层（Shadow DOM 隔离）
  // ==========================================================================
  let lhost = null;
  let lroot = null;
  const dom = {};
  let toastHost = null;
  let toastBox = null;
  let toastTimer = 0;

  const CSS = `
* { box-sizing: border-box; }
.wrap { position: fixed; inset: 0; pointer-events: none; font: 12px/1.4 system-ui, sans-serif; }
.edge, .core {
  position: absolute; left: 0; right: 0; will-change: transform, opacity;
}
.edge { height: 54px; opacity: 0; }
.edge.top { top: 0; background: linear-gradient(180deg, rgba(24, 18, 10, .55) 0%,
  rgba(24, 18, 10, .18) 42%, rgba(24, 18, 10, 0) 100%); }
.edge.bottom { bottom: 0; background: linear-gradient(0deg, rgba(24, 18, 10, .55) 0%,
  rgba(24, 18, 10, .18) 42%, rgba(24, 18, 10, 0) 100%); }
.coreWrap {
  position: absolute; top: 10vh; bottom: 10vh; right: 5px; width: 6px; opacity: 0;
  border-radius: 999px; background: rgba(20, 16, 10, .16);
  box-shadow: 0 0 0 1px rgba(255, 240, 205, .14) inset;
}
.core {
  top: 0; height: 0; border-radius: 999px;
  background: linear-gradient(180deg, #ffe7a1, #d9ab4c 55%, #a97f22);
  box-shadow: 0 0 8px rgba(255, 214, 130, .55);
}
.coreHead {
  position: absolute; left: -3px; right: -3px; top: 0; height: 10px; margin-top: -5px;
  border-radius: 50%; opacity: 0;
  background: radial-gradient(circle at 50% 40%, #fff6d6, #e6c071 60%, #9c7826);
  box-shadow: 0 0 10px rgba(255, 216, 130, .75);
}
/* ---- 缩略图（VSCode 风格）---- */
.mm {
  position: absolute; top: 0; right: 0; height: 100%; width: 88px; display: none;
  pointer-events: none; opacity: var(--mmo, .32); transition: opacity .18s ease;
  background: rgba(128, 120, 104, .07);
  border-left: 1px solid rgba(180, 150, 90, .22);
  box-shadow: -10px 0 22px rgba(0, 0, 0, .10);
  user-select: none;
}
.mm.hit { pointer-events: auto; cursor: pointer; touch-action: none; }
.mm.hot { opacity: 1; }
.mm canvas { display: block; width: 100%; height: 100%; }
.mmvp {
  position: absolute; left: 0; right: 0; top: 0; height: 0; pointer-events: none;
  background: rgba(255, 226, 150, .16);
  border-top: 1px solid rgba(255, 226, 150, .6);
  border-bottom: 1px solid rgba(255, 226, 150, .6);
  box-shadow: 0 0 12px rgba(255, 214, 130, .22) inset;
}
`;

  const MARKUP =
    '<div class="wrap">' +
    '<div class="edge top"></div><div class="edge bottom"></div>' +
    '<div class="coreWrap"><div class="core"></div><div class="coreHead"></div></div>' +
    '<div class="mm"><canvas></canvas><div class="mmvp"></div></div>' +
    '</div>';

  // 插入的 MARKUP 是本文件里写死的常量字符串，不含任何外部输入；
  // 而且落在 Shadow DOM 内，与页面 CSS / DOM 完全隔离（无 XSS、无样式泄漏）。
  function appendMarkup(root, markup) {
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    while (holder.firstChild) root.appendChild(holder.firstChild);
  }

  function buildLayer() {
    if (lhost || !document.body || !document.documentElement.attachShadow) return;
    lhost = document.createElement('div');
    lhost.id = HOST_ID;
    lhost.style.cssText =
      'position:fixed!important;inset:0!important;width:auto!important;height:auto!important;' +
      'margin:0!important;padding:0!important;border:0!important;background:none!important;' +
      'z-index:2147483645!important;pointer-events:none!important;display:block!important;';
    lroot = lhost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    lroot.appendChild(style);
    appendMarkup(lroot, MARKUP);
    const q = (sel) => lroot.querySelector(sel);
    dom.edgeTop = q('.edge.top');
    dom.edgeBottom = q('.edge.bottom');
    dom.coreWrap = q('.coreWrap');
    dom.core = q('.core');
    dom.coreHead = q('.coreHead');
    dom.mm = q('.mm');
    dom.mmCanvas = q('.mm canvas');
    dom.mmVp = q('.mmvp');
    document.documentElement.appendChild(lhost);
    buildMinimap();
  }

  const dc = { y: null, v: 0, t: 0, raf: 0 };

  function decorKick() {
    if (!anyDecorOn()) return;
    if (!lhost) buildLayer();
    if (!dom.edgeTop || dc.raf) return;
    dc.t = 0;
    dc.raf = requestAnimationFrame(decorTick);
  }

  function decorTick(t) {
    const el = curRoot();
    const y = readY(el);
    const max = maxOf(el);
    const dt = clamp(dc.t ? (t - dc.t) / 1000 : 1 / 60, 1 / 240, 0.1);
    dc.t = t;

    if (dc.y === null) dc.y = y;
    const inst = clamp((y - dc.y) / Math.max(dt, 1 / 240), -8000, 8000);
    dc.y = y;
    // 速度平滑：起步快、收手后慢（阴影自然淡出）
    const tau = Math.abs(inst) > Math.abs(dc.v) ? 0.04 : 0.13;
    dc.v += (inst - dc.v) * (1 - Math.exp(-dt / tau));

    applyDecor(y, max, dc.v);

    if (Math.abs(dc.v) < 6) {
      dc.v = 0;
      applyDecor(y, max, 0);
      dc.raf = 0;
      dc.t = 0;
      return;
    }
    dc.raf = requestAnimationFrame(decorTick);
  }

  function applyDecor(y, max, v) {
    if (!dom.edgeTop) return;
    const ui = cfg.ui;
    const vh = window.innerHeight || 1;
    const k = clamp(Math.abs(v) / 2200, 0, 1);
    const down = v >= 0;
    const scrollable = max > vh * 0.4;

    // 出纸阴影：滚动方向的前沿更重（像纸从轴下被卷出来）
    const nearTop = y > 4 ? 1 : 0.35;
    const nearBot = max - y > 4 ? 1 : 0.35;
    const eTop = scrollable && ui.shadows ? k * (down ? 1 : 0.45) * nearTop : 0;
    const eBot = scrollable && ui.shadows ? k * (down ? 0.45 : 1) * nearBot : 0;
    dom.edgeTop.style.opacity = eTop;
    dom.edgeBottom.style.opacity = eBot;
    dom.edgeTop.style.height = 30 + 44 * eTop + 'px';
    dom.edgeBottom.style.height = 30 + 44 * eBot + 'px';

    // 卷芯进度：滚动时浮现、停下淡出；缩略图开着就让位（信息重复）
    const mmOn = !!(ui.minimap && dom.mm && dom.mm.style.display !== 'none');
    const showCore = scrollable && ui.core && !mmOn ? clamp(k * 2.2, 0, 1) : 0;
    const pct = max > 0 ? clamp(y / max, 0, 1) : 0;
    dom.coreWrap.style.opacity = showCore;
    dom.core.style.height = (pct * 100).toFixed(2) + '%';
    dom.coreHead.style.opacity = showCore * clamp(k * 1.6, 0, 1);
    dom.coreHead.style.top = (pct * 100).toFixed(2) + '%';

    updateMinimapVp(y);
  }

  // ==========================================================================
  // 6. 缩略图：右侧一栏按比例重绘的页面骨架（背景色块 + 图片 + 真实文字行盒）
  // ==========================================================================
  const mm = {
    scale: 1, total: 1, painted: 0, dragging: false, timer: 0, lastRender: 0, ctx: null,
    hiddenUntil: 0, restoreTimer: 0, // 双击右键临时隐藏用
  };
  const MM_SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK|TITLE|OPTION)$/;
  const MM_BOX = /^(IMG|VIDEO|CANVAS|IFRAME|HR)$/;

  // 双击右键临时隐藏：缩略图挡住右侧内容时，连按两下右键收起，到时自动回来。
  // 状态走时间戳而不是只靠 setTimeout —— 后台标签页的定时器会被节流，时间戳不会骗人。
  function mmSuspended() {
    return performance.now() < mm.hiddenUntil;
  }

  function mmHideTemporarily(sec) {
    const s = clamp(Number(sec) || 20, 3, 600);
    mm.hiddenUntil = performance.now() + s * 1000;
    clearTimeout(mm.restoreTimer);
    applyMinimap();
    mm.restoreTimer = setTimeout(() => {
      mm.hiddenUntil = 0;
      applyMinimap();
    }, s * 1000);
  }

  function mmUsable() {
    return (
      !!cfg.ui.minimap &&
      !!dom.mm &&
      !mmSuspended() &&
      window.innerWidth >= 720 &&
      maxOf(curRoot()) > window.innerHeight * 0.5
    );
  }

  // ---- 双击右键：缩略图范围内连按两下右键 → 暂隐。
  // Windows 上 contextmenu 是右键「松开」时才弹的，不抑制它的话第一次右键就弹出系统菜单，
  // 第二次点击落在菜单上 —— 双击根本不可能成立。所以这个范围内（我们自己的 UI）右键一律不
  // 走系统菜单，换取可靠的双击识别；手势关掉 / 缩略图隐藏时恢复原样。
  const mmPress = { t: 0, x: 0, y: 0, armed: false };
  const MM_DBL_MS = 400;
  const MM_DBL_SLOP = 10;

  function inMinimap(x, y) {
    if (!dom.mm || dom.mm.style.display === 'none') return false;
    const r = dom.mm.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function onMmPress(e) {
    if (e.button !== 2 || !cfg.ui.minimapDoubleClick) return;
    if (mmSuspended() || !mmUsable() || !inMinimap(e.clientX, e.clientY)) return;
    const now = performance.now();
    const dbl =
      mmPress.armed &&
      now - mmPress.t <= MM_DBL_MS &&
      Math.abs(e.clientX - mmPress.x) <= MM_DBL_SLOP &&
      Math.abs(e.clientY - mmPress.y) <= MM_DBL_SLOP;
    if (dbl) {
      mmPress.armed = false;
      mmHideTemporarily(cfg.ui.minimapHideSeconds);
      flash(
        '缩略图已收起 ' + clamp(Number(cfg.ui.minimapHideSeconds) || 20, 3, 600) + 's（到时自动回来）'
      );
      return;
    }
    mmPress.armed = true;
    mmPress.t = now;
    mmPress.x = e.clientX;
    mmPress.y = e.clientY;
  }

  function onMmContext(e) {
    if (!cfg.ui.minimapDoubleClick) return;
    if (mmSuspended() || !mmUsable() || !inMinimap(e.clientX, e.clientY)) return;
    // 自己的 UI 区域，右键菜单一律不走系统；把手势关掉就能恢复
    e.preventDefault();
    e.stopPropagation();
  }

  function buildMinimap() {
    if (!dom.mm || dom.mm.__bound) return;
    dom.mm.__bound = true;
    mm.ctx = dom.mmCanvas.getContext('2d');
    dom.mm.addEventListener('pointerdown', mmDown);
    dom.mm.addEventListener('pointermove', mmMove);
    dom.mm.addEventListener('pointerup', mmUp);
    dom.mm.addEventListener('pointercancel', mmUp);
    dom.mm.addEventListener('mouseenter', () => dom.mm.classList.add('hot'));
    dom.mm.addEventListener('mouseleave', () => dom.mm.classList.remove('hot'));
  }

  function mmSeek(clientY) {
    const r = dom.mm.getBoundingClientRect();
    const root = curRoot();
    const sp = (r.height || 1) / Math.max(1, root.scrollHeight);
    const vh = root.clientHeight || window.innerHeight;
    scrollToY((clientY - r.top) / sp - vh / 2, null, true);
  }

  function mmDown(e) {
    if (!cfg.ui.minimapInteractive || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    mm.dragging = true;
    try {
      dom.mm.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 忽略 */
    }
    mmSeek(e.clientY);
  }

  function mmMove(e) {
    if (!mm.dragging) return;
    e.preventDefault();
    mmSeek(e.clientY);
  }

  function mmUp(e) {
    mm.dragging = false;
    try {
      dom.mm.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* 忽略 */
    }
  }

  // 排队重绘：已排队就不再推后（否则页面上任何「每帧都在变」的元素——计时器、进度条、
  // 我们自己的读数面板——都会让防抖永远等不到头，缩略图永远画不出来）。
  // 非强制路径还加了个最小重绘间隔，免得变动风暴里反复重描。
  function scheduleMinimap(delay, force) {
    if (!cfg.ui.minimap) return;
    if (mm.timer && !force) return;
    if (mm.timer) clearTimeout(mm.timer);
    let d = delay === undefined ? 300 : delay;
    if (!force) d = Math.max(d, 1200 - (performance.now() - mm.lastRender));
    mm.timer = setTimeout(() => {
      mm.timer = 0;
      mm.lastRender = performance.now();
      try {
        renderMinimap();
      } catch (e) {
        /* 渲染失败不影响滚动主功能 */
      }
    }, d);
  }

  function updateMinimapVp(y) {
    if (!dom.mm || dom.mm.style.display === 'none') return;
    const root = curRoot();
    const total = Math.max(1, root.scrollHeight);
    const vh = root.clientHeight || window.innerHeight;
    const h = dom.mm.clientHeight || window.innerHeight;
    const sp = h / total;
    dom.mmVp.style.top = (y * sp).toFixed(2) + 'px';
    dom.mmVp.style.height = Math.max(6, vh * sp).toFixed(2) + 'px';
  }

  function renderMinimap() {
    if (!dom.mm || !mm.ctx) return;
    if (!mmUsable()) {
      dom.mm.style.display = 'none';
      return;
    }
    const root = curRoot();
    const walkRoot = isWinScroll(root) ? document.body : root;
    if (!walkRoot) return;
    const total = Math.max(1, root.scrollHeight);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = clamp(Math.round(cfg.ui.minimapWidth), 48, 200);
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    dom.mm.style.display = 'block';
    dom.mm.style.width = w + 'px';
    dom.mm.style.setProperty('--mmo', String(clamp(cfg.ui.minimapOpacity, 0.1, 1)));
    dom.mm.classList.toggle('hit', !!cfg.ui.minimapInteractive);

    const cw = Math.round(w * dpr);
    const ch = Math.round(vh * dpr);
    if (dom.mmCanvas.width !== cw || dom.mmCanvas.height !== ch) {
      dom.mmCanvas.width = cw;
      dom.mmCanvas.height = ch;
    }
    const ctx = mm.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, vh);

    const sx = w / Math.max(1, vw);
    const sy = vh / total;
    mm.scale = sy;
    mm.total = total;

    const rootRect = isWinScroll(root) ? { left: 0, top: 0 } : root.getBoundingClientRect();
    const originY = isWinScroll(root) ? window.pageYOffset : root.scrollTop - rootRect.top;
    const originX = -rootRect.left;
    const t0 = performance.now();
    let painted = 0;

    // 1) 先铺底：背景色块 / 图片 / 分割线
    const SHOW_ELEMENT = 1;
    const ew = document.createTreeWalker(walkRoot, SHOW_ELEMENT, null);
    let e = ew.nextNode();
    let n = 0;
    while (e && n < 3500 && performance.now() - t0 < 180) {
      n++;
      const cur = e;
      e = ew.nextNode();
      if (cur.id === HOST_ID || MM_SKIP.test(cur.tagName)) continue;
      const r = cur.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(cur);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const isBox = MM_BOX.test(cur.tagName);
      const bg = cs.backgroundColor;
      const hasBg = !!bg && bg.indexOf('rgba(0, 0, 0, 0)') !== 0 && bg !== 'transparent';
      if (!isBox && !hasBg) continue;
      // 整页级的大色块（body 背景那类）画出来只会糊住整条缩略图
      if (!isBox && r.height >= total * 0.75 && r.width >= vw * 0.5) continue;
      const y = (r.top + originY) * sy;
      const h = Math.max(0.8, r.height * sy);
      if (y + h < 0 || y > vh) continue;
      const x = (r.left + originX) * sx;
      const ww = Math.max(0.8, r.width * sx);
      if (cur.tagName === 'HR') {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = cs.color || '#888';
        ctx.fillRect(0, y, w, 1);
      } else if (isBox) {
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = '#8a8375';
        ctx.fillRect(x, y, ww, h);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#6f695e';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 0.25, y + 0.25, Math.max(0.5, ww - 0.5), Math.max(0.5, h - 0.5));
      } else {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, ww, h);
      }
      painted++;
    }

    // 2) 文字行：range.getClientRects() 拿到真实行盒，才有「VSCode 缩略图」的味道
    const SHOW_TEXT = 4;
    const tw = document.createTreeWalker(walkRoot, SHOW_TEXT, {
      acceptNode(node) {
        const v = node.nodeValue;
        if (!v || !v.trim()) return 2; // REJECT
        const p = node.parentElement;
        if (!p) return 2;
        if (p.namespaceURI !== 'http://www.w3.org/1999/xhtml') return 2; // SVG 等
        if (p.id === HOST_ID || (p.closest && p.closest('#' + HOST_ID))) return 2;
        if (MM_SKIP.test(p.tagName)) return 2;
        return 1; // ACCEPT
      },
    });
    const range = document.createRange();
    let t = tw.nextNode();
    let m = 0;
    let rects = 0;
    while (t && m < 4000 && rects < 24000 && performance.now() - t0 < 320) {
      m++;
      const node = t;
      t = tw.nextNode();
      const p = node.parentElement;
      if (!p) continue;
      const cs = getComputedStyle(p);
      const weight = cs.fontWeight === 'bold' || parseInt(cs.fontWeight, 10) >= 600;
      range.selectNodeContents(node);
      const list = range.getClientRects();
      ctx.fillStyle = cs.color || '#333';
      ctx.globalAlpha = weight ? 0.85 : 0.55;
      const hMul = weight ? 0.8 : 0.6;
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        rects++;
        if (r.height < 2 || r.width < 1) continue;
        const y = (r.top + originY) * sy;
        if (y < -4 || y > vh + 4) continue;
        ctx.fillRect(
          (r.left + originX) * sx,
          y,
          Math.max(0.8, r.width * sx),
          Math.max(0.7, r.height * sy * hMul)
        );
        painted++;
      }
    }
    ctx.globalAlpha = 1;
    mm.painted = painted;
    updateMinimapVp(readY(root));
  }

  // DOM 变了 → 重新描一遍（节流，且我们自己写在 html 上的层不在 body 里，不会自激）
  function watchMinimap() {
    if (mm.obs || !document.body || typeof MutationObserver !== 'function') return;
    mm.obs = new MutationObserver(() => {
      if (cfg.ui.minimap) scheduleMinimap(700);
    });
    mm.obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function applyMinimap() {
    if (!lhost || !dom.mm) return;
    buildMinimap();
    const ok = mmUsable();
    dom.mm.style.display = ok ? 'block' : 'none';
    if (ok) {
      dom.mm.style.width = clamp(Math.round(cfg.ui.minimapWidth), 48, 200) + 'px';
      dom.mm.style.setProperty('--mmo', String(clamp(cfg.ui.minimapOpacity, 0.1, 1)));
      dom.mm.classList.toggle('hit', !!cfg.ui.minimapInteractive);
      scheduleMinimap(60, true);
    }
    updateMinimapVp(readY(curRoot()));
  }

  // ==========================================================================
  // 7. 提示气泡（自带 shadow，装饰层关掉也能提示）
  // ==========================================================================
  function flash(msg) {
    if (!document.body || !document.documentElement.attachShadow) return;
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.style.cssText =
        'position:fixed!important;left:50%!important;bottom:28px!important;' +
        'transform:translateX(-50%)!important;z-index:2147483647!important;' +
        'pointer-events:none!important;';
      const root = toastHost.attachShadow({ mode: 'open' });
      const s = document.createElement('style');
      s.textContent =
        '.t{background:rgba(28,22,14,.92);color:#f6e7c4;border:1px solid rgba(224,189,102,.5);' +
        'border-radius:10px;padding:9px 14px;font:13px/1.5 system-ui,sans-serif;' +
        'box-shadow:0 8px 26px rgba(0,0,0,.35);opacity:0;' +
        'transition:opacity .22s ease,transform .22s ease;transform:translateY(6px);}' +
        '.t.on{opacity:1;transform:translateY(0)}';
      root.appendChild(s);
      toastBox = document.createElement('div');
      toastBox.className = 't';
      root.appendChild(toastBox);
      document.documentElement.appendChild(toastHost);
    }
    toastBox.textContent = msg;
    toastBox.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastBox.classList.remove('on'), 2000);
  }

  // ==========================================================================
  // 8. 站内设置面板（ScriptCat 用扩展控制面板；TM / VM 用户就地在这里配）
  // ==========================================================================
  let panelHost = null;
  let panelRoot = null;
  let panelBody = null;

  const PANEL = [
    {
      group: '滚动',
      items: [
        { path: 'enabled', label: '平滑滚动总开关', hint: '关掉后完全交还原生滚动', type: 'bool' },
        { path: 'keys', label: '接管键盘翻页键', hint: '空格 / PgUp / PgDn / 方向键 / Home / End', type: 'bool' },
        { path: 'anchors', label: '锚点跳转动画', hint: '点页内 #锚点 时也走展卷', type: 'bool' },
        { path: 'smoothTime', label: '顺滑度', hint: '阻尼时间越大越绵长', type: 'select', values: [0.2, 0.34, 0.52, 0.8], fmt: (v) => v + 's' },
        { path: 'distScale', label: '滚动距离倍率', hint: '', type: 'select', values: [0.6, 1, 1.4, 2], fmt: (v) => v + '×' },
      ],
    },
    {
      group: '装饰层',
      items: [
        { path: 'ui.shadows', label: '出纸阴影', hint: '滚动前沿的暗边，强度随速度变化', type: 'bool' },
        { path: 'ui.core', label: '卷芯进度条', hint: '缩略图开启时自动让位', type: 'bool' },
      ],
    },
    {
      group: '缩略图 · VSCode 风格',
      items: [
        { path: 'ui.minimap', label: '显示缩略图', hint: '窄屏（<720px）自动隐藏', type: 'bool' },
        { path: 'ui.minimapInteractive', label: '可点击 / 拖动跳转', hint: '关掉则纯展示、不遮挡右侧点选', type: 'bool' },
        { path: 'ui.minimapWidth', label: '宽度', hint: '', type: 'range', min: 48, max: 200, step: 4, unit: 'px' },
        { path: 'ui.minimapOpacity', label: '静息不透明度', hint: '鼠标移上去变 1', type: 'range', min: 0.1, max: 1, step: 0.02 },
        { path: 'ui.minimapDoubleClick', label: '双击右键暂时隐藏', hint: '在缩略图上连按两下右键（该区域不弹系统菜单）', type: 'bool' },
        { path: 'ui.minimapHideSeconds', label: '隐藏时长', hint: '到时自动恢复', type: 'range', min: 5, max: 120, step: 5, unit: 's' },
      ],
    },
    {
      group: '本站',
      items: [
        { path: 'siteOff', label: '站点黑名单', hint: '每行一个域名，命中则整站不接管', type: 'lines' },
      ],
    },
  ];

  const PANEL_CSS = `
* { box-sizing: border-box; }
.back { position: absolute; inset: 0; background: rgba(0, 0, 0, .38); }
.card {
  position: relative; width: min(430px, 94vw); max-height: 80vh; display: flex; flex-direction: column;
  background: #1d1811; color: #f3e6c8; border: 1px solid rgba(224, 189, 102, .45);
  border-radius: 14px; box-shadow: 0 24px 60px rgba(0, 0, 0, .5);
  font: 13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  overflow: hidden;
}
.hd {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px;
  border-bottom: 1px solid rgba(224, 189, 102, .25);
  background: linear-gradient(180deg, rgba(255, 224, 150, .10), rgba(255, 224, 150, 0));
}
.hd b { font-size: 14px; letter-spacing: .06em; color: #ffd98a; font-weight: 600; flex: 1; }
.hd .v { font-size: 11px; color: #a2916c; }
.hd button {
  background: none; border: 1px solid rgba(224, 189, 102, .4); color: #f3e6c8;
  border-radius: 8px; padding: 2px 10px; cursor: pointer; font-size: 13px;
}
.body { overflow-y: auto; padding: 6px 16px 12px; }
.g { margin: 14px 0 4px; font-size: 12px; letter-spacing: .1em; color: #ffd98a; opacity: .92; }
.row { display: flex; align-items: center; gap: 12px; padding: 5px 0; }
.row .txt { flex: 1; min-width: 0; }
.row .lbl { font-size: 13px; }
.row .hint { font-size: 11.5px; color: #a2916c; }
.row input[type="checkbox"] { width: 17px; height: 17px; accent-color: #d9ab4c; cursor: pointer; }
.row select {
  background: #2a2317; color: #f3e6c8; border: 1px solid rgba(224, 189, 102, .35);
  border-radius: 7px; padding: 3px 6px; font: 12.5px system-ui, sans-serif;
}
.row input[type="range"] { width: 130px; accent-color: #d9ab4c; }
.row .val { width: 44px; text-align: right; font-size: 12px; color: #d8c9a5; }
.area {
  width: 100%; height: 62px; resize: vertical; margin-top: 4px;
  background: #2a2317; color: #f3e6c8; border: 1px solid rgba(224, 189, 102, .35);
  border-radius: 8px; padding: 6px 8px; font: 12px/1.5 ui-monospace, Consolas, monospace;
}
.ft {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 10px 16px; border-top: 1px solid rgba(224, 189, 102, .25);
  font-size: 11.5px; color: #a2916c;
}
.ft button {
  background: rgba(255, 240, 205, .09); border: 1px solid rgba(224, 189, 102, .45);
  color: #f6e7c4; border-radius: 8px; padding: 5px 12px; cursor: pointer; font-size: 12.5px;
}
.ft button:hover { background: rgba(255, 240, 205, .2); }
`;

  function panelShown() {
    return !!panelHost && panelHost.style.display !== 'none';
  }

  function buildRow(it) {
    const row = document.createElement('div');
    row.className = 'row';
    if (it.type === 'lines') {
      row.style.flexDirection = 'column';
      row.style.alignItems = 'stretch';
    }
    const txt = document.createElement('div');
    txt.className = 'txt';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = it.label;
    txt.appendChild(lbl);
    if (it.hint) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = it.hint;
      txt.appendChild(h);
    }
    row.appendChild(txt);

    let ctl;
    if (it.type === 'bool') {
      ctl = document.createElement('input');
      ctl.type = 'checkbox';
      ctl.addEventListener('change', () => setVal(it.path, ctl.checked));
    } else if (it.type === 'select') {
      ctl = document.createElement('select');
      it.values.forEach((v) => {
        const o = document.createElement('option');
        o.value = String(v);
        o.textContent = it.fmt ? it.fmt(v) : String(v);
        ctl.appendChild(o);
      });
      ctl.addEventListener('change', () => setVal(it.path, Number(ctl.value)));
    } else if (it.type === 'range') {
      ctl = document.createElement('input');
      ctl.type = 'range';
      ctl.min = String(it.min);
      ctl.max = String(it.max);
      ctl.step = String(it.step || 1);
      const out = document.createElement('span');
      out.className = 'val';
      const show = () => {
        out.textContent = String(getPath(cfg, it.path)) + (it.unit ? ' ' + it.unit : '');
      };
      ctl.addEventListener('input', () => {
        setVal(it.path, Number(ctl.value));
        show();
      });
      ctl.dataset.path = it.path;
      row.appendChild(ctl);
      row.appendChild(out);
      row.__range = { ctl: ctl, show: show };
      return row;
    } else if (it.type === 'lines') {
      ctl = document.createElement('textarea');
      ctl.className = 'area su-scroll';
      ctl.addEventListener('change', () => setVal(it.path, ctl.value));
    }
    ctl.dataset.path = it.path;
    row.appendChild(ctl);
    return row;
  }

  function buildPanel() {
    if (panelHost || !document.documentElement.attachShadow) return;
    panelHost = document.createElement('div');
    panelHost.id = PANEL_ID;
    panelHost.style.cssText =
      'position:fixed!important;inset:0!important;z-index:2147483647!important;' +
      'display:none!important;align-items:center!important;justify-content:center!important;';
    panelRoot = panelHost.attachShadow({ mode: 'open' });
    const s = document.createElement('style');
    s.textContent = PANEL_CSS;
    panelRoot.appendChild(s);

    const back = document.createElement('div');
    back.className = 'back';
    back.addEventListener('click', () => closePanel());

    const card = document.createElement('div');
    card.className = 'card';

    const hd = document.createElement('div');
    hd.className = 'hd';
    const ttl = document.createElement('b');
    ttl.textContent = '卷轴滚动 · 设置';
    const ver = document.createElement('span');
    ver.className = 'v';
    ver.textContent = 'v' + VERSION;
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.addEventListener('click', () => closePanel());
    hd.appendChild(ttl);
    hd.appendChild(ver);
    hd.appendChild(close);

    panelBody = document.createElement('div');
    panelBody.className = 'body su-scroll';

    PANEL.forEach((g) => {
      const gh = document.createElement('div');
      gh.className = 'g';
      gh.textContent = g.group;
      panelBody.appendChild(gh);
      g.items.forEach((it) => panelBody.appendChild(buildRow(it)));
    });

    const ft = document.createElement('div');
    ft.className = 'ft';
    const tip = document.createElement('span');
    tip.textContent = 'ScriptCat 也可在扩展控制面板里配置同一批开关';
    const reset = document.createElement('button');
    reset.textContent = '恢复默认';
    reset.addEventListener('click', () => {
      resetAll();
      flash('已恢复默认设置');
    });
    ft.appendChild(tip);
    ft.appendChild(reset);

    card.appendChild(hd);
    card.appendChild(panelBody);
    card.appendChild(ft);
    panelRoot.appendChild(back);
    panelRoot.appendChild(card);
    document.documentElement.appendChild(panelHost);
    syncPanel();
  }

  // 把面板控件刷成当前配置（打开面板 / 恢复默认后调用）
  function syncPanel() {
    if (!panelBody) return;
    Array.prototype.forEach.call(panelBody.querySelectorAll('[data-path]'), (ctl) => {
      const v = getPath(cfg, ctl.dataset.path);
      if (ctl.type === 'checkbox') ctl.checked = !!v;
      else if (ctl.tagName === 'SELECT') ctl.value = String(v);
      else if (ctl.type === 'range') ctl.value = String(v);
      else ctl.value = Array.isArray(v) ? v.join('\n') : String(v);
    });
    Array.prototype.forEach.call(panelBody.querySelectorAll('.row'), (row) => {
      if (row.__range) row.__range.show();
    });
  }

  function openPanel() {
    buildPanel();
    if (!panelHost) {
      flash('本浏览器不支持 Shadow DOM，设置面板不可用');
      return;
    }
    panelHost.style.display = 'flex';
    syncPanel();
  }

  function closePanel() {
    if (panelHost) panelHost.style.display = 'none';
  }

  function resetAll() {
    SPEC.forEach((sp) => {
      if (sp[0].indexOf('internal.') === 0) return;
      setPath(cfg, sp[1], sp[2]);
      rawSet(sp[0], sp[2]);
    });
    applyRuntime();
    syncPanel();
  }

  function onPanelKey(e) {
    if (e.key === 'Escape' && panelShown()) {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
    }
  }

  // ==========================================================================
  // 9. 开关 / 菜单 / 快捷键
  // ==========================================================================
  let resetStyle = null;

  function lockScrollBehavior() {
    // 页面自己的 scroll-behavior:smooth 会和逐帧写入打架（每帧都被浏览器再动画化）
    if (resetStyle || !document.head) return;
    resetStyle = document.createElement('style');
    resetStyle.textContent = 'html,body{scroll-behavior:auto !important}';
    document.head.appendChild(resetStyle);
  }

  function unlockScrollBehavior() {
    if (resetStyle && resetStyle.parentNode) resetStyle.parentNode.removeChild(resetStyle);
    resetStyle = null;
  }

  function anyDecorOn() {
    const ui = cfg.ui;
    return !!(ui.shadows || ui.core || ui.minimap);
  }

  // 配置变化后统一收口：滚动接管、装饰层显隐、缩略图刷新
  function applyRuntime() {
    if (cfg.enabled) {
      lockScrollBehavior();
      hookScrollTo();
      if (!st.raf) {
        st.root = pickRoot(document.body);
        st.selfY = readY(st.root);
        st.cur = st.target = st.selfY;
        st.v = 0;
      }
    } else {
      stopTween();
      unlockScrollBehavior();
    }
    if (anyDecorOn()) {
      if (!lhost) buildLayer();
      if (lhost) lhost.style.display = 'block';
      watchMinimap();
      applyMinimap();
      dc.y = null;
      decorKick();
    } else if (lhost) {
      if (dc.raf) cancelAnimationFrame(dc.raf);
      dc.raf = 0;
      lhost.style.display = 'none';
    }
    updateMinimapVp(readY(curRoot()));
  }

  function setEnabled(on, quiet) {
    setVal('enabled', !!on);
    if (!quiet) flash(cfg.enabled ? '卷轴滚动：开 ✦' : '卷轴滚动：关（原生滚动）');
  }

  function toggleSite() {
    const h = myHost;
    const i = cfg.siteOff.indexOf(h);
    const list = cfg.siteOff.slice();
    if (i >= 0) list.splice(i, 1);
    else list.push(h);
    setVal('siteOff', list);
    syncPanel();
    flash(i >= 0 ? '已移出黑名单：' + h : '已加入黑名单（刷新生效）：' + h);
  }

  function cycle(list, path, label, fmt) {
    const i = list.indexOf(getPath(cfg, path));
    const next = list[(i + 1) % list.length];
    setVal(path, next);
    stopTween();
    st.selfY = readY(curRoot());
    st.cur = st.target = st.selfY;
    syncPanel();
    flash(label + '：' + (fmt ? fmt(next) : next));
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    const m = (name, fn) => {
      try {
        GM_registerMenuCommand(name, fn, { id: name });
      } catch (e) {
        try {
          GM_registerMenuCommand(name, fn);
        } catch (e2) {
          /* 忽略 */
        }
      }
    };
    m('⚙ 设置面板（Alt+O）', () => openPanel());
    m('平滑滚动：开 / 关（Alt+S）', () => setEnabled(!cfg.enabled));
    m('缩略图：开 / 关（Alt+M）', () => {
      setVal('ui.minimap', !cfg.ui.minimap);
      syncPanel();
      flash('缩略图：' + (cfg.ui.minimap ? '开' : '关'));
    });
    m('缩略图 · 可点击拖动：开 / 关', () => {
      setVal('ui.minimapInteractive', !cfg.ui.minimapInteractive);
      syncPanel();
      flash('缩略图交互：' + (cfg.ui.minimapInteractive ? '开' : '关'));
    });
    m('缩略图 · 双击右键暂隐：开 / 关', () => {
      setVal('ui.minimapDoubleClick', !cfg.ui.minimapDoubleClick);
      syncPanel();
      flash('双击右键暂隐：' + (cfg.ui.minimapDoubleClick ? '开' : '关'));
    });
    m('装饰 · 出纸阴影：开 / 关', () => {
      setVal('ui.shadows', !cfg.ui.shadows);
      syncPanel();
      flash('出纸阴影：' + (cfg.ui.shadows ? '开' : '关'));
    });
    m('装饰 · 卷芯进度：开 / 关', () => {
      setVal('ui.core', !cfg.ui.core);
      syncPanel();
      flash('卷芯进度：' + (cfg.ui.core ? '开' : '关'));
    });
    m('顺滑度 +（0.20 / 0.34 / 0.52 / 0.80s 循环）', () =>
      cycle([0.2, 0.34, 0.52, 0.8], 'smoothTime', '顺滑度', (v) => v + 's')
    );
    m('滚动距离 ×（0.6 / 1 / 1.4 / 2 循环）', () =>
      cycle([0.6, 1, 1.4, 2], 'distScale', '滚动距离', (v) => v + '×')
    );
    m('键盘接管：开 / 关', () => {
      setVal('keys', !cfg.keys);
      syncPanel();
      flash('键盘接管：' + (cfg.keys ? '开' : '关'));
    });
    m('锚点跳转动画：开 / 关', () => {
      setVal('anchors', !cfg.anchors);
      syncPanel();
      flash('锚点跳转动画：' + (cfg.anchors ? '开' : '关'));
    });
    m('本页开关（加入 / 移出黑名单）', toggleSite);
    m('重置全部设置', () => {
      resetAll();
      flash('已恢复默认设置');
    });
  }

  function onHotkey(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const k = (e.key || '').toLowerCase();
    if (k === 's') {
      e.preventDefault();
      e.stopPropagation();
      setEnabled(!cfg.enabled);
    } else if (k === 'm') {
      e.preventDefault();
      e.stopPropagation();
      setVal('ui.minimap', !cfg.ui.minimap);
      syncPanel();
      flash('缩略图：' + (cfg.ui.minimap ? '开' : '关'));
    } else if (k === 'o' || k === ',') {
      e.preventDefault();
      e.stopPropagation();
      if (panelShown()) closePanel();
      else openPanel();
    }
  }

  // ==========================================================================
  // 10. 启动
  // ==========================================================================
  function start() {
    if (!document.body) return;
    if (anyDecorOn()) buildLayer();
    applyRuntime();
    registerMenu();
    watchMinimap();
    if (cfg.ui.minimap) scheduleMinimap(400, true);
    if (!cfg.seen) {
      setVal('seen', true);
      flash('卷轴滚动已启用 · Alt+S 开关 · Alt+M 缩略图 · Alt+O 设置 · 按住 Alt 滚轮 = 原生');
    }
  }

  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('keydown', onKey, { passive: false, capture: true });
  window.addEventListener('click', onAnchors, { passive: false, capture: true });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('keydown', onHotkey, { passive: false, capture: true });
  window.addEventListener('keydown', onPanelKey, { passive: false, capture: true });
  // 双击右键暂隐缩略图。capture 是为了先于缩略图自己的 pointerdown 拿到事件，
  // 并且缩略图关掉交互（pointer-events:none）时也能收到 —— 那时点不中它，但手势仍该可用。
  window.addEventListener('pointerdown', onMmPress, { passive: true, capture: true });
  window.addEventListener('contextmenu', onMmContext, { passive: false, capture: true });
  window.addEventListener(
    'resize',
    () => {
      dc.y = null;
      decorKick();
      scheduleMinimap(200);
    },
    { passive: true }
  );
  window.addEventListener(
    'load',
    () => {
      decorKick();
      scheduleMinimap(300);
    },
    { passive: true }
  );

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // 本地测试 / 调试用（test/scroll-demo.html 与验证脚本依赖它）
  window.__scrollUnroll = {
    version: VERSION,
    cfg: cfg,
    spec: SPEC,
    setVal: setVal,
    setEnabled: setEnabled,
    reset: resetAll,
    panel: (on) => (on === false ? closePanel() : openPanel()),
    panelOpen: () => panelShown(),
    to: (y) => scrollToY(y),
    toTop: () => scrollToY(0),
    toEnd: () => scrollToY(maxOf(curRoot())),
    flash: flash,
    state: () => {
      const el = curRoot();
      return {
        y: readY(el),
        target: st.target,
        cur: st.cur,
        v: st.v,
        running: !!st.raf,
        max: maxOf(el),
        root: el === document.documentElement ? 'html' : el.tagName.toLowerCase(),
      };
    },
    layer: () => ({
      built: !!lhost,
      shadow: !!(lhost && lhost.shadowRoot),
      shadowTop: dom.edgeTop ? dom.edgeTop.style.opacity : null,
      shadowBottom: dom.edgeBottom ? dom.edgeBottom.style.opacity : null,
      coreHeight: dom.core ? dom.core.style.height : null,
    }),
    minimap: () => ({
      display: dom.mm ? dom.mm.style.display : null,
      width: dom.mm ? dom.mm.style.width : null,
      hit: dom.mm ? dom.mm.classList.contains('hit') : null,
      hot: dom.mm ? dom.mm.classList.contains('hot') : null,
      canvasW: dom.mmCanvas ? dom.mmCanvas.width : 0,
      canvasH: dom.mmCanvas ? dom.mmCanvas.height : 0,
      painted: mm.painted,
      total: mm.total,
      vpTop: dom.mmVp ? dom.mmVp.style.top : null,
      vpH: dom.mmVp ? dom.mmVp.style.height : null,
      suspended: mmSuspended(),
      hiddenLeftMs: Math.max(0, Math.round(mm.hiddenUntil - performance.now())),
    }),
    // 双击右键效果的手动入口（测试页 / 控制台用）
    hideMinimap: (sec) => mmHideTemporarily(sec),
  };
})();
