#!/usr/bin/env node
/**
 * media-migrate.mjs — 把 tb710fu-doc 的媒体资源按「文档方向」重新归位。
 *
 * 背景
 *   tb710fu-doc 下有两个方向的文档：generic/ 与 without_unlock/。
 *   原本所有媒体资源都平铺在 tb710fu-doc/media/ 根目录下，无法从路径看出
 *   某张图属于哪个方向。本脚本把媒体资源迁移到与文档目录同名的子目录：
 *
 *     tb710fu-doc/media/generic/**          <- 仅被 generic/        文档引用
 *     tb710fu-doc/media/without_unlock/**   <- 仅被 without_unlock/ 文档引用
 *     tb710fu-doc/media/generic/<x> 和 media/without_unlock/<x>  <- 被两个方向共享（复制两份）
 *
 *   同时改写所有 Markdown / HTML 中的相对引用，使其指向新位置。
 *   因为没有移动文档，所有引用都是「../media/...」形式（high_versions/ 下是
 *   「../../media/...」），本脚本按「引用解析后落在 media/ 目录内」来识别，
 *   所以链接、图片、`<img src>` 都能覆盖，且不会误伤其它相对路径。
 *
 * 用法
 *   node scripts/media-migrate.mjs                # 试运行（dry-run，默认，不写任何文件）
 *   node scripts/media-migrate.mjs --apply        # 实际执行
 *   node scripts/media-migrate.mjs --apply --no-git-mv   # 用 fs.rename 代替 git mv
 *   node scripts/media-migrate.mjs --verify       # 只校验引用是否全部可解析
 *   node scripts/media-migrate.mjs --help
 *
 * 常用选项
 *   --root <dir>     子模块根目录，默认自动探测 tb710fu-doc
 *   --variant a,b    文档方向目录名，默认 generic,without_unlock
 *   --quiet          只打印汇总，不打印逐条明细
 *   --no-git-mv      不使用 git mv（默认使用，以保留 git 历史）
 *
 * 本脚本是幂等的：迁移完成后再跑一次会报「无需迁移」。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// 子目录归属表
// ---------------------------------------------------------------------------
// 媒体子目录无法从「被谁引用」推断归属时（例如目录内容全部未被引用，或该
// 目录被两个方向共同引用），在这里显式指定。键为 media/ 下的相对路径。
/** @type {Record<string, string>} */
const DIR_UNLOCKED_VARIANT = {
  // 对应 generic/root_your_device_lkm.md（解锁后 LKM Root 教程）
  unlock_lkm_root: 'generic',

  // 由 without_unlock/high_versions/*.md 引用的两个高阶文档
  create_profile_with_avb_droid: 'without_unlock',
  restore_aosp_trust_chain_on_android: 'without_unlock',
}

const USAGE = `media-migrate.mjs — 把 tb710fu-doc 的媒体资源按文档方向重新归位

  node scripts/media-migrate.mjs                  试运行（dry-run，默认，不写任何文件）
  node scripts/media-migrate.mjs --apply          实际执行
  node scripts/media-migrate.mjs --apply --no-git-mv
                                                  用 fs.rename 代替 git mv
  node scripts/media-migrate.mjs --verify         只校验引用是否全部可解析

选项
  --apply            真正写入（默认只打印计划）
  --dry-run          显式指定试运行（默认行为）
  --verify           校验文档中所有媒体引用能否解析、大小写是否一致
  --root <dir>       子模块根目录，默认自动探测 tb710fu-doc
  --variant a,b      文档方向目录名，默认 generic,without_unlock
  --no-git-mv        不使用 git mv（默认使用，以保留 git 历史）
  --quiet, -q        只打印汇总
  --help, -h         显示本帮助

迁移规则
  media/<x>            -> media/generic/<x>          仅 generic 引用
  media/<x>            -> media/without_unlock/<x>   仅 without_unlock 引用
  media/<x>            -> 两个目录各一份              两个方向共享
  media/<sub>/...      -> 按子目录归属整体移动
  未被任何文档引用的文件会被删除
  Markdown 与 <img src> 中的相对引用同步改写
`

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
const toPosix = (p) => p.split(path.sep).join('/')
const exists = (p) => fs.existsSync(p)

/**
 * 抓取文档中的图片引用：
 *   1) Markdown  ![](../media/x.webp)
 *   2) HTML      <img src="../media/x.webp">
 * 用 `(["'])...\5` 回引保证引号成对，避免 "..." 被单引号分支抢走。
 * 捕获组：1=md 前缀 2=md 目标 4=img 前缀 5=引号 6=img 目标
 */
const REF_RE = /(!?\[[^\]]*\]\(\s*)([^()\s]+)(\s*\))|(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\5/gi
const refTarget = (m) => (m[2] !== undefined ? m[2] : m[4] !== undefined ? m[6] : undefined)

function walk(dir) {
  const files = []
  const dirs = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, entry.name)
      if (entry.isDirectory()) {
        dirs.push(p)
        stack.push(p)
      } else if (entry.isFile()) {
        files.push(p)
      }
    }
  }
  return { files, dirs }
}

function unique(items) {
  return [...new Set(items)]
}

function samePathCI(a, b) {
  return a.toLowerCase() === b.toLowerCase()
}

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    apply: false,
    verify: false,
    help: false,
    quiet: false,
    useGitMv: true,
    root: null,
    variants: ['generic', 'without_unlock'],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') opts.apply = true
    else if (a === '--dry-run') opts.apply = false
    else if (a === '--verify') opts.verify = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--quiet' || a === '-q') opts.quiet = true
    else if (a === '--no-git-mv') opts.useGitMv = false
    else if (a === '--root') opts.root = argv[++i]
    else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length)
    else if (a === '--variant') opts.variants = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a.startsWith('--variant=')) opts.variants = a.slice('--variant='.length).split(',').map((s) => s.trim()).filter(Boolean)
    else throw new Error(`未知参数: ${a}（用 --help 查看用法）`)
  }
  return opts
}

/** 在脚本自身位置向上查找子模块根目录。返回绝对路径。 */
function detectRoot(explicit) {
  if (explicit) {
    const c = path.resolve(explicit)
    if (!exists(path.join(c, 'media'))) throw new Error(`--root 指定的目录下没有 media/：${c}`)
    return c
  }
  const here = __dirnameOf() // .../<repo>/scripts
  const candidates = [
    path.resolve(here, '..', 'tb710fu-doc'), // 仓库根下的子模块
    path.resolve(process.cwd(), 'tb710fu-doc'),
    path.resolve(process.cwd()),
  ]
  for (const c of candidates) {
    if (exists(path.join(c, 'media')) && exists(path.join(c, '.git'))) return c
  }
  for (const c of candidates) {
    if (exists(path.join(c, 'media'))) return c
  }
  throw new Error('无法定位 tb710fu-doc 子模块根目录，请用 --root 指定')
}

function __dirnameOf() {
  return path.dirname(fileURLToPath(import.meta.url))
}

/** 统一用「相对子模块根目录的 posix 路径」表示仓库内文件。 */
function createRel(ROOT) {
  return (abs) => toPosix(path.relative(ROOT, path.resolve(abs)))
}

// ---------------------------------------------------------------------------
// 扫描 + 计划
// ---------------------------------------------------------------------------
function buildPlan(root, variants) {
  root = path.resolve(root)
  const rel = createRel(root)
  const mediaRoot = path.join(root, 'media')
  if (!exists(mediaRoot)) throw new Error(`找不到媒体目录: ${mediaRoot}`)

  const { files: absMediaFiles } = walk(mediaRoot)
  const mediaFiles = absMediaFiles.map(rel)
  // 小写路径 -> 磁盘真实路径（用于发现引用大小写写错，Linux 上会 404）
  const byLower = new Map(mediaFiles.map((p) => [p.toLowerCase(), p]))

  const mediaPrefix = 'media/'
  const isUnderMedia = (repoRel) => repoRel.startsWith(mediaPrefix)
  const relFromMedia = (asset) => asset.slice(mediaPrefix.length)

  /**
   * 资源键：与「资源放在哪个方向目录」无关的身份标识。
   *   media/fix_gsn/x.png          （源子目录）  -> <文档方向>/fix_gsn/x.png
   *   media/image8.webp            （源根目录）  -> <文档方向>/image8.webp
   *   media/generic/image8.webp    （已就位）    -> <文档方向>/image8.webp
   *   media/GENERIC/image8.webp    （大小写写错）-> <文档方向>/image8.webp
   * 即：方向目录只当「前缀」补齐，不参与资源身份，识别时忽略大小写。
   * 这样同一份资源在迁移前后、以及两个方向目录之间都能得到同一个键，
   * 脚本可重复执行，也能顺带发现方向目录名大小写写错的引用。
   */
  const keyOf = (mediaRel, docVariant) => {
    const segs = mediaRel.split('/')
    const v = variants.find((x) => x.toLowerCase() === segs[0].toLowerCase())
    if (v && segs.length > 1) return `${docVariant}/${segs.slice(1).join('/')}`
    return `${docVariant}/${mediaRel}`
  }

  /** 该路径是否位于某个方向目录内（忽略大小写）。 */
  const variantDirOf = (mediaRel) => {
    const first = mediaRel.split('/')[0]
    return variants.find((v) => v.toLowerCase() === first.toLowerCase()) ?? null
  }

  // 键 -> 媒体文件。源目录里的文件不知道将来属于哪个方向，因此对每个方向各
  // 注册一次；已就位的文件只注册自己那一个，避免同名文件互相覆盖。
  const keyIndex = new Map()
  for (const asset of mediaFiles) {
    const mediaRel = relFromMedia(asset)
    const vd = variantDirOf(mediaRel)
    if (vd) keyIndex.set(keyOf(mediaRel, vd).toLowerCase(), asset)
    else for (const v of variants) keyIndex.set(keyOf(mediaRel, v).toLowerCase(), asset)
  }

  const docs = []
  for (const variant of variants) {
    const dir = path.join(root, variant)
    if (!exists(dir)) continue
    for (const f of walk(dir).files) {
      if (f.toLowerCase().endsWith('.md')) docs.push(rel(f))
    }
  }
  docs.sort()

  const columns = new Map(mediaFiles.map((p) => [p, new Set()]))
  const refs = []
  for (const doc of docs) {
    const text = fs.readFileSync(path.join(root, doc), 'utf8')
    const docVariant = doc.split('/')[0]
    let m
    REF_RE.lastIndex = 0
    while ((m = REF_RE.exec(text))) {
      const target = refTarget(m)
      if (target === undefined) continue
      const resolved = rel(path.resolve(root, path.dirname(doc), target))
      if (!isUnderMedia(resolved)) continue
      const asset = keyIndex.get(keyOf(resolved.slice(mediaPrefix.length), docVariant).toLowerCase())
      if (asset) columns.get(asset).add(docVariant)
      refs.push({ doc, target, resolved, variant: docVariant, index: m.index, match: m[0] })
    }
  }

  // --- 目标路径 -----------------------------------------------------------
  const variantFor = new Map()
  const unresolvedDirs = new Set()

  // media/ 下的顶层子目录（排除目标方向目录本身，保证脚本可重复执行）
  const subdirs = new Set(
    mediaFiles
      .map(relFromMedia)
      .filter((s) => s.includes('/'))
      .map((s) => s.split('/')[0])
      .filter((top) => !variants.includes(top)),
  )
  for (const top of subdirs) {
    const users = new Set()
    for (const [asset, cols] of columns) {
      if (!asset.startsWith(`${mediaPrefix}${top}/`)) continue
      for (const c of cols) users.add(c)
    }
    if (users.size === 1) {
      variantFor.set(top, [...users][0])
    } else if (DIR_UNLOCKED_VARIANT[top]) {
      variantFor.set(top, DIR_UNLOCKED_VARIANT[top])
    } else {
      unresolvedDirs.add(top)
    }
  }
  if (unresolvedDirs.size) {
    throw new Error(
      `以下媒体子目录无法判定归属（被 0 个或 2 个以上方向引用），请在脚本顶部 DIR_UNLOCKED_VARIANT 中登记：\n  ` +
        [...unresolvedDirs].join('\n  '),
    )
  }

  // --- 动作清单 -----------------------------------------------------------
  // 只有「被文档引用」的资源才参与移动；未被引用的文件一律走删除分支，
  // 包括子目录里的垃圾（先删后移，避免 git mv 整个目录时把它们一起搬过去）。
  // 已经在目标方向目录里的文件自然停在原地（from === to）。
  const targetFor = new Map() // oldRel -> newRel
  const moves = []
  const shared = [] // {from, to:[...]}
  const deletions = []

  for (const asset of mediaFiles) {
    const sub = relFromMedia(asset)
    const users = columns.get(asset) ?? new Set()

    if (users.size === 0) {
      // 只清理 media/ 根目录和源子目录里的孤儿文件；目标方向目录内的文件
      // 不动（那里可能放着尚未被引用的新图）。
      const top = sub.split('/')[0]
      if (!variants.includes(top)) deletions.push(asset)
      continue
    }

    if (users.size > 1) {
      shared.push({ from: asset, to: [...users].sort().map((v) => `${mediaPrefix}${v}/${sub}`) })
      continue
    }

    // 该资源只被一个方向引用
    const variant = [...users][0]
    // 已经在目标方向目录里的文件，先剥掉方向前缀，避免出现 generic/generic/
    const bare = sub.startsWith(`${variant}/`) ? sub.slice(variant.length + 1) : sub
    const to = `${mediaPrefix}${variant}/${bare}`
    targetFor.set(asset, to)
    if (asset !== to) moves.push({ from: asset, to })
  }

  // --- 引用改写 -----------------------------------------------------------
  // 每个资源最终所在位置（共享资源按文档方向各取一份）。
  const finalTargetOf = new Map()
  for (const [from, to] of targetFor) finalTargetOf.set(from, [to])
  for (const s of shared) finalTargetOf.set(s.from, s.to)

  // 键 -> 最终位置（media/ 内相对路径）。共享资源对每个方向各注册一次，
  // 于是每个方向的文档都能查到自己那一份。
  const destIndex = new Map()
  for (const asset of mediaFiles) {
    const dests = finalTargetOf.get(asset)
    if (!dests || !dests.length) continue
    const mediaRel = relFromMedia(asset)
    const vd = variantDirOf(mediaRel)
    if (vd) {
      destIndex.set(keyOf(mediaRel, vd).toLowerCase(), relFromMedia(dests[0]))
      continue
    }
    for (const dest of dests) {
      destIndex.set(keyOf(mediaRel, relFromMedia(dest).split('/')[0]).toLowerCase(), relFromMedia(dest))
    }
  }

  /** 该引用改写后应指向的 media/ 内相对路径；无法判定时返回 null。 */
  const finalMediaRelOf = (r) =>
    destIndex.get(keyOf(r.resolved.slice(mediaPrefix.length), r.variant).toLowerCase()) ?? null

  const rewrites = new Map() // doc -> [{start, end, oldText, newText}]
  const caseFixes = []
  for (const r of refs) {
    const finalMediaRel = finalMediaRelOf(r)
    if (finalMediaRel === null) continue // 坏链接或指向 media/ 之外，本次不动
    const targetOffset = r.match.indexOf(r.target)
    if (targetOffset < 0) throw new Error(`内部错误：无法在匹配串中定位目标 ${r.target}`)
    const newTarget = toPosix(
      path.relative(path.join(root, path.dirname(r.doc)), path.join(root, mediaPrefix, finalMediaRel)),
    )
    if (newTarget !== r.target) {
      if (!rewrites.has(r.doc)) rewrites.set(r.doc, [])
      rewrites.get(r.doc).push({
        start: r.index + targetOffset,
        end: r.index + targetOffset + r.target.length,
        oldText: r.target,
        newText: newTarget,
      })
    }
    // 原引用写法与磁盘真实路径不一致（大小写或写错的目录名）：Windows/macOS
    // 能打开，Linux 上会 404。本次改写顺带规范成真实路径。
    const realRel = byLower.get(r.resolved.toLowerCase())
    if (realRel && realRel !== r.resolved) {
      caseFixes.push({ doc: r.doc, oldText: r.target, newText: newTarget, realRel })
    }
  }

  return {
    root,
    mediaRoot,
    variants,
    mediaFiles,
    docs,
    columns,
    variantFor,
    moves,
    shared,
    deletions,
    rewrites,
    caseFixes,
    refCount: refs.length,
  }
}

/**
 * 改写文档中的媒体引用。
 *
 * 文档不会被移动，所以只需要按原文件读、改、写回。所有编辑都是同一批已
 * 计算好的「原始字符区间」（见 buildPlan），从后往前替换即可保证偏移有效。
 * 任一区间内容与预期不符就抛错中止，绝不做「改了一半」的写入。
 */
function rewriteDocs(plan, { apply }) {
  const results = []
  for (const doc of [...plan.rewrites.keys()].sort()) {
    const file = path.join(plan.root, doc)
    const raw = fs.readFileSync(file, 'utf8')
    const bom = raw.charCodeAt(0) === 0xfeff ? '\ufeff' : ''
    const text = bom ? raw.slice(1) : raw
    const edits = [...plan.rewrites.get(doc)].sort((a, b) => b.start - a.start)
    let out = text
    for (const e of edits) {
      const before = out.slice(e.start, e.end)
      if (before !== e.oldText) {
        throw new Error(`改写失败（偏移不一致）: ${doc} 期望 "${e.oldText}"，实际 "${before}"`)
      }
      out = out.slice(0, e.start) + e.newText + out.slice(e.end)
    }
    results.push({ doc, file, before: text, after: out, bom, edits: edits.length })
    if (apply) fs.writeFileSync(file, bom + out, 'utf8')
  }
  return results
}

// ---------------------------------------------------------------------------
// git 操作
//
// 全部包一层 try/catch：某些受限环境（例如把 stdio 走管道的沙箱）会直接
// 拒绝 spawn git（EPERM）。这种情况下自动退回纯文件系统操作，并在结尾
// 汇总提醒用户手动 git add。
// ---------------------------------------------------------------------------
function isTracked(root, repoRel) {
  try {
    execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', repoRel], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function gitMv(root, from, to) {
  execFileSync('git', ['-C', root, 'mv', '-f', '--', from, to], { stdio: 'pipe' })
}

function gitRm(root, repoRel) {
  execFileSync('git', ['-C', root, 'rm', '-f', '-q', '--', repoRel], { stdio: 'pipe' })
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------
function execute(plan, opts, log) {
  const { root } = plan
  const result = { movedFiles: 0, movedDirs: 0, removed: 0, copied: 0, docsRewritten: 0, warnings: [] }

  // git 不可用时（受限沙箱里 spawn git 会 EPERM）自动降级为纯 fs 操作，
  // 只记一次提示，避免刷屏。
  let gitBroken = false
  const noteGitBroken = () => {
    if (gitBroken) return
    gitBroken = true
    result.warnings.push(
      'git 不可用（可能是受限执行环境拒绝 spawn），已全部改用文件系统操作；' +
        '改动仍在工作区中，请稍后手动执行 git add -A 以保留历史',
    )
  }
  const tracked = (p) => {
    if (!opts.useGitMv || gitBroken) return false
    const t = isTracked(root, p)
    if (!t) {
      // isTracked 吞掉了异常，这里显式探测一次，区分「未跟踪」和「git 不可用」
      try {
        execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { stdio: 'pipe' })
      } catch {
        noteGitBroken()
      }
    }
    return t
  }
  const useGit = (fn, fallback) => {
    if (!opts.useGitMv || gitBroken) return fallback()
    try {
      return fn()
    } catch {
      noteGitBroken()
      return fallback()
    }
  }

  // 1) 删除未引用文件（先删，避免 git mv 目录时把垃圾一起搬过去）
  for (const f of plan.deletions) {
    log(`  rm   ${f}`)
    if (opts.apply) {
      if (tracked(f)) useGit(() => gitRm(root, f), () => fs.rmSync(path.join(root, f)))
      else fs.rmSync(path.join(root, f))
    }
    result.removed++
  }

  // 2) 共享资源：读一次，写到每个方向，再删除源文件
  for (const s of plan.shared) {
    log(`  copy ${s.from} -> ${s.to.map((t) => t.replace(/^media\//, '')).join(' + ')}`)
    if (opts.apply) {
      const buf = fs.readFileSync(path.join(root, s.from))
      for (const to of s.to) {
        const dest = path.join(root, to)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, buf)
        result.copied++
      }
      if (tracked(s.from)) useGit(() => gitRm(root, s.from), () => fs.rmSync(path.join(root, s.from)))
      else fs.rmSync(path.join(root, s.from))
    }
  }

  // 3) 移动：目录优先（一次 git mv 保留整个子目录历史），再逐文件
  const dirMoves = []
  const seenDirs = new Set()
  for (const m of plan.moves) {
    const parts = m.from.split('/')
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      if (seenDirs.has(d)) continue
      if (plan.mediaFiles.some((f) => f.startsWith(`${d}/`))) {
        // 只有当该目录整体归属同一目标时才做目录级移动
        const prefix = `media/${d.split('/')[1]}/`
        const dests = new Set(
          [...plan.moves]
            .filter((x) => x.from.startsWith(`${d}/`))
            .map((x) => x.to.slice(0, x.to.indexOf(x.from.slice(d.length + 1)))),
        )
        if (dests.size === 1) {
          const targetRoot = [...dests][0]
          if (targetRoot && targetRoot.startsWith(prefix)) {
            seenDirs.add(d)
            dirMoves.push({ from: d, to: targetRoot.slice(0, -1) })
          }
        }
      }
    }
  }
  const dirMoveSet = new Map(dirMoves.map((d) => [d.from, d.to]))
  const coveredByDirMove = (f) => [...dirMoveSet.keys()].some((d) => f.startsWith(`${d}/`))

  for (const d of dirMoves) {
    log(`  mvdir ${d.from} -> ${d.to.replace(/^media\//, '')}`)
    if (opts.apply) {
      const from = path.join(root, d.from)
      if (exists(from)) {
        const to = path.join(root, d.to)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        if (tracked(d.from)) useGit(() => gitMv(root, d.from, d.to), () => fs.renameSync(from, to))
        else fs.renameSync(from, to)
      }
    }
    result.movedDirs++
  }

  for (const m of plan.moves) {
    if (coveredByDirMove(m.from)) continue
    log(`  mv   ${m.from} ->  ${m.to.replace(/^media\//, '')}`)
    if (opts.apply) {
      const from = path.join(root, m.from)
      if (!exists(from)) {
        result.warnings.push(`源文件不存在，已跳过: ${m.from}`)
        continue
      }
      const to = path.join(root, m.to)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      if (samePathCI(m.from, m.to)) {
        // 仅大小写差异：文件系统大小写不敏感时无法直接改名，走中间名
        const tmp = `${to}.__tmp_casefix__`
        fs.renameSync(from, tmp)
        fs.renameSync(tmp, to)
      } else if (tracked(m.from)) {
        useGit(() => gitMv(root, m.from, m.to), () => fs.renameSync(from, to))
      } else {
        fs.renameSync(from, to)
      }
    }
    result.movedFiles++
  }

  // 4) 改写文档中的引用
  for (const [doc, edits] of [...plan.rewrites].sort()) {
    log(`  edit ${doc}  (${edits.length} 处)`)
  }
  if (opts.apply) result.docsRewritten = rewriteDocs(plan, { apply: true }).length

  // 5) 清理空目录
  if (opts.apply) {
    const { dirs } = walk(plan.mediaRoot)
    for (const d of dirs.sort((a, b) => b.length - a.length)) {
      if (fs.readdirSync(d).length === 0) fs.rmdirSync(d)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------
function verify(root, variants) {
  root = path.resolve(root)
  const rel = createRel(root)
  const mediaRoot = path.join(root, 'media')
  const { files } = walk(mediaRoot)
  const byLower = new Map(files.map((p) => [rel(p).toLowerCase(), rel(p)]))

  let checked = 0
  const missing = []
  const caseOnly = []
  for (const variant of variants) {
    const dir = path.join(root, variant)
    if (!exists(dir)) continue
    for (const f of walk(dir).files) {
      if (!f.toLowerCase().endsWith('.md')) continue
      const doc = rel(f)
      const text = fs.readFileSync(f, 'utf8')
      let m
      REF_RE.lastIndex = 0
      while ((m = REF_RE.exec(text))) {
        const target = refTarget(m)
        if (target === undefined) continue
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue
        const resolved = rel(path.resolve(root, path.dirname(doc), target))
        if (!resolved.startsWith('media/')) continue
        checked++
        const real = byLower.get(resolved.toLowerCase())
        if (!real) missing.push(`${doc} -> ${target}`)
        else if (real !== resolved) caseOnly.push(`${doc} -> ${target}  (实际: ${real})`)
      }
    }
  }
  return { checked, missing, caseOnly }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
function printPlan(plan, opts) {
  const { moves, shared, deletions, rewrites, caseFixes, variantFor } = plan
  console.log(`\n子模块根目录: ${path.relative(process.cwd(), plan.root) || '.'}`)
  console.log(`媒体文件: ${plan.mediaFiles.length}  文档: ${plan.docs.length}  引用: ${plan.refCount}\n`)

  console.log('子目录归属:')
  for (const [d, v] of [...variantFor].sort()) console.log(`  media/${d}/  ->  media/${v}/${d}/`)

  const byVariant = new Map()
  for (const m of moves) {
    const v = m.to.split('/')[1]
    byVariant.set(v, (byVariant.get(v) ?? 0) + 1)
  }
  console.log('\n计划汇总:')
  for (const [v, n] of [...byVariant].sort()) console.log(`  移动到 media/${v}/: ${n} 个文件`)
  console.log(`  共享资源复制: ${shared.length} 个（每个方向各一份）`)
  console.log(`  删除未引用文件: ${deletions.length} 个`)
  console.log(`  改写文档: ${rewrites.size} 个（共 ${[...rewrites.values()].reduce((a, b) => a + b.length, 0)} 处引用）`)
  console.log(`  顺带修正大小写错误: ${caseFixes.length} 处`)

  if (!opts.quiet) {
    if (shared.length) {
      console.log('\n共享资源（复制两份）:')
      for (const s of shared) console.log(`  ${s.from}  ->  ${s.to.join('  +  ')}`)
    }
    if (deletions.length) {
      console.log('\n待删除（未被任何文档引用）:')
      for (const d of deletions) console.log(`  ${d}`)
    }
    if (caseFixes.length) {
      console.log('\n引用大小写/目录名不一致（Linux 上会 404，本次已规范）:')
      for (const c of unique(caseFixes.map((c) => `${c.doc}\n      ${c.oldText}  ->  ${c.newText}\n      磁盘真实路径: ${c.realRel}`)))
        console.log(`  ${c}`)
    }
    console.log('\n引用改写明细:')
    for (const [doc, edits] of [...rewrites].sort()) {
      console.log(`  ${doc}`)
      for (const e of [...edits].sort((a, b) => a.start - b.start)) console.log(`      ${e.oldText}  ->  ${e.newText}`)
    }
  }
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(String(e.message ?? e))
    process.exit(2)
  }
  if (opts.help) {
    console.log(USAGE)
    return
  }

  const root = detectRoot(opts.root)

  if (opts.verify) {
    const r = verify(root, opts.variants)
    console.log(`检查引用: ${r.checked} 处`)
    console.log(`无法解析: ${r.missing.length} 处`)
    for (const m of r.missing) console.log(`  ✗ ${m}`)
    console.log(`大小写不一致: ${r.caseOnly.length} 处`)
    for (const c of r.caseOnly) console.log(`  ! ${c}`)
    process.exit(r.missing.length || r.caseOnly.length ? 1 : 0)
  }

  const plan = buildPlan(root, opts.variants)
  printPlan(plan, opts)

  const noop =
    plan.moves.length === 0 && plan.shared.length === 0 && plan.deletions.length === 0 && plan.rewrites.size === 0
  if (noop) {
    console.log('\n无需迁移，目录结构已是目标形态。')
    const r = verify(root, opts.variants)
    console.log(`引用自检: ${r.checked} 处，无法解析 ${r.missing.length} 处，大小写不一致 ${r.caseOnly.length} 处`)
    return
  }

  if (!opts.apply) {
    console.log('\n[试运行] 未修改任何文件。确认无误后加 --apply 执行。')
    return
  }

  console.log('\n执行中...')
  const result = execute(plan, opts, (s) => {
    if (!opts.quiet) console.log(s)
  })

  console.log('\n执行完毕:')
  console.log(
    `  移动目录: ${result.movedDirs}  移动文件: ${result.movedFiles}  复制: ${result.copied}  删除: ${result.removed}  改写文档: ${result.docsRewritten ?? 0}`,
  )
  for (const w of result.warnings) console.log(`  ! ${w}`)

  const after = buildPlan(root, opts.variants)
  const stillToMove = after.moves.length + after.shared.length
  console.log(`\n复核: 仍需迁移 ${stillToMove} 项，剩余未引用文件 ${after.deletions.length} 项`)

  const r = verify(root, opts.variants)
  console.log(`引用自检: ${r.checked} 处，无法解析 ${r.missing.length} 处，大小写不一致 ${r.caseOnly.length} 处`)
  for (const m of r.missing) console.log(`  ✗ ${m}`)
  for (const c of r.caseOnly) console.log(`  ! ${c}`)
  if (r.missing.length || r.caseOnly.length) process.exitCode = 1

  // 提示 media/ 根目录是否已清空
  const leftovers = fs.readdirSync(path.join(root, 'media')).filter((n) => !opts.variants.includes(n))
  if (leftovers.length) {
    console.log(`\n注意: media/ 根目录仍有 ${leftovers.length} 项: ${leftovers.join(', ')}`)
  } else {
    console.log('\nmedia/ 根目录已清空，只剩方向子目录。')
  }
}

main()
