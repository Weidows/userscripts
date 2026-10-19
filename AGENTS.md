# AGENTS.md — userscripts 仓库协作规范

本仓库是 ScriptCat / 油猴用户脚本合集（后台静默自动化类型）。以下是维护本仓库时必须遵守的约定，Agent 改完代码后务必照做。

## 每次更新记得改版本号

**改了任意脚本（`*.user.js`）后，必须同步递增该脚本元数据块里的 `@version`。** 这是硬规则。

- 版本号格式：`主.次.修订`（如 `1.0.0`）。
- 递增规则：
  - 修了 bug / 文案 / 逻辑微调 → 升修订号（`1.0.0` → `1.0.1`）
  - 加了功能 / 改了行为 → 升次版本号（`1.0.0` → `1.1.0`）
  - 不兼容改动 / 大重构 → 升主版本号（`1.0.0` → `2.0.0`）
- 为什么：ScriptCat 靠 `@version` 判定脚本是否更新；不改版本号，用户重载/同步时不会生效，排查问题也会误以为"还是旧版"。
- 不要把版本号改动和其他无关的脚本混在同一笔提交里——每个被改的脚本各自升自己的版本号。

### 同时更新 README 里的安装徽章版本（同一条规则的延伸）

README「脚本一览」表的安装徽章文案**就是脚本版本号**，形如 `v2.0.2-install`（shields 会渲染成 `v2.0.2 | install`）。
**升了 `@version` 就必须改对应徽章**，否则徽章显示的版本会骗人（比脚本旧）。

- 徽章 URL：`https://img.shields.io/badge/v{版本}-install-9cf.svg`
- shields 转义：`-` 写成 `--`，`_` 写成 `__`，空格写成 `_`。**中文标签必须先 URL 编码**（直接写中文会乱码成 `ÊÚÈ¨`）。
- 两个脚本版本号相同时（如 OtakuFans 的授权 / 签到都是 `1.0.0`），徽章文案要带角色词区分：`授权_v1.0.0-install`、`签到_v1.0.0-install`。
- 自检：把 README 里每个徽章的版本号与对应 `scripts/*.user.js` 的 `@version` 对一遍，应全部一致。

### Greasy Fork 徽章（只有发到 GF 的脚本才有）

脚本发布到 Greasy Fork 后，在「脚本一览」的安装列、raw 徽章之后追加一个 **GF 徽章**：

```html
<a href="https://greasyfork.org/zh-CN/scripts/<id>" target="_blank" rel="noopener"><img src="https://img.shields.io/greasyfork/v/<id>?label=GF" alt="Greasy Fork"></a>
```

- 用 shields 的 **`greasyfork/v/<id>` 动态徽章**（渲染成 `GF | v1.2.0`），版本实时取自 GF —— **不要**写静态 `badge/v{版本}-install`，否则等于多一处要手改的版本号，迟早漂。
- `<id>` 用 `gf list --json` 查（含 id / name / version / codeUrl），不要靠猜名字或搜索。
- 加徽章前先核对 GF 上那份代码与仓库一致：`gf cat <id>` 去掉注入的 `@downloadURL` / `@updateURL` 行后与 `scripts/<file>` diff，不一致就先 `gf publish` 更新。
- 没发布到 GF 的脚本（后台定时类通常不上 GF —— GF/TM 跑不了 `@background`）**不要加**，别放空链接或占位图。
- 两个徽章是两条独立安装入口：raw 徽章仍按上一条规则跟着 `@version` 手动同步，GF 徽章由 GF 自己喂版本。

### GF 的「描述」怎么跟着 README 走

GF 脚本页有两块文本，来源不同，别混：

| 位置 | 来源 | 更新方式 |
| --- | --- | --- |
| 描述（脚本名下面那句） | 代码元信息块的 `@description` | 随**代码同步**自动更新（改脚本 → push） |
| 附加信息（图片 / 表格 / 长文） | 仓库的 `docs/gf/<脚本名>.md` | 改 README → 重生成 md → GF 自动拉 |

- 只改 README **不用升 `@version`**：GF 在代码没变时会为「附加信息」变化新建版本记录，且不要求版本号递增（`version_not_incremented?` 在 `code == 上一版 code` 时直接返回 false）。
- 生成器 `node tools/gf-docs.mjs`（`--check` 只校验是否过期）：README 里 `### 标题 · \`脚本名\`` 的小节切成 `docs/gf/<脚本名>.md`，**相对图片路径自动改写成 raw 绝对地址** —— GF 只允许 `https` 的 `img src`，而且渲染基准是 md 所在目录、不是仓库根，直接放相对路径会 404。
- 新脚本发到 GF 后两件事：① 在 `tools/gf-docs.mjs` 的 `GF_IDS` 里加 `脚本名 → GF id`；② 跑 `python tools/gf-bind-info-sync.py <GF id>` 绑定「附加信息同步 URL」（GF 无公开 API，只能走管理页 `sync_update` 表单；提交时**必须同时带上代码同步字段**，否则会被清空）。
- `.github/workflows/gf-docs.yml` 在 README / `image/**` / 生成器变化时自动重生成并提交，忘记本地跑也不会让 GF 描述过期。
- GF 的 automatic 同步是**周期性**的，不是 push 即触发；想立刻生效：`gf sync <id> --now`（回显「未发现更新」就是同步成功）。

## README 安装徽章的已知限制（实测，别再试了）

- 徽章锚点写成 `<a href="..." target="_blank" rel="noopener">` 时，**github.com 会把 `target` 剥掉**、
  把 `rel` 改写成 `nofollow`（用 GitHub Markdown API 与真实仓库页双重验证过），所以点徽章是**本标签页跳转**，改不了。
  该写法在 GitLab / Gitea / VS Code 预览 / GitHub Pages 上仍然生效，所以保留着不亏，但**不要承诺用户 GitHub 上是新标签页打开**。
- 裸 raw 链接被点击后浏览器展示的是纯文本源码，不是安装页；真正触发安装依赖扩展拦截（ScriptCat / Tampermonkey 都支持）。
  若打开成了一坨代码，就是扩展没拦到，需要先确认脚本已启用 + 对应域名授权。

## ScriptCat 元信息坑（已踩过）

- **`@crontab` 行不能带行内 `//` 注释。** ScriptCat 的定时表达式解析器不会剥离尾部注释，会把 `// 每周四...` 当成表达式一部分导致「错误的定时表达式」报错。说明文字放独立注释行。
- 后台脚本跑在沙盒里，无法操作 DOM，一律用 `GM_xmlhttpRequest`（`anonymous: false` 带登录 Cookie）而非 `fetch`/`XMLHttpRequest`。
- 必须 `return new Promise(...)`；`resolve`=成功、`reject`=失败；`reject(new CATRetryError(msg, sec))` 可触发自动重试（仅网络类错误值得重试，登录失效不要重试）。
- 每个要访问的 host 都要在 `@connect` 声明，否则请求被拦截。

## 提交约定

- 不主动 `git push`（除非用户要求）。
- 提交信息用中文简述改动；metadata 移动/重命名会被 git 识别为 `R`，历史保持干净。
- 文档（README.md）里的脚本链接要和实际目录结构一致（当前脚本在 `scripts/` 下）。
