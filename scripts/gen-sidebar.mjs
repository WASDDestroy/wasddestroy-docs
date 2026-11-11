#!/usr/bin/env node
/**
 * 从「各子目录的文件层级」和 `.vitepress/sidebar.map.mjs` 中的映射生成根站点 sidebar。
 *
 *   node scripts/gen-sidebar.mjs            生成并写入 .vitepress/sidebar.generated.mjs
 *   node scripts/gen-sidebar.mjs --check    只校验：生成结果与磁盘上的文件不一致时退出 1
 *   node scripts/gen-sidebar.mjs --strict   把 warning 也当成错误（CI 用）
 *
 * 标题来源优先级：titles 映射 > 文件 H1 > 文件名。
 * 目录的层级、顺序、折叠状态无法从文件系统推断的部分由映射补齐。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const MAP_FILE = path.join(ROOT, '.vitepress', 'sidebar.map.mjs')
const OUT_FILE = path.join(ROOT, '.vitepress', 'sidebar.generated.mjs')

const argv = new Set(process.argv.slice(2))
const CHECK = argv.has('--check')
const STRICT = argv.has('--strict')

// 不参与扫描的目录：依赖、VitePress 自身、纯资源目录
const SKIP_DIRS = new Set(['node_modules', '.vitepress', '.git', 'media', 'public'])
// 不作为侧栏条目的文件：分区首页由 home/nav 进入，README 不是文档
const SKIP_FILES = new Set(['README.md', 'index.md'])

const errors = []
const warnings = []
const fail = (msg) => errors.push(msg)
const warn = (msg) => warnings.push(msg)

const toPosix = (p) => p.split(path.sep).join('/')
const posixJoin = (...parts) => toPosix(path.posix.join(...parts))
const stripMd = (p) => p.replace(/\.md$/i, '')

if (!fs.existsSync(MAP_FILE)) {
  console.error(`找不到映射文件: ${MAP_FILE}`)
  process.exit(2)
}

/* ---------- 文件系统扫描 ---------- */

function listDir(absDir) {
  const files = []
  const dirs = []
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) dirs.push(entry.name)
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      if (!SKIP_FILES.has(entry.name)) files.push(entry.name)
    }
  }
  // 文件名固定用码位序，保证跨平台结果一致
  files.sort()
  dirs.sort()
  return { files, dirs }
}

/** 目录（含任意深度子目录）里是否存在可收录的 .md */
function hasDocs(absDir) {
  const { files, dirs } = listDir(absDir)
  if (files.length) return true
  return dirs.some((d) => hasDocs(path.join(absDir, d)))
}

const h1Cache = new Map()

/** 取第一个围栏外的 H1；跳过 YAML frontmatter。找不到返回 null */
function readH1(absFile) {
  if (h1Cache.has(absFile)) return h1Cache.get(absFile)
  let text = fs.readFileSync(absFile, 'utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const lines = text.split(/\r?\n/)
  let i = 0
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
      /* 跳过 frontmatter */
    }
    i++
  }
  let inFence = false
  let title = null
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```+|~~~+)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^#\s+(.+?)\s*$/.exec(line)
    if (m) {
      title = m[1].trim()
      break
    }
  }
  h1Cache.set(absFile, title)
  return title
}

/* ---------- 生成 ---------- */

const map = (await import(pathToFileURL(MAP_FILE).href)).default
const { sections = {}, dirs: dirConfig = {}, titles = {} } = map

// 映射自身的过期项检查：目录改名/文件删除后不该静默失效
for (const key of Object.keys(dirConfig)) {
  const abs = path.join(ROOT, key)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    fail(`dirs 里的目录不存在（目录已改名或删除）: ${key}`)
  }
}
for (const key of Object.keys(titles)) {
  const repoRelNoExt = stripMd(toPosix(key))
  if (!fs.existsSync(path.join(ROOT, repoRelNoExt + '.md'))) {
    fail(`titles 指向不存在的文件（文件已改名或删除）: ${key}`)
  }
}

/** 目录配置可以是字符串（仅中文名）或对象 */
function normalizeDirCfg(raw) {
  if (typeof raw === 'string') return { label: raw }
  if (raw && typeof raw === 'object') return raw
  return {}
}

function fileLink(repoRelNoExt) {
  return '/' + toPosix(repoRelNoExt)
}

function indexLink(repoRelDir) {
  const p = toPosix(repoRelDir)
  return '/' + (p === '' ? '' : p + '/')
}

/**
 * 生成一个叶子条目。repoRelNoExt 相对仓库根，不带 .md。
 * 标题优先级：titles[仓库相对路径] > H1 > 文件名
 */
function makeLeaf(repoRelNoExt, ctx) {
  repoRelNoExt = stripMd(toPosix(repoRelNoExt))
  const absFile = path.join(ROOT, repoRelNoExt + '.md')
  if (!fs.existsSync(absFile)) {
    fail(`[${ctx.section}] 引用了不存在的文件: ${repoRelNoExt}.md`)
    return null
  }
  const text = titles[repoRelNoExt] ?? readH1(absFile) ?? path.posix.basename(repoRelNoExt)
  if (!titles[repoRelNoExt] && !readH1(absFile)) {
    warn(`[${repoRelNoExt}] 没有 H1，侧栏回退为文件名`)
  }
  ctx.used.add(repoRelNoExt)
  return { text, link: fileLink(repoRelNoExt) }
}

/**
 * 自动展开一个目录：文件按文件名、子目录按目录名排在最前，
 * 若映射给了 order 则按 order 重排，未列出的条目追加到末尾并告警。
 */
function expandDir(relDir, cfg, ctx) {
  const absDir = path.join(ROOT, relDir)
  const { files, dirs } = listDir(absDir)

  let entries = []
  for (const name of files) {
    const repoRelNoExt = stripMd(posixJoin(relDir, name))
    if (ctx.exclude.has(repoRelNoExt)) continue
    entries.push({ kind: 'file', name, key: stripMd(name) })
  }
  for (const name of dirs) {
    const childAbs = path.join(absDir, name)
    if (!hasDocs(childAbs)) continue
    entries.push({ kind: 'dir', name, key: name })
  }

  if (Array.isArray(cfg.order)) {
    const ordered = []
    for (const raw of cfg.order) {
      const key = String(raw).replace(/\/$/, '')
      const idx = entries.findIndex((e) => e.key === key)
      if (idx < 0) {
        fail(`[${relDir}] order 里的条目不存在或已被排除: ${raw}`)
        continue
      }
      ordered.push(entries[idx])
      entries.splice(idx, 1)
    }
    if (entries.length) {
      warn(
        `[${relDir}] 以下条目未出现在 order 中，已按文件名追加到末尾: ` +
          entries.map((e) => e.key).join(', ')
      )
    }
    entries = [...ordered, ...entries]
  }

  const items = []
  for (const entry of entries) {
    if (entry.kind === 'file') {
      const leaf = makeLeaf(posixJoin(relDir, entry.name), ctx)
      if (leaf) items.push(leaf)
      continue
    }
    const childRel = posixJoin(relDir, entry.name)
    const dCfg = normalizeDirCfg(dirConfig[childRel])
    if (!dCfg.label) {
      fail(`目录缺少中文名，请在 dirs 里补充: '${childRel}'`)
    }
    const group = {
      text: dCfg.label ?? entry.name,
      collapsed: dCfg.collapsed ?? false,
      items: expandDir(childRel, dCfg, ctx),
    }
    const childAbs = path.join(ROOT, childRel)
    if (fs.existsSync(path.join(childAbs, 'index.md'))) {
      group.link = indexLink(childRel)
    }
    items.push(group)
  }
  return items
}

/** tree 覆盖：显式给出分组/顺序，节点为文件 key 或分组对象 */
function resolveTree(nodes, section, ctx) {
  const items = []
  for (const node of nodes) {
    if (typeof node === 'string') {
      const leaf = makeLeaf(posixJoin(section, node), ctx)
      if (leaf) items.push(leaf)
      continue
    }
    if (!node || typeof node !== 'object' || !Array.isArray(node.items)) {
      fail(`[${section}] tree 里的节点既不是文件 key 也不是带 items 的分组: ${JSON.stringify(node)}`)
      continue
    }
    const group = {
      text: node.text,
      collapsed: node.collapsed ?? false,
      items: resolveTree(node.items, section, ctx),
    }
    if (node.link) group.link = node.link
    items.push(group)
  }
  return items
}

/** 收集分区内所有可收录的 md，用于「未被任何条目引用」的告警 */
function collectDocs(relDir, ctx, out = []) {
  const absDir = path.join(ROOT, relDir)
  const { files, dirs } = listDir(absDir)
  for (const name of files) {
    const repoRelNoExt = stripMd(posixJoin(relDir, name))
    if (ctx.exclude.has(repoRelNoExt)) continue
    out.push(repoRelNoExt)
  }
  for (const name of dirs) {
    const childAbs = path.join(absDir, name)
    if (hasDocs(childAbs)) collectDocs(toPosix(path.posix.join(relDir, name)), ctx, out)
  }
  return out
}

const sidebar = {}
const seenLinks = new Map()

for (const [section, rawCfg] of Object.entries(sections)) {
  const cfg = typeof rawCfg === 'string' ? { label: rawCfg } : rawCfg
  const absSection = path.join(ROOT, section)
  if (!fs.existsSync(absSection) || !fs.statSync(absSection).isDirectory()) {
    fail(`sections 里的分区目录不存在: ${section}`)
    continue
  }

  const exclude = new Set(
    (cfg.exclude ?? []).map((p) => stripMd(toPosix(path.posix.join(section, p))))
  )
  const ctx = { section, used: new Set(), exclude }

  let items
  if (Array.isArray(cfg.tree)) {
    items = resolveTree(cfg.tree, section, ctx)
  } else {
    if (!cfg.label) fail(`分区缺少中文名: ${section}`)
    items = [
      {
        text: cfg.label ?? section,
        collapsed: cfg.collapsed ?? false,
        items: expandDir(section, { order: cfg.order }, ctx),
      },
    ]
  }

  // 未被目录收录的文档（只对 tree 分区有意义，其余会自动收录）
  for (const doc of collectDocs(section, ctx)) {
    if (!ctx.used.has(doc)) warn(`[${doc}] 文档没有被侧栏收录`)
  }

  // 同一分区内链接不得重复
  const walkLinks = (list) => {
    for (const item of list) {
      if (item.link) {
        if (seenLinks.has(item.link)) {
          fail(`链接重复: ${item.link}（同时出现在 ${seenLinks.get(item.link)} 和 /${section}/）`)
        } else {
          seenLinks.set(item.link, '/' + section + '/')
        }
        const abs = path.join(ROOT, item.link)
        const ok =
          fs.existsSync(abs + '.md') ||
          fs.existsSync(path.join(abs, 'index.md')) ||
          (item.link.endsWith('/') && fs.existsSync(path.join(abs, 'index.md')))
        if (!ok) fail(`生成的链接没有对应文档: ${item.link}`)
      }
      if (item.items) walkLinks(item.items)
    }
  }
  walkLinks(items)

  sidebar[`/${toPosix(section)}/`] = items
}

/* ---------- 输出 ---------- */

const content = '// 由 scripts/gen-sidebar.mjs 生成，请勿手工编辑。\nexport default ' + JSON.stringify(sidebar, null, 2) + '\n'

if (warnings.length) {
  console.warn(`提示 ${warnings.length} 条：`)
  for (const w of warnings) console.warn('  ! ' + w)
}
if (errors.length) {
  console.error(`错误 ${errors.length} 条：`)
  for (const e of errors) console.error('  ✗ ' + e)
  process.exit(1)
}

if (CHECK) {
  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : ''
  if (current !== content) {
    console.error(`${path.relative(ROOT, OUT_FILE)} 与生成结果不一致，请运行 pnpm gen:sidebar`)
    process.exit(1)
  }
  console.log('sidebar 生成结果与磁盘一致')
} else {
  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : ''
  if (current === content) {
    console.log(`sidebar 无变化（${Object.keys(sidebar).length} 个分区）`)
  } else {
    fs.writeFileSync(OUT_FILE, content, 'utf8')
    console.log(`已写入 ${path.relative(ROOT, OUT_FILE)}（${Object.keys(sidebar).length} 个分区）`)
  }
}

if (STRICT && warnings.length) {
  console.error('--strict：存在 warning，按失败处理')
  process.exit(1)
}
