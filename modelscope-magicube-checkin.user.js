// ==UserScript==
// @name         ModelScope 魔粒每日自动签到
// @namespace    https://modelscope.cn/magicube
// @version      1.0.0
// @description  ScriptCat 后台定时任务：每天自动访问 https://modelscope.cn/magicube/usage?tab=consume 触发签到领取魔粒，无需手动打开页面
// @author       weidows
// @crontab      * * once * *
// @grant        GM_xmlhttpRequest
// @grant        GM_log
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      modelscope.cn
// @connect      cdn.modelscope.cn
// ==/UserScript==

/**
 * 说明：
 * - @crontab * * once * *  表示每天只成功执行一次（首次匹配的分钟即跑，当天不再重复）
 *   好处：浏览器关了几天再开、后台调度延迟、重启导致的重复都能被 once 兜住
 *   想固定在 09:10 执行可改为：// @crontab 10 9 once * *
 *   想每天 9-18 点之间只跑一次可改为：// @crontab * 9-18 once * *
 * - 必须 return Promise，resolve=成功，reject=失败；失败时抛 CATRetryError 可自动重试
 * - 后台脚本跑在沙盒里无法操作 DOM，全部用 GM_xmlhttpRequest 带 Cookie 请求
 */

return new Promise((resolve, reject) => {
  const URL_PAGE = "https://modelscope.cn/magicube/usage?tab=consume";
  const URL_BALANCE = "https://modelscope.cn/openapi/v1/magicubes/balance";
  const TODAY = new Date().toISOString().slice(0, 10);

  function log(...args) {
    const msg = args.map(String).join(" ");
    try { GM_log(msg); } catch (_) {}
    console.log("[MagicCube]", ...args);
  }

  function notify(title, text) {
    try { GM_notification({ title, text }); } catch (_) {}
  }

  // 防止当天已成功又被重试/重跑：用 GM 存储做幂等
  const lastDate = GM_getValue("last_success_date", "");
  const lastBalance = GM_getValue("last_balance", "");

  log(`开始签到任务 today=${TODAY} last_success=${lastDate} last_balance=${lastBalance}`);

  // 1) 先访问页面：你说的“访问一下这个地址就能签到”就是靠这个请求触发
  GM_xmlhttpRequest({
    url: URL_PAGE,
    method: "GET",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Referer": "https://modelscope.cn/",
    },
    // anonymous: false 才会带上 modelscope.cn 的登录 Cookie
    anonymous: false,
    onload(res) {
      log(`GET ${URL_PAGE} status=${res.status} len=${(res.responseText || "").length}`);

      if (res.status === 401 || res.status === 403) {
        const msg = "未登录或 Cookie 失效，请手动打开页面登录一次";
        log(msg);
        notify("魔粒签到失败", msg);
        reject(msg);
        return;
      }

      const html = res.responseText || "";
      // 未登录时页面会包含 登录/注册 字样且无魔粒数据
      if (html.includes("登录 / 注册") && !html.includes("我的魔粒") && !html.includes("magicCube")) {
        const msg = "检测到未登录状态，请先在浏览器中登录 modelscope.cn";
        log(msg);
        notify("魔粒签到失败", msg);
        reject(msg);
        return;
      }

      log("页面访问成功，尝试查询余额确认是否已领取（可选）...");

      // 2) 再查一次余额接口做确认/日志（失败不影响主流程判定）
      GM_xmlhttpRequest({
        url: URL_BALANCE,
        method: "GET",
        headers: { "Accept": "application/json", "Referer": URL_PAGE },
        anonymous: false,
        onload(r2) {
          log(`GET balance status=${r2.status} body=${(r2.responseText || "").slice(0, 800)}`);
          let balanceText = "";
          try {
            const j = JSON.parse(r2.responseText);
            const d = j.data || j;
            const bal = d.available_balance ?? d.balance ?? d.total ?? "";
            if (bal !== "") balanceText = `当前可用魔粒: ${bal}`;
          } catch (_) {}

          GM_setValue("last_success_date", TODAY);
          if (balanceText) GM_setValue("last_balance", balanceText);

          const okMsg = balanceText ? `签到完成，${balanceText}` : "签到完成（页面访问成功）";
          log(okMsg);
          notify("魔粒签到成功", okMsg);
          resolve(okMsg);
        },
        onerror() {
          // 余额接口失败不算签到失败，页面访问本身已触发签到
          log("余额接口请求失败，但页面访问已完成，视为签到成功");
          GM_setValue("last_success_date", TODAY);
          notify("魔粒签到成功", "页面访问成功（余额查询跳过）");
          resolve("ok - page visited, balance check skipped");
        },
        ontimeout() {
          log("余额接口超时，视为签到成功");
          GM_setValue("last_success_date", TODAY);
          resolve("ok - balance timeout");
        },
      });
    },
    onerror(err) {
      const msg = `页面请求失败 status=${err && err.status} error=${err && err.error}`;
      log(msg);
      // 用 CATRetryError 触发 ScriptCat 的重试（最小 5s，这里 60s 后重试）
      try {
        reject(new CATRetryError(msg, 60));
      } catch (_) {
        reject(msg);
      }
    },
    ontimeout() {
      const msg = "页面请求超时";
      log(msg);
      try {
        reject(new CATRetryError(msg, 60));
      } catch (_) {
        reject(msg);
      }
    },
    timeout: 15000,
  });
});
