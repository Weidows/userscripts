// ==UserScript==
// @name         ModelScope 魔粒每日自动签到
// @namespace    https://modelscope.cn/magicube
// @version      1.1.0
// @description  ScriptCat 后台定时任务：每天自动访问 https://modelscope.cn/magicube/usage?tab=consume 触发签到领取魔粒。登录过期会检测并弹出可点击的登录提示。
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
 *
 * 登录过期检测（多路判定，任一命中即视为未登录）：
 *   1) 页面请求返回 401 / 403
 *   2) 页面 HTML 含「登录 / 注册」且不含魔粒数据（未登录态）
 *   3) 余额接口返回 JSON 的 code == "InvalidAuthentication"（最硬信号，Cookie 失效）
 *   4) 余额接口返回 401 / 403
 * 命中后：弹「可点击打开登录页」的通知，并直接 reject（不重试，因为重试也没用，必须你重新登录）
 */

return new Promise((resolve, reject) => {
  const URL_PAGE = "https://modelscope.cn/magicube/usage?tab=consume";
  const URL_LOGIN = "https://modelscope.cn/my/account?from=magicube";
  const URL_BALANCE = "https://modelscope.cn/openapi/v1/magicubes/balance";
  const TODAY = new Date().toISOString().slice(0, 10);

  function log(...args) {
    const msg = args.map(String).join(" ");
    try { GM_log(msg); } catch (_) {}
    console.log("[MagicCube]", ...args);
  }

  // 统一：登录过期处理。onLoginExpired=true 时直接 reject（不重试），并弹可点击通知
  function handleLoginExpired(reason) {
    const msg = `登录已过期/未登录：${reason}。请点击通知登录 modelscope.cn 后，次日自动重试（或手动运行一次）。`;
    log(msg);
    try {
      GM_notification({
        title: "魔粒签到失败 · 需要重新登录",
        text: msg + "\n\n[点击此通知打开登录页]",
        onclick: function () {
          try { window.open(URL_LOGIN, "_blank"); } catch (_) {}
        },
        timeout: 0,
      });
    } catch (_) {
      // 某些环境 GM_notification 不支持 onclick，退化为普通通知
      try { GM_notification({ title: "魔粒签到失败 · 需要重新登录", text: msg + " 登录页：" + URL_LOGIN }); } catch (__) {}
    }
    // 登录失效必须人工介入，重试无意义；直接 reject（once 已保证当天不会重复跑）
    reject(msg);
  }

  function notifySuccess(text) {
    try {
      GM_notification({ title: "魔粒签到成功", text: text, timeout: 8000 });
    } catch (_) {}
  }

  log(`开始签到任务 today=${TODAY} last_success=${GM_getValue("last_success_date", "")}`);

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
        handleLoginExpired(`访问页面返回 ${res.status}`);
        return;
      }

      const html = res.responseText || "";
      // 未登录时页面会包含 登录/注册 字样且无魔粒数据
      if (html.includes("登录 / 注册") && !html.includes("我的魔粒") && !html.includes("magicCube")) {
        handleLoginExpired("页面显示未登录态");
        return;
      }

      log("页面访问成功，尝试查询余额确认是否已领取（并兜底检测登录态）...");

      // 2) 再查一次余额接口做确认/日志（同时用 InvalidAuthentication 兜底检测 Cookie 是否真的有效）
      GM_xmlhttpRequest({
        url: URL_BALANCE,
        method: "GET",
        headers: { "Accept": "application/json", "Referer": URL_PAGE },
        anonymous: false,
        onload(r2) {
          log(`GET balance status=${r2.status} body=${(r2.responseText || "").slice(0, 800)}`);

          // 兜底检测登录过期：最硬信号
          if (r2.status === 401 || r2.status === 403) {
            handleLoginExpired(`余额接口返回 ${r2.status}`);
            return;
          }
          let json = null;
          try { json = JSON.parse(r2.responseText); } catch (_) {}
          if (json && (json.code === "InvalidAuthentication" || /authentication required/i.test(json.message || ""))) {
            handleLoginExpired("余额接口返回 InvalidAuthentication（Cookie 已失效）");
            return;
          }

          let balanceText = "";
          if (json) {
            const d = json.data || json;
            const bal = d.available_balance ?? d.balance ?? d.total ?? "";
            if (bal !== "") balanceText = `当前可用魔粒: ${bal}`;
          }

          GM_setValue("last_success_date", TODAY);
          if (balanceText) GM_setValue("last_balance", balanceText);

          const okMsg = balanceText ? `签到完成，${balanceText}` : "签到完成（页面访问成功）";
          log(okMsg);
          notifySuccess(okMsg);
          resolve(okMsg);
        },
        onerror() {
          // 余额接口失败不算签到失败，页面访问本身已触发签到
          log("余额接口请求失败，但页面访问已完成，视为签到成功");
          GM_setValue("last_success_date", TODAY);
          notifySuccess("页面访问成功（余额查询跳过）");
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
      // 网络错误才值得重试（CATRetryError），登录类错误已在上面拦截
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
