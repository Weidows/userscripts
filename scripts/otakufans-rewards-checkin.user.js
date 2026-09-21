// ==UserScript==
// @name         OtakuFans 每日签到
// @namespace    https://otakufans.net/rewards
// @version      1.0.0
// @description  ScriptCat 后台定时任务：每天自动领取 OtakuFans 的 7 天登录奖励（credits / 视频券）。接口鉴权走 Firebase ID Token，需配合 otakufans-rewards-auth.user.js 自动同步授权。
// @author       weidows
// @crontab      * * once * *
// @grant        GM_xmlhttpRequest
// @grant        GM_log
// @grant        GM_notification
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @storageName  otakufans-rewards
// @connect      otakufans.net
// @connect      securetoken.googleapis.com
// ==/UserScript==

/**
 * 说明：
 * - @crontab * * once * *  表示每天只成功执行一次（当天首次匹配的分钟即跑，当天不再重复）
 *   好处：浏览器关机几天再开、后台调度延迟、重启导致的重复都能被 once 兜住
 *   想固定时间可改为：// @crontab 10 9 once * *（注意 @crontab 行内不能写注释）
 * - 必须 return Promise，resolve=成功，reject=失败；网络类失败抛 CATRetryError 会自动重试
 * - 后台脚本跑在沙盒里无法操作 DOM，全部用 GM_xmlhttpRequest 请求
 *
 * 鉴权链路（关键）：
 *   签到接口是 POST https://otakufans.net/api/credits/daily-reward，
 *   鉴权只认 Authorization: Bearer <Firebase ID Token>，浏览器 Cookie 完全没用（实测带 Cookie 仍 401）。
 *   ID Token 由浏览器里的 Firebase SDK 存在 IndexedDB，后台脚本读不到，
 *   所以由 otakufans-rewards-auth.user.js（页面脚本）在你访问 otakufans.net 时抓取，
 *   通过 ScriptCat 共享存储（两个脚本声明同一个 @storageName）喂给本脚本。
 *   本脚本每天用 refreshToken 换新的 ID Token（securetoken.googleapis.com，Firebase 会轮换 refreshToken，已回写），
 *   再查状态 → 领取。
 *
 * 异常处理：
 *   1) 没有授权信息      → 常驻通知（点击打开 rewards 页），不重试
 *   2) refreshToken 失效 → 清掉本地授权 + 常驻通知要求重新访问网站，不重试
 *   3) 被风控 / 额度上限 → 普通通知说明原因，当天不再重试
 *   4) 网络类错误        → CATRetryError 60 秒后自动重试
 */

return new Promise((resolve, reject) => {
  const REWARDS_PAGE = "https://otakufans.net/rewards";
  const DAILY_REWARD_API = "https://otakufans.net/api/credits/daily-reward";
  const ID_TOKEN_API = "https://securetoken.googleapis.com/v1/token";
  const LOG_TAG = "[OtakuFans签到]";

  function log(...args) {
    const msg = args.map(String).join(" ");
    try { GM_log(LOG_TAG + msg); } catch (_) {}
    console.log(LOG_TAG, ...args);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // sticky=true 时通知常驻（不会自动消失），适合需要人工介入的场景
  function notify(title, text, sticky) {
    const opts = {
      title: title,
      text: text + "\n\n[点击此通知打开 OtakuFans]",
      timeout: sticky ? 0 : 10000,
      onclick: function () {
        try { GM_openInTab(REWARDS_PAGE, { active: true }); } catch (_) {}
      },
    };
    try {
      GM_notification(opts);
    } catch (_) {
      // 退化为普通通知（不带点击）
      try { GM_notification({ title: title, text: text }); } catch (__) {}
    }
  }

  function getTimeZone() {
    const saved = GM_getValue("timeZone", "");
    if (saved) return saved;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (_) {
      return "UTC";
    }
  }

  // 按站点时区算「本地日历日」，必须和站点一致，否则会重复领取/漏领
  function localDay(timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  // GM_xmlhttpRequest → Promise；默认 anonymous=true（这两个接口只用 Bearer 鉴权，不需要 Cookie）
  function request(opts) {
    return new Promise((res, rej) => {
      const conf = Object.assign({ method: "GET", anonymous: true, timeout: 20000 }, opts);
      conf.onload = res;
      conf.onerror = () => rej(new Error("请求失败 " + conf.url));
      conf.ontimeout = () => rej(new Error("请求超时 " + conf.url));
      GM_xmlhttpRequest(conf);
    });
  }

  function parseJson(res) {
    try { return JSON.parse(res.responseText || "{}"); } catch (_) { return null; }
  }

  function isAuthStatus(status) {
    return status === 401 || status === 403;
  }

  // 用 refreshToken 换 ID Token；Firebase 会轮换 refreshToken，拿到新的必须回写，否则下次失效
  async function fetchIdToken(apiKey, refreshToken) {
    const res = await request({
      method: "POST",
      url: ID_TOKEN_API + "?key=" + encodeURIComponent(apiKey),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refreshToken),
    });
    const json = parseJson(res) || {};
    const idToken = json.id_token || json.idToken || "";
    const errText = String((json.error && (json.error.message || json.error)) || res.responseText || "").slice(0, 200);
    if (res.status !== 200 || !idToken) {
      const e = new Error("换取 ID Token 失败 status=" + res.status + " " + errText);
      // 只有明确的 refreshToken 无效才判定为「授权失效」，其它（5xx/限流）交给重试
      e.authDead = res.status === 400 || /INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|USER_DISABLED|invalid_grant/i.test(errText);
      throw e;
    }
    const newRefresh = json.refresh_token || json.refreshToken || "";
    if (newRefresh && newRefresh !== refreshToken) GM_setValue("refreshToken", newRefresh);
    GM_setValue("idTokenRefreshedAt", Date.now());
    return idToken;
  }

  function dropAuth() {
    GM_deleteValue("apiKey");
    GM_deleteValue("refreshToken");
    GM_deleteValue("accessToken");
  }

  // 授权失效统一处理：清理本地授权 + 常驻通知 + reject（不重试，重试没意义）
  function handleAuthLost(reason) {
    dropAuth();
    const msg = "Firebase 授权已失效（" + reason + "）。请打开一次 otakufans.net 任意页面，授权同步脚本会自动重新同步，之后即可正常签到。";
    log(msg);
    notify("OtakuFans 签到 · 需要重新授权", msg, true);
    reject(msg);
  }

  (async () => {
    try {
      const timeZone = getTimeZone();
      const today = localDay(timeZone);
      log(`开始签到 today=${today} tz=${timeZone} last=${GM_getValue("lastClaimDate", "")}`);

      // 0) 当日幂等：今天已经领过就不打接口了
      if (GM_getValue("lastClaimDate", "") === today) {
        log("今日已签到，跳过");
        resolve("skip: already claimed " + today);
        return;
      }

      const apiKey = GM_getValue("apiKey", "");
      const refreshToken = GM_getValue("refreshToken", "");
      if (!apiKey || !refreshToken) {
        const msg = "还没有 OtakuFans 的授权信息。请先确认已安装 otakufans-rewards-auth.user.js，并打开一次任意 otakufans.net 页面完成授权同步。";
        log(msg);
        notify("OtakuFans 签到 · 等待授权", msg, true);
        reject(msg);
        return;
      }

      // 1) 换 ID Token
      let idToken;
      try {
        idToken = await fetchIdToken(apiKey, refreshToken);
      } catch (e) {
        if (e && e.authDead) {
          handleAuthLost(e.message);
          return;
        }
        throw e;
      }

      const fingerprint = GM_getValue("fingerprint", "");
      const headers = { Authorization: "Bearer " + idToken, "x-time-zone": timeZone };
      if (fingerprint) headers["x-fingerprint"] = fingerprint;

      // 2) 查今日状态：canClaim / blockedBy / 连续天数
      const statusRes = await request({ url: DAILY_REWARD_API, headers: headers, anonymous: false });
      const status = parseJson(statusRes) || {};
      log(`GET status=${statusRes.status} body=${String(statusRes.responseText || "").slice(0, 500)}`);

      if (isAuthStatus(statusRes.status)) {
        handleAuthLost("接口返回 " + statusRes.status);
        return;
      }
      if (statusRes.status !== 200 && statusRes.status !== 429 && statusRes.status < 500) {
        // 4xx 是契约/账号类问题，60 秒后重试没意义，直接说清楚
        const msg = "查询签到状态失败 status=" + statusRes.status + " body=" + String(statusRes.responseText || "").slice(0, 200);
        log(msg);
        notify("OtakuFans 签到 · 查询失败", msg, false);
        reject(msg);
        return;
      }
      if (statusRes.status !== 200) {
        throw new Error("状态接口异常 status=" + statusRes.status + " body=" + String(statusRes.responseText || "").slice(0, 200));
      }

      if (status.blockedBy) {
        // 风控（ipBlocklisted / ipWindow / deviceWindow）或免费额度到顶（cap/held/needToSpend）
        const capText = status.cap
          ? "（免费额度 " + (status.held == null ? "?" : status.held) + "/" + status.cap +
            (status.needToSpend ? "，再消耗 " + status.needToSpend + " credits 可继续领取" : "") + "）"
          : "";
        const msg = "今日奖励没能领取：blockedBy=" + status.blockedBy + capText + "。已跳过，明天自动重试。";
        log(msg);
        notify("OtakuFans 签到 · 未领取", msg, false);
        resolve("blocked: " + status.blockedBy);
        return;
      }

      if (status.canClaim !== true) {
        // 服务端说今天已领过（例如你手动点过、或页面脚本补签过）
        GM_setValue("lastClaimDate", today);
        log("服务端判定今日已领取，跳过。连续 " + (status.currentStreak == null ? "?" : status.currentStreak) + " 天");
        resolve("skip: already claimed on server " + today);
        return;
      }

      // 3) 领取（同源连续请求之间留间隔，避免被风控当成脚本刷接口）
      await sleep(1500);
      const claimRes = await request({
        method: "POST",
        url: DAILY_REWARD_API,
        headers: Object.assign({}, headers, { "Content-Type": "application/json" }),
        data: JSON.stringify({ timeZone: timeZone, fingerprint: fingerprint || undefined }),
        anonymous: false,
      });
      const claim = parseJson(claimRes) || {};
      log(`POST status=${claimRes.status} body=${String(claimRes.responseText || "").slice(0, 500)}`);

      if (isAuthStatus(claimRes.status)) {
        handleAuthLost("领取接口返回 " + claimRes.status);
        return;
      }
      if (claimRes.status >= 400 && claimRes.status < 500 && claimRes.status !== 429) {
        // 4xx（如邮箱未验证、账号不符合条件）：重试无意义，通知说清楚
        const detail = claim.error || claim.code ? "error=" + claim.error + " code=" + claim.code : String(claimRes.responseText || "").slice(0, 200);
        const msg = "领取失败 status=" + claimRes.status + " " + detail;
        log(msg);
        notify("OtakuFans 签到 · 领取失败", msg, false);
        reject(msg);
        return;
      }
      if (claimRes.status < 200 || claimRes.status >= 300) {
        const detail = claim.error || claim.code ? "error=" + claim.error + " code=" + claim.code : String(claimRes.responseText || "").slice(0, 200);
        throw new Error("领取接口异常 status=" + claimRes.status + " " + detail);
      }

      if (claim.status === "already_claimed") {
        GM_setValue("lastClaimDate", today);
        log("领取接口返回 already_claimed（今天已领过）");
        resolve("already_claimed " + today);
        return;
      }

      if (claim.status === "claimed") {
        GM_setValue("lastClaimDate", today);
        GM_setValue("lastClaimAt", Date.now());
        const amount = Number(claim.rewardAmount);
        const streak = claim.newStreak == null ? "?" : claim.newStreak;
        const longest = claim.newLongest == null ? "?" : claim.newLongest;
        // 第 7 天那格是视频券（creditsForConsecutiveDay 对非积分奖励返回 0）
        const rewardText = amount > 0 ? "+" + amount + " credits" : "1 张视频券";
        const msg = "本次奖励 " + rewardText + " · 连续 " + streak + " 天（最长 " + longest + " 天）";
        log("签到成功：" + msg);
        notify("OtakuFans 签到成功", msg, false);
        resolve("claimed: " + rewardText + " streak=" + streak);
        return;
      }

      throw new Error("领取接口返回未知结果 body=" + String(claimRes.responseText || "").slice(0, 200));
    } catch (e) {
      const msg = String((e && e.message) || e);
      log("签到失败：" + msg);
      try {
        reject(new CATRetryError(msg, 60));
      } catch (_) {
        reject(msg);
      }
    }
  })();
});
