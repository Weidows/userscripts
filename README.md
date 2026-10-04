# userscripts

个人用户脚本（油猴 / ScriptCat）合集。

所有脚本均为**后台静默自动化**类型，基于 [ScriptCat](https://scriptcat.org/zh-CN/) 的后台脚本与 `@crontab` 定时能力实现，无需手动打开页面。

## 安装方式

1. 浏览器安装扩展：
   - [ScriptCat（推荐，原生支持后台脚本与定时）](https://chromewebstore.google.com/detail/scriptcat/ndcooeababalnlpkfedmmbbbgkljhpjf)
   - [Tampermonkey（兼容，但无后台定时能力）](https://www.tampermonkey.net/)
2. 点击下方脚本的 **「安装」** 按钮，或在 ScriptCat 中「新建脚本 → 从 URL 安装」粘贴 raw 链接。
3. 首次使用请先在浏览器中**登录对应网站**（脚本依赖浏览器 Cookie 鉴权）。
4. 启用脚本即可，无需任何额外配置。

> 安装按钮均为一键跳转 ScriptCat 安装页；`url` 参数为 GitHub raw 文件地址。

### [Epic 每周免费游戏自动领取](scripts/epic-freegame-claimer.user.js)

每周自动领取 Epic Games Store 的本周免费游戏（查询促销 → 校验登录态 → 下单 free 订单），未登录会弹可点击的登录提示。

- 类型：ScriptCat 后台定时脚本（`@crontab`）
- 调度：`* * once * 4`（每周四首次匹配即执行，当日幂等，防重跑；已带"本周已领过"去重，不会重复下单）
- 机制：对照 epicgames-freegames-node 的真实请求体，用带 Cookie 的 `GM_xmlhttpRequest` 走 `order-preview` → `confirm-order` 完成免费下单；公开接口 `freeGamesPromotions` 取当前免费游戏，`account/v2/refresh-csrf` 取 XSRF 并兼作登录态判定
- 未登录处理：CSRF/下单被重定向到登录页即弹「可点击打开登录页」通知并放弃本次（重试无意义）
- 边界：依赖浏览器里 store.epicgames.com 的登录 Cookie（同 `.epicgames.com` 域共享）；极少数情况触发 Arkose 验证码会失败并提示手动领取；兑换码类免费游戏（`isCodeRedemptionOnly`）无法自动领取，会被跳过

[![安装到 ScriptCat](https://img.shields.io/badge/ScriptCat-一键安装-9cf.svg)](https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/epic-freegame-claimer.user.js)
[![查看源码](https://img.shields.io/badge/源码-GitHub-181717.svg)](scripts/epic-freegame-claimer.user.js)

#### 自定义执行时间

编辑脚本元信息的 `@crontab` 行：

```js
// @crontab      * * once * 4          // ↑ 这一行不能带行内注释！改成下面任一行时删掉后面的 // 说明
// @crontab      * * once * 4
// @crontab      10 22 once * 4        // 对齐北京时间新游上架后，每周四 22:10 跑
// @crontab      * * once * *          // 每天检查一次（已去重，不会重复下单）
```

#### 验证

- ScriptCat 脚本列表，悬停「运行状态」列查看下次执行时间，点击查看 `GM_log` 日志
- 登录态判定：未登录时首次运行会弹「需要登录」通知，点开即跳登录页
- 领取结果：对比领取前后库内游戏（Epic 客户端「库」页）确认

## 脚本列表

### [ModelScope 魔粒每日自动签到](scripts/modelscope-magicube-checkin.user.js)

每天自动访问 `https://modelscope.cn/magicube/usage?tab=consume` 触发签到领取魔粒，并查询余额确认结果。

- 类型：ScriptCat 后台定时脚本（`@background` + `@crontab`）
- 调度：`* * once * *`（每天首次匹配即执行，当日幂等，防重复/延迟/重启重跑）
- 机制：魔搭魔粒无独立领取接口，访问页面即由后端发放；脚本用带 Cookie 的 `GM_xmlhttpRequest` 模拟访问 + 余额接口校验
- 通知：`GM_notification` 弹「签到成功 / 失败」；运行日志见 ScriptCat 脚本列表「运行状态」列

[![安装到 ScriptCat](https://img.shields.io/badge/ScriptCat-一键安装-9cf.svg)](https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/modelscope-magicube-checkin.user.js)
[![查看源码](https://img.shields.io/badge/源码-GitHub-181717.svg)](scripts/modelscope-magicube-checkin.user.js)

> 已安装 ScriptCat / Tampermonkey 后，**点击上方「一键安装」徽章**即直接弹出安装框；
> 也可在 ScriptCat 中「新建脚本 → 从 URL 安装」粘贴 raw 链接。

#### 自定义执行时间

编辑脚本元信息的 `@crontab` 行：

```js
// @crontab      * * once * *          // 每天首次匹配即跑（默认）
// @crontab      10 9 once * *         // 每天 09:10 只跑一次
// @crontab      * 9-18 once * *       // 每天 9:00–18:59 之间只跑一次
```

#### 验证

- ScriptCat 脚本列表，悬停「运行状态」列查看下次执行时间，点击查看 `GM_log` 日志
- 对比签到前后「我的魔粒」余额变化确认是否真正领取

### [OtakuFans 每日自动签到](scripts/otakufans-rewards-checkin.user.js)

每天自动领取 OtakuFans 的「7 天登录奖励」（credits / 第 7 天视频券），后台静默执行，无需打开网页。

- 类型：ScriptCat 后台定时脚本（`@crontab` + `@storageName` 共享存储）
- 调度：`* * once * *`（每天首次匹配即执行，当日幂等，防重跑）
- 需配套安装 [OtakuFans 授权同步](scripts/otakufans-rewards-auth.user.js)（页面脚本，`@match https://otakufans.net/*`），两者靠同一个 `@storageName` 传授权信息
- 机制：签到接口 `POST /api/credits/daily-reward` 只认 `Authorization: Bearer <Firebase ID Token>`，带 Cookie 一样 401。ID Token 由站点自己的 Firebase SDK 存在浏览器 IndexedDB（`firebaseLocalStorageDb`），后台沙盒读不到 → 授权同步脚本在你访问 otakufans.net 时把 `refreshToken` + 设备指纹写进共享存储，后台脚本每天用它换新 ID Token（`securetoken.googleapis.com`，Firebase 会轮换 refreshToken，脚本已回写）→ 查状态 → 领取
- 顺手补签：授权同步脚本在你逛站时若发现当天还没领，会直接领掉（授权链路万一失效也不漏签）
- 通知：领取成功弹「+X credits · 连续 N 天」（点击打开 rewards 页）；未授权 / 授权失效弹**常驻**可点击通知要求重新访问一次网站；被风控（`ipBlocklisted` / `ipWindow` / `deviceWindow`）或免费额度到顶时说明原因并放弃当天
- 边界：站点要求「任意充值解锁每日奖励」时不做绕过；未登录 / 无授权信息不重试（重试无意义），网络类错误 `CATRetryError` 60s 后重试

[![安装到 ScriptCat](https://img.shields.io/badge/授权同步-一键安装-9cf.svg)](https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/otakufans-rewards-auth.user.js)
[![安装到 ScriptCat](https://img.shields.io/badge/每日签到-一键安装-9cf.svg)](https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/otakufans-rewards-checkin.user.js)
[![查看源码](https://img.shields.io/badge/源码-GitHub-181717.svg)](scripts/otakufans-rewards-checkin.user.js)

#### 安装顺序与验证

1. 两个脚本**都要装**（先装哪个都行，授权同步脚本装好后刷新一次网站才生效）
2. 打开任意 `otakufans.net` 页面（已登录状态），`F12 → 控制台`搜 `[OtakuFans授权]`，应看到：

   ```
   [OtakuFans授权] 授权信息已同步到共享存储 uid=xxx fp=xxxxxxxxxxxx…
   [OtakuFans授权] 补签 GET status=200 …
   ```

   若当天没领过，紧接着就是 `补签 POST status=200 …`（页面右下角弹出「OtakuFans 已自动签到 +N credits」）
3. 后台脚本：ScriptCat 脚本列表里悬停「运行状态」列可看下次执行时间，点开看 `GM_log` 日志；手动点「运行一次」应输出 `skip: already claimed <日期>`
4. 最终以站点 `https://otakufans.net/rewards` 页面的余额 / 连续天数是否为今日已领取为准

> 兜底：如果哪天 `@storageName` 共享失效（ScriptCat 里标注为实验特性），在 otakufans.net 页面点脚本菜单「复制 OtakuFans 授权信息（手动兜底）」，
> 把 JSON 里的 `apiKey` / `refreshToken` / `fingerprint` / `timeZone` 四项手动填进**签到脚本**的存储即可。
> 首次抓取依赖网站的 Firebase 登录态（IndexedDB），Firefox 无 `indexedDB.databases()` 会跳过自动抓取，只能用上面的手动兜底。

#### 自定义执行时间

编辑脚本元信息的 `@crontab` 行：

```js
// @crontab      * * once * *          // 每天首次匹配即跑（默认）
// @crontab      10 9 once * *         // 每天 09:10 只跑一次
// @crontab      * 9-18 once * *       // 每天 9:00–18:59 之间只跑一次
```

## 页面脚本

### [Bangumi 番源 & BT 磁链助手](scripts/bgm-anime-source-helper.user.js)

在 Bangumi 番剧页直接给出**「在哪能在线看」**和**「哪里能下 BT」**，补上 Bangumi 本身没有的资源追踪能力
（起因：Animeko 依赖第三方站解析，上游一变就失效；本脚本改为只依赖社区维护的番剧站点映射 + 各站 RSS）。

- 类型：**页面脚本**（非后台定时），`@match https://bgm.tv/subject/*`、`/ep/*`（含 `bangumi.tv` / `www.bgm.tv`）
- **在线观看**：一次性拉取 [`bangumi-data`](https://github.com/bangumi-data/bangumi-data)（社区维护的番剧↔各站 id 映射，实测 `@0.3` 原文 7.5 MB / 8800+ 条，精简为 `{站:id}` 索引后约 1.6 MB，缓存 3 天）建索引，按番剧精确生成深链
  - 启用理由：这正是 Animeko 番源的同一套上游数据，社区持续维护，上游改站点只用等数据刷新
  - 站点 URL 模板**直接采用数据自带的 `siteMeta`**（官方模板优先，内置模板仅兜底），所以站点改 URL 不用改脚本
  - 覆盖 B站 / 巴哈姆特動畫瘋 / Netflix / 木棉花 / Ani-One / AcFun / 爱奇艺 / 腾讯 / 优酷 / Viu / ABEMA / Crunchyroll 等 30+ 站
  - **B站支持分集直达**：`media_id` →（`pgc/review/user`）`season_id` →（`pgc/view/web/season`）逐集 `ep` id，直出 `.../bangumi/play/ep{id}`
  - 番剧不在索引里（新番常见）或没有映射时，自动降级为**各站站内搜索**兜底，永不空手
- **BT 索引**：聚合 5 个源，全部走 RSS（比爬网页稳得多，且不受前端改版影响）
  - 蜜柑计划（优先用 bangumi-data 的 `mikan` id 走 `RSS/Bangumi` 精确订阅，取不到再退回 `RSS/Search`）
  - 动漫花园 / Nyaa / ACGNX / ACG.RIP
  - **磁链获取方式（实测）**：动漫花园与 ACGNX 的 RSS `<enclosure>` **本身就是 magnet**，直接可点；Nyaa 由 `<nyaa:infoHash>` 合成 magnet；蜜柑由 `/Home/Episode/{40位hash}` 合成（已验证该 hash 即 infohash）；ACG.RIP 无磁链，只给 `.torrent` + 详情页
- **筛选策略**（设置面板可调，默认即好用）：源权重 → 画质（2160>1080>720）→ 字幕（简>繁>日>英）→ 字幕组优先/拉黑 → 集数命中 → 做种数 → 时效；默认屏蔽 `PV/CM/NCOP/NCED/MENU/预告/Sample` 等
- **按集**：番剧页与章节页（`/subject/{id}/ep`）每一集后注入 `🔍 BT`，点击展开该集的磁链；整季番剧页则给整季列表 + 集号筛选
- 其他：结果本地缓存（默认 60 min，可清空）、同源请求串行 + 间隔（防触发风控）、失败单源不影响其余源

[![安装到 ScriptCat](https://img.shields.io/badge/ScriptCat-一键安装-9cf.svg)](https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/bgm-anime-source-helper.user.js)
[![查看源码](https://img.shields.io/badge/源码-GitHub-181717.svg)](scripts/bgm-anime-source-helper.user.js)

#### 验证

先在浏览器登录 `bgm.tv`（脚本要用登录态读页面、并调用 `api.bgm.tv`），然后装脚本，打开任一动画条目页：

1. 顶部应出现 **🎬 番源 & BT 磁链** 面板，三个页签：在线观看 / BT 下载 / 设置
2. 「在线观看」选一部有正版源的番（如 `https://bgm.tv/subject/400602` 葬送的芙莉莲）：
   - 应看到 `哔哩哔哩` 等按钮；点开是 `.../bangumi/media/md{id}`
   - 下面还有 **B站分集直达**（`第1集`…），点开 URL 形如 `https://www.bilibili.com/bangumi/play/ep779775`
3. 「BT 下载」：默认关键词 = 中文名，点「搜索」，列表每条应有 `磁链`（点它应唤起 qBittorrent/迅雷等；没装客户端则无反应）、`种子`、`详情`
4. 打开 `https://bgm.tv/subject/400602/ep`，每一集右侧应有 `🔍 BT` 按钮，点击展开该集结果
5. 控制台过滤 `[bgmh]` 可看日志（bangumi-data 条数、各源失败原因等）

> 注意：BT 源可用性随上游波动（这正是本脚本要摆脱的痛点，但 RSS 比网页解析稳得多）。若某源长期 403/超时，
> 在「设置」里取消勾选它，或换关键词（日文原名查 Nyaa 更准，中文名查蜜柑/花园更准）。

#### 自定义策略

面板「设置」页签（也可点油猴菜单）可改：画质/字幕/字幕组优先顺序、字幕组拉黑、屏蔽关键词、每源条数、
最低做种、只显示带磁链、请求间隔、缓存时长。修改立即生效（搜索缓存需点「清空搜索缓存」）。

## 说明

- 后台脚本运行在沙盒中，无法操作 DOM，均通过 `GM_xmlhttpRequest` 带 Cookie 请求。
- 未登录或 Cookie 失效会 `reject` 并通知，请先手动登录对应站点。
- 网络超时触发 `CATRetryError` 自动重试一次（60s 后）。

## License

[MIT](LICENSE)
