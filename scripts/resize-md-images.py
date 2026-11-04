#!/usr/bin/env python3
"""resize-md-images.py — 把 Markdown 里靠 HTML ``<img width/height>`` 控制显示尺寸的图片，
按标签给出的像素尺寸等比缩放，再把标签替换成标准 Markdown 图片引用 ``![](src)``。

为什么要这么做
  ``<img>`` 属于内联 HTML，会触发 markdownlint 的 MD033/no-inline-html；
  而 Markdown 语法本身没有尺寸属性，所以“显示多大”只能在图片文件本身上实现：
  先按标签里的 width/height 把图片裁到对应像素，再换成 ``![](src)``。

行为约定
  * 默认只缩小、不放大（低分辨率截图放大只会变糊）；需要严格贴合标签尺寸时加 --allow-upscale。
  * 同一张图片被多个标签引用时只缩放一次。
  * 只处理代码块 / 行内代码 / HTML 注释之外的 <img>，不会改动示例代码里的标签。
  * 没有 width/height 的标签：图片不动，仅替换引用写法。
  * 尺寸写成百分比等无法换算成像素的值：不动、只报警告，退出码为 1（宁可漏转，不可转错）。
  * 保留原有的 alt 属性（若有）；不新造 alt 文本。

用法
  python scripts/resize-md-images.py                     # 扫描整个仓库，试运行（默认不写盘）
  python scripts/resize-md-images.py --write             # 实际执行
  python scripts/resize-md-images.py --write --allow-upscale
  python scripts/resize-md-images.py --ref-only doc.md   # 只把标签换成引用，不动图片
  python scripts/resize-md-images.py --report r.json --quiet
  python scripts/resize-md-images.py tb710fu-doc/generic/foo.md

常用选项
  --write, -w        真正写入文件（文档 + 图片）；默认只打印计划
  --ref-only         不缩放图片，只把 <img> 换成 Markdown 引用
  --allow-upscale    允许把小于标签尺寸的图片放大
  --quality N        JPEG 重新编码质量，默认 92
  --report PATH      把逐项结果写成 JSON
  --quiet, -q        只打印汇总
  --help, -h         显示帮助

依赖
  Pillow（``pip install pillow``）。

局限
  * 缩进式代码块（4 空格）里的 <img> 无法可靠识别，会被当作正文处理；
    本仓库的文档统一用围栏代码块，不受影响。
  * 标签属性值里若出现未转义的 ``>``，标签会被截断（本仓库没有这种写法）。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from urllib.parse import unquote

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("需要 Pillow：pip install pillow")

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
MD_EXTS = {".md", ".mkd", ".mdwn", ".mdown", ".markdown", ".markdn", ".mdtxt", ".mdtext"}
SKIP_DIR_NAMES = {".git", "node_modules", "vendor", "bower_components"}
SKIP_PATH_SUFFIXES = (
    os.path.join(".vitepress", "cache"),
    os.path.join(".vitepress", "dist"),
)

FENCE_RE = re.compile(r"^[ \t]*(`{3,}|~{3,})")
COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
# 属性值可以是双引号、单引号或无引号
ATTR_RE = re.compile(r"""([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+))""")

# 报告里的分类
RESIZED = "resize"
REF = "ref"
KEPT = "kept"
WARN = "warn"


def to_posix(p: str) -> str:
    return p.replace(os.sep, "/")


# ---------------------------------------------------------------------------
# 找文档
# ---------------------------------------------------------------------------
def should_skip_dir(name: str) -> bool:
    return name in SKIP_DIR_NAMES


def iter_markdown(targets: list[str]) -> list[str]:
    """展开命令行目标：文件原样返回，目录递归收集 Markdown 文档。"""
    out: list[str] = []
    for target in targets:
        target = os.path.abspath(target)
        if os.path.isfile(target):
            out.append(target)
            continue
        for root, dirs, files in os.walk(target):
            if any(root.replace(os.sep, "/").endswith("/" + to_posix(s)) for s in SKIP_PATH_SUFFIXES):
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs if not should_skip_dir(d)]
            for name in files:
                if os.path.splitext(name)[1].lower() in MD_EXTS:
                    out.append(os.path.join(root, name))
    return sorted(set(out))


# ---------------------------------------------------------------------------
# Markdown 结构识别：哪些区域不该动
# ---------------------------------------------------------------------------
def _inline_code_spans(line: str, base: int) -> list[tuple[int, int]]:
    """一行内成对的反引号串（支持 ``a ` b`` 这种多反引号）→ [start, end)。"""
    spans: list[tuple[int, int]] = []
    i, n = 0, len(line)
    while i < n:
        if line[i] != "`":
            i += 1
            continue
        j = i
        while j < n and line[j] == "`":
            j += 1
        run = j - i
        k, found = j, None
        while k < n:
            if line[k] == "`":
                m = k
                while m < n and line[m] == "`":
                    m += 1
                if m - k == run:
                    found = m
                    break
                k = m
            else:
                k += 1
        if found is None:  # 落单的反引号，不算行内代码
            i = j
        else:
            spans.append((base + i, base + found))
            i = found
    return spans


def protected_spans(text: str) -> list[tuple[int, int]]:
    """返回不应被改写的字符区间：围栏代码块、行内代码、HTML 注释。"""
    spans: list[tuple[int, int]] = []

    # 1) 围栏代码块（逐行扫描，记录每个围栏块的整体区间）
    fence: tuple[str, int, int] | None = None  # (字符, 长度, 起始偏移)
    offset = 0
    for line in text.splitlines(keepends=True):
        m = FENCE_RE.match(line)
        if fence is None:
            if m:
                marker = m.group(1)
                fence = (marker[0], len(marker), offset)
                spans.append((offset, offset + len(line)))
        elif m and m.group(1)[0] == fence[0] and len(m.group(1)) >= fence[1] and not line.strip()[len(m.group(1)):].strip():
            spans.append((fence[2], offset + len(line)))
            fence = None
        offset += len(line)
    if fence is not None:  # 围栏没闭合：保护到文末
        spans.append((fence[2], len(text)))

    # 2) HTML 注释
    for m in COMMENT_RE.finditer(text):
        spans.append((m.start(), m.end()))

    # 3) 行内代码（跳过已在围栏/注释里的部分）
    offset = 0
    for line in text.splitlines(keepends=True):
        for start, end in _inline_code_spans(line, offset):
            if not overlaps(spans, start, end):
                spans.append((start, end))
        offset += len(line)
    return spans


def overlaps(spans: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(start < s_end and s_start < end for s_start, s_end in spans)


# ---------------------------------------------------------------------------
# <img> 标签识别与属性解析
# ---------------------------------------------------------------------------
def iter_img_tags(text: str):
    """逐个产出 (start, end, tag_text)，按引号状态跳过属性值里的 ``>``。"""
    i, n = 0, len(text)
    lower = text.lower()
    while True:
        start = lower.find("<img", i)
        if start < 0:
            return
        # 必须是 <img 后面跟空白或 / 或 >
        after = start + 4
        if after < n and not (text[after].isspace() or text[after] in "/>"):
            i = after
            continue
        j, quote = after, None
        while j < n:
            ch = text[j]
            if quote:
                if ch == quote:
                    quote = None
            elif ch in "\"'":
                quote = ch
            elif ch == ">":
                yield start, j + 1, text[start:j + 1]
                i = j + 1
                break
            j += 1
        else:  # 没有闭合的 >
            return


def parse_attrs(tag: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    body = tag[4:]
    if body.endswith(">"):
        body = body[:-1]
    for m in ATTR_RE.finditer(body):
        name = m.group(1).lower()
        value = m.group(3) if m.group(3) is not None else m.group(4) if m.group(4) is not None else m.group(5)
        attrs.setdefault(name, value or "")
    return attrs


def parse_px(value: str | None) -> int | None:
    """'1000' / '1000px' → 1000；百分比、auto、calc() 等返回 None。"""
    if not value:
        return None
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*", value, re.IGNORECASE)
    if not m:
        return None
    px = int(round(float(m.group(1))))
    return px if px > 0 else None


# ---------------------------------------------------------------------------
# 缩放
# ---------------------------------------------------------------------------
def scale_ratio(w: int, h: int, want_w: int | None, want_h: int | None, allow_upscale: bool) -> float:
    ratios: list[float] = []
    if want_h:
        ratios.append(want_h / h)
    if want_w:
        ratios.append(want_w / w)
    if not ratios:
        return 1.0
    ratio = min(ratios)  # 同时给了宽高时，取较小者，保证两边都不超
    return ratio if allow_upscale else min(ratio, 1.0)


def resize_image(path: str, ratio: float, quality: int) -> tuple[tuple[int, int], tuple[int, int], int, int] | None:
    """按比例缩放并覆盖原文件。返回 (原尺寸, 新尺寸, 原字节数, 新字节数)，无需缩放时返回 None。"""
    before_bytes = os.path.getsize(path)
    with Image.open(path) as im:
        fmt = (im.format or "").upper()
        if getattr(im, "n_frames", 1) > 1:
            raise ValueError("动图（多帧）不支持缩放")
        w, h = im.size
        nw, nh = max(1, round(w * ratio)), max(1, round(h * ratio))
        if (nw, nh) == (w, h):
            return None
        extra: dict[str, object] = {}
        if im.info.get("icc_profile"):
            extra["icc_profile"] = im.info["icc_profile"]
        if im.info.get("exif"):
            extra["exif"] = im.info["exif"]
        out = im.convert("RGB") if fmt == "JPEG" else im
        resized = out.resize((nw, nh), Image.LANCZOS)
        if fmt == "JPEG":
            resized.save(path, "JPEG", quality=quality, optimize=True, progressive=True, **extra)
        elif fmt == "PNG":
            resized.save(path, "PNG", optimize=True, **extra)
        elif fmt == "WEBP":
            resized.save(path, "WEBP", quality=quality, method=6, **extra)
        else:
            resized.save(path, fmt or "PNG", **extra)
    return (w, h), (nw, nh), before_bytes, os.path.getsize(path)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def human(n: int) -> str:
    return f"{n / 1024:.0f} KiB" if n >= 1024 else f"{n} B"


def process_doc(doc: str, opts, cache: dict[str, tuple[int, int]], log) -> list[dict]:
    with open(doc, encoding="utf-8", newline="") as f:
        raw = f.read()
    bom = "\ufeff" if raw.startswith("\ufeff") else ""
    text = raw[len(bom):]
    doc_dir = os.path.dirname(doc)

    spans = protected_spans(text)
    edits: list[tuple[int, int, str]] = []
    records: list[dict] = []

    for start, end, tag in iter_img_tags(text):
        if overlaps(spans, start, end):
            records.append({"doc": doc, "line": text.count("\n", 0, start) + 1, "kind": KEPT,
                            "reason": "代码块/注释内，跳过", "tag": tag.strip()})
            continue
        line = text.count("\n", 0, start) + 1
        attrs = parse_attrs(tag)
        src = (attrs.get("src") or "").strip()
        alt = attrs.get("alt", "")
        if not src:
            records.append({"doc": doc, "line": line, "kind": WARN, "reason": "缺少 src", "tag": tag.strip()})
            log(f"  ! {to_posix(doc)}:{line} 缺少 src，跳过")
            continue

        want_w, want_h = parse_px(attrs.get("width")), parse_px(attrs.get("height"))
        dims_raw = {k: attrs[k] for k in ("width", "height") if k in attrs}
        unsupported = [k for k, v in dims_raw.items() if parse_px(v) is None]

        replacement = f"![{alt}]({src})"
        rec = {"doc": doc, "line": line, "src": src, "tag": tag.strip(), "attrs": attrs}

        if unsupported:
            records.append({**rec, "kind": WARN,
                            "reason": f"无法换算的尺寸属性: {', '.join(unsupported)}"})
            log(f"  ! {to_posix(doc)}:{line} 尺寸不是像素（{dims_raw}），保留标签不转换")
            continue

        remote = bool(re.match(r"^[a-z][a-z0-9+.-]*:", src, re.IGNORECASE))
        img_path = None if remote else os.path.normpath(os.path.join(doc_dir, unquote(src)))

        if opts.ref_only or remote or not (want_w or want_h):
            edits.append((start, end, replacement))
            reason = ("远程图片，无法缩放" if remote else
                      "未给出像素尺寸" if not (want_w or want_h) else "只替换引用（--ref-only）")
            records.append({**rec, "kind": REF, "reason": reason})
            log(f"  ~ {to_posix(doc)}:{line} {reason}")
            continue

        if not os.path.isfile(img_path):
            records.append({**rec, "kind": WARN, "reason": "找不到图片文件", "path": img_path})
            log(f"  ! {to_posix(doc)}:{line} 找不到图片: {src}")
            continue

        try:
            with Image.open(img_path) as probe:
                w, h = probe.size
            ratio = scale_ratio(w, h, want_w, want_h, opts.allow_upscale)
        except Exception as exc:  # noqa: BLE001 - 图片损坏等
            records.append({**rec, "kind": WARN, "reason": f"无法读取图片: {exc}"})
            log(f"  ! {to_posix(doc)}:{line} 无法读取图片: {src} ({exc})")
            continue

        if ratio == 1.0:
            records.append({**rec, "kind": REF, "reason": f"已是 {w}x{h}，无需缩放"})
            log(f"  = {to_posix(doc)}:{line} {src} {w}x{h} 无需缩放")
            edits.append((start, end, replacement))
            continue

        if img_path in cache:
            nw, nh = cache[img_path]
            records.append({**rec, "kind": REF, "reason": f"同图已处理 → {nw}x{nh}"})
            log(f"  = {to_posix(doc)}:{line} {src} 同图已处理 → {nw}x{nh}")
            edits.append((start, end, replacement))
            continue

        target = (max(1, round(w * ratio)), max(1, round(h * ratio)))
        if opts.write:
            try:
                result = resize_image(img_path, ratio, opts.quality)
            except Exception as exc:  # noqa: BLE001
                records.append({**rec, "kind": WARN, "reason": f"缩放失败: {exc}"})
                log(f"  ! {to_posix(doc)}:{line} 缩放失败: {src} ({exc})")
                continue
            if result is None:
                cache[img_path] = (w, h)
                records.append({**rec, "kind": REF, "reason": "已是目标尺寸"})
                edits.append((start, end, replacement))
                continue
            (w0, h0), (nw, nh), b0, b1 = result
            cache[img_path] = (nw, nh)
            records.append({**rec, "kind": RESIZED, "reason": f"{w0}x{h0} -> {nw}x{nh}",
                            "from": [w0, h0], "to": [nw, nh], "bytes_before": b0, "bytes_after": b1})
            log(f"  > {to_posix(doc)}:{line} {src}  {w0}x{h0} -> {nw}x{nh}  {human(b0)} -> {human(b1)}")
        else:
            cache[img_path] = target
            records.append({**rec, "kind": RESIZED, "reason": f"{w}x{h} -> {target[0]}x{target[1]} (dry-run)",
                            "from": [w, h], "to": list(target)})
            log(f"  > {to_posix(doc)}:{line} {src}  {w}x{h} -> {target[0]}x{target[1]}  [dry-run]")

        edits.append((start, end, replacement))

    if opts.write and edits:
        out = text
        for start, end, replacement in sorted(edits, key=lambda e: e[0], reverse=True):
            out = out[:start] + replacement + out[end:]
        with open(doc, "w", encoding="utf-8", newline="") as f:
            f.write(bom + out)
    return records


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="按 <img width/height> 缩放图片并把标签换成 Markdown 引用",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("用法", 1)[-1] if __doc__ else None,
    )
    ap.add_argument("targets", nargs="*", default=["."], help="Markdown 文件或目录（默认当前目录）")
    ap.add_argument("--write", "-w", action="store_true", help="真正写入（默认只试运行）")
    ap.add_argument("--ref-only", action="store_true", help="不缩放图片，只替换引用写法")
    ap.add_argument("--allow-upscale", action="store_true", help="允许放大小图")
    ap.add_argument("--quality", type=int, default=92, help="JPEG 质量，默认 92")
    ap.add_argument("--report", metavar="PATH", help="把逐项结果写成 JSON")
    ap.add_argument("--quiet", "-q", action="store_true", help="只打印汇总")
    opts = ap.parse_args(argv)

    docs = iter_markdown(opts.targets)
    if not docs:
        print("没有找到 Markdown 文档")
        return 2

    print(f"扫描 {len(docs)} 个文档{'（试运行，不写盘）' if not opts.write else ''}")
    print(f"缩放策略：{'允许放大' if opts.allow_upscale else '只缩小不放大'}"
          f"{'；只替换引用' if opts.ref_only else ''}\n")

    log = (lambda *_: None) if opts.quiet else print
    cache: dict[str, tuple[int, int]] = {}
    all_records: list[dict] = []
    for doc in docs:
        records = process_doc(doc, opts, cache, log)
        all_records.extend(records)

    by_kind: dict[str, list[dict]] = {}
    for r in all_records:
        by_kind.setdefault(r["kind"], []).append(r)

    print("\n汇总:")
    print(f"  找到 <img> 标签: {len(all_records)}")
    print(f"  缩放图片（去重）: {len(by_kind.get(RESIZED, []))}")
    print(f"  替换为 Markdown 引用: {len(by_kind.get(REF, [])) + len(by_kind.get(RESIZED, []))}")
    print(f"  保留原标签: {len(by_kind.get(KEPT, []))}")
    print(f"  警告: {len(by_kind.get(WARN, []))}")
    if opts.report:
        with open(opts.report, "w", encoding="utf-8") as f:
            json.dump(all_records, f, ensure_ascii=False, indent=2)
        print(f"  报告: {opts.report}")
    if not opts.write:
        print("\n[试运行] 未修改任何文件。确认无误后加 --write 执行。")
    return 1 if by_kind.get(WARN) else 0


if __name__ == "__main__":
    sys.exit(main())
