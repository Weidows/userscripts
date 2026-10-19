![1792420690219](https://raw.githubusercontent.com/Weidows/userscripts/master/image/README/1792420690219.png)

- 在线观看：拉 [`bangumi-data`](https://github.com/bangumi-data/bangumi-data)（正是 Animeko 番源的同一套上游数据）建 `bangumi_id → 各站 id` 索引；URL 模板以数据自带的 `siteMeta` 为准，**站点改 URL 无需改脚本**
- B站分集直达：`media_id` →（`pgc/review/user`）`season_id` →（`pgc/view/web/season`）逐集 `ep` id，直出 `.../bangumi/play/ep{id}`
- BT 索引：蜜柑（优先用 bangumiId 精确订阅）/ 动漫花园 / Nyaa / ACGNX / ACG.RIP，全部走 RSS，不受前端改版影响
- 磁链获取（实测）：动漫花园与 ACGNX 的 RSS `<enclosure>` 本身就是 magnet；Nyaa 由 `infoHash` 合成；蜜柑由 `/Home/Episode/{40位hash}` 合成（该 hash 即 infohash）；ACG.RIP 只给 `.torrent` + 详情页
- 策略：源权重 → 画质 → 字幕 → 字幕组白 / 黑名单 → 集数命中 → 做种 → 时效，面板可调；章节页每集注入 `🔍 BT`
- 兜底：条目不在索引里（新番常见）时降级为各站站内搜索
