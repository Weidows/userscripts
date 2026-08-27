// ==UserScript==
// @name         Epic 每周免费游戏加购物车
// @namespace    https://store.epicgames.com/
// @version      2.0.0
// @description  ScriptCat 后台定时任务：每周把 Epic 的免费游戏加入购物车（避免下单时的验证码），然后给你购物车链接，你点链接手动结算即可。未登录会弹可点击登录提示，并每日重复提醒直到你处理。
// @author       weidows
// 调度：默认每天跑一次（* * once * *），因为「加购物车」是幂等的，每天跑既能补加新游戏、又能每天重复提醒你（你常离开电脑注意不到弹窗）。
//   Epic 一般在美国时间周四 ~10:00（北京时间周四晚~22:00）刷新免费游戏，每天跑也能覆盖。
//   想只在周四跑可改为：// @crontab * * once * 4（但那样每周只提醒一次）。
// 注意：@crontab 行不能带行内注释，否则 ScriptCat 解析定时表达式会报错。
// @crontab      * * once * *
// @grant        GM_xmlhttpRequest
// @grant        GM_log
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      store-site-backend-static-ipv4.ak.epicgames.com
// @connect      store.epicgames.com
// @connect      www.epicgames.com
// ==/UserScript==

/**
 * 思路（相比旧版「自动下单」）：
 * - 自动下单会触发 Arkose 验证码，后台脚本没法过，经常失败。
 * - 加购物车基本不触发验证码，所以改成：把本周免费游戏加进购物车 → 给你购物车链接 → 你手动点链接结算。
 * - 「你常离开电脑注意不到弹窗」→ 用每日 cron + 购物车校验做重复提醒：
 *     只要那些免费游戏还躺在购物车里（说明你还没结算），每天就再提醒一次；
 *     一旦你结算了（游戏离开购物车），就停止提醒。
 *
 * 流程：
 *   1) freeGamesPromotions —— 拉当前免费游戏（公开接口）
 *   2) CartOffersValidation —— 跳过你已经拥有的（避免反复加已拥有的游戏）
 *   3) 逐个 addToCart (GraphQL mutation) —— 幂等，重复加无害
 *   4) getCartItems —— 确认哪些真的在购物车里
 *   5) 还在购物车 → 存 pending 标记 + 弹「可点击打开购物车」的常驻通知（每天重弹直到清空）
 *      已空（你结算了/促销结束）→ 清 pending，可选通知「已结算 ✓」
 *
 * 未登录检测：addToCart 返回 GraphQL errors 且含 auth/token/login 字样，或 401 → 视为未登录，
 *   弹可点击登录页的常驻通知，并每天重弹直到登录成功（加车成功）。
 *   （403 + HTML 挑战页是风控/限流，不是没登录，按「稍后重试」处理，不弹登录框。）
 *
 * 关键端点 / 头（来自 Epic 商店前端的公开 GraphQL）：
 *   POST https://store.epicgames.com/graphql
 *   必须带 X-Epic-ApiKey（商店前端写死的公开 key，非私密）。
 */

return new Promise((resolve, reject) => {
  // —— 可配置项 ——
  const COUNTRY = "US";
  const LOCALE = "en-US";
  const TIMEOUT_MS = 20000;
  const EPIC_APIKEY = "98412d6a3e7c4d148c695c9d6f5c5c35"; // Epic 商店前端公开 key
  const CART_URL = `https://store.epicgames.com/${LOCALE}/cart`;

  // 端点
  const URL_FREE = `https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=${LOCALE}&country=${COUNTRY}&allowCountries=${COUNTRY}`;
  const URL_GRAPHQL = "https://store.epicgames.com/graphql";
  const URL_LOGIN = "https://store.epicgames.com/";

  // 持久化键
  const KEY_PENDING = "epic_cart_pending"; // {kind:'cart'|'login', week, offers:[{title,offerId,namespace}], firstAt, lastAt}

  function log(...args) {
    const msg = args.map(String).join(" ");
    try { GM_log(msg); } catch (_) {}
    console.log("[EpicCart]", ...args);
  }

  function safeJSON(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function nowISOWeek() {
    // 简单的「年-周」标识，用来区分不同周的免费游戏
    const d = new Date();
    const onejan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
  }

  // —— GraphQL 请求封装 ——
  function gqlRequest(query, variables) {
    return new Promise((res) => {
      GM_xmlhttpRequest({
        url: URL_GRAPHQL,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Epic-ApiKey": EPIC_APIKEY,
        },
        data: JSON.stringify({ query, variables: variables || {} }),
        anonymous: false,
        timeout: TIMEOUT_MS,
        onload(r) {
          const text = r.responseText || "";
          const isHtml = /<(!doctype|html)/i.test(text);
          let json = null;
          if (!isHtml) { try { json = JSON.parse(text); } catch (_) {} }
          res({ status: r.status, text, json, isHtml, responseHeaders: r.responseHeaders || "" });
        },
        onerror(e) { res({ status: (e && e.status) || 0, text: "", json: null, isHtml: false, responseHeaders: "", error: true }); },
        ontimeout() { res({ status: 0, text: "", json: null, isHtml: false, responseHeaders: "", timeout: true }); },
      });
    });
  }

  // 是否「未登录 / 登录过期」：GraphQL errors 含 auth/token/login，或 401
  function gqlAuthError(r) {
    if (r.status === 401) return true;
    const errs = (r.json && r.json.errors) || [];
    return errs.some((e) => /auth|authentication|token_verification|login|unauthorized/i.test((e.code || "") + " " + (e.message || "")));
  }
  // 是否被风控/限流/网络抖动挡住（不是「没登录」）：HTML 挑战页、403、超时、网络错误
  function gqlBlocked(r) {
    return r.isHtml || r.status === 403 || r.timeout || r.error;
  }

  // —— 通知 ——
  function notifyCartReady(pending) {
    const titles = pending.offers.map((o) => o.title).join("、");
    const text = `本周 ${pending.offers.length} 款免费游戏已在购物车，去结算：\n${titles}\n\n${CART_URL}\n（点此通知打开购物车；结算后不再提醒）`;
    try {
      GM_notification({
        title: "Epic 免费游戏已在购物车 · 去结算",
        text,
        timeout: 0,
        onclick() { try { window.open(CART_URL, "_blank"); } catch (_) {} },
      });
    } catch (_) {
      try { GM_notification({ title: "Epic 免费游戏已在购物车", text: text }); } catch (__) {}
    }
  }

  function notifyLoginNeeded() {
    const text = `未登录 / 登录已过期，无法把免费游戏加入购物车。\n请登录后下次定时会自动重试（每天提醒）。\n\n${URL_LOGIN}`;
    try {
      GM_notification({
        title: "Epic 免费游戏加购物车失败 · 需要登录",
        text,
        timeout: 0,
        onclick() { try { window.open(URL_LOGIN, "_blank"); } catch (_) {} },
      });
    } catch (_) {
      try { GM_notification({ title: "Epic 免费游戏加购物车失败 · 需要登录", text }); } catch (__) {}
    }
  }

  function notifyInfo(title, text) {
    try { GM_notification({ title, text, timeout: 10000 }); } catch (_) {}
  }

  // 解析 freeGamesPromotions → 当前免费、非兑换码 列表
  function parseFreeGames(json) {
    const out = [];
    try {
      const elements = json.data.Catalog.searchStore.elements || [];
      const now = Date.now();
      for (const e of elements) {
        const promos = (e.promotions && e.promotions.promotionalOffers) || [];
        if (!promos.length) continue;
        const active = promos.some((po) =>
          po.promotionalOffers.some((o) => {
            const s = Date.parse(o.startDate), en = Date.parse(o.endDate);
            return !isNaN(s) && !isNaN(en) && now >= s && now <= en;
          })
        );
        if (!active) continue;
        const tp = (e.price && e.price.totalPrice) || {};
        const discount = tp.discountPrice;
        if (typeof discount !== "number" || discount !== 0) continue;
        if (e.isCodeRedemptionOnly) continue;
        out.push({ title: e.title, offerId: e.id, namespace: e.namespace });
      }
    } catch (err) {
      log("解析免费游戏列表失败:", err && err.message);
    }
    return out;
  }

  // —— GraphQL 片段 ——
  const Q_OFFERS_VALIDATION = `query getOffersValidation($offers: [OfferToValidate]!) {
    Entitlements { cartOffersValidation(offerParams: $offers) { fullyOwnedOffers { offerId namespace } } }
  }`;
  const M_ADD_TO_CART = `mutation addToCart($namespace: String!, $offerId: String!) {
    Cart { addToCart(namespace: $namespace, offerId: $offerId) { success cartItem { id offerId namespace } } }
  }`;
  const Q_CART_ITEMS = `query getCartItems { Cart { cartItems { elements { id offerId namespace } } } }`;

  // —— 主流程 ——
  (async () => {
    log("开始 Epic 免费游戏加购物车任务");

    // 1) 免费游戏列表
    const freeRes = await new Promise((res) => {
      GM_xmlhttpRequest({
        url: URL_FREE, method: "GET", headers: { "Accept": "application/json" },
        anonymous: false, timeout: TIMEOUT_MS,
        onload: (r) => res(safeJSON(r.responseText)),
        onerror: () => res(null), ontimeout: () => res(null),
      });
    });
    const free = parseFreeGames(freeRes);
    if (!free.length) {
      log("当前没有可加购物车的免费游戏");
      try { GM_setValue(KEY_PENDING, ""); } catch (_) {}
      notifyInfo("Epic 免费游戏", "本周没有可加购物车的免费游戏");
      return resolve("no free games");
    }
    log("当前免费游戏:", free.map((g) => g.title).join(", "));

    // 2) 跳过已拥有的（避免反复加已拥有的游戏）
    let toAdd = free;
    try {
      const vr = await gqlRequest(Q_OFFERS_VALIDATION, {
        offers: free.map((g) => ({ offerId: g.offerId, namespace: g.namespace })),
      });
      if (vr.json && vr.json.data && vr.json.data.Entitlements) {
        const owned = new Set(
          (vr.json.data.Entitlements.cartOffersValidation.fullyOwnedOffers || []).map((o) => o.offerId)
        );
        const skipped = free.filter((g) => owned.has(g.offerId)).map((g) => g.title);
        toAdd = free.filter((g) => !owned.has(g.offerId));
        if (skipped.length) log("已拥有、跳过:", skipped.join(", "));
      }
    } catch (_) {}

    if (!toAdd.length) {
      log("免费游戏都已拥有，无需加购物车");
      try { GM_setValue(KEY_PENDING, ""); } catch (_) {}
      notifyInfo("Epic 免费游戏", "本周免费游戏你都已拥有 ✓");
      return resolve("all owned");
    }

    // 3) 逐个加购物车
    const addedOk = [];
    let authFailed = false, blocked = false;
    for (const g of toAdd) {
      const r = await gqlRequest(M_ADD_TO_CART, { namespace: g.namespace, offerId: g.offerId });
      if (gqlAuthError(r)) { authFailed = true; log("加购物车未登录:", g.title); continue; }
      if (gqlBlocked(r)) { blocked = true; log("加购物车被风控/限流:", g.title, "status=", r.status); continue; }
      const ok = r.json && r.json.data && r.json.data.Cart && r.json.data.Cart.addToCart && r.json.data.Cart.addToCart.success;
      if (ok) { addedOk.push(g); log("已加入购物车:", g.title); }
      else { log("加购物车返回异常:", g.title, (r.json && JSON.stringify(r.json.errors)) || r.status); }
    }

    // 未登录：弹登录框 + 每日重提醒，直到登录成功
    if (authFailed && addedOk.length === 0) {
      log("全部加购物车失败（未登录），等待登录后重试");
      const pending = { kind: "login", week: nowISOWeek(), offers: toAdd.map((g) => ({ title: g.title, offerId: g.offerId, namespace: g.namespace })), firstAt: Date.now(), lastAt: Date.now() };
      try { GM_setValue(KEY_PENDING, JSON.stringify(pending)); } catch (_) {}
      notifyLoginNeeded();
      return resolve("login needed");
    }
    if (blocked && addedOk.length === 0) {
      log("加购物车被风控拦截，下次定时重试");
      notifyInfo("Epic 免费游戏", "加购物车被风控拦截，下次定时会自动重试");
      return resolve("blocked, retry later");
    }

    // 4) 确认哪些真的在购物车里
    const cartRes = await gqlRequest(Q_CART_ITEMS, {});
    let inCart = [];
    if (cartRes.json && cartRes.json.data && cartRes.json.data.Cart) {
      const elems = (cartRes.json.data.Cart.cartItems && cartRes.json.data.Cart.cartItems.elements) || [];
      const inCartIds = new Set(elems.map((e) => e.offerId));
      inCart = addedOk.filter((g) => inCartIds.has(g.offerId));
    }
    log("确认在购物车里:", inCart.map((g) => g.title).join(", ") || "(无)");

    // 5) 处理 pending / 重复提醒
    let prev = {};
    try { prev = safeJSON(GM_getValue(KEY_PENDING, "")) || {}; } catch (_) {}

    if (inCart.length) {
      // 之前是 login 状态但现在已经加成功了 → 清掉 login 标记，转成 cart 提醒
      const pending = {
        kind: "cart",
        week: nowISOWeek(),
        offers: inCart.map((g) => ({ title: g.title, offerId: g.offerId, namespace: g.namespace })),
        firstAt: prev.kind === "cart" ? (prev.firstAt || Date.now()) : Date.now(),
        lastAt: Date.now(),
      };
      try { GM_setValue(KEY_PENDING, JSON.stringify(pending)); } catch (_) {}
      // 每天重提醒（同一天手动多次运行也不重复弹）
      const sinceLast = Date.now() - (prev.lastAt || 0);
      if (prev.kind !== "cart" || sinceLast >= 20 * 3600 * 1000) {
        notifyCartReady(pending);
        log("已提醒去购物车结算（首次或距上次提醒已超过 20h）");
      } else {
        log("购物车仍有未结算游戏，但今天已提醒过，跳过重复弹");
      }
      return resolve(`in cart: ${inCart.length}`);
    }

    // 购物车空了（你结算了，或促销结束，或全被风控）→ 清 pending
    if (prev.kind === "cart") {
      log("购物车已清空，视为已结算，停止提醒");
      notifyInfo("Epic 免费游戏", "购物车里的免费游戏已结算 ✓");
    }
    try { GM_setValue(KEY_PENDING, ""); } catch (_) {}
    return resolve("cart empty / done");
  })().catch((err) => {
    log("任务异常:", err && err.message);
    try { reject(new CATRetryError("Epic 加购物车异常: " + (err && err.message), 120)); }
    catch (_) { resolve("error: " + (err && err.message)); }
  });
});
