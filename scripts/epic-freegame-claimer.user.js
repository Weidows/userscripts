// ==UserScript==
// @name         Epic 每周免费游戏自动领取
// @namespace    https://store.epicgames.com/
// @version      1.0.4
// @description  ScriptCat 后台定时任务：每周自动领取 Epic Games Store 的本周免费游戏（查询促销 → 校验登录态 → 下单 free 订单）。未登录/登录过期会检测并弹出可点击的登录提示。
// @author       weidows
// 调度：每周四首次匹配时跑一次（北京时间≈周四凌晨，避开周三晚新游上架前）；当天幂等防重跑。
// 注意：@crontab 行不能带行内注释，否则 ScriptCat 解析定时表达式会报错。
// @crontab      * * once * 4
// @grant        GM_xmlhttpRequest
// @grant        GM_log
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      store-site-backend-static-ipv4.ak.epicgames.com
// @connect      store.epicgames.com
// @connect      www.epicgames.com
// @connect      payment-website-pci.ol.epicgames.com
// @connect      account-public-service-prod.ol.epicgames.com
// ==/UserScript==

/**
 * 说明：
 * - @crontab * * once * 4  表示每周四只成功执行一次（首次匹配的分钟即跑，当天不再重复）。
 *   Epic 一般在美国时间周四 ~10:00（北京时间周四晚~22:00）刷新免费游戏，脚本当天任意一次成功即可，
 *   会顺带把"还没上架但已免费"的游戏一并领取。想固定在周四 22:10 跑可改为：// @crontab 10 22 once * 4
 *   想每天检查可改为：// @crontab * * once * *（已带"本周已领过"去重，不会重复下单）
 * - 必须 return Promise，resolve=成功，reject=失败；失败时抛 CATRetryError 可自动重试。
 * - 后台脚本跑在沙盒里无法操作 DOM，全部用 GM_xmlhttpRequest 带 Cookie 请求（anonymous:false）。
 *
 * 领取流程（照搬 Epic 网页下单逻辑，已对照 epicgames-freegames-node 的真实请求）：
 *   1) freeGamesPromotions  —— 拉取当前/即将免费的游戏（公开接口，无需登录）
 *   2) id/api/csrf          —— 刷新 XSRF-TOKEN Cookie（返回 204，Set-Cookie 下发；注意：
 *      绝对不能用 account/v2/refresh-csrf 当登录信号，因为它"已登录也返回 HTML 登录页"，会误判）。
 *   3) 仅对"当前免费（promotionalOffers 进行中 + discountPrice==0 + 非兑换码）且本周未领过"的游戏：
 *        GET  www.epicgames.com/store/purchase?offers=1-<ns>-<id>  → 从 HTML 刮出 #purchaseToken
 *        POST order-preview  (带 x-requested-with: <purchaseToken>) → 取 syncToken / orderId
 *        POST confirm-order   (带 x-requested-with: <purchaseToken>) → 完成免费下单
 *    ★ 关键：Epic 下单必须用购买页里的 purchaseToken 作为 x-requested-with 请求头；
 *      之前误用 X-XSRF-TOKEN 头会导致 payment 站点 401（已登录也 401）→ 误弹登录框。
 *
 * 未登录检测（以"登录页"为唯一权威信号，不再用 refresh-csrf、也不再把任何 HTML 当未登录）：
 *   - 只有 401/403 且响应是真正的登录页（含 loginId / password 表单）才视为未登录。
 *   - payment 站点偶发的 401 HTML 外壳（<title>Payment by Epic Games</title>，无登录表单）
 *     不算未登录，不会弹框（这种通常是风控/接口抖动，重试即可）。
 * 命中登录页后：弹「可点击打开登录页」的通知，并直接 reject（重试无意义，必须你重新登录）。
 *
 * 已知边界（务必看）：
 *   - 依赖浏览器里 store.epicgames.com 的登录 Cookie（同一 .epicgames.com 域共享，payment 站点也能带）。
 *   - 极少数情况 Epic 会弹 Arkose/验证码（captcha.challenge）：届时本次领取失败并通知你手动去领。
 *   - 兑换码类免费游戏（isCodeRedemptionOnly=true，如某些 DLC/礼包）无法自动领取，会被跳过并提示手动。
 */

return new Promise((resolve, reject) => {
  // —— 可配置项 ——
  const COUNTRY = "US";          // 用于过滤地区可见的免费游戏；一般 US 即覆盖全球免费游戏
  const LOCALE = "en-US";
  const TIMEOUT_MS = 20000;

  // 端点（与 epicgames-freegames-node 保持一致）
  const URL_FREE = `https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=${LOCALE}&country=${COUNTRY}&allowCountries=${COUNTRY}`;
  const URL_CSRF = "https://www.epicgames.com/id/api/csrf";
  const URL_PREVIEW = "https://payment-website-pci.ol.epicgames.com/purchase/order-preview";
  const URL_CONFIRM = "https://payment-website-pci.ol.epicgames.com/purchase/confirm-order";
  const URL_PURCHASE = "https://www.epicgames.com/store/purchase";
  const URL_LOGIN = "https://store.epicgames.com/";

  function log(...args) {
    const msg = args.map(String).join(" ");
    try { GM_log(msg); } catch (_) {}
    console.log("[EpicFree]", ...args);
  }

  // 轻量 JSON 解析，失败返回 null
  function safeJSON(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  // 从 id/api/csrf 的响应头里取出 XSRF-TOKEN（Set-Cookie 形式）
  function extractXsrf(headers) {
    if (!headers) return "";
    const m = String(headers).match(/XSRF-TOKEN=([^;,\r\n]+)/i);
    return m ? m[1] : "";
  }

  // 从购买页 HTML 刮出 #purchaseToken 的值（Epic 下单必须带它作为 x-requested-with 头）
  function extractPurchaseToken(html) {
    if (!html) return "";
    const m = String(html).match(/id=["']purchaseToken["'][^>]*value=["']([^"']+)["']/i)
            || String(html).match(/["']purchaseToken["']\s*:\s*["']([^"']+)["']/i);
    return m ? m[1] : "";
  }

  // 判断响应是不是 Epic 的「登录页 / 未登录重定向页」。
  // 注意：payment-website-pci 即使已登录也可能回一个带 <title>Payment by Epic Games</title>
  // 的 401 HTML 外壳（不含登录表单）；这个必须判为「请求被拒」，而不是「未登录」，
  // 否则已登录也会误弹登录框。真正未登录的标志是有登录表单（loginId / 密码输入框）。
  function isLoginPage(text) {
    if (!/<(!doctype|html)/i.test(text || "")) return false;
    const lower = text.toLowerCase();
    return /name=["']?loginid|id=["']?loginid|password/i.test(lower);
  }

  // 真正的「未登录」判定：401/403 + 是登录页（含登录表单）。
  // 401 但只是 Payment 外壳（无登录表单）→ 视为会话/接口问题，不弹登录框。
  function isUnauthorized(rc) {
    return (rc.status === 401 || rc.status === 403) && isLoginPage(rc.responseText);
  }

  function notifyLoginNeeded(reason) {
    const msg = `未登录 / 登录已过期：${reason}。请点击通知登录 Epic 后，下次定时（或手动运行一次）会自动重试。`;
    log(msg);
    try {
      GM_notification({
        title: "Epic 免费游戏领取失败 · 需要登录",
        text: msg + "\n\n[点击此通知打开登录页]",
        onclick() { try { window.open(URL_LOGIN, "_blank"); } catch (_) {} },
        timeout: 0,
      });
    } catch (_) {
      try { GM_notification({ title: "Epic 免费游戏领取失败 · 需要登录", text: msg + " 登录页：" + URL_LOGIN }); } catch (__) {}
    }
    reject(msg);
  }

  function notifyInfo(title, text) {
    try { GM_notification({ title, text, timeout: 10000 }); } catch (_) {}
  }

  // 解析 freeGamesPromotions，返回"当前免费"列表
  function parseFreeGames(json) {
    const out = [];
    try {
      const elements = json.data.Catalog.searchStore.elements || [];
      const now = Date.now();
      for (const e of elements) {
        const promos = (e.promotions && e.promotions.promotionalOffers) || [];
        if (!promos.length) continue;                       // 没有进行中的促销
        const active = promos.some((po) =>
          po.promotionalOffers.some((o) => {
            const s = Date.parse(o.startDate), en = Date.parse(o.endDate);
            return !isNaN(s) && !isNaN(en) && now >= s && now <= en;
          })
        );
        if (!active) continue;
        const tp = (e.price && e.price.totalPrice) || {};
        const discount = tp.discountPrice;
        if (typeof discount !== "number" || discount !== 0) continue;  // 不是真免费
        if (e.isCodeRedemptionOnly) continue;                          // 兑换码类无法自动领
        out.push({
          title: e.title,
          offerId: e.id,
          namespace: e.namespace,
          url: `https://store.epicgames.com/${LOCALE}/p/${e.productSlug || e.urlSlug || e.id}`,
        });
      }
    } catch (err) {
      log("解析免费游戏列表失败:", err && err.message);
    }
    return out;
  }

  // —— 主流程 ——
  log("开始 Epic 免费游戏领取任务");

  GM_xmlhttpRequest({
    url: URL_FREE,
    method: "GET",
    headers: { "Accept": "application/json" },
    anonymous: false,
    timeout: TIMEOUT_MS,
    onload(res) {
      const free = parseFreeGames(safeJSON(res.responseText));
      if (!free.length) {
        log("当前没有可领取的免费游戏（可能本周已领完或暂无免费游戏）");
        notifyInfo("Epic 免费游戏", "本周没有可自动领取的免费游戏");
        return resolve("no free games this week");
      }
      log("发现可领取免费游戏:", free.map((g) => g.title).join(", "));

      // 2) 刷新 XSRF-TOKEN（id/api/csrf 返回 204，Set-Cookie 下发 XSRF-TOKEN + EPIC_SESSION_AP）
      //    注意：不在此处判断登录态！account/v2/refresh-csrf 已登录也返回 HTML，会误判。
      //    真正的登录判断放在 claimOne 的 order-preview（401/403/HTML 才视为未登录）。
      GM_xmlhttpRequest({
        url: URL_CSRF,
        method: "GET",
        headers: { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" },
        anonymous: false,
        timeout: TIMEOUT_MS,
        onload(r2) {
          // 204 即可；刷新 XSRF-TOKEN Cookie（下单时 Epic 仍会校验该 Cookie）
          const got = extractXsrf(r2.responseHeaders);
          log("CSRF 刷新完成 status=", r2.status, " xsrfCookie len=", (got || "").length);

          // 本周已成功领取过的 offerId 集合（去重，避免重复下单）
          let claimed = {};
          try { claimed = safeJSON(GM_getValue("claimed_offers", "{}")) || {}; } catch (_) {}

          const pending = free.filter((g) => !claimed[g.offerId]);
          if (!pending.length) {
            log("本周免费游戏已全部领取过，跳过");
            notifyInfo("Epic 免费游戏", "本周免费游戏已全部领取 ✓");
            return resolve("all already claimed this week");
          }
          log("待领取:", pending.map((g) => g.title).join(", "));

          // 逐个领取
          let idx = 0;
          const results = [];

          function claimNext() {
            if (idx >= pending.length) {
              // 汇总
              const ok = results.filter((r) => r.ok).map((r) => r.title);
              const fail = results.filter((r) => !r.ok);
              try { GM_setValue("claimed_offers", JSON.stringify(claimed)); } catch (_) {}
              if (ok.length) {
                notifyInfo("Epic 免费游戏领取成功", `已领取 ${ok.length} 款：${ok.join("、")}`);
                log("领取完成，成功:", ok.join(", "));
              }
              if (fail.length) {
                const reasons = fail.map((r) => `${r.title}(${r.reason})`).join("；");
                notifyInfo("Epic 免费游戏部分失败", reasons + "（多半是验证码，可手动领取）");
                log("部分失败:", reasons);
              }
              return resolve(`claimed ${ok.length}/${pending.length}`);
            }
            const game = pending[idx++];
            claimOne(game, (r) => {
              results.push(r);
              if (r.ok) claimed[r.offerId] = new Date().toISOString().slice(0, 10);
              claimNext();
            });
          }
          claimNext();
        },
        onerror(err) {
          const msg = `CSRF 刷新请求失败 status=${err && err.status}`;
          log(msg);
          try { reject(new CATRetryError(msg, 120)); } catch (_) { reject(msg); }
        },
        ontimeout() {
          const msg = "CSRF 刷新请求超时";
          log(msg);
          try { reject(new CATRetryError(msg, 120)); } catch (_) { reject(msg); }
        },
      });
    },
    onerror(err) {
      const msg = `免费游戏列表请求失败 status=${err && err.status}`;
      log(msg);
      try { reject(new CATRetryError(msg, 120)); } catch (_) { reject(msg); }
    },
    ontimeout() {
      const msg = "免费游戏列表请求超时";
      log(msg);
      try { reject(new CATRetryError(msg, 120)); } catch (_) { reject(msg); }
    },
  });

  // 领取单个游戏：
  //   1) GET 购买页（www.epicgames.com/store/purchase?offers=...）→ 从 HTML 刮出 #purchaseToken
  //   2) POST order-preview  → 取 syncToken / orderId / namespace / country
  //        （purchaseToken 必须作为 x-requested-with 请求头携带，这是 Epic 下单的硬要求）
  //   3) POST confirm-order   → 完成免费下单
  // 对照 epicgames-freegames-node 的 purchase.ts：x-requested-with 必须是 purchaseToken，
  // 不是 XSRF-TOKEN；之前用错头会导致 payment 站点 401 → 误弹登录框。
  function claimOne(game, done) {
    const purchaseUrl = `${URL_PURCHASE}?offers=1-${game.namespace}-${game.offerId}`;

    // 1) 拉购买页，刮 purchaseToken
    GM_xmlhttpRequest({
      url: purchaseUrl,
      method: "GET",
      headers: { "Accept": "text/html,application/xhtml+xml" },
      anonymous: false,
      timeout: TIMEOUT_MS,
      onload(r0) {
        if (isUnauthorized(r0)) {
          return notifyLoginNeeded("购买页被重定向到登录页");
        }
        const token = extractPurchaseToken(r0.responseText);
        if (!token) {
          return done({ ok: false, title: game.title, offerId: game.offerId, reason: "购买页未取到 purchaseToken（可能页面结构变了/被风控）" });
        }
        log("已取得 purchaseToken（len=" + token.length + "），开始下单:", game.title);

        const previewBody = {
          useDefault: true,
          setDefault: false,
          namespace: game.namespace,
          country: COUNTRY,
          countryName: null,
          orderId: null,
          orderComplete: null,
          orderError: null,
          orderPending: null,
          offers: [game.offerId],
          offerPrice: "",
        };

        GM_xmlhttpRequest({
          url: URL_PREVIEW,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Referer": purchaseUrl,
            "x-requested-with": token,
          },
          data: JSON.stringify(previewBody),
          anonymous: false,
          timeout: TIMEOUT_MS,
          onload(rp) {
            // 401/403 且是登录页才算「未登录」；Payment 外壳的 401 不带登录表单，不弹框
            if (isUnauthorized(rp)) {
              return notifyLoginNeeded("order-preview 被重定向到登录页");
            }
            const jp = safeJSON(rp.responseText);
            if (!jp || !jp.orderResponse) {
              return done({ ok: false, title: game.title, offerId: game.offerId, reason: "order-preview 无返回" });
            }
            const orderId = jp.orderId || (jp.orderResponse && jp.orderResponse.orderId);
            const syncToken = jp.syncToken || (jp.orderResponse && jp.orderResponse.syncToken);
            const ns = jp.namespace || game.namespace;
            const country = jp.country || COUNTRY;
            if (!orderId || !syncToken) {
              return done({ ok: false, title: game.title, offerId: game.offerId, reason: "缺少 orderId/syncToken" });
            }

            const confirmBody = {
              useDefault: true,
              setDefault: false,
              namespace: ns,
              country: country,
              countryName: null,
              orderId: orderId,
              orderComplete: false,
              orderError: false,
              orderPending: false,
              offers: [game.offerId],
              includeAccountBalance: false,
              totalAmount: 0,
              affiliateId: "",
              creatorSource: "",
              threeDSToken: "",
              voucherCode: null,
              syncToken: syncToken,
              isFreeOrder: true,
            };

            GM_xmlhttpRequest({
              url: URL_CONFIRM,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Referer": purchaseUrl,
                "x-requested-with": token,
              },
              data: JSON.stringify(confirmBody),
              anonymous: false,
              timeout: TIMEOUT_MS,
              onload(rc) {
                // 401/403 且是登录页才算「未登录」；Payment 外壳的 401 不带登录表单，不弹框
                if (isUnauthorized(rc)) {
                  return notifyLoginNeeded("confirm-order 被重定向到登录页");
                }
                const jc = safeJSON(rc.responseText);
                // 验证码拦截
                const errCode = (jc && (jc.errorCode || (jc.orderResponse && jc.orderResponse.errorCode))) || "";
                if (/captcha/i.test(errCode) || /captcha/i.test(rc.responseText || "")) {
                  return done({ ok: false, title: game.title, offerId: game.offerId, reason: "触发验证码" });
                }
                // 已拥有 / 完成
                const status = (jc && jc.orderResponse && (jc.orderResponse.orderStatus || jc.orderResponse.status)) || "";
                const body = (rc.responseText || "").toLowerCase();
                if (/already (own|claimed|purchased)/i.test(body) || status === "COMPLETED" || (jc && jc.orderComplete === true)) {
                  return done({ ok: true, title: game.title, offerId: game.offerId, reason: "已拥有/完成" });
                }
                if (jc && (jc.orderComplete === true || /complete/i.test(status))) {
                  return done({ ok: true, title: game.title, offerId: game.offerId });
                }
                // 兜底：成功常见特征
                if (rc.status === 200 && (status === "COMPLETED" || body.includes("\"orderComplete\":true") || body.includes("purchaseComplete"))) {
                  return done({ ok: true, title: game.title, offerId: game.offerId });
                }
                done({ ok: false, title: game.title, offerId: game.offerId, reason: `confirm 异常 status=${rc.status}` });
              },
              onerror(err) {
                done({ ok: false, title: game.title, offerId: game.offerId, reason: `confirm 失败 status=${err && err.status}` });
              },
              ontimeout() {
                done({ ok: false, title: game.title, offerId: game.offerId, reason: "confirm 超时" });
              },
            });
          },
          onerror(err) {
            done({ ok: false, title: game.title, offerId: game.offerId, reason: `preview 失败 status=${err && err.status}` });
          },
          ontimeout() {
            done({ ok: false, title: game.title, offerId: game.offerId, reason: "preview 超时" });
          },
        });
      },
      onerror(err) {
        done({ ok: false, title: game.title, offerId: game.offerId, reason: `购买页失败 status=${err && err.status}` });
      },
      ontimeout() {
        done({ ok: false, title: game.title, offerId: game.offerId, reason: "购买页超时" });
      },
    });
  }
});
