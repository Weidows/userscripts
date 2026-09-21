// ==UserScript==
// @name         OtakuFans 授权同步 / 补签到
// @namespace    https://otakufans.net/rewards
// @version      1.0.0
// @description  浏览 otakufans.net 时把 Firebase 授权信息（refreshToken / 设备指纹）同步给后台签到脚本（共享存储 @storageName），并顺手补做当日签到。
// @author       weidows
// @match        https://otakufans.net/*
// @run-at       document-idle
// @inject-into  content
// @grant        GM_xmlhttpRequest
// @grant        GM_log
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @storageName  otakufans-rewards
// @connect      otakufans.net
// @connect      securetoken.googleapis.com
// ==/UserScript==

/**
 * 说明（为什么需要这个「页面脚本」）：
 * OtakuFans 的签到接口只用 Firebase ID Token 鉴权，而 ID Token / refreshToken 被网站自己的
 * Firebase SDK 存在浏览器 IndexedDB（库 firebaseLocalStorageDb）里 —— 后台脚本（沙盒，无页面上下文）
 * 读不到。所以本脚本在你会话存续期间把授权信息抓出来，写进 ScriptCat 共享存储：
 *   两个脚本声明同一个 @storageName（otakufans-rewards）即可互相读写。
 * 之后每天由 otakufans-rewards-checkin.user.js 后台定时签到，无需你打开网站。
 *
 * 本脚本做三件事：
 *   1) 从 IndexedDB 读 Firebase 当前用户（apiKey / refreshToken / uid）
 *   2) 复刻站点的 getGuestFingerprintHash（SHA-256(设备特征串)）一起存起来（服务端靠它做设备风控）
 *   3) 如果今天还没签到，顺手补签一次（这样即使后台授权链路出问题，你逛一次站也不会漏签）
 *
 * 注意：
 *   - 只在已登录（IndexedDB 里有 Firebase 用户）时才动手，未登录静默退出
 *   - 用 indexedDB.databases() 先判断库是否存在，绝不用 indexedDB.open(name) 创建空库
 *     （同名空库会让站点自己的 Firebase SDK 打不开 objectStore，直接搞坏站点登录）
 *   - Firefox 无 indexedDB.databases()，本脚本静默跳过（授权仍可手动粘贴，见下）
 *   - 站点改版 / 抓取失败时：脚本菜单「复制 OtakuFans 授权信息」可拿到 JSON，
 *     手动填到后台脚本的存储里（键名 apiKey / refreshToken / fingerprint / timeZone）
 */

(async function () {
  const REWARDS_PAGE = "https://otakufans.net/rewards";
  const DAILY_REWARD_API = "https://otakufans.net/api/credits/daily-reward";
  const ID_TOKEN_API = "https://securetoken.googleapis.com/v1/token";
  const LOG_TAG = "[OtakuFans授权]";

  const AUTH_DB = "firebaseLocalStorageDb";
  const AUTH_STORE = "firebaseLocalStorage";
  const AUTH_KEY_PREFIX = "firebase:authUser:";

  let LOGGED_AUTH = null;
  let LOGGED_FP = "";

  function log(...args) {
    const msg = args.map(String).join(" ");
    try { GM_log(LOG_TAG + msg); } catch (_) {}
    console.log(LOG_TAG, ...args);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function notify(title, text) {
    try {
      if (LOGGED_AUTH) {
        GM_notification({
          title: title,
          text: text,
          timeout: 10000,
          onclick: function () {
            try { window.open(REWARDS_PAGE, "_blank"); } catch (_) {}
          },
        });
      } else {
        GM_notification({ title: title, text: text, timeout: 10000 });
      }
    } catch (_) {}
  }

  function getTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (_) {
      return "UTC";
    }
  }

  function localDay(timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function request(opts) {
    return new Promise((res, rej) => {
      const conf = Object.assign({ method: "GET", anonymous: false, timeout: 20000 }, opts);
      conf.onload = res;
      conf.onerror = () => rej(new Error("请求失败 " + conf.url));
      conf.ontimeout = () => rej(new Error("请求超时 " + conf.url));
      GM_xmlhttpRequest(conf);
    });
  }

  function parseJson(res) {
    try { return JSON.parse(res.responseText || "{}"); } catch (_) { return null; }
  }

  // ---------- 1) 读网站自己的 Firebase 登录态 ----------

  function listDatabases() {
    return new Promise((resolve) => {
      if (!self.indexedDB || typeof indexedDB.databases !== "function") {
        resolve(null);
        return;
      }
      indexedDB.databases().then((dbs) => resolve((dbs || []).map((d) => d.name))).catch(() => resolve(null));
    });
  }

  function readAuthRecords() {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(AUTH_DB);
      } catch (_) {
        resolve(null);
        return;
      }
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const close = () => { try { db.close(); } catch (_) {} };
        try {
          if (!db.objectStoreNames.contains(AUTH_STORE)) {
            close();
            resolve(null);
            return;
          }
          const all = db.transaction(AUTH_STORE, "readonly").objectStore(AUTH_STORE).getAll();
          all.onsuccess = () => { const rows = all.result || []; close(); resolve(rows); };
          all.onerror = () => { close(); resolve(null); };
        } catch (_) {
          close();
          resolve(null);
        }
      };
    });
  }

  async function waitForFirebaseAuth(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const dbs = await listDatabases();
      if (dbs && dbs.indexOf(AUTH_DB) >= 0) {
        const rows = await readAuthRecords();
        if (rows) {
          for (const row of rows) {
            const key = String((row && row.fbase_key) || "");
            if (key.indexOf(AUTH_KEY_PREFIX) !== 0) continue;
            const user = (row && row.value) || {};
            const sts = user.stsTokenManager || {};
            if (!sts.refreshToken) continue;
            return {
              // 键名形如 firebase:authUser:<apiKey>:<appName>
              apiKey: user.apiKey || key.slice(AUTH_KEY_PREFIX.length).split(":")[0] || "",
              refreshToken: sts.refreshToken,
              accessToken: sts.accessToken || "",
              expirationTime: Number(sts.expirationTime || 0),
              uid: user.uid || "",
              email: user.email || "",
            };
          }
        }
      }
      if (Date.now() >= deadline) return null;
      await sleep(1000);
    }
  }

  // ---------- 2) 复刻站点的设备指纹 ----------
  // 等价于站点 bundle 里的 getGuestFingerprintHash()：SHA-256(特征串)，服务端用它做设备维度风控

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function collectFingerprintRaw() {
    const parts = [];
    parts.push(navigator.userAgent);
    parts.push(String(window.screen.width));
    parts.push(String(window.screen.height));
    parts.push(String(window.screen.colorDepth));
    parts.push(navigator.language);
    parts.push((navigator.languages || []).join(",") || "");
    try {
      parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch (_) {
      parts.push("tz_unknown");
    }
    parts.push(String(navigator.hardwareConcurrency == null ? "" : navigator.hardwareConcurrency));
    parts.push(String(navigator.deviceMemory == null ? "" : navigator.deviceMemory));

    try {
      const v = document.createElement("video");
      parts.push(
        [
          'video/mp4; codecs="avc1.42E01E"',
          'video/mp4; codecs="hev1.1.6.L93.B0"',
          'video/webm; codecs="vp9"',
          'video/ogg; codecs="theora"',
          "audio/mpeg",
          'audio/ogg; codecs="vorbis"',
        ].map((t) => v.canPlayType(t) || "no").join(",")
      );
    } catch (_) {
      parts.push("media_error");
    }

    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) {
        parts.push("no_webgl");
      } else {
        const exts = gl.getSupportedExtensions();
        const extStr = exts ? exts.sort().join(",") : "no_extensions";
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        if (info) {
          const vendor = gl.getParameter(info.UNMASKED_VENDOR_WEBGL);
          const renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
          parts.push(vendor + "~" + renderer + "|" + extStr);
        } else {
          parts.push("no_debug_info|" + extStr);
        }
      }
    } catch (_) {
      parts.push("webgl_error");
    }

    const uad = navigator.userAgentData;
    if (uad) {
      const platform = uad.platform || "unknown_platform";
      const mobile = uad.mobile ? "mobile" : "desktop";
      const brands = (uad.brands || []).map((b) => b.brand + ":" + b.version).join(",") || "";
      parts.push(platform + "|" + mobile + "|" + brands);
    } else {
      parts.push("no_client_hints");
    }

    return parts.join("|");
  }

  async function getGuestFingerprintHash() {
    try {
      if (self.crypto && crypto.subtle) return await sha256Hex(collectFingerprintRaw());
    } catch (_) {}
    return "";
  }

  // ---------- 3) 换 token + 补签到 ----------

  async function freshIdToken(auth) {
    if (auth.accessToken && auth.expirationTime > Date.now() + 60000) return auth.accessToken;
    const res = await request({
      method: "POST",
      url: ID_TOKEN_API + "?key=" + encodeURIComponent(auth.apiKey),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(auth.refreshToken),
      anonymous: true,
    });
    const json = parseJson(res) || {};
    const idToken = json.id_token || json.idToken || "";
    if (idToken && (json.refresh_token || json.refreshToken)) GM_setValue("refreshToken", json.refresh_token || json.refreshToken);
    return idToken;
  }

  async function tryClaimToday(auth, fingerprint, timeZone, today) {
    if (GM_getValue("lastClaimDate", "") === today) {
      log("今日已签到，跳过补签");
      return;
    }
    const idToken = await freshIdToken(auth);
    if (!idToken) {
      log("拿不到 ID Token，跳过补签");
      return;
    }
    const headers = { Authorization: "Bearer " + idToken, "x-time-zone": timeZone };
    if (fingerprint) headers["x-fingerprint"] = fingerprint;

    const statusRes = await request({ url: DAILY_REWARD_API, headers: headers });
    const status = parseJson(statusRes) || {};
    log(`补签 GET status=${statusRes.status} body=${String(statusRes.responseText || "").slice(0, 300)}`);
    if (statusRes.status !== 200) return;
    if (status.blockedBy) {
      log("今日奖励被风控/额度限制：" + status.blockedBy);
      return;
    }
    if (status.canClaim !== true) {
      GM_setValue("lastClaimDate", today);
      log("服务端判定今日已领取（连续 " + (status.currentStreak == null ? "?" : status.currentStreak) + " 天）");
      return;
    }

    await sleep(1500);
    const claimRes = await request({
      method: "POST",
      url: DAILY_REWARD_API,
      headers: Object.assign({}, headers, { "Content-Type": "application/json" }),
      data: JSON.stringify({ timeZone: timeZone, fingerprint: fingerprint || undefined }),
    });
    const claim = parseJson(claimRes) || {};
    log(`补签 POST status=${claimRes.status} body=${String(claimRes.responseText || "").slice(0, 300)}`);
    if (claim.status === "claimed") {
      GM_setValue("lastClaimDate", today);
      GM_setValue("lastClaimAt", Date.now());
      const amount = Number(claim.rewardAmount);
      const streak = claim.newStreak == null ? "?" : claim.newStreak;
      notify("OtakuFans 已自动签到", (amount > 0 ? "+" + amount + " credits" : "1 张视频券") + " · 连续 " + streak + " 天");
    } else if (claim.status === "already_claimed") {
      GM_setValue("lastClaimDate", today);
    }
  }

  // ---------- 主流程 ----------

  const auth = await waitForFirebaseAuth(30000);
  if (!auth || !auth.apiKey) {
    log("未检测到站点登录态（未登录 / 浏览器不支持 indexedDB.databases()），本次跳过");
    return;
  }
  LOGGED_AUTH = auth;

  const fingerprint = await getGuestFingerprintHash();
  const timeZone = getTimeZone();
  const today = localDay(timeZone);

  // 换账号了：清掉「今天已领」的标记，让新账号也能领
  const oldUid = GM_getValue("uid", "");
  if (oldUid && oldUid !== auth.uid) GM_setValue("lastClaimDate", "");

  GM_setValue("apiKey", auth.apiKey);
  GM_setValue("refreshToken", auth.refreshToken);
  if (auth.accessToken) GM_setValue("accessToken", auth.accessToken);
  if (fingerprint) GM_setValue("fingerprint", fingerprint);
  GM_setValue("timeZone", timeZone);
  GM_setValue("uid", auth.uid || "");
  GM_setValue("email", auth.email || "");
  GM_setValue("authSyncedAt", Date.now());
  log("授权信息已同步到共享存储 uid=" + auth.uid + " fp=" + (fingerprint ? fingerprint.slice(0, 12) + "…" : "(空)"));

  // 手动兜底：把授权信息复制到剪贴板，可粘贴进后台脚本的存储
  try {
    const payload = { apiKey: auth.apiKey, refreshToken: auth.refreshToken, fingerprint: fingerprint, timeZone: timeZone, uid: auth.uid, email: auth.email };
    GM_registerMenuCommand("复制 OtakuFans 授权信息（手动兜底）", function () {
      try {
        GM_setClipboard(JSON.stringify(payload, null, 2), "text");
        notify("OtakuFans 授权信息已复制", "粘贴到 签到脚本 的存储里（键名 apiKey / refreshToken / fingerprint / timeZone）");
      } catch (_) {}
    });
  } catch (_) {}

  try {
    await tryClaimToday(auth, fingerprint, timeZone, today);
  } catch (e) {
    log("补签失败（不影响后台签到）：" + String((e && e.message) || e));
  }
})();
