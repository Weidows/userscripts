# userscripts

个人用户脚本（油猴 / ScriptCat）合集。

后台脚本走 ScriptCat 的 `@background` + `@crontab`，静默定时执行，无需开页面；页面脚本在匹配站点注入 UI。

## 安装

1. 装扩展：[ScriptCat](https://chromewebstore.google.com/detail/scriptcat/ndcooeababalnlpkfedmmbbbgkljhpjf)（推荐，支持后台定时）或 [Tampermonkey](https://www.tampermonkey.net/)（兼容，无后台定时）
2. 点下表的 **版本徽章**（形如 `v2.0.2 install`）安装；也可在 ScriptCat 中「新建脚本 → 从 URL 安装」粘贴 raw 链接
3. **先登录对应网站** —— 脚本依赖浏览器 Cookie 鉴权

## 脚本一览

| 脚本 | 类型 | 作用 | 触发 | 安装 |
| --- | --- | --- | --- | --- |
| **Epic 免费游戏** | 后台定时 | 免费游戏自动加购物车 + 重复提醒，手动结算 | 每天 | <a href="https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/epic-freegame-claimer.user.js" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/v2.0.2-install-9cf.svg" alt="v2.0.2 install"></a> |
| **ModelScope 魔粒** | 后台定时 | 访问页面触发签到，领魔粒 | 每天 | <a href="https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/modelscope-magicube-checkin.user.js" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/v1.1.0-install-9cf.svg" alt="v1.1.0 install"></a> |
| **OtakuFans 签到** | 后台定时 + 页面授权 | 领 7 天登录奖励 | 每天 | <a href="https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/otakufans-rewards-auth.user.js" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/%E6%8E%88%E6%9D%83_v1.0.0-install-9cf.svg" alt="授权 v1.0.0 install"></a> <a href="https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/otakufans-rewards-checkin.user.js" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/%E7%AD%BE%E5%88%B0_v1.0.0-install-9cf.svg" alt="签到 v1.0.0 install"></a> |
| **Bangumi 番源** | 页面脚本 | 番剧页展示在线观看源 + BT 磁链 | 打开 bgm.tv | <a href="https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/bgm-anime-source-helper.user.js" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/v1.0.1-install-9cf.svg" alt="v1.0.1 install"></a> |
| **卷轴滚动** | 页面脚本 | 滚轮 / 键盘 / 锚点改走临界阻尼动画平滑「展卷」+ VSCode 风格缩略图 | 任意网页 | <a href="https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/scroll-unroll.user.js" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/v1.1.0-install-9cf.svg" alt="v1.1.0 install"></a> |

## 通用：自定义执行时间

编辑脚本元信息的 `@crontab` 行 —— **该行不能带行内 `//` 注释**（ScriptCat 会把注释当表达式，报「错误的定时表达式」）：

```js
// @crontab  * * once * *     // 每天首次匹配即跑（默认，当日幂等）
// @crontab  * * once * 4     // 每周四首次匹配即跑
// @crontab  10 22 once * 4   // 每周四 22:10（对齐北京时间新游上架）
// @crontab  * 9-18 once * *  // 每天 9:00–18:59 之间只跑一次
```

## 各脚本说明

### Epic 免费游戏 · `epic-freegame-claimer`

- 机制：带 Cookie 的 `GM_xmlhttpRequest` 把当周免费游戏加进购物车 → 给你购物车链接，你点链接手动结算（自动下单会触发 Arkose 验证码，后台过不了）
- 重复提醒：每天跑一次，只要免费游戏还在购物车里就再提醒一次；结算后自动停止
- 边界：依赖 `store.epicgames.com` 登录 Cookie；兑换码类（`isCodeRedemptionOnly`）无法自动领取，会被跳过

### ModelScope 魔粒 · `modelscope-magicube-checkin`

- 机制：魔粒无独立领取接口，访问页面即由后端发放 → 脚本模拟访问 + 余额接口校验
- 通知：`GM_notification` 弹成功 / 失败

### OtakuFans 签到 · `otakufans-rewards-auth` + `otakufans-rewards-checkin`

- **两个脚本都要装**，靠同一个 `@storageName` 传授权（授权脚本装好刷新一次网站才生效）
- 机制：签到接口只认 Firebase ID Token（带 Cookie 一样 401），Token 存在站点 IndexedDB，后台沙盒读不到 → 授权脚本在你逛站时把 `refreshToken` + 设备指纹写入共享存储，后台脚本每天换新 Token（Firebase 会轮换，脚本已回写）
- 顺手补签：授权脚本在你逛站时若发现当天未领会直接领掉
- 兜底：共享存储失效（ScriptCat 实验特性）时，在 otakufans.net 点脚本菜单「复制授权信息」，把 `apiKey` / `refreshToken` / `fingerprint` / `timeZone` 手动填进**签到脚本**存储

### Bangumi 番源 · `bgm-anime-source-helper`

起因：Animeko 依赖第三方站解析，上游一变就失效；本脚本改为只依赖社区维护的番剧站点映射 + 各站 RSS。

- 在线观看：拉 [`bangumi-data`](https://github.com/bangumi-data/bangumi-data)（正是 Animeko 番源的同一套上游数据）建 `bangumi_id → 各站 id` 索引；URL 模板以数据自带的 `siteMeta` 为准，**站点改 URL 无需改脚本**
- B站分集直达：`media_id` →（`pgc/review/user`）`season_id` →（`pgc/view/web/season`）逐集 `ep` id，直出 `.../bangumi/play/ep{id}`
- BT 索引：蜜柑（优先用 bangumiId 精确订阅）/ 动漫花园 / Nyaa / ACGNX / ACG.RIP，全部走 RSS，不受前端改版影响
- 磁链获取（实测）：动漫花园与 ACGNX 的 RSS `<enclosure>` 本身就是 magnet；Nyaa 由 `infoHash` 合成；蜜柑由 `/Home/Episode/{40位hash}` 合成（该 hash 即 infohash）；ACG.RIP 只给 `.torrent` + 详情页
- 策略：源权重 → 画质 → 字幕 → 字幕组白 / 黑名单 → 集数命中 → 做种 → 时效，面板可调；章节页每集注入 `🔍 BT`
- 兜底：条目不在索引里（新番常见）时降级为各站站内搜索

### 卷轴滚动 · `scroll-unroll`

- 机制：接管 `wheel` / 键盘翻页键 / 页内锚点，用临界阻尼（SmoothDamp）逐帧写入滚动位置——连续滚不重启动画、可中途改道、无过冲；页面自身的 `scroll-behavior: smooth` 会被临时压成 `auto`（逐帧写入与浏览器再动画化会互相打架）
- 装饰层（各项可分别开关）：页首上轴杆出现、开卷后收起；接近卷尾下轴杆滑出；滚动前沿的出纸阴影强度随速度变化；卷芯进度条滚动时浮现
- 缩略图（VSCode 风格，可开关）：右栏按比例重绘页面骨架（背景色块 + 图片占位 + 真实文字行盒），视口指示器跟着滚动走；可点击 / 拖动跳转（1:1 跟手）；静息半透明、悬停变实；窄屏（<720px）自动隐藏；开着缩略图时卷芯进度自动让位
- 配置：**ScriptCat** 走脚本元信息里的 `@UserConfig`（扩展控制面板出现「配置」按钮）；**Tampermonkey / Violentmonkey** 用脚本菜单「⚙ 设置面板（Alt+O）」或页面内设置面板。两边读写同一批存储键（`scroll.*` / `decor.*` / `site.blacklist`），不会各说各话
- 主动放行：正文里的内嵌滚动框、按住 `Ctrl`（缩放）/ `Alt`（临时原生）、横向滚动、输入框内的翻页键；`body{overflow:hidden}` + 主容器滚动的 SPA 布局会自动改用那个容器
- 快捷键：`Alt+S` 平滑开关 / `Alt+M` 缩略图 / `Alt+O` 设置面板；脚本菜单里另有各子功能单独开关、顺滑度（0.20–0.80s）、距离倍率（0.6–2×）、本页黑名单、重置
- 自测：双击 `test/scroll-demo.html`（脚本以普通 `<script>` 加载，不需要扩展；左下角面板有实时读数与缩略图开关）

## 验证

| 脚本 | 怎么看 |
| --- | --- |
| Epic / ModelScope / OtakuFans | 登录站点后，ScriptCat 脚本列表悬停「运行状态」看下次执行时间 / `GM_log`；余额 / 连续天数 / 库内游戏为最终依据 |
| OtakuFans 授权 | `F12 → 控制台` 过滤 `[OtakuFans授权]` |
| Bangumi | 登录 bgm.tv 开 `https://bgm.tv/subject/400602`：应有「哔哩哔哩」按钮 + B站分集直达，BT 每条带 `磁链`；`F12` 过滤 `[bgmh]` |
| 卷轴滚动 | 双击 `test/scroll-demo.html`：滚轮应「一次滑到位」；右侧出现缩略图（有内容纹理，可点击 / 拖动跳转）；`Alt+M` 开关缩略图、`Alt+O` 开设置面板、`Alt+S` 开关平滑；左下角面板实时显示 `y / target / speed / 缩略图笔画数`；`F12` 里 `window.__scrollUnroll.state()`、`.minimap()` 查内部状态 |

## 说明

- 后台脚本在沙盒中，无法操作 DOM，一律用 `GM_xmlhttpRequest` 带 Cookie 请求；页面脚本直接操作 DOM
- 未登录 / Cookie 失效会 `reject` 并通知，需先手动登录对应站点
- 网络超时触发 `CATRetryError`，60s 后自动重试一次
