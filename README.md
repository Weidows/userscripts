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

## 说明

- 后台脚本运行在沙盒中，无法操作 DOM，均通过 `GM_xmlhttpRequest` 带 Cookie 请求。
- 未登录或 Cookie 失效会 `reject` 并通知，请先手动登录对应站点。
- 网络超时触发 `CATRetryError` 自动重试一次（60s 后）。

## License

[MIT](LICENSE)
