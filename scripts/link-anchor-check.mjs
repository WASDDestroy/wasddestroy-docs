import fs from 'node:fs'
import path from 'node:path'

// 以 VitePress 构建产物为准，校验 tb710fu-doc 内所有相对链接（文件 + 锚点）与图片引用
const distDefault = '.vitepress/dist/tb710fu-doc'
const dist = path.resolve(process.argv[2] ?? distDefault)
const docRoot = path.resolve('tb710fu-doc')
const variants = ['generic', 'without_unlock']
const toPosix = (p) => p.split(path.sep).join('/')

function walk(dir, pred) {
  const out = []
  const st = [dir]
  while (st.length) {
    const c = st.pop()
    for (const e of fs.readdirSync(c, { withFileTypes: true })) {
      const p = path.join(c, e.name)
      if (e.isDirectory()) st.push(p)
      else if (pred(p)) out.push(p)
    }
  }
  return out
}

// VitePress 布局自带的 id，不属于文档锚点
const LAYOUT_IDS = new Set([
  'check-dark-mode', 'check-mac-os', 'app', 'local-search', 'main-nav-aria-label',
  'VPSidebarNav', 'sidebar-aria-label', 'VPContent', 'doc-outline-aria-label', 'doc-footer-aria-label',
])

if (!fs.existsSync(dist)) {
  console.error(`找不到构建产物: ${dist}\n请先运行 npx vitepress build`)
  process.exit(2)
}

const anchorsByPage = new Map()
const docRootName = path.basename(docRoot)
for (const html of walk(dist, (p) => p.endsWith('.html'))) {
  const distRel = toPosix(path.relative(dist, html)).replace(/\.html$/, '.md')
  const pageKey = distRel.startsWith(`${docRootName}/`) ? distRel.slice(docRootName.length + 1) : distRel
  const text = fs.readFileSync(html, 'utf8')
  const ids = new Set()
  // heading 自动 slug 与作者手写的 <a id="X"> 都会被这里捕获
  for (const m of text.matchAll(/\sid="([^"]+)"/g)) if (!LAYOUT_IDS.has(m[1])) ids.add(m[1])
  anchorsByPage.set(pageKey, ids)
}

const docs = []
for (const v of variants) for (const f of walk(path.join(docRoot, v), (p) => p.endsWith('.md'))) docs.push(f)

const linkRe = /(!?)\[([^\]]*)\]\(\s*([^()\s]+?)(?:\s+["'][^"']*["'])?\s*\)/g
let refTotal = 0
let imgTotal = 0
const problems = []

for (const f of docs) {
  const rel = toPosix(path.relative(docRoot, f))
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const m of line.matchAll(linkRe)) {
      const target = m[3]
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue // 外链
      const abs0 = path.resolve(path.dirname(f), target.split('#')[0] || '.')
      if (m[1] === '!') {
        imgTotal++
        if (!fs.existsSync(abs0)) problems.push(`${rel}:${i + 1}  图片缺失  ${target}`)
        continue
      }
      refTotal++
      const hashIdx = target.indexOf('#')
      const filePart = hashIdx < 0 ? target : target.slice(0, hashIdx)
      const anchor = hashIdx < 0 ? '' : target.slice(hashIdx + 1)
      if (!filePart) {
        if (anchor && !(anchorsByPage.get(rel) ?? new Set()).has(anchor)) {
          problems.push(`${rel}:${i + 1}  页内锚点不存在  ${target}`)
        }
        continue
      }
      let abs = abs0
      if (!fs.existsSync(abs) && fs.existsSync(abs + '.md')) abs += '.md'
      if (!fs.existsSync(abs)) {
        problems.push(`${rel}:${i + 1}  目标文件不存在  ${target}`)
        continue
      }
      const pageKey = toPosix(path.relative(docRoot, abs))
      if (pageKey.startsWith('..')) continue // 跨到 generic_knowledge/ 等，属于根站范围
      const ids = anchorsByPage.get(pageKey)
      if (!ids) {
        problems.push(`${rel}:${i + 1}  构建产物无此页  ${target}`)
        continue
      }
      if (anchor && !ids.has(anchor)) problems.push(`${rel}:${i + 1}  跨页锚点不存在  ${target}`)
    }
  })
}

console.log(`文档 ${docs.length} 篇 | 相对链接 ${refTotal} 条 | 图片引用 ${imgTotal} 条`)
console.log(`问题 ${problems.length} 条`)
for (const p of problems) console.log('  ✗ ' + p)
process.exitCode = problems.length ? 1 : 0
