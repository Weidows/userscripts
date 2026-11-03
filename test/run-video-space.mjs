// 视频空格用例的自动回归：起一个独立 profile 的 headless Edge/Chrome，用裸 CDP 发**真实按键**
// （Input.dispatchKeyEvent，等价人手按空格，能验证「页面有没有被滚动」），跑 test/video-space.html。
//
//   node test/run-video-space.mjs
//
// 不碰用户正在用的浏览器：独立 --user-data-dir + 独立调试端口（默认 9333，可用 EGO_TEST_PORT 覆盖）。
// 浏览器路径自动探测 Edge / Chrome，也可用 MSEDGE 环境变量指定。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(HERE, 'video-space.html')).href;
const PORT = Number(process.env.EGO_TEST_PORT || 9333);

const CANDIDATES = [
  process.env.MSEDGE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
].filter(Boolean);

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('找不到 Edge / Chrome，可用 MSEDGE=<路径> 指定');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'su-vtest-'));
const proc = spawn(browser, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,800',
  'about:blank',
], { stdio: 'ignore' });

async function version() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('DevTools 没起来（端口被占用？试试 EGO_TEST_PORT=9344）');
}

const ver = await version();
console.log('浏览器:', ver['User-Agent']);

const tgt = await (await fetch(
  `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(PAGE)}`,
  { method: 'PUT' },
)).json();

const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await sleep(1200);

for (let i = 0; i < 40; i++) {
  if (await evalJS('!!(window.__scrollUnroll && window.__all && window.__shadowVideo)')) break;
  await sleep(250);
}

// type:'keyDown' + text 才产生字符（输入框用例靠它），否则只发 rawKeyDown
async function press(key, code, vk, opts = {}) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: opts.shift ? 8 : 0 };
  await send('Input.dispatchKeyEvent', opts.text ? { type: 'keyDown', text: key, ...base } : { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// 上一用例的焦点会继续吃按键（焦点元素即使滚出视口也算），每步之前清干净
const blur = () => evalJS('(document.activeElement && document.activeElement.blur && document.activeElement.blur(), document.body.focus(), 1)');
const stateOf = (vid) => evalJS(`JSON.stringify(window.__vstate(${JSON.stringify(vid)}))`).then(JSON.parse);
const allStates = () => evalJS('JSON.stringify(window.__all())').then(JSON.parse);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? '✅' : '❌') + ' ' + name + (detail ? '  ' + detail : ''));
}

await evalJS('window.__startAll()');
await sleep(900);

// 1 主播放器：空格 = 暂停 / 播放，页面不动
{
  await blur();
  const y0 = await evalJS('window.__center("#p-main")');
  await sleep(300);
  const before = await stateOf('p-main');
  await press(' ', 'Space', 32);
  await sleep(700);
  const after = await stateOf('p-main');
  check('1 空格暂停主播放器', before.paused === false && after.paused === true, `paused ${before.paused}→${after.paused}`);
  check('1 页面没被空格滚走', Math.abs(after.scrollY - y0) <= 2, `scrollY ${y0}→${after.scrollY}`);
  await press(' ', 'Space', 32);
  await sleep(600);
  const again = await stateOf('p-main');
  check('1 再按空格恢复播放', again.paused === false, `paused ${after.paused}→${again.paused}`);
  check('1 恢复后页面仍不动', Math.abs(again.scrollY - y0) <= 2, `scrollY ${again.scrollY}`);
}

// 2 小尺寸视频：仍归滚动
{
  await blur();
  const y0 = await evalJS('window.__center(null, "p-small")');
  await sleep(300);
  const inView = (await allStates()).filter((v) => v.inView).map((v) => v.id);
  const before = await stateOf('p-small');
  await press(' ', 'Space', 32);
  await sleep(1600);
  const after = await stateOf('p-small');
  check('2 小视频视口内只有它自己', inView.length === 1 && inView[0] === 'p-small', JSON.stringify(inView));
  check('2 空格照常翻页', after.scrollY - y0 > 100, `scrollY ${y0}→${after.scrollY}`);
  check('2 小视频状态没被动', before.paused === after.paused, `paused ${before.paused}→${after.paused}`);
}

// 3 静音循环无控件的装饰视频：仍归滚动
{
  await blur();
  const y0 = await evalJS('window.__center("#p-hero")');
  await sleep(300);
  const before = await stateOf('p-hero');
  await press(' ', 'Space', 32);
  await sleep(1600);
  const after = await stateOf('p-hero');
  check('3 装饰视频不抢空格', after.scrollY - y0 > 100 && before.paused === after.paused, `scrollY ${y0}→${after.scrollY}, paused ${before.paused}→${after.paused}`);
}

// 4 焦点在 video 上：小尺寸也归播放器
{
  await blur();
  const y0 = await evalJS('window.__center("#p-focus")');
  await sleep(200);
  await evalJS('document.getElementById("p-focus").focus()');
  await sleep(200);
  const foc = await evalJS('document.activeElement.tagName');
  const before = await stateOf('p-focus');
  await press(' ', 'Space', 32);
  await sleep(700);
  const after = await stateOf('p-focus');
  check('4 焦点在 video 上时空格归播放器', foc === 'VIDEO' && before.paused === false && after.paused === true, `active=${foc}, paused ${before.paused}→${after.paused}`);
  check('4 页面不动', Math.abs(after.scrollY - y0) <= 2, `scrollY ${y0}→${after.scrollY}`);
  await blur();
}

// 5 Shadow DOM 里的视频
{
  await blur();
  const y0 = await evalJS('window.__center(null, "p-shadow")');
  await sleep(300);
  const before = await stateOf('p-shadow');
  await press(' ', 'Space', 32);
  await sleep(700);
  const after = await stateOf('p-shadow');
  check('5 影子树里的视频也被暂停', before.paused === false && after.paused === true, `paused ${before.paused}→${after.paused} (${before.w}x${before.h})`);
  check('5 页面不动', Math.abs(after.scrollY - y0) <= 2, `scrollY ${y0}→${after.scrollY}`);
}

// 6 站点自己也绑了空格：净结果只切一次
{
  await blur();
  const y0 = await evalJS('window.__center("#p-global")');
  await sleep(300);
  const before = await stateOf('p-global');
  await press(' ', 'Space', 32);
  await sleep(700);
  const after = await stateOf('p-global');
  check('6 站点也绑空格时不打架（净切一次）', before.paused === false && after.paused === true, `paused ${before.paused}→${after.paused}`);
  check('6 页面不动', Math.abs(after.scrollY - y0) <= 2, `scrollY ${y0}→${after.scrollY}`);
  await press(' ', 'Space', 32);
  await sleep(700);
  const again = await stateOf('p-global');
  check('6 再按一次能切回去', again.paused === false, `paused ${after.paused}→${again.paused}`);
}

// 7 输入框里空格只打字
{
  await evalJS('window.__center("#t-input")');
  await sleep(200);
  await evalJS('var t=document.getElementById("t-input"); t.value=""; t.focus()');
  const y0 = await evalJS('Math.round(window.scrollY)');
  await press(' ', 'Space', 32, { text: ' ' });
  await sleep(600);
  const val = await evalJS('document.getElementById("t-input").value');
  const y1 = await evalJS('Math.round(window.scrollY)');
  check('7 输入框里空格不触发滚动', y1 === y0 && val === ' ', `value=${JSON.stringify(val)}, scrollY ${y0}→${y1}`);
  await blur();
}

// 8 视口里没有视频：照常翻页
{
  await blur();
  const y0 = await evalJS('window.__pos(document.body.scrollHeight - 2.6 * window.innerHeight)');
  await sleep(300);
  const inView = (await allStates()).filter((v) => v.inView).map((v) => v.id);
  const before = (await allStates()).map((v) => v.paused);
  await press(' ', 'Space', 32);
  await sleep(1600);
  const y1 = await evalJS('Math.round(window.scrollY)');
  const after = (await allStates()).map((v) => v.paused);
  check('8 没有视频时空格照常翻页', y1 - y0 > 100, `scrollY ${y0}→${y1}`);
  check('8 所有视频状态未变', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(before) + ' → ' + JSON.stringify(after));
  if (inView.length) console.log('   注意：这些视频在视口里', JSON.stringify(inView));
}

// 9 Shift+空格 在视频上仍然上翻
{
  await blur();
  const y0 = await evalJS('window.__center("#p-main")');
  await sleep(300);
  const before = await stateOf('p-main');
  await press(' ', 'Space', 32, { shift: true });
  await sleep(1600);
  const after = await stateOf('p-main');
  check('9 Shift+空格 在视频上仍然上翻', after.scrollY < y0 - 100 || y0 === 0, `scrollY ${y0}→${after.scrollY}`);
  check('9 Shift+空格 不动播放状态', before.paused === after.paused, `paused ${before.paused}→${after.paused}`);
}

const failed = results.filter((r) => !r.pass);
console.log('\n' + (failed.length ? `❌ ${failed.length}/${results.length} 项失败` : `✅ 全部 ${results.length} 项通过`));

ws.close();
proc.kill();
// 浏览器进程退出前 profile 目录可能还被占用，清了就清了，清不掉也无所谓（临时目录）
try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed.length ? 1 : 0);
