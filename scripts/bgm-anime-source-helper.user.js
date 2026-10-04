// ==UserScript==
// @name         Bangumi 番源 & BT 磁链助手
// @name:zh-CN   Bangumi 番源 & BT 磁链助手
// @namespace    https://github.com/Weidows/userscripts
// @version      1.0.0
// @description  在 Bangumi 番剧页直接看到「在哪能在线看」和「哪里能下 BT」。在线观看用 bangumi-data 官源映射（bilibili / 巴哈姆特動畫瘋 / Netflix / 木棉花 / Ani-One 等）；BT 聚合动漫花园 / 蜜柑计划 / Nyaa / ACG.RIP / ACGNX，支持按集筛选、画质与字幕组策略、本地缓存。
// @author       Weidows
// @license      MIT
// @homepageURL  https://github.com/Weidows/userscripts
// @supportURL   https://github.com/Weidows/userscripts/issues
// @icon         https://bgm.tv/img/favicon.ico
// @match        https://bgm.tv/subject/*
// @match        https://bangumi.tv/subject/*
// @match        https://www.bgm.tv/subject/*
// @match        https://bgm.tv/ep/*
// @match        https://bangumi.tv/ep/*
// @match        https://www.bgm.tv/ep/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_notification
// @connect      api.bgm.tv
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// @connect      share.dmhy.org
// @connect      mikanani.me
// @connect      nyaa.si
// @connect      share.acgnx.se
// @connect      acg.rip
// @connect      api.bilibili.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* eslint-disable no-multi-str */
(function () {
  'use strict';

  // ==========================================================================
  // 0. 常量与默认设置
  // ==========================================================================

  const NS = 'bgmh';
  const LOG = (...a) => console.log('[bgmh]', ...a);

  // bangumi-data：社区维护的「番剧 ↔ 各站点 id」映射表。animeko 的番源也是走这套上游数据，
  // 所以这里直接复用，而不是自己爬各站搜索页（那才是「上游一改就废」的根源）。
  const BANGUMI_DATA_URLS = [
    'https://cdn.jsdelivr.net/npm/bangumi-data@0.3/dist/data.json',
    'https://unpkg.com/bangumi-data@0.3/dist/data.json',
  ];

  const SITE_TEMPLATES = {
    bilibili: { title: '哔哩哔哩', url: 'https://www.bilibili.com/bangumi/media/md{{id}}', region: 'CN', color: '#fb7299' },
    bilibili_hk_mo_tw: { title: '哔哩哔哩（港澳台）', url: 'https://www.bilibili.com/bangumi/media/md{{id}}', region: 'HK', color: '#fb7299' },
    bilibili_hk_mo: { title: '哔哩哔哩（港澳）', url: 'https://www.bilibili.com/bangumi/media/md{{id}}', region: 'HK', color: '#fb7299' },
    bilibili_tw: { title: '哔哩哔哩（台灣）', url: 'https://www.bilibili.com/bangumi/media/md{{id}}', region: 'TW', color: '#fb7299' },
    acfun: { title: 'AcFun', url: 'https://www.acfun.cn/bangumi/aa{{id}}', region: 'CN', color: '#fd4c5b' },
    gamer: { title: '巴哈姆特動畫瘋', url: 'https://acg.gamer.com.tw/acgDetail.php?s={{id}}', region: 'TW', color: '#1b7fd4' },
    gamer_hk: { title: '巴哈姆特動畫瘋（HK）', url: 'https://acg.gamer.com.tw/acgDetail.php?s={{id}}', region: 'HK', color: '#1b7fd4' },
    qq: { title: '腾讯视频', url: 'https://v.qq.com/x/cover/{{id}}.html', region: 'CN', color: '#ff9d00' },
    youku: { title: '优酷', url: 'https://list.youku.com/show/id_z{{id}}.html', region: 'CN' },
    iqiyi: { title: '爱奇艺', url: 'https://www.iqiyi.com/{{id}}.html', region: 'CN', color: '#00be06' },
    mgtv: { title: '芒果TV', url: 'https://www.mgtv.com/h/{{id}}.html', region: 'CN' },
    letv: { title: '乐视', url: 'https://www.le.com/comic/{{id}}.html', region: 'CN' },
    netflix: { title: 'Netflix', url: 'https://www.netflix.com/title/{{id}}', region: '', color: '#e50914' },
    muse_hk: { title: '木棉花 HK', url: 'https://www.youtube.com/playlist?list={{id}}', region: 'HK' },
    muse_tw: { title: '木棉花 TW', url: 'https://www.youtube.com/playlist?list={{id}}', region: 'TW' },
    ani_one: { title: 'Ani-One 中文', url: 'https://www.youtube.com/playlist?list={{id}}', region: 'HK' },
    ani_one_asia: { title: 'Ani-One Asia', url: 'https://www.youtube.com/playlist?list={{id}}', region: '' },
    tropics: { title: '回歸線娛樂', url: 'https://www.youtube.com/playlist?list={{id}}', region: 'TW' },
    mighty: { title: '曼迪', url: 'https://www.youtube.com/playlist?list={{id}}', region: 'TW' },
    crunchyroll: { title: 'Crunchyroll', url: 'https://www.crunchyroll.com/series/{{id}}/', region: '' },
    viu: { title: 'Viu', url: 'https://www.viu.com/ott/hk/zh-hk/vod/{{id}}/', region: 'HK' },
    mytv: { title: 'myTV SUPER', url: 'https://www.mytvsuper.com/tc/programme/{{id}}/', region: 'HK' },
    abema: { title: 'ABEMA', url: 'https://abema.tv/video/title/{{id}}', region: 'JP' },
    unext: { title: 'U-NEXT', url: 'https://video.unext.jp/title/{{id}}', region: 'JP' },
    danime: { title: 'dアニメストア', url: 'https://animestore.docomo.ne.jp/animestore/ci_pc?workId={{id}}', region: 'JP' },
    nicovideo: { title: 'Niconico', url: 'https://ch.nicovideo.jp/{{id}}', region: 'JP' },
    prime: { title: 'Prime Video', url: 'https://www.amazon.co.jp/gp/video/detail/{{id}}', region: 'JP' },
    disneyplus: { title: 'Disney+', url: 'https://www.disneyplus.com/series/view/{{id}}', region: '' },
    tmdb: { title: 'TMDB', url: 'https://www.themoviedb.org/{{id}}', region: '', info: true },
    mal: { title: 'MyAnimeList', url: 'https://myanimelist.net/anime/{{id}}', region: '', info: true },
    aniList: { title: 'AniList', url: 'https://anilist.co/anime/{{id}}', region: '', info: true },
    anidb: { title: 'AniDB', url: 'https://anidb.net/anime/{{id}}', region: '', info: true },
  };

  // 兜底：模板猜错 / 站点没有映射时，给一个站内搜索链接，保证永远可用
  const SITE_SEARCH_FALLBACK = [
    { title: 'B站搜索', url: 'https://search.bilibili.com/all?keyword={{q}}', color: '#fb7299' },
    { title: '巴哈搜索', url: 'https://ani.gamer.com.tw/search.php?kw={{q}}', color: '#1b7fd4' },
    { title: '蜜柑搜索', url: 'https://mikanani.me/Home/Search?searchstr={{q}}', color: '#f5a623' },
    { title: '花園搜索', url: 'https://share.dmhy.org/topics/list?keyword={{q}}', color: '#5aa9e6' },
    { title: 'Nyaa搜索', url: 'https://nyaa.si/?q={{q}}&c=1_0&f=0', color: '#00897b' },
  ];

  const SOURCE_META = {
    mikan: { title: '蜜柑计划', home: 'https://mikanani.me', weight: 30 },
    dmhy: { title: '动漫花园', home: 'https://share.dmhy.org', weight: 26 },
    nyaa: { title: 'Nyaa', home: 'https://nyaa.si', weight: 14 },
    acgnx: { title: 'ACGNX', home: 'https://share.acgnx.se', weight: 12 },
    acgrip: { title: 'ACG.RIP', home: 'https://acg.rip', weight: 8 },
  };

  const DEFAULT_SETTINGS = {
    sources: { mikan: true, dmhy: true, nyaa: true, acgnx: true, acgrip: false },
    resOrder: ['2160', '1080', '720', '480'],      // 画质优先级
    langOrder: ['简', '繁', '日', '英'],            // 字幕优先级
    teamPriority: [],                              // 字幕组优先（可空）
    teamBlacklist: [],
    blockKeywords: ['PV', 'CM', 'NCOP', 'NCED', 'MENU', '预告', 'Preview', 'Sample', '试看'],
    minSeeders: 0,
    maxResults: 12,          // 每集/整季展示条数
    requestInterval: 1200,   // 同源连续请求间隔（ms）
    timeout: 15000,
    bangumiDataTTL: 3,       // bangumi-data 缓存天数
    cacheTTLMinutes: 60,     // 搜索结果缓存分钟
    showTorrentOnly: false,  // true = 只显示有磁链的
  };

  // ==========================================================================
  // 1. 工具
  // ==========================================================================

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function loadSettings() {
    const s = GM_getValue(NS + '.settings', null) || {};
    // 只有「从未保存过 sources」时才用默认值；已保存过就按原样尊重（缺键视为关闭），
    // 否则用户全关后仍会被默认值复活，且以后新增源会悄悄替你打开。
    const sources = s.sources ? Object.assign({}, s.sources) : Object.assign({}, DEFAULT_SETTINGS.sources);
    return Object.assign({}, DEFAULT_SETTINGS, s, { sources });
  }
  let SETTINGS = loadSettings();
  const saveSettings = () => GM_setValue(NS + '.settings', SETTINGS);

  /** GM_xmlhttpRequest → Promise，可带 headers，绕过 CORS */
  function gmGet(url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        url,
        method: opts.method || 'GET',
        headers: Object.assign(
          { Accept: opts.accept || '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7' },
          opts.headers || {}
        ),
        data: opts.data,
        timeout: opts.timeout || SETTINGS.timeout,
        responseType: 'text',
        onload(res) {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText || '');
          else reject(new Error('HTTP ' + res.status + ' @ ' + url));
        },
        onerror() { reject(new Error('网络错误 @ ' + url)); },
        ontimeout() { reject(new Error('超时 @ ' + url)); },
      });
    });
  }

  function decodeEntities(s) {
    if (!s) return '';
    return String(s)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/g, '&');
  }

  const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

  /** 全角 → 半角 + 统一大小写，用于匹配 */
  function norm(s) {
    return String(s || '')
      .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[\u3000]/g, ' ')
      .replace(/[【】\[\]（）()「」『』·・、,，。．.！!？?~～\-_—:：;；/\\|'"”“]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, n = Number(bytes);
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n >= 100 || i === 0 ? 0 : 1) + u[i];
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return '';
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ---- 极简 XML 解析（命名空间无关；RSS 可能被 WAF 换成 HTML，需容错）----
  function xmlItems(xml) {
    if (!xml || /<!doctype html|<html[\s>]/i.test(xml.slice(0, 400))) return [];
    const items = [];
    const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = re.exec(xml))) items.push(m[1]);
    return items;
  }
  // 标签名前缀可选：nyaa:infoHash / torrent:contentLength / 裸 link 都能命中
  const NS_PREFIX = '(?:[\\w.-]+:)?';
  // 注意：必须先 decodeEntities（含 CDATA 解包）再 stripTags——
  // dmhy/acgnx 的 <title><![CDATA[...]]></title> 若先 tag-strip 会被整段删成空串
  function tagText(chunk, name) {
    const m = chunk.match(new RegExp('<' + NS_PREFIX + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + NS_PREFIX + name + '>', 'i'));
    if (!m) return '';
    return decodeEntities(m[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function tagRaw(chunk, name) {
    const m = chunk.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
    return m ? decodeEntities(m[1]).trim() : '';
  }
  function attr(chunk, name, attrName) {
    const m = chunk.match(new RegExp('<' + name + '\\b[^>]*\\b' + attrName + '\\s*=\\s*"([^"]*)"', 'i'));
    return m ? decodeEntities(m[1]).trim() : '';
  }

  // ---- 剧集号识别 ----
  // 仅含分辨率数字：绝不能把 12/10/16 之类放进来，否则「第12话」会被误判过滤掉
  const RES_SET = new Set([360, 480, 540, 576, 720, 1080, 1440, 2160, 4320]);
  const RES_LIST = [4320, 2160, 1440, 1080, 720, 576, 540, 480, 360];
  /**
   * 从种子标题里提取集号。
   * 容忍 [01] / - 01 / 第01话 / EP01 / 01v2；排除 1080p / x265 / 10bit / 年份 / 分辨率。
   */
  function detectEpisodes(rawTitle) {
    const out = { eps: new Set(), isBatch: false, ranges: [] };
    const t = String(rawTitle || '');
    if (!t) return out;

    const okNum = (n, before, after) => {
      if (!Number.isFinite(n) || n <= 0 || n > 1999) return false;
      if (RES_SET.has(n)) return false;                        // 分辨率
      if (n >= 1900 && n <= 2030) return false;                // 年份
      if (/[0-9]/.test(before || '')) return false;            // 前面接数字（属于更长的数）
      if (/[0-9]/.test(after || '')) return false;             // 后面接数字（属于更长的数）
      if (/[xXhH]$/.test(before || '')) return false;          // 1080x / h264
      if (/^\s*(?:p|i|bit|kbps|fps|ch|hz|f)\b/i.test(after || '')) return false; // 1080p / 10bit / 5.1ch
      if (/^\s*[KMG]i?B\b/i.test(after || '')) return false;   // 体积 6.6GiB
      return true;
    };
    const push = (n, before, after) => { if (okNum(n, before, after)) out.eps.add(n); };

    let m;
    // 1) 批量区间：01-28 / 01~12（仅当区间合理，避免把 1080-2160 之类当区间）
    const rangeRe = /(?:\[|\(|【|\s|^)(\d{1,3})\s*[-~～]\s*(\d{1,3})(?:v\d)?(?:\s*[\]\)】]|\s*(?:END|Fin|完|合集|全集)?)/gi;
    while ((m = rangeRe.exec(t))) {
      const a = +m[1], b = +m[2];
      if (a >= 1 && b > a && b - a <= 60 && !RES_SET.has(a) && !RES_SET.has(b)) {
        out.isBatch = true;
        out.ranges.push([a, b]);
      }
    }
    if (/合集|全集|完整版|Complete|Batch|全\s*\d{1,3}\s*[话話集]/i.test(t)) out.isBatch = true;

    // 2) 第N话 / 第N集
    const cnRe = /第\s*(\d{1,4})\s*[话話集回]/g;
    while ((m = cnRe.exec(t))) push(+m[1], '', '');

    // 3) [01] / 【01】 / (01)
    const brRe = /[\[【(]\s*(\d{1,3})(?:v\d)?\s*[\]】)]/g;
    while ((m = brRe.exec(t))) push(+m[1], '[', ']');

    // 4) 分隔符 + 集号：  - 01 / _01 / EP01 / E01 / 空格 01
    const sepRe = /(?:^|[\s\-_\]])(?:EP|EPISODE|E|#)?\s*(\d{1,3})(?:v\d)?(?=$|[\s\-_.\[\]】)])/gi;
    while ((m = sepRe.exec(t))) push(+m[1], m[0].slice(0, -String(m[1]).length), '');

    // 5) 兜底：仅当下面的数字被非字母数字隔开时才算（避免 S01 的 01、1080p 的 108 被误收）
    if (out.eps.size === 0 && out.ranges.length === 0) {
      const anyRe = /(?:^|[^0-9A-Za-z])(\d{1,3})(?=[^0-9A-Za-z]|$)/g;
      while ((m = anyRe.exec(t))) push(+m[1], '', '');
    }

    // 区间展开：与已识别集号取并集（展示层自行截断，不会刷屏）
    out.ranges.forEach(([a, b]) => { for (let i = a; i <= b; i++) out.eps.add(i); });
    return out;
  }

  function detectResolution(t) {
    const s = String(t || '');
    // 关键：不能写 \b1080\b —— "1080p" 中 0 与 p 之间无单词边界，\b 会失配（曾致全部画质解析为 0）
    for (const r of RES_LIST) {
      if (new RegExp('(?:^|[^0-9])' + r + '(?:[^0-9]|$)').test(s)) return r;
    }
    if (/(?:^|[^0-9a-z])4\s*k(?:[^0-9a-z]|$)/i.test(s)) return 2160;
    if (/(?:^|[^0-9a-z])uhd(?:[^0-9a-z]|$)/i.test(s)) return 2160;
    if (/(?:^|[^0-9a-z])2\s*k(?:[^0-9a-z]|$)/i.test(s)) return 1440;
    return 0;
  }

  function detectLang(t) {
    const s = String(t || '');
    if (/简繁|繁简|CHS|简体|GB(?!\w)|BIG5|S\.?C|JPSC|Baha.*简/i.test(s) && /繁/.test(s)) return '简';
    if (/简日|简中|简体|CHS|JPSC|\bSC\b|GB(?!\w)/i.test(s)) return '简';
    if (/繁日|繁中|繁體|CHT|JPTC|\bTC\b|BIG5|Big5/i.test(s)) return '繁';
    if (/简繁|多语|MultiSub|Multi-?Sub/i.test(s)) return '简';
    if (/双语|Bilingual/i.test(s)) return '简';
    if (/英|Eng(lish)?|\bEN\b|Multi/i.test(s)) return '英';
    return '';
  }

  const detectTeam = (t) => {
    const m = String(t || '').match(/^\s*[\[\u3010]([^\]\u3010\u3011]{1,30})[\]\u3011]/);
    return m ? m[1].trim() : '';
  };

  // ==========================================================================
  // 2. bangumi-data 索引（番剧 ↔ 站点 id）
  // ==========================================================================

  const BDA_KEY = NS + '.bangumiData';

  async function getBangumiData() {
    const cached = GM_getValue(BDA_KEY, null);
    const ttlMs = (SETTINGS.bangumiDataTTL || 3) * 86400000;
    if (cached && cached.at && Date.now() - cached.at < ttlMs && cached.index) {
      return { index: cached.index, meta: cached.meta || {} };
    }

    for (const url of BANGUMI_DATA_URLS) {
      try {
        LOG('拉取 bangumi-data:', url);
        const txt = await gmGet(url, { accept: 'application/json', timeout: 30000 });
        const raw = JSON.parse(txt);
        const items = raw && raw.items;
        if (!Array.isArray(items)) throw new Error('items 字段缺失');

        // 精简索引：只留「bangumi_id → {站: id}」。丢掉用不到的 title/titleTranslate，
        // 可把 ~7.5MB 原文压到 ~1.6MB，避免撑爆 GM 存储（Tampermonkey 单值有大小上限）。
        const index = {};
        for (const it of items) {
          const sites = it.sites || [];
          const bgm = sites.find((s) => s.site === 'bangumi' && s.id != null);
          if (!bgm) continue;
          const map = {};
          for (const s of sites) {
            if (!s || s.site === 'bangumi') continue;
            // 实测：少数条目（如 iqiyi 老数据）只有完整 url、没有 id —— 两种都存，取用时再判
            const val = s.id != null ? String(s.id) : (s.url || '');
            if (val && !map[s.site]) map[s.site] = val;
          }
          index[String(bgm.id)] = map;
        }
        // 站点 URL 模板以官方 siteMeta 为准：上游改了只用等数据刷新，不用改脚本——
        // 这才是真正解决「上游一变就废」的做法，自定义模板只作兜底。
        const meta = raw.siteMeta || {};
        GM_setValue(BDA_KEY, { at: Date.now(), index, meta });
        LOG('bangumi-data 索引条数:', Object.keys(index).length, '站点模板:', Object.keys(meta).length);
        return { index, meta };
      } catch (e) {
        LOG('bangumi-data 失败:', url, e.message);
      }
    }
    return null;
  }

  // ---- 站点模板解析（优先 bangumi-data 的 siteMeta）----
  function bdaMeta(key) {
    return (ctxState.bdata && ctxState.bdata.meta && ctxState.bdata.meta[key]) || null;
  }
  function siteTitleFor(key) {
    const m = bdaMeta(key);
    return (m && m.title) || (SITE_TEMPLATES[key] && SITE_TEMPLATES[key].title) || key;
  }
  function siteTypeFor(key) {
    const m = bdaMeta(key);
    const t = (m && m.type) || (SITE_TEMPLATES[key] && SITE_TEMPLATES[key].info ? 'info' : 'onair');
    return t === 'resource' || t === 'info' ? t : 'onair';
  }
  function siteUrlFor(key, val) {
    const m = bdaMeta(key);
    if (m && m.urlTemplate) {
      if (/\{\{\s*id\s*\}\}/.test(m.urlTemplate)) return m.urlTemplate.replace(/\{\{\s*id\s*\}\}/g, encodeURIComponent(val));
      if (/\{\{\s*url\s*\}\}/.test(m.urlTemplate)) return m.urlTemplate.replace(/\{\{\s*url\s*\}\}/g, val);
    }
    const t = SITE_TEMPLATES[key];
    if (t) return t.url.replace('{{id}}', encodeURIComponent(val));
    if (/^https?:\/\//i.test(val)) return val;   // 条目自带完整 URL（部分 iqiyi 老数据）
    return '';
  }

  // ==========================================================================
  // 3. 页面信息采集
  // ==========================================================================

  function parsePath() {
    const ep = location.pathname.match(/\/ep\/(\d+)/);
    const sub = location.pathname.match(/\/subject\/(\d+)/);
    return {
      epId: ep ? ep[1] : null,
      subjectId: sub ? sub[1] : null,
      isEpList: /\/subject\/\d+\/ep\b/.test(location.pathname),
    };
  }

  const V0_CACHE = new Map();
  async function bgmSubject(id) {
    if (V0_CACHE.has(id)) return V0_CACHE.get(id);
    try {
      const txt = await gmGet('https://api.bgm.tv/v0/subjects/' + id, { accept: 'application/json' });
      const j = JSON.parse(txt);
      V0_CACHE.set(id, j);
      return j;
    } catch (e) { LOG('v0 subject 失败', id, e.message); return null; }
  }
  async function bgmEp(id) {
    try {
      const txt = await gmGet('https://api.bgm.tv/v0/episodes/' + id, { accept: 'application/json' });
      return JSON.parse(txt);
    } catch (e) { LOG('v0 ep 失败', e.message); return null; }
  }

  /**
   * B站分集直达：bangumi-data 只给 media_id(md{id})，要拿到「第N集」的播放页需两次解析：
   *   media_id --pgc/review/user--> season_id --pgc/view/web/season--> episodes[{title:"1", id:779775}]
   * 播放页 = https://www.bilibili.com/bangumi/play/ep{id}
   * （两接口已实测：media_id=21087073 → season_id=46089 → 46 条分集，title 为纯数字集号）
   */
  const BILI_CACHE = new Map();
  async function biliEpisodes(mediaId) {
    if (BILI_CACHE.has(mediaId)) return BILI_CACHE.get(mediaId);
    let res = null;
    try {
      const revTxt = await gmGet('https://api.bilibili.com/pgc/review/user?media_id=' + mediaId, { accept: 'application/json' });
      const rev = JSON.parse(revTxt);
      const seasonId = rev && rev.result && rev.result.media && rev.result.media.season_id;
      if (seasonId) {
        const seasTxt = await gmGet('https://api.bilibili.com/pgc/view/web/season?season_id=' + seasonId, { accept: 'application/json' });
        const seas = JSON.parse(seasTxt);
        const eps = ((seas && seas.result && seas.result.episodes) || [])
          .map((e) => ({ sort: parseInt(e.title, 10), url: 'https://www.bilibili.com/bangumi/play/ep' + e.id, name: e.title }))
          .filter((e) => Number.isFinite(e.sort));
        if (eps.length) res = { seasonId, title: (seas.result && seas.result.title) || '', eps };
      }
    } catch (e) { LOG('B站分集解析失败', mediaId, e.message); }
    BILI_CACHE.set(mediaId, res);
    return res;
  }

  /** 在「在线观看」页里补一个 B站分集直达区（可按当前集号高亮） */
  function renderBiliPane(host, mediaId, epSort) {
    const holder = el('div');
    host.appendChild(holder);
    biliEpisodes(mediaId).then((data) => {
      if (!data) return;
      const head = el('div', 'bgmh-sub');
      head.innerHTML = 'B站分集直达' + (data.title ? '（' + esc(data.title) + '）' : '');
      holder.appendChild(head);

      const box = el('div', 'bgmh-sites');
      const limit = ctxState.epSort != null ? data.eps.length : 12;
      const cur = epSort != null ? data.eps.find((e) => e.sort === Number(epSort)) : null;
      if (cur) {
        const a = el('a', 'bgmh-src');
        a.href = cur.url; a.target = '_blank'; a.rel = 'noopener';
        a.innerHTML = `<i style="background:#fb7299"></i>本集 第${esc(cur.name)}集`;
        a.style.fontWeight = '600';
        box.appendChild(a);
      }
      data.eps.slice(0, limit).forEach((e) => {
        if (cur && e.sort === cur.sort) return;
        const a = el('a', 'bgmh-src', '第' + esc(e.name) + '集');
        a.href = e.url; a.target = '_blank'; a.rel = 'noopener';
        box.appendChild(a);
      });
      holder.appendChild(box);
      if (ctxState.epSort == null && data.eps.length > limit) {
        const more = el('div', 'bgmh-sub');
        const b = el('button', 'bgmh-btn mini', `展开全部 ${data.eps.length} 集`);
        b.onclick = () => {
          b.parentNode.removeChild(b);
          holder.removeChild(box);
          const box2 = el('div', 'bgmh-sites');
          data.eps.forEach((e) => {
            const a = el('a', 'bgmh-src', '第' + esc(e.name) + '集');
            a.href = e.url; a.target = '_blank'; a.rel = 'noopener';
            box2.appendChild(a);
          });
          holder.appendChild(box2);
        };
        more.appendChild(b);
        holder.appendChild(more);
      }
    }).catch(() => { });
  }

  /** 解析页面上的基本信息（不联网也能拿到日文原名 / 中文名） */
  function readPageInfo() {
    const info = { title: '', titleCn: '', aliases: [], epsCount: null };

    const h1 = document.querySelector('#headerSubject h1.nameSingle, #headerSubject h1');
    if (h1) {
      const a = h1.querySelector('a');
      info.title = ((a && a.textContent) || h1.textContent || '').replace(/\s+/g, ' ').trim();
      if (a && a.getAttribute('title')) info.titleCn = a.getAttribute('title').trim();
    }
    if (!info.title) info.title = (document.title || '').split('|')[0].trim();

    document.querySelectorAll('ul#infobox li, #infobox li').forEach((li) => {
      const tip = li.querySelector('span.tip');
      if (!tip) return;
      const key = tip.textContent.replace(/[:：]\s*$/, '').trim();
      const val = li.textContent.replace(tip.textContent, '').trim();
      if (key === '中文名' || key === '中文譯名') { if (val && !info.titleCn) info.titleCn = val; }
      else if (key === '别名' || key === '別名') {
        val.split(/[、,，\/]/).map((s) => s.trim()).filter(Boolean).forEach((s) => info.aliases.push(s));
      } else if (key === '话数' || key === '話數') {
        const n = parseInt(val.replace(/[^\d]/g, ''), 10);
        if (n) info.epsCount = n;
      }
    });
    return info;
  }

  // ==========================================================================
  // 4. BT 源
  // ==========================================================================

  const lastRequestAt = {};
  async function throttled(key, fn) {
    const gap = SETTINGS.requestInterval || 1200;
    const last = lastRequestAt[key] || 0;
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt[key] = Date.now();
    return fn();
  }

  function magnetFromHash(hash, name) {
    if (!hash) return '';
    return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name || '')}` +
      '&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce' +
      '&tr=udp%3A%2F%2Fopen.tracker.cl%3A1337%2Fannounce' +
      '&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A6969%2Fannounce' +
      '&tr=http%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce';
  }

  /** 动漫花园：RSS enclosure 直出 magnet（无需再抓详情页） */
  async function searchDmhy(query) {
    const url = 'https://share.dmhy.org/topics/rss/rss.xml?keyword=' + encodeURIComponent(query);
    const xml = await throttled('dmhy', () => gmGet(url));
    return xmlItems(xml).map((it) => {
      const title = tagText(it, 'title');
      const en = attr(it, 'enclosure', 'url');
      const magnet = /^magnet:/i.test(en) ? en : '';
      const desc = stripTags(tagRaw(it, 'description'));
      const sizeM = desc.match(/\[(\d+(?:\.\d+)?\s*[KMGT]i?B)\]/i) || desc.match(/(\d+(?:\.\d+)?\s*[KMGT]i?B)/i);
      return {
        source: 'dmhy',
        title,
        magnet,
        torrent: magnet ? '' : en,
        page: tagText(it, 'link'),
        date: Date.parse(tagText(it, 'pubDate')) || 0,
        sizeText: sizeM ? sizeM[1] : '',
        seeders: null,
        team: detectTeam(title),
      };
    });
  }

  /** 蜜柑计划：优先走 bangumiId 精确订阅，否则关键字搜索。magnet 由 /Home/Episode/{hash} 的 40 位 hash 合成（已验证 == infohash） */
  function parseMikanItems(xml) {
    return xmlItems(xml).map((it) => {
      const title = tagText(it, 'title');
      const link = tagText(it, 'link');
      const hash = (link.match(/\/Home\/Episode\/([0-9a-fA-F]{40})/) || [])[1] || '';
      const len = parseInt(tagText(it, 'contentLength'), 10);
      const desc = stripTags(tagRaw(it, 'description'));
      const sizeM = desc.match(/\[\s*(\d+(?:\.\d+)?\s*[KMGT]i?B)\s*\]/i);
      const pub = tagText(it, 'pubDate');
      return {
        source: 'mikan',
        title,
        magnet: magnetFromHash(hash, title),
        torrent: attr(it, 'enclosure', 'url'),
        page: link,
        date: Date.parse(pub) || 0,
        sizeText: sizeM ? sizeM[1] : (len ? fmtSize(len) : ''),
        bytes: len || 0,
        seeders: null,
        team: detectTeam(title),
      };
    });
  }
  async function searchMikan(query, mikanId) {
    if (mikanId) {
      try {
        const xml = await throttled('mikan', () => gmGet('https://mikanani.me/RSS/Bangumi?bangumiId=' + mikanId));
        const list = parseMikanItems(xml);
        if (list.length) return list;
      } catch (e) { LOG('mikan 订阅失败，回退搜索', e.message); }
    }
    const xml = await throttled('mikan', () => gmGet('https://mikanani.me/RSS/Search?searchstr=' + encodeURIComponent(query)));
    return parseMikanItems(xml);
  }

  /** Nyaa：infoHash → magnet */
  async function searchNyaa(query) {
    const url = 'https://nyaa.si/?page=rss&c=1_0&f=0&q=' + encodeURIComponent(query);
    const xml = await throttled('nyaa', () => gmGet(url));
    return xmlItems(xml).map((it) => {
      const title = tagText(it, 'title');
      const hash = tagText(it, 'infoHash');
      const sizeText = tagText(it, 'size');
      const seeders = parseInt(tagText(it, 'seeders'), 10);
      return {
        source: 'nyaa',
        title,
        magnet: magnetFromHash(hash, title),
        torrent: tagText(it, 'link'),
        page: tagText(it, 'guid'),
        date: Date.parse(tagText(it, 'pubDate')) || 0,
        sizeText,
        seeders: Number.isFinite(seeders) ? seeders : null,
        team: detectTeam(title),
      };
    });
  }

  /** ACGNX：enclosure 直出 magnet */
  async function searchAcgnx(query) {
    const url = 'https://share.acgnx.se/rss.xml?keyword=' + encodeURIComponent(query);
    const xml = await throttled('acgnx', () => gmGet(url));
    return xmlItems(xml).map((it) => {
      const title = tagText(it, 'title');
      const en = attr(it, 'enclosure', 'url') || tagText(it, 'link');
      const magnet = /^magnet:/i.test(en) ? en : '';
      const size = parseInt(tagRaw(it, 'contentLength').replace(/[^\d]/g, ''), 10);
      return {
        source: 'acgnx',
        title,
        magnet,
        torrent: magnet ? '' : en,
        page: tagText(it, 'link'),
        date: Date.parse(tagText(it, 'pubDate')) || 0,
        sizeText: size ? fmtSize(size) : '',
        seeders: null,
        team: detectTeam(title),
      };
    });
  }

  /** ACG.RIP：无 magnet，只给 .torrent + 详情页 */
  async function searchAcgrip(query) {
    const url = 'https://acg.rip/.xml?term=' + encodeURIComponent(query);
    const xml = await throttled('acgrip', () => gmGet(url));
    return xmlItems(xml).map((it) => {
      const title = tagText(it, 'title');
      const size = parseInt(tagRaw(it, 'contentLength').replace(/[^\d]/g, ''), 10);
      return {
        source: 'acgrip',
        title,
        magnet: '',
        torrent: attr(it, 'enclosure', 'url'),
        page: tagText(it, 'link'),
        date: Date.parse(tagText(it, 'pubDate')) || 0,
        sizeText: size ? fmtSize(size) : '',
        seeders: null,
        team: detectTeam(title),
      };
    });
  }

  // ==========================================================================
  // 5. 策略：过滤 + 排序
  // ==========================================================================

  function applyStrategy(list, ctx) {
    const S = SETTINGS;
    const seen = new Set();
    const out = [];

    for (const r of list) {
      if (!r || !r.title) continue;
      const key = r.magnet || r.torrent || r.title;
      if (seen.has(key)) continue;
      seen.add(key);

      const hay = norm(r.title);
      if (S.blockKeywords.some((k) => k && hay.includes(norm(k)))) continue;
      if (S.teamBlacklist.some((k) => k && norm(r.team).includes(norm(k)))) continue;
      if (S.showTorrentOnly && !r.magnet && !r.torrent) continue;
      if (S.minSeeders > 0 && r.seeders != null && r.seeders < S.minSeeders) continue;

      const ep = detectEpisodes(r.title);
      r._ep = ep;
      r._res = detectResolution(r.title);
      r._lang = detectLang(r.title) || (r.source === 'nyaa' ? '英' : '');
      r._score = score(r, ctx, ep);
      out.push(r);
    }

    out.sort((a, b) => b._score - a._score);
    return out;
  }

  function score(r, ctx, ep) {
    const S = SETTINGS;
    let s = 0;

    // 源权重
    s += (SOURCE_META[r.source] && SOURCE_META[r.source].weight) || 0;

    // 画质
    const ri = S.resOrder.indexOf(String(r._res));
    s += ri === -1 ? 0 : (S.resOrder.length - ri) * 120;

    // 字幕语言
    const li = S.langOrder.indexOf(r._lang);
    s += li === -1 ? 0 : (S.langOrder.length - li) * 60;

    // 字幕组优先
    if (r.team) {
      const wi = S.teamPriority.findIndex((t) => norm(t) && norm(r.team).includes(norm(t)));
      if (wi !== -1) s += (S.teamPriority.length - wi) * 40;
    }

    // 集数命中
    if (ctx && ctx.ep != null) {
      if (ep.eps.has(Number(ctx.ep))) s += 300;
      else if (ep.isBatch) s -= 45;
      else s -= 25;
    }

    // 做种
    if (r.seeders != null) s += Math.min(r.seeders, 200) * 0.8;

    // 时效
    if (r.date) {
      const days = (Date.now() - r.date) / 86400000;
      if (days >= 0) s += Math.max(0, 40 - days / 8);
    }
    return s;
  }

  // ==========================================================================
  // 6. 结果缓存
  // ==========================================================================

  function cacheGet(key) {
    const v = GM_getValue(NS + '.c.' + key, null);
    if (!v) return null;
    if (Date.now() - v.at > (SETTINGS.cacheTTLMinutes || 60) * 60000) return null;
    return v.list;
  }
  function cacheSet(key, list) {
    try { GM_setValue(NS + '.c.' + key, { at: Date.now(), list }); } catch (e) { LOG('缓存写入失败', e.message); }
  }
  function clearCache() {
    const all = GM_listValues ? GM_listValues() : [];
    all.forEach((k) => { if (k.indexOf(NS + '.c.') === 0) GM_deleteValue(k); });
  }

  // ==========================================================================
  // 7. UI
  // ==========================================================================

  const CSS = `
.bgmh-box{border:1px solid #e8e3dc;border-radius:4px;background:#fff;margin:10px 0;font-size:13px;line-height:1.7;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.bgmh-box *{box-sizing:border-box}
.bgmh-head{display:flex;align-items:center;gap:8px;padding:7px 10px;background:linear-gradient(#fbfaf8,#f3f0eb);border-bottom:1px solid #e8e3dc;font-weight:600;color:#4b453d;cursor:pointer;user-select:none}
.bgmh-head .bgmh-sp{flex:1}
.bgmh-head .bgmh-ic{font-weight:400;color:#9b9287;font-size:12px}
.bgmh-btn{display:inline-block;padding:1px 8px;border:1px solid #d9d3ca;border-radius:3px;background:#fff;color:#6c655c;cursor:pointer;font-size:12px;line-height:1.9;text-decoration:none!important;white-space:nowrap}
.bgmh-btn:hover{background:#f6f3ef;border-color:#c3bbb0;color:#4b453d}
.bgmh-btn.on{background:#f09199;border-color:#f09199;color:#fff}
.bgmh-btn.mini{padding:0 6px;font-size:11px;line-height:1.8}
.bgmh-tabs{display:flex;gap:0;border-bottom:1px solid #eee9e2;background:#faf8f5}
.bgmh-tab{padding:6px 14px;cursor:pointer;color:#8a8177;font-size:13px;border-bottom:2px solid transparent}
.bgmh-tab.on{color:#e5697a;border-bottom-color:#f09199;background:#fff;font-weight:600}
.bgmh-pane{display:none;padding:10px}
.bgmh-pane.on{display:block}
.bgmh-sites{display:flex;flex-wrap:wrap;gap:6px}
.bgmh-src{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:1px solid #e2ddd5;border-radius:14px;background:#fdfcfa;color:#5a534a!important;text-decoration:none!important;font-size:12px}
.bgmh-src:hover{background:#f6f1ec;border-color:#f09199;color:#e5697a!important}
.bgmh-src i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#c9c2b8}
.bgmh-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}
.bgmh-toolbar input[type=text]{flex:1;min-width:150px;padding:3px 7px;border:1px solid #ddd7cf;border-radius:3px;font-size:12px}
.bgmh-toolbar label{display:inline-flex;align-items:center;gap:3px;font-size:12px;color:#7a7268;cursor:pointer}
.bgmh-sub{color:#9b9287;font-size:12px;margin:6px 0}
.bgmh-list{display:flex;flex-direction:column;gap:5px}
.bgmh-item{display:flex;gap:7px;align-items:flex-start;padding:6px 8px;border:1px solid #efeae3;border-radius:3px;background:#fdfcfa}
.bgmh-item:hover{border-color:#e6ddd1;background:#fff9f5}
.bgmh-item .bgmh-t{flex:1;word-break:break-all;color:#4b453d;font-size:12.5px;line-height:1.6}
.bgmh-tags{margin-top:2px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.bgmh-tag{font-size:10.5px;padding:0 5px;border-radius:2px;background:#f0ece6;color:#877e73;line-height:1.7}
.bgmh-tag.s{margin-left:auto}
.bgmh-tag.res{background:#eaf3fb;color:#3c7bb0}
.bgmh-tag.ep{background:#fdeef0;color:#d75f70}
.bgmh-act{display:flex;gap:4px;flex-shrink:0;padding-top:1px}
.bgmh-a{font-size:11.5px;padding:1px 7px;border-radius:3px;text-decoration:none!important;line-height:1.9;white-space:nowrap}
.bgmh-a.magnet{background:#f09199;color:#fff!important}
.bgmh-a.magnet:hover{background:#e07d86}
.bgmh-a.torrent{background:#eef4ee;color:#5a8a5a!important;border:1px solid #d6e3d6}
.bgmh-a.page{background:#f4f2ef;color:#7a7268!important;border:1px solid #e2ddd5}
.bgmh-empty{color:#a49b90;font-size:12px;padding:10px;text-align:center}
.bgmh-err{color:#c0584f;font-size:12px;padding:6px 8px;background:#fdf1f0;border:1px solid #f5ddd9;border-radius:3px}
.bgmh-loading{color:#a49b90;font-size:12px;padding:8px;text-align:center}
.bgmh-epbtn{display:inline-block;margin-left:6px;padding:0 6px;border:1px solid #e2ddd5;border-radius:3px;background:#faf8f5;color:#9b9287;cursor:pointer;font-size:11px;vertical-align:middle}
.bgmh-epbtn:hover{border-color:#f09199;color:#e5697a;background:#fff}
.bgmh-epres{margin:6px 0 10px;padding:8px;border-left:3px solid #f09199;background:#fdfaf8;border-radius:3px}
.bgmh-set{display:grid;grid-template-columns:96px 1fr;gap:6px 10px;align-items:center;padding:4px 0}
.bgmh-set label{color:#7a7268;font-size:12px}
.bgmh-set input[type=text]{width:100%;padding:3px 7px;border:1px solid #ddd7cf;border-radius:3px;font-size:12px}
.bgmh-hint{grid-column:1/-1;color:#a49b90;font-size:11px;margin:-2px 0 4px}
.bgmh-collapsed .bgmh-tabs,.bgmh-collapsed .bgmh-body{display:none}
`;

  let panel, bodyEl, ctxState = { subjectId: null, epId: null, epSort: null, info: null, bdata: null };
  let searchToken = 0;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function renderStreamPane(pane) {
    pane.innerHTML = '';
    const info = ctxState.info;
    const bdata = ctxState.bdata;
    const entry = bdata && bdata.index && ctxState.subjectId ? bdata.index[ctxState.subjectId] : null;

    const wrap = el('div');
    if (entry) {
      const sites = Object.keys(entry);
      const onair = sites.filter((k) => siteTypeFor(k) === 'onair');
      const infoSites = sites.filter((k) => siteTypeFor(k) === 'info');
      const unknown = sites.filter((k) => !SITE_TEMPLATES[k] && !bdaMeta(k));

      if (onair.length) {
        wrap.appendChild(el('div', 'bgmh-sub', '在线观看（数据来源 bangumi-data，点击进入对应站点）'));
        const box = el('div', 'bgmh-sites');
        onair.forEach((k) => {
          const href = siteUrlFor(k, entry[k]);
          if (!href) return;
          const a = el('a', 'bgmh-src');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener';
          const color = (SITE_TEMPLATES[k] && SITE_TEMPLATES[k].color) || '#c9c2b8';
          const region = bdaMeta(k) && bdaMeta(k).regions ? bdaMeta(k).regions[0] : ((SITE_TEMPLATES[k] && SITE_TEMPLATES[k].region) || '');
          a.innerHTML = `<i style="background:${color}"></i>${esc(siteTitleFor(k))}` +
            (region ? `<span style="color:#bbb;font-size:11px">${esc(region)}</span>` : '');
          box.appendChild(a);
        });
        if (box.childNodes.length) wrap.appendChild(box);

        // 有 B站映射时，进一步展开「分集直达」（只在 bgm.tv 详情页做，章节页已有逐集 BT）
        const biliKey = ['bilibili', 'bilibili_hk_mo_tw', 'bilibili_hk_mo', 'bilibili_tw'].find((k) => entry[k]);
        if (biliKey) {
          try { renderBiliPane(wrap, entry[biliKey], ctxState.epSort); } catch (e) { LOG('B站分集区渲染失败', e); }
        }
      } else {
        wrap.appendChild(el('div', 'bgmh-sub', 'bangumi-data 未登记该番的正版在线源，用下面的站内搜索兜底：'));
      }

      if (infoSites.length) {
        wrap.appendChild(el('div', 'bgmh-sub', '资料站'));
        const box2 = el('div', 'bgmh-sites');
        infoSites.forEach((k) => {
          const href = siteUrlFor(k, entry[k]);
          if (!href) return;
          const a = el('a', 'bgmh-src', esc(siteTitleFor(k)));
          a.href = href;
          a.target = '_blank'; a.rel = 'noopener';
          box2.appendChild(a);
        });
        if (box2.childNodes.length) wrap.appendChild(box2);
      }
      if (unknown.length) {
        wrap.appendChild(el('div', 'bgmh-sub', '其他收录：' + unknown.map((k) => esc(k)).join('、')));
      }
    } else {
      wrap.appendChild(el('div', 'bgmh-sub',
        bdata ? '该条目不在 bangumi-data 索引里（新番常见），用站内搜索兜底：' : 'bangumi-data 未加载成功，用站内搜索兜底：'));
    }

    // 兜底搜索
    const q = info.titleCn || info.title || '';
    const fbTitle = el('div', 'bgmh-sub', '站内搜索兜底');
    wrap.appendChild(fbTitle);
    const fbox = el('div', 'bgmh-sites');
    SITE_SEARCH_FALLBACK.forEach((s) => {
      const a = el('a', 'bgmh-src', esc(s.title));
      a.href = s.url.replace('{{q}}', encodeURIComponent(q));
      a.target = '_blank'; a.rel = 'noopener';
      fbox.appendChild(a);
    });
    wrap.appendChild(fbox);

    if (info.aliases && info.aliases.length) {
      wrap.appendChild(el('div', 'bgmh-sub', '别名：' + esc(info.aliases.slice(0, 8).join(' / '))));
    }
    pane.appendChild(wrap);
  }

  function isBlocked() {
    const S = SETTINGS;
    return !Object.keys(S.sources).some((k) => S.sources[k]);
  }

  function renderBtPane(pane) {
    pane.innerHTML = '';
    const info = ctxState.info;

    const tb = el('div', 'bgmh-toolbar');
    const input = el('input');
    input.type = 'text';
    input.value = pane.dataset.query || info.titleCn || info.title || '';
    input.placeholder = '搜索关键词';
    const btn = el('button', 'bgmh-btn', '搜索');
    const srcBox = el('span');
    srcBox.style.cssText = 'display:inline-flex;gap:8px;flex-wrap:wrap';

    Object.keys(SOURCE_META).forEach((k) => {
      const lab = el('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!SETTINGS.sources[k];
      cb.onchange = () => { SETTINGS.sources[k] = cb.checked; saveSettings(); };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(SOURCE_META[k].title));
      srcBox.appendChild(lab);
    });

    tb.appendChild(input);
    tb.appendChild(btn);
    const res = el('div');

    const doSearch = (force) => {
      pane.dataset.query = input.value.trim();
      runSearch(pane.dataset.query, res, force);
    };
    btn.onclick = () => doSearch(true);
    input.onkeydown = (e) => { if (e.key === 'Enter') doSearch(true); };

    pane.appendChild(tb);
    pane.appendChild(srcBox);
    pane.appendChild(el('div', 'bgmh-sub', ctxState.epSort != null ? `按第 ${ctxState.epSort} 集筛选` : '整季资源（已按策略排序）'));
    pane.appendChild(res);

    if (isBlocked()) {
      res.appendChild(el('div', 'bgmh-empty', '请至少勾选一个 BT 源'));
    } else {
      doSearch(false);
    }
  }

  function renderResults(container, list, ctx, onMore) {
    container.innerHTML = '';
    if (!list.length) {
      container.appendChild(el('div', 'bgmh-empty', '没有搜到结果。换个关键词，或到源站手动搜索。'));
      return;
    }
    const S = SETTINGS;
    const max = ctx.max || S.maxResults;
    const show = list.slice(0, max);
    const box = el('div', 'bgmh-list');

    show.forEach((r) => {
      const item = el('div', 'bgmh-item');
      const t = el('div', 'bgmh-t');
      t.appendChild(document.createTextNode(r.title));

      const tags = el('div', 'bgmh-tags');
      const srcName = (SOURCE_META[r.source] && SOURCE_META[r.source].title) || r.source;
      tags.appendChild(el('span', 'bgmh-tag', esc(srcName)));
      if (r._res) tags.appendChild(el('span', 'bgmh-tag res', r._res + 'p'));
      if (r._lang) tags.appendChild(el('span', 'bgmh-tag', esc(r._lang)));
      if (r._ep && r._ep.eps.size && r._ep.eps.size <= 6) {
        tags.appendChild(el('span', 'bgmh-tag ep', 'EP ' + [...r._ep.eps].sort((a, b) => a - b).join('·')));
      } else if (r._ep && r._ep.isBatch) {
        tags.appendChild(el('span', 'bgmh-tag ep', '合集'));
      }
      if (r.sizeText) tags.appendChild(el('span', 'bgmh-tag', esc(r.sizeText)));
      if (r.seeders != null) tags.appendChild(el('span', 'bgmh-tag', '↑' + r.seeders));
      if (r.date) tags.appendChild(el('span', 'bgmh-tag s', fmtDate(r.date)));
      t.appendChild(tags);

      const act = el('div', 'bgmh-act');
      if (r.magnet) {
        const a = el('a', 'bgmh-a magnet', '磁链');
        a.href = r.magnet;
        a.title = '点击唤起 BT 客户端';
        act.appendChild(a);
      }
      if (r.torrent) {
        const a = el('a', 'bgmh-a torrent', '种子');
        a.href = r.torrent; a.target = '_blank'; a.rel = 'noopener';
        act.appendChild(a);
      }
      if (r.page) {
        const a = el('a', 'bgmh-a page', '详情');
        a.href = r.page; a.target = '_blank'; a.rel = 'noopener';
        act.appendChild(a);
      }
      item.appendChild(t);
      item.appendChild(act);
      box.appendChild(item);
    });

    container.appendChild(box);

    if (list.length > max) {
      const more = el('div', 'bgmh-sub');
      more.style.textAlign = 'center';
      const b = el('button', 'bgmh-btn mini', `展开全部 ${list.length} 条`);
      b.onclick = () => renderResults(container, list, Object.assign({}, ctx, { max: list.length }));
      more.appendChild(b);
      container.appendChild(more);
    }
  }

  async function runSearch(query, container, force) {
    if (!query) { container.innerHTML = ''; container.appendChild(el('div', 'bgmh-empty', '请输入关键词')); return; }
    if (isBlocked()) { container.innerHTML = ''; container.appendChild(el('div', 'bgmh-empty', '请至少勾选一个 BT 源')); return; }

    const token = ++searchToken;
    const epKey = ctxState.epSort != null ? '@' + ctxState.epSort : '';
    const cacheKey = (ctxState.subjectId || location.pathname) + '|' + query + '|' +
      Object.keys(SETTINGS.sources).filter((k) => SETTINGS.sources[k]).join(',') + epKey;

    if (!force) {
      const c = cacheGet(cacheKey);
      if (c) { renderResults(container, c, { ep: ctxState.epSort }); return; }
    }

    container.innerHTML = '';
    container.appendChild(el('div', 'bgmh-loading', '正在搜索…'));

    const entry = ctxState.bdata && ctxState.bdata.index && ctxState.subjectId ? ctxState.bdata.index[ctxState.subjectId] : null;
    const hints = entry || {};
    const tasks = [];
    const errs = [];

    // 章节页按集搜索时不走 bangumiId 订阅（订阅是整季的，集号筛选交给 applyStrategy）
    const useMikanIndex = !epKey;
    if (SETTINGS.sources.mikan) tasks.push(searchMikan(query, useMikanIndex ? hints.mikan : null).catch((e) => { errs.push('蜜柑: ' + e.message); return []; }));
    if (SETTINGS.sources.dmhy) tasks.push(searchDmhy(query).catch((e) => { errs.push('花園: ' + e.message); return []; }));
    if (SETTINGS.sources.nyaa) tasks.push(searchNyaa(query).catch((e) => { errs.push('Nyaa: ' + e.message); return []; }));
    if (SETTINGS.sources.acgnx) tasks.push(searchAcgnx(query).catch((e) => { errs.push('ACGNX: ' + e.message); return []; }));
    if (SETTINGS.sources.acgrip) tasks.push(searchAcgrip(query).catch((e) => { errs.push('ACG.RIP: ' + e.message); return []; }));

    const merged = (await Promise.all(tasks)).flat();
    if (token !== searchToken) return; // 有更新的搜索，丢弃本次

    const list = applyStrategy(merged, { ep: ctxState.epSort });
    cacheSet(cacheKey, list);

    container.innerHTML = '';
    if (errs.length) container.appendChild(el('div', 'bgmh-err', errs.join('；')));
    renderResults(container, list, { ep: ctxState.epSort });
  }

  function renderSettingsPane(pane) {
    pane.innerHTML = '';
    const grid = el('div', 'bgmh-set');
    const rows = [
      ['画质优先', 'resOrder', '逗号分隔，如 2160,1080,720'],
      ['字幕优先', 'langOrder', '简,繁,日,英'],
      ['字幕组优先', 'teamPriority', '如 LoliHouse,喵萌奶茶屋'],
      ['字幕组拉黑', 'teamBlacklist', '命中即丢弃'],
      ['屏蔽关键词', 'blockKeywords', 'PV,CM,NCOP 等'],
    ];
    rows.forEach(([label, key, hint]) => {
      const l = el('label', null, esc(label));
      const inp = el('input');
      inp.type = 'text';
      inp.value = (SETTINGS[key] || []).join(',');
      inp.onchange = () => {
        SETTINGS[key] = inp.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        saveSettings();
      };
      grid.appendChild(l);
      grid.appendChild(inp);
      grid.appendChild(el('div', 'bgmh-hint', esc(hint)));
    });

    [['每源展示条数', 'maxResults', 1], ['最低做种', 'minSeeders', 0],
    ['请求间隔(ms)', 'requestInterval', 0], ['缓存(分钟)', 'cacheTTLMinutes', 0],
    ['bangumi-data缓存(天)', 'bangumiDataTTL', 1]].forEach(([label, key, min]) => {
      const l = el('label', null, esc(label));
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = min;
      inp.value = SETTINGS[key];
      inp.style.cssText = 'width:100%;padding:3px 7px;border:1px solid #ddd7cf;border-radius:3px;font-size:12px';
      inp.onchange = () => {
        const v = Number(inp.value);
        if (Number.isFinite(v)) { SETTINGS[key] = v; saveSettings(); }
      };
      grid.appendChild(l);
      grid.appendChild(inp);
      grid.appendChild(el('div', 'bgmh-hint', ''));
    });

    const l2 = el('label', null, '只显示带磁链');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!SETTINGS.showTorrentOnly;
    cb.onchange = () => { SETTINGS.showTorrentOnly = cb.checked; saveSettings(); };
    grid.appendChild(l2); grid.appendChild(cb); grid.appendChild(el('div', 'bgmh-hint', ''));

    pane.appendChild(grid);

    const ops = el('div', 'bgmh-toolbar');
    ops.style.marginTop = '8px';
    const bReset = el('button', 'bgmh-btn', '恢复默认');
    bReset.onclick = () => {
      if (confirm('恢复所有设置为默认值？')) { GM_setValue(NS + '.settings', null); SETTINGS = loadSettings(); renderPanel(); }
    };
    const bCache = el('button', 'bgmh-btn', '清空搜索缓存');
    bCache.onclick = () => { clearCache(); alert('已清空搜索缓存'); };
    const bData = el('button', 'bgmh-btn', '重新拉取 bangumi-data');
    bData.onclick = async () => {
      GM_deleteValue(BDA_KEY);
      bData.textContent = '拉取中…';
      ctxState.bdata = await getBangumiData();
      bData.textContent = '重新拉取 bangumi-data';
      renderStreamPane(document.querySelector('#bgmh-pane-stream'));
      alert(ctxState.bdata ? '已更新，共 ' + Object.keys(ctxState.bdata.index).length + ' 条索引' : '拉取失败，请检查 @connect / 网络');
    };
    ops.appendChild(bReset); ops.appendChild(bCache); ops.appendChild(bData);
    pane.appendChild(ops);
    pane.appendChild(el('div', 'bgmh-hint',
      '修改立即生效（搜索缓存不会自动失效，可点「清空搜索缓存」）。策略排序：源权重 → 画质 → 字幕 → 字幕组 → 集数命中 → 做种 → 时效。'));
  }

  function renderPanel() {
    if (!panel) return;
    renderStreamPane(panel.querySelector('#bgmh-pane-stream'));
    renderBtPane(panel.querySelector('#bgmh-pane-bt'));
    renderSettingsPane(panel.querySelector('#bgmh-pane-set'));
  }

  function buildPanel() {
    if (document.getElementById('bgmh-panel')) return;
    panel = el('div', 'bgmh-box');
    panel.id = 'bgmh-panel';

    const head = el('div', 'bgmh-head');
    head.innerHTML = '<span>🎬 番源 &amp; BT 磁链</span><span class="bgmh-sp"></span>' +
      '<span class="bgmh-ic">点击折叠 / 展开</span>';
    head.onclick = () => panel.classList.toggle('bgmh-collapsed');

    const tabs = el('div', 'bgmh-tabs');
    const paneWrap = el('div', 'bgmh-body');
    const panes = {
      stream: el('div', 'bgmh-pane on'), bt: el('div', 'bgmh-pane'), set: el('div', 'bgmh-pane'),
    };
    panes.stream.id = 'bgmh-pane-stream';
    panes.bt.id = 'bgmh-pane-bt';
    panes.set.id = 'bgmh-pane-set';

    [['stream', '在线观看'], ['bt', 'BT 下载'], ['set', '设置']].forEach(([k, label]) => {
      const t = el('div', 'bgmh-tab' + (k === 'stream' ? ' on' : ''), esc(label));
      t.onclick = () => {
        tabs.querySelectorAll('.bgmh-tab').forEach((x) => x.classList.remove('on'));
        t.classList.add('on');
        Object.keys(panes).forEach((x) => panes[x].classList.toggle('on', x === k));
      };
      tabs.appendChild(t);
    });

    Object.keys(panes).forEach((k) => paneWrap.appendChild(panes[k]));
    panel.appendChild(head);
    panel.appendChild(tabs);
    panel.appendChild(paneWrap);

    // 插入位置：主栏最上方（subject 页 / ep 页 / 章节页结构不同，逐一兜底）
    const host = document.querySelector('#columnSubjectHomeA') ||
      document.querySelector('#columnInSubjectA') ||
      document.querySelector('#columnSubjectHomeB') ||
      document.querySelector('.column-main') ||
      document.querySelector('#main') ||
      document.body;
    const anchor = document.querySelector('#bangumiInfo');
    if (anchor && anchor.parentNode === host) host.insertBefore(panel, anchor.nextSibling);
    else host.insertBefore(panel, host.firstChild);

    bodyEl = paneWrap;
    renderPanel();
  }

  // ==========================================================================
  // 8. 章节页：每集一个 🔍
  // ==========================================================================

  function enhanceEpList() {
    const rows = document.querySelectorAll('li.line_odd, li.line_even');
    rows.forEach((row) => {
      if (row.dataset.bgmh) return;
      const h6 = row.querySelector('h6');
      const a = h6 && h6.querySelector('a[href^="/ep/"]');
      if (!a) return;
      row.dataset.bgmh = '1';

      const sortM = a.textContent.match(/^\s*([\d.]+)\s*\./);
      const sort = sortM ? parseFloat(sortM[1]) : null;
      const epId = (a.getAttribute('href').match(/\/ep\/(\d+)/) || [])[1];

      const btn = el('span', 'bgmh-epbtn', '🔍 BT');
      btn.title = '搜索该集的 BT 资源';
      let box = null;
      btn.onclick = async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (box && box.parentNode) { box.parentNode.removeChild(box); box = null; return; }
        box = el('div', 'bgmh-epres');
        box.appendChild(el('div', 'bgmh-loading', '搜索中…'));
        row.parentNode.insertBefore(box, row.nextSibling);

        const query = ctxState.info.titleCn || ctxState.info.title;
        const entry = ctxState.bdata && ctxState.bdata.index && ctxState.subjectId ? ctxState.bdata.index[ctxState.subjectId] : null;
        const key = (ctxState.subjectId || '') + '|ep' + (sort != null ? sort : epId) + '|' + query;

        let list = cacheGet(key);
        if (!list) {
          const tasks = [];
          const errs = [];
          if (SETTINGS.sources.dmhy) tasks.push(searchDmhy(query).catch((er) => { errs.push('花園: ' + er.message); return []; }));
          if (SETTINGS.sources.mikan) tasks.push(searchMikan(query, entry && entry.mikan).catch((er) => { errs.push('蜜柑: ' + er.message); return []; }));
          if (SETTINGS.sources.nyaa) tasks.push(searchNyaa(query).catch((er) => { errs.push('Nyaa: ' + er.message); return []; }));
          if (SETTINGS.sources.acgnx) tasks.push(searchAcgnx(query).catch((er) => { errs.push('ACGNX: ' + er.message); return []; }));
          if (SETTINGS.sources.acgrip) tasks.push(searchAcgrip(query).catch((er) => { errs.push('ACG.RIP: ' + er.message); return []; }));
          const merged = (await Promise.all(tasks)).flat();
          list = applyStrategy(merged, { ep: sort });
          cacheSet(key, list);
        }

        box.innerHTML = '';
        if (sort != null) {
          const hit = list.filter((r) => r._ep && r._ep.eps.has(sort));
          if (hit.length) {
            box.appendChild(el('div', 'bgmh-sub', `第 ${sort} 集匹配到 ${hit.length} 条`));
            renderResults(box, hit, { ep: sort, max: 6 });
          } else if (list.length) {
            box.appendChild(el('div', 'bgmh-sub', `未找到精确匹配第 ${sort} 集的条目（可能跨季编号不一致），下面是整季资源：`));
            renderResults(box, list, { ep: sort, max: 6 });
          } else {
            box.appendChild(el('div', 'bgmh-empty', '没有结果'));
          }
        } else {
          renderResults(box, list, { ep: null, max: 8 });
        }
      };

      const holder = row.querySelector('h6');
      if (holder) holder.appendChild(btn);
    });
  }

  // ==========================================================================
  // 9. 启动
  // ==========================================================================

  async function main() {
    GM_addStyle(CSS);
    const p = parsePath();
    ctxState.subjectId = p.subjectId;
    ctxState.epId = p.epId;
    ctxState.info = readPageInfo();

    // /ep/{id} 上先解析出所属条目，才能查映射、算集号
    if (p.epId) {
      const ep = await bgmEp(p.epId);
      if (ep) {
        ctxState.subjectId = String(ep.subject_id);
        ctxState.epSort = ep.sort != null ? ep.sort : null;
        if (ep.name_cn || ep.name) ctxState.info.epName = ep.name_cn || ep.name;
      }
    }

    // 用 v0 补全别名 / 中文名 / 话数（拿不到就用 DOM 的）
    if (ctxState.subjectId) {
      const sub = await bgmSubject(ctxState.subjectId);
      if (sub) {
        if (sub.name) ctxState.info.title = sub.name;
        if (sub.name_cn) ctxState.info.titleCn = sub.name_cn;
        (sub.infobox || []).forEach((kv) => {
          if (kv.key === '别名' && Array.isArray(kv.value)) {
            kv.value.forEach((v) => { const t = v && (v.v || v.k); if (t && !ctxState.info.aliases.includes(t)) ctxState.info.aliases.push(t); });
          }
          if (kv.key === '中文名' && typeof kv.value === 'string' && !ctxState.info.titleCn) ctxState.info.titleCn = kv.value;
        });
      }
    }

    buildPanel();

    if (p.isEpList) enhanceEpList();

    // bangumi-data 异步加载，不阻塞面板
    getBangumiData().then((d) => {
      ctxState.bdata = d;
      renderStreamPane(panel.querySelector('#bgmh-pane-stream'));
    });
  }

  // 菜单
  try {
    GM_registerMenuCommand('清空搜索缓存', () => { clearCache(); alert('已清空'); });
    GM_registerMenuCommand('重新拉取 bangumi-data', async () => {
      GM_deleteValue(BDA_KEY);
      const d = await getBangumiData();
      ctxState.bdata = d;
      if (panel) renderStreamPane(panel.querySelector('#bgmh-pane-stream'));
      alert(d ? 'OK，' + Object.keys(d).length + ' 条' : '失败');
    });
  } catch (e) { /* 部分管理器不支持 */ }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
