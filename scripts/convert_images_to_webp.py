#!/usr/bin/env python3
"""convert_images_to_webp.py — 把 Markdown 引用的栅格图片转成 WebP，
同步改写引用、删除原始大图。

工作方式
  * 只处理 Markdown 里真正显示出来的图片：标准 ``![alt](src)`` 与内联
    ``<img src="...">``；围栏代码块、行内代码、HTML 注释、YAML frontmatter
    里的内容不会被误改。
  * 支持 png / jpg / jpeg / bmp / tif / tiff。gif（可能动图）、svg、avif
    以及已经是 webp 的文件一律跳过。
  * 只有 WebP 比原图至少小 ``--min-saving``（默认 5%）才替换；否则保留原图。
  * 同一张图片被多篇文档引用时只转换一次，所有引用一起改写。
  * 原图被删除前，要求它的**全部**引用方都参与本次转换，避免留下悬空引用。

两种运行模式
  --all      扫描工作区（可传目录，默认整个仓库）。CI 构建前、手动批量整理用。
  --staged   只处理 Git 暂存区（pre-commit hook 用）。直接改写 index 里的
             blob，因此不会把未暂存的修改带进提交；若相关文件在暂存后又被
             改动，则跳过并在 stderr 提示，绝不动工作区。

用法
  python scripts/convert_images_to_webp.py --all --dry-run   # 预览
  python scripts/convert_images_to_webp.py --all             # 实际转换
  python scripts/convert_images_to_webp.py --staged          # hook 调用
  python scripts/convert_images_to_webp.py --all --quality 90
  python scripts/convert_images_to_webp.py --all path/to/dir

依赖
  Pillow：``python -m pip install pillow``

跳过整个 hook
  ``SKIP_WEBP_HOOK=1 git commit ...``
"""

from __future__ import annotations

import argparse
import html
import io
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - 环境问题
    sys.exit(
        "需要 Pillow 才能转码图片：\n"
        "  python -m pip install pillow\n"
        "（也可以在提交时用 SKIP_WEBP_HOOK=1 临时跳过）"
    )

# Windows 默认 GBK，hook 在 Git Bash 里跑；统一按 UTF-8 输出，避免中文乱码。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):  # pragma: no cover
        pass

CONVERTIBLE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
MD_EXTS = {".md", ".markdown", ".mdown", ".mkd", ".mdwn", ".mdtxt"}
SKIP_DIR_NAMES = {".git", "node_modules", "dist", ".pnpm-store", "tmp", "vendor"}
SKIP_PATH_SUFFIXES = (
    os.path.join(".vitepress", "dist"),
    os.path.join(".vitepress", "cache"),
)

# 标准 Markdown 图片；URL 支持 <...> 包裹，title 原样保留。
MD_IMAGE_RE = re.compile(
    r"!\[(?P<alt>[^\]]*)\]\(\s*(?P<url><[^>]*>|[^\s)]+)(?P<rest>[^)]*)\)"
)
# 内联 HTML <img src="...">，属性顺序任意。
HTML_IMG_RE = re.compile(
    r"<img\b[^>]*?\bsrc\s*=\s*(?P<q>[\"'])(?P<url>.*?)(?P=q)", re.IGNORECASE
)
# frontmatter 里的封面图（VitePress 的 image: / cover:），不能被当成正文图片。
FM_IMAGE_RE = re.compile(r"^\s*(?:image|cover)\s*:\s*[\"']?([^\"'\s#]+)", re.MULTILINE)

FENCE_RE = re.compile(r"^[ \t]*(`{3,}|~{3,})")
COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


@dataclass
class Ref:
    doc: Path          # 文档绝对路径
    start: int         # URL 在文档中的起止位置
    end: int
    url: str           # 原始 URL 文本（可能带 ./、../、%20）
    image: Path | None  # 解析后的图片绝对路径；外部/不存在为 None


@dataclass
class Conversion:
    src: Path
    dst: Path
    before: int
    after: int
    reused: bool = False
    data: bytes | None = None  # 待写入的 WebP 内容（reused 时为空）


class SkipImage(Exception):
    """单张图片无法/无需转换。"""


class GitError(Exception):
    pass


# ---------------------------------------------------------------------------
# 通用工具
# ---------------------------------------------------------------------------
def human(n: int) -> str:
    if n >= 1024 * 1024:
        return f"{n / 1024 / 1024:.2f} MiB"
    if n >= 1024:
        return f"{n / 1024:.0f} KiB"
    return f"{n} B"


def to_posix(p: str | Path) -> str:
    return str(p).replace(os.sep, "/")


def path_has_skipped_part(path: Path, root: Path) -> bool:
    try:
        rel = path.relative_to(root)
    except ValueError:
        rel = path
    parts = rel.parts
    if any(part in SKIP_DIR_NAMES for part in parts):
        return True
    posix = to_posix(rel)
    return any(
        posix == to_posix(s) or posix.startswith(to_posix(s) + "/")
        for s in SKIP_PATH_SUFFIXES
    )


def overlaps(spans: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(start < s_end and s_start < end for s_start, s_end in spans)


def _inline_code_spans(line: str, base: int) -> list[tuple[int, int]]:
    """一行内成对的反引号串（支持 ``a ` b`` 这种多反引号）。"""
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
        if found is None:
            i = j
        else:
            spans.append((base + i, base + found))
            i = found
    return spans


def frontmatter_span(text: str) -> tuple[int, int] | None:
    if not text.startswith("---"):
        return None
    m = re.match(r"^---[ \t]*\r?\n.*?\r?\n---[ \t]*(?:\r?\n|$)", text, re.DOTALL)
    return (0, m.end()) if m else None


def protected_spans(text: str) -> list[tuple[int, int]]:
    """围栏代码块、行内代码、HTML 注释、frontmatter。"""
    spans: list[tuple[int, int]] = []

    fence: tuple[str, int, int] | None = None
    offset = 0
    for line in text.splitlines(keepends=True):
        m = FENCE_RE.match(line)
        if fence is None:
            if m:
                marker = m.group(1)
                fence = (marker[0], len(marker), offset)
                spans.append((offset, offset + len(line)))
        elif (
            m
            and m.group(1)[0] == fence[0]
            and len(m.group(1)) >= fence[1]
            and not line.strip()[len(m.group(1)) :].strip()
        ):
            spans.append((fence[2], offset + len(line)))
            fence = None
        offset += len(line)
    if fence is not None:
        spans.append((fence[2], len(text)))

    for m in COMMENT_RE.finditer(text):
        spans.append((m.start(), m.end()))

    fm = frontmatter_span(text)
    if fm:
        spans.append(fm)

    offset = 0
    for line in text.splitlines(keepends=True):
        for start, end in _inline_code_spans(line, offset):
            if not overlaps(spans, start, end):
                spans.append((start, end))
        offset += len(line)
    return spans


def split_url_tail(url: str) -> tuple[str, str]:
    """把 URL 拆成 (主体, ?query#fragment 尾巴)。"""
    cut = len(url)
    for ch in "?#":
        i = url.find(ch)
        if i != -1:
            cut = min(cut, i)
    return url[:cut], url[cut:]


def url_to_webp(url: str) -> str:
    """只替换扩展名，保留 ./、../、%20、query/fragment 与 <...> 包裹。"""
    angle = url.startswith("<") and url.endswith(">")
    inner = url[1:-1] if angle else url
    core, tail = split_url_tail(inner)
    stem, ext = os.path.splitext(core)
    if ext.lower() not in CONVERTIBLE_EXTS:
        return url
    out = stem + ".webp" + tail
    return f"<{out}>" if angle else out


def resolve_url(doc: Path, url: str, root: Path) -> Path | None:
    raw = html.unescape(url.strip())
    if raw.startswith("<") and raw.endswith(">"):
        raw = raw[1:-1]
    raw = unquote(split_url_tail(raw)[0])
    if not raw or re.match(r"^[a-z][a-z0-9+.-]*:", raw, re.IGNORECASE) or raw.startswith("//"):
        return None
    if raw.startswith("/"):
        for base in (root / ".vitepress" / "public", root / "public"):
            candidate = (base / raw.lstrip("/")).resolve()
            if candidate.is_file():
                return candidate
        return None
    candidate = (doc.parent / raw).resolve()
    return candidate if candidate.is_file() else None


# ---------------------------------------------------------------------------
# 解析文档
# ---------------------------------------------------------------------------
def parse_refs(text: str, doc: Path, root: Path) -> list[Ref]:
    spans = protected_spans(text)
    refs: list[Ref] = []

    for m in MD_IMAGE_RE.finditer(text):
        if overlaps(spans, m.start(), m.end()):
            continue
        url = m.group("url")
        refs.append(
            Ref(doc, m.start("url"), m.end("url"), url, resolve_url(doc, url, root))
        )

    for m in HTML_IMG_RE.finditer(text):
        if overlaps(spans, m.start(), m.end()):
            continue
        url = m.group("url")
        refs.append(
            Ref(doc, m.start("url"), m.end("url"), url, resolve_url(doc, url, root))
        )
    return refs


def frontmatter_images(text: str, doc: Path, root: Path) -> set[Path]:
    fm = frontmatter_span(text)
    if not fm:
        return set()
    out: set[Path] = set()
    for m in FM_IMAGE_RE.finditer(text[: fm[1]]):
        resolved = resolve_url(doc, m.group(1), root)
        if resolved:
            out.add(resolved)
    return out


def iter_markdown(
    root: Path, targets: list[Path], skip_abs: set[Path] | None = None
) -> list[Path]:
    skip_abs = skip_abs or set()
    found: set[Path] = set()
    for target in targets:
        target = target.resolve()
        if target.is_file():
            if target.suffix.lower() in MD_EXTS:
                found.add(target)
            continue
        for dirpath, dirnames, filenames in os.walk(target):
            here = Path(dirpath)
            dirnames[:] = [
                d
                for d in dirnames
                if d not in SKIP_DIR_NAMES
                and (here / d).resolve() not in skip_abs
                and not path_has_skipped_part(here / d, root)
            ]
            for name in filenames:
                if Path(name).suffix.lower() in MD_EXTS:
                    found.add((here / name).resolve())
    return sorted(found)


def submodule_roots(root: Path) -> set[Path]:
    """当前仓库的子模块挂载点（避免 --staged 把子模块文档当成父仓库未跟踪文档）。"""
    try:
        out = git(
            ["config", "-f", ".gitmodules", "--get-regexp", "path"], check=False
        ).stdout.decode("utf-8", "replace")
    except OSError:
        return set()
    roots: set[Path] = set()
    for line in out.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[1].strip():
            roots.add((root / parts[1].strip()).resolve())
    return roots


# ---------------------------------------------------------------------------
# 编码
# ---------------------------------------------------------------------------
def encode_webp(raw: bytes, quality: int) -> bytes:
    try:
        with Image.open(io.BytesIO(raw)) as im:
            if getattr(im, "n_frames", 1) > 1:
                raise SkipImage("多帧图片")
            im = ImageOps.exif_transpose(im)
            has_alpha = (
                im.mode in {"RGBA", "LA", "RGBa", "La"}
                or (im.mode == "P" and "transparency" in im.info)
            )
            icc = im.info.get("icc_profile")
            converted = im.convert("RGBA" if has_alpha else "RGB")
            buf = io.BytesIO()
            kwargs: dict[str, object] = {"quality": quality, "method": 6}
            if icc:
                kwargs["icc_profile"] = icc
            converted.save(buf, "WEBP", **kwargs)
            return buf.getvalue()
    except SkipImage:
        raise
    except Exception as exc:  # noqa: BLE001 - 损坏图片等
        raise SkipImage(f"无法解码：{exc}") from exc


def extension_for_webp(src: Path) -> Path:
    return src.with_suffix(".webp")


def atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# --all：直接处理工作区
# ---------------------------------------------------------------------------
def run_all(args: argparse.Namespace) -> int:
    root = Path.cwd()
    targets = [Path(p) for p in (args.paths or ["."])]
    docs = iter_markdown(root, targets)
    if not docs:
        print("[webp] 没有找到 Markdown 文档")
        return 0

    doc_texts: dict[Path, str] = {}
    doc_boms: dict[Path, bool] = {}
    doc_refs: dict[Path, list[Ref]] = {}
    image_docs: dict[Path, set[Path]] = {}
    protected: set[Path] = set()

    for doc in docs:
        try:
            raw = doc.read_bytes()
            bom = raw.startswith(b"\xef\xbb\xbf")
            text = raw.decode("utf-8-sig")
        except (OSError, UnicodeDecodeError) as exc:
            print(f"[webp] 跳过无法读取的文档 {to_posix(doc)}：{exc}", file=sys.stderr)
            continue
        doc_texts[doc] = text
        doc_boms[doc] = bom
        refs = parse_refs(text, doc, root)
        doc_refs[doc] = refs
        for ref in refs:
            if ref.image and ref.image.suffix.lower() in CONVERTIBLE_EXTS:
                image_docs.setdefault(ref.image, set()).add(doc)
        protected |= frontmatter_images(text, doc, root)

    conversions: list[Conversion] = []
    mapping: dict[Path, Path] = {}
    skipped: list[tuple[Path, str]] = []
    used_targets: set[Path] = set()

    for src in sorted(image_docs):
        if src in protected:
            skipped.append((src, "被 frontmatter 引用（封面图），保留原格式"))
            continue
        if not src.is_file():
            continue
        dst = extension_for_webp(src)
        if dst in used_targets:
            skipped.append((src, f"目标 {dst.name} 已被另一张同名单图占用"))
            continue
        try:
            conv = plan_worktree_conversion(src, dst, args)
        except SkipImage as exc:
            skipped.append((src, str(exc)))
            continue
        conversions.append(conv)
        mapping[src] = dst
        used_targets.add(dst)

    if args.dry_run:
        updated_docs = 0
        for doc, refs in doc_refs.items():
            if any(ref.image in mapping for ref in refs):
                updated_docs += 1
        report_all(args, conversions, updated_docs, skipped, dry_run=True)
        return 0

    # 先写 WebP，再改文档引用，最后删原图：任何一步中断都不会留下悬空引用。
    done: list[Conversion] = []
    for conv in conversions:
        try:
            if conv.data is not None:
                atomic_write(conv.dst, conv.data)
            done.append(conv)
        except OSError as exc:
            print(f"[webp] 写入失败 {to_posix(conv.dst)}：{exc}", file=sys.stderr)
            mapping.pop(conv.src, None)
            skipped.append((conv.src, f"写入失败：{exc}"))

    updated_docs = 0
    for doc, refs in doc_refs.items():
        edits = [
            (ref.start, ref.end, url_to_webp(ref.url))
            for ref in refs
            if ref.image in mapping
        ]
        if not edits:
            continue
        new_text = doc_texts[doc]
        for start, end, replacement in sorted(edits, key=lambda e: e[0], reverse=True):
            new_text = new_text[:start] + replacement + new_text[end:]
        if new_text != doc_texts[doc]:
            data = new_text.encode("utf-8")
            if doc_boms.get(doc):
                data = b"\xef\xbb\xbf" + data
            doc.write_bytes(data)
            updated_docs += 1

    for conv in done:
        try:
            conv.src.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            print(f"[webp] 无法删除原图 {to_posix(conv.src)}：{exc}", file=sys.stderr)

    report_all(args, done, updated_docs, skipped, dry_run=False)
    return 0


def plan_worktree_conversion(src: Path, dst: Path, args: argparse.Namespace) -> Conversion:
    before = src.stat().st_size
    if dst.exists():
        after = dst.stat().st_size
        if after < before * (1 - args.min_saving):
            return Conversion(src, dst, before, after, reused=True)
        raise SkipImage("同名 .webp 已存在但体积没有明显优势")
    raw = src.read_bytes()
    out = encode_webp(raw, args.quality)
    if len(out) >= before * (1 - args.min_saving):
        raise SkipImage(
            f"WebP 收益不足（{human(before)} → {human(len(out))}）"
        )
    return Conversion(src, dst, before, len(out), data=out)


def report_all(
    args: argparse.Namespace,
    conversions: list[Conversion],
    updated_docs: int,
    skipped: list[tuple[Path, str]],
    dry_run: bool,
) -> None:
    before = sum(c.before for c in conversions)
    after = sum(c.after for c in conversions)
    saved = before - after
    verb = "将转换" if dry_run else "已转换"
    if not before:
        print("[webp] 没有需要转换的图片")
    else:
        print(
            f"[webp] {verb} {len(conversions)} 张图片：{human(before)} → "
            f"{human(after)}（节省 {human(saved)}，{saved / before * 100:.1f}%）"
        )
    if updated_docs:
        print(f"[webp] {'将更新' if dry_run else '已更新'} {updated_docs} 篇文档的图片引用")
    if args.verbose:
        for c in sorted(conversions, key=lambda x: x.before - x.after, reverse=True)[:15]:
            print(f"       {human(c.before):>9} → {human(c.after):<9} {to_posix(c.src)}")
    if skipped and (args.verbose or not conversions):
        for path, reason in skipped[:20]:
            print(f"[webp] 跳过 {to_posix(path)}：{reason}", file=sys.stderr)
        if len(skipped) > 20:
            print(f"[webp] 其余 {len(skipped) - 20} 张跳过项略", file=sys.stderr)


# ---------------------------------------------------------------------------
# --staged：直接操作 Git index
# ---------------------------------------------------------------------------
def git(args: list[str], *, check: bool = True, input_bytes: bytes | None = None) -> subprocess.CompletedProcess:
    result = subprocess.run(
        ["git", *args], input=input_bytes, capture_output=True, check=False
    )
    if check and result.returncode != 0:
        raise GitError(
            f"git {' '.join(args)} 失败：{result.stderr.decode('utf-8', 'replace').strip()}"
        )
    return result


def git_z(args: list[str]) -> list[str]:
    out = git(args).stdout
    return [os.fsdecode(x) for x in out.split(b"\0") if x]


def git_blob(rel: str) -> bytes:
    return git(["show", f":{rel}"]).stdout


def update_index(rel: str, data: bytes) -> None:
    sha = git(["hash-object", "-w", "--stdin"], input_bytes=data).stdout.decode().strip()
    git(["update-index", "--add", "--cacheinfo", f"100644,{sha},{rel}"])


def worktree_clean(rel: str) -> bool:
    return git(["diff", "--quiet", "--", rel], check=False).returncode == 0


def decode_md(raw: bytes) -> tuple[str, bool]:
    bom = raw.startswith(b"\xef\xbb\xbf")
    return raw.decode("utf-8-sig"), bom


def run_staged(args: argparse.Namespace) -> int:
    root = Path(git(["rev-parse", "--show-toplevel"]).stdout.decode().strip())
    os.chdir(root)

    staged = set(git_z(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]))
    staged_md = {p for p in staged if Path(p).suffix.lower() in MD_EXTS}
    if not staged_md:
        return 0

    tracked = set(git_z(["ls-files", "-z"]))
    if not tracked:
        return 0

    # 读取所有被跟踪文档的 index 版本，建立“图片 → 引用文档”的反向索引。
    all_texts: dict[str, str] = {}
    all_refs: dict[str, list[Ref]] = {}
    image_docs: dict[Path, set[str]] = {}
    protected: set[Path] = set()
    for rel in sorted(p for p in tracked if Path(p).suffix.lower() in MD_EXTS):
        try:
            text, _ = decode_md(git_blob(rel))
        except (GitError, UnicodeDecodeError):
            continue
        doc = root / rel
        all_texts[rel] = text
        refs = parse_refs(text, doc, root)
        all_refs[rel] = refs
        for ref in refs:
            if ref.image and ref.image.suffix.lower() in CONVERTIBLE_EXTS:
                image_docs.setdefault(ref.image, set()).add(rel)
        protected |= frontmatter_images(text, doc, root)

    # 工作区里尚未加入 Git 的 Markdown 也可能引用同一张图；它们不会进入本次
    # 提交，但删掉原图会让它们悬空，所以一并纳入“引用方”检查。
    known = set(all_refs)
    for doc in iter_markdown(root, [root], skip_abs=submodule_roots(root)):
        rel = to_posix(doc.relative_to(root))
        if rel in known:
            continue
        try:
            text = doc.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError):
            continue
        refs = parse_refs(text, doc, root)
        all_refs[rel] = refs
        for ref in refs:
            if ref.image and ref.image.suffix.lower() in CONVERTIBLE_EXTS:
                image_docs.setdefault(ref.image, set()).add(rel)
        protected |= frontmatter_images(text, doc, root)

    # 候选：被暂存文档引用、且已在 index 中的图片。
    candidates: set[Path] = set()
    for doc_rel in staged_md:
        for ref in all_refs.get(doc_rel, []):
            if ref.image and ref.image.suffix.lower() in CONVERTIBLE_EXTS:
                candidates.add(ref.image)

    conversions: list[Conversion] = []
    mapping: dict[Path, Path] = {}
    skipped: list[tuple[Path, str]] = []
    used_targets: set[str] = set()

    for src in sorted(candidates):
        src_rel = to_posix(src.relative_to(root))
        if src_rel not in tracked:
            skipped.append((src, "图片尚未加入 Git（先 git add）"))
            continue
        if src in protected:
            skipped.append((src, "被 frontmatter 引用（封面图）"))
            continue

        dst = extension_for_webp(src)
        dst_rel = to_posix(dst.relative_to(root))
        if dst_rel in used_targets:
            skipped.append((src, f"目标 {dst.name} 已被另一张同名单图占用"))
            continue

        ref_docs = image_docs.get(src, set())
        unstaged_docs = ref_docs - staged_md
        if unstaged_docs:
            skipped.append(
                (src, "还被未暂存的文档引用：" + "、".join(sorted(unstaged_docs)[:3]))
            )
            continue
        if not worktree_clean(src_rel):
            skipped.append((src, "图片有未暂存修改，先 git add"))
            continue
        dirty_docs = [d for d in ref_docs if not worktree_clean(d)]
        if dirty_docs:
            skipped.append(
                (src, "引用它的文档有未暂存修改：" + "、".join(sorted(dirty_docs)[:3]))
            )
            continue

        dst = extension_for_webp(src)
        dst_rel = to_posix(dst.relative_to(root))
        try:
            conv, new_bytes = plan_staged_conversion(src_rel, dst_rel, tracked, args)
        except SkipImage as exc:
            skipped.append((src, str(exc)))
            continue

        if args.dry_run:
            conversions.append(conv)
            mapping[src] = dst
            used_targets.add(dst_rel)
            continue

        update_index(dst_rel, new_bytes)
        dst.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(dst, new_bytes)
        conversions.append(conv)
        mapping[src] = dst
        used_targets.add(dst_rel)

    if args.dry_run:
        report_staged(args, conversions, mapping, all_refs, staged_md, skipped, dry_run=True)
        return 0

    updated_docs = 0
    for doc_rel in sorted(staged_md):
        refs = all_refs.get(doc_rel, [])
        edits = [
            (ref.start, ref.end, url_to_webp(ref.url))
            for ref in refs
            if ref.image in mapping
        ]
        if not edits:
            continue
        text = all_texts[doc_rel]
        _, bom = decode_md(git_blob(doc_rel))
        new_text = text
        for start, end, replacement in sorted(edits, key=lambda e: e[0], reverse=True):
            new_text = new_text[:start] + replacement + new_text[end:]
        if new_text == text:
            continue
        data = new_text.encode("utf-8")
        if bom:
            data = b"\xef\xbb\xbf" + data
        update_index(doc_rel, data)
        (root / doc_rel).write_bytes(data)
        updated_docs += 1

    # 文档引用都改好之后再删原图，避免中途失败留下悬空引用。
    for conv in conversions:
        src_rel = to_posix(conv.src)
        git(["update-index", "--force-remove", "--", src_rel])
        try:
            (root / src_rel).unlink()
        except FileNotFoundError:
            pass

    report_staged(args, conversions, mapping, all_refs, staged_md, skipped, dry_run=False,
                  updated_docs=updated_docs)
    return 0


def plan_staged_conversion(
    src_rel: str, dst_rel: str, tracked: set[str], args: argparse.Namespace
) -> tuple[Conversion, bytes]:
    src_bytes = git_blob(src_rel)
    before = len(src_bytes)

    if dst_rel in tracked:
        dst_bytes = git_blob(dst_rel)
        if len(dst_bytes) < before * (1 - args.min_saving):
            return Conversion(Path(src_rel), Path(dst_rel), before, len(dst_bytes), reused=True), dst_bytes
        raise SkipImage("同名 .webp 已存在但体积没有明显优势")

    if os.path.isfile(dst_rel):
        dst_bytes = Path(dst_rel).read_bytes()
        if len(dst_bytes) < before * (1 - args.min_saving):
            return Conversion(Path(src_rel), Path(dst_rel), before, len(dst_bytes), reused=True), dst_bytes

    out = encode_webp(src_bytes, args.quality)
    if len(out) >= before * (1 - args.min_saving):
        raise SkipImage(f"WebP 收益不足（{human(before)} → {human(len(out))}）")
    return Conversion(Path(src_rel), Path(dst_rel), before, len(out)), out


def report_staged(
    args: argparse.Namespace,
    conversions: list[Conversion],
    mapping: dict[Path, Path],
    all_refs: dict[str, list[Ref]],
    staged_md: set[str],
    skipped: list[tuple[Path, str]],
    dry_run: bool,
    updated_docs: int | None = None,
) -> None:
    before = sum(c.before for c in conversions)
    after = sum(c.after for c in conversions)
    saved = before - after
    if conversions:
        verb = "将转换" if dry_run else "已转换"
        print(f"[webp] {verb} {len(conversions)} 张图片：{human(before)} → {human(after)}"
              f"（节省 {human(saved)}，{saved / before * 100:.1f}%）")
    if updated_docs is None:
        updated_docs = sum(
            1
            for doc in staged_md
            if any(ref.image in mapping for ref in all_refs.get(doc, []))
        )
    if updated_docs:
        print(f"[webp] {'将更新' if dry_run else '已更新'} {updated_docs} 篇文档的图片引用")
    if args.verbose:
        for c in sorted(conversions, key=lambda x: x.before - x.after, reverse=True):
            print(f"       {human(c.before):>9} → {human(c.after):<9} {to_posix(c.src)}")
    for path, reason in skipped:
        print(f"[webp] 跳过 {to_posix(path)}：{reason}", file=sys.stderr)


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="把 Markdown 引用的图片转换为 WebP，改写引用并删除原图",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--all", action="store_true", help="扫描工作区（CI / 手动批量）")
    mode.add_argument("--staged", action="store_true", help="只处理 Git 暂存区（pre-commit）")
    parser.add_argument("paths", nargs="*", help="--all 的扫描目录，默认整个仓库")
    parser.add_argument("--quality", type=int, default=88, help="WebP 质量 1-100，默认 88")
    parser.add_argument(
        "--min-saving", type=float, default=0.05,
        help="至少节省这个比例才替换，默认 0.05",
    )
    parser.add_argument("--dry-run", action="store_true", help="只报告，不写任何文件")
    parser.add_argument("-v", "--verbose", action="store_true", help="列出每张转换")
    args = parser.parse_args(argv)

    if not 1 <= args.quality <= 100:
        parser.error("--quality 必须在 1-100 之间")
    if not 0 <= args.min_saving < 1:
        parser.error("--min-saving 必须在 [0, 1) 之间")

    try:
        if args.staged:
            return run_staged(args)
        return run_all(args)
    except GitError as exc:
        print(f"[webp] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
