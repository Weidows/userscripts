#!/usr/bin/env node
/**
 * 从 README 抽出「已发布到 Greasy Fork 的脚本」小节，生成 GF 可直接拉取的 markdown。
 *
 * 为什么需要这一层：
 * Greasy Fork 的脚本页有两个文本区 ——
 *   1. 描述 @description：来自脚本代码的元信息块，随「代码同步」自动更新，不需要这个工具。
 *   2. 附加信息 additional info：图片 / 表格 / 长文，有**独立的同步 URL**
 *      （管理页 additional_info_sync[0][sync_identifier]），在同一次同步任务里被一起抓取。
 * README 是仓库里唯一的人读文档，所以把它按脚本切分，GF 从 raw 地址拉取每片，
 * 「改 README → push」就等于「改 GF 描述」。
 *
 * 关键处理：README 里的图片是相对路径（image/README/x.png），GF 只允许 https 的 img src，
 * 而且渲染基准是同步 URL 所在目录而不是仓库根 —— 这里直接改写成 raw 绝对地址，
 * 不依赖 GF 的渲染期绝对化（那是按 markdown 文件所在目录算的，路径会错）。
 *
 * 用法：node tools/gf-docs.mjs [--check]
 *   --check  只报告是否需要重新生成，不写文件（给 CI / pre-push 用）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const OUT_DIR = join(ROOT, 'docs', 'gf');
const RAW_BASE = 'https://raw.githubusercontent.com/Weidows/userscripts/master/';

/** 已发布到 GF 的脚本：脚本文件名（不含 .user.js） → GF 脚本 id。新发布后在这里加一行。 */
const GF_IDS = {
  'bgm-anime-source-helper': 599220,
  'scroll-unroll': 601009,
};

const readme = readFileSync(README, 'utf8').replace(/\r\n/g, '\n');

/** 把 README 里的相对引用改写成 raw 绝对地址，否则在 GF 上点不开 / 显示不出来。 */
function absolutize(md) {
  return md.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (/^(https?:|mailto:|#)/i.test(target)) return whole;
    return `](${RAW_BASE}${target.replace(/^\.?\//, '')})`;
  });
}

/** 切出 `### 标题 · \`脚本名\`` 形式的各小节（OtakuFans 那种一行两个脚本名的也认）。 */
function sections() {
  const lines = readme.split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    const h = /^###\s+(.+)$/.exec(line);
    if (h) {
      const slugs = [...h[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      cur = slugs.length ? { title: h[1].replace(/\s*·\s*`[^`]+`(\s*\+\s*`[^`]+`)*\s*$/, '').trim(), slugs, body: [] } : null;
      if (cur) out.push(cur);
      continue;
    }
    if (/^##\s/.test(line)) { cur = null; continue; }
    if (cur) cur.body.push(line);
  }
  return out;
}

const results = [];
for (const sec of sections()) {
  const slugs = sec.slugs.filter((s) => GF_IDS[s]);
  if (!slugs.length) continue;
  const body = absolutize(sec.body.join('\n').replace(/^\n+|\n+$/g, ''));
  const md = `${body}\n`;
  for (const slug of slugs) {
    results.push({ slug, id: GF_IDS[slug], title: sec.title, md, path: join(OUT_DIR, `${slug}.md`) });
  }
}

const checkOnly = process.argv.includes('--check');
let changed = 0;
if (!existsSync(OUT_DIR) && !checkOnly) mkdirSync(OUT_DIR, { recursive: true });

for (const r of results) {
  const prev = existsSync(r.path) ? readFileSync(r.path, 'utf8') : null;
  const same = prev === r.md;
  if (!same) changed++;
  if (!checkOnly && !same) writeFileSync(r.path, r.md);
  console.log(`${same ? '  不变' : checkOnly ? '  需更新' : '  已写入'}  docs/gf/${r.slug}.md  (GF ${r.id} · ${r.title})`);
}

if (checkOnly) {
  console.log(changed ? `\n${changed} 个文件需要重新生成：node tools/gf-docs.mjs` : '\n全部最新');
  process.exit(changed ? 1 : 0);
}
console.log(changed ? `\n完成，${changed} 个文件有变化` : '\n完成，无变化');
if (changed) {
  console.log('\n下一步：commit + push，然后 GF 会按「附加信息同步 URL」拉取：');
  for (const r of results) console.log(`  GF ${r.id} ← ${RAW_BASE}docs/gf/${r.slug}.md`);
}
