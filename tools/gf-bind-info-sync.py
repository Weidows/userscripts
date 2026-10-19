#!/usr/bin/env python3
"""给 GF 脚本绑定「附加信息同步 URL」（additional_info_sync），并立即拉一次。

GF 没有公开 API 做这件事：管理页 /scripts/<id>/admin 的 sync_update 表单才是入口。
要点（都实测过）：
  - 字段是 additional_info_sync[0][...]，不是 script_version[...]；attribute_default=true
    表示「默认附加信息」（匹配 @name 的语言）。
  - 代码同步字段必须一起带上，否则会被清空 —— 同一个表单管两件事。
  - 提交按钮是裸参数名：update-and-sync（保存并立即同步）/ update-only（仅保存）。
  - 成功 = 302 到脚本页；失败 = 200 重新渲染 admin 页，所以要按最终 URL 判定。
  - 这个脚本绝不打印 cookie。
"""

import json
import pathlib
import re
import subprocess
import sys
import time

PROXY = "http://127.0.0.1:7890"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
RAW = "https://raw.githubusercontent.com/Weidows/userscripts/master/docs/gf/"


def cookie_header() -> str:
    sess = json.loads((pathlib.Path.home() / ".config" / "gf" / "session.json").read_text(encoding="utf-8"))
    return "; ".join("%s=%s" % (c["name"], c["value"]) for c in sess["cookies"])


def curl(url, extra=None, follow=True, retries=3):
    last = ("", "000", "")
    for attempt in range(retries):
        cmd = ["curl", "-s", "-x", PROXY, "--max-time", "60", "-A", UA, "-H", "Cookie: " + cookie_header()]
        if follow:
            cmd += ["-L", "--max-redirs", "5"]
        cmd += ["-w", "\n@@@META %{http_code} %{url_effective}"]
        cmd += (extra or []) + [url]
        r = subprocess.run(cmd, capture_output=True, text=True)
        body, _, meta = r.stdout.rpartition("\n@@@META ")
        code, _, final = meta.strip().partition(" ")
        last = (body, code, final)
        # 000 = 连接阶段就断了（这台机器走代理偶尔会这样），退避重试
        if code not in ("000", ""):
            return last
        time.sleep(2 + attempt * 2)
    return last


def bind(script_id: int, doc_slug: str, current_code_url: str, dry: bool = False):
    print(f"\n=== GF {script_id} ← docs/gf/{doc_slug}.md")
    page, code, final = curl(f"https://greasyfork.org/zh-CN/scripts/{script_id}/admin")
    if code != "200" or "sync_update" not in page:
        print(f"  ✗ 拿不到管理页（HTTP {code} → {final}）")
        return False

    form = re.search(r'<form[^>]*action="([^"]*sync_update)"[^>]*>(.*?)</form>', page, re.S)
    if not form:
        print("  ✗ 找不到 sync_update 表单")
        return False
    action, inner = form.group(1), form.group(2)
    token = re.search(r'name="authenticity_token"[^>]*value="([^"]+)"', inner)
    if not token:
        print("  ✗ 表单里没有 authenticity_token")
        return False
    print(f"  表单: {action}")
    print(f"  现有代码同步: {'已绑定' if current_code_url in inner else '未绑定'}")

    fields = [
        ("_method", "patch"),
        ("authenticity_token", token.group(1)),
        ("script[sync_identifier]", current_code_url),
        ("script[sync_type]", "automatic"),
        ("additional_info_sync[0][attribute_default]", "true"),
        ("additional_info_sync[0][sync_identifier]", RAW + doc_slug + ".md"),
        ("additional_info_sync[0][value_markup]", "markdown"),
        ("update-and-sync", "1"),
    ]
    args = []
    for k, v in fields:
        args += ["--data-urlencode", f"{k}={v}"]

    if dry:
        print("  (dry run — 未提交) 将设置：")
        for k, v in fields:
            if k.startswith("additional_info_sync"):
                print(f"    {k} = {v}")
        return True

    body, code, final = curl("https://greasyfork.org" + action, extra=args)
    ok = f"/scripts/{script_id}" in final and "admin" not in final.split("/scripts/")[-1]
    print(f"  提交结果: HTTP {code} → {final}")
    if not ok:
        errs = re.findall(r'class="[^"]*error[^"]*"[^>]*>(.*?)<', body, re.S)
        print("  ✗ 未跳到脚本页，可能被拒：", [re.sub(r"\s+", " ", e).strip()[:120] for e in errs][:4])
        return False
    return True


def verify(script_id: int, doc_slug: str):
    """回读管理页确认绑定，再看公开页是否已渲染出附加信息（图和文字）。"""
    page, code, _ = curl(f"https://greasyfork.org/zh-CN/scripts/{script_id}/admin")
    m = re.search(r'name="additional_info_sync\[0\]\[sync_identifier\]"[^>]*value="([^"]*)"', page)
    if not m:
        m = re.search(r'value="([^"]*)"[^>]*name="additional_info_sync\[0\]\[sync_identifier\]"', page)
    bound = m.group(1) if m else ""
    print(f"  管理页回读 additional_info_sync = {bound or '（空）'}")
    pub, pcode, _ = curl(f"https://greasyfork.org/zh-CN/scripts/{script_id}")
    has_img = "raw.githubusercontent.com/Weidows/userscripts" in pub
    print(f"  公开页 HTTP {pcode} · 含 raw 图片地址: {'是' if has_img else '否'}")
    return doc_slug + ".md" in bound


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    targets = [
        (599220, "bgm-anime-source-helper",
         "https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/bgm-anime-source-helper.user.js"),
        (601009, "scroll-unroll",
         "https://raw.githubusercontent.com/Weidows/userscripts/master/scripts/scroll-unroll.user.js"),
    ]
    only = [a for a in sys.argv[1:] if a.isdigit()]
    for sid, slug, code_url in targets:
        if only and str(sid) not in only:
            continue
        if bind(sid, slug, code_url, dry) and not dry:
            verify(sid, slug)
