#!/usr/bin/env node
/**
 * install-git-hooks.mjs — 启用仓库自带的 pre-commit（图片转 WebP）。
 *
 * - 父仓库：把 core.hooksPath 指到版本化的 .githooks/。
 * - 子模块：图片主要放在 tb710fu-doc / data-structure 里，而父仓库的 hook
 *   提交不了子模块内容，所以给每个已初始化的子模块写入一份本地 hook
 *   （.git/modules/<name>/hooks/pre-commit），提交子模块时同样会转码。
 *
 * 由 package.json 的 prepare 自动执行，也可以手动 `pnpm hooks:install`。
 * 子模块里的 hook 是本机配置，不会提交；换机器后重新跑一次即可。
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const MARKER = '# managed-by: convert_images_to_webp'

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts }).trim()
}

function hookScript(scriptPath) {
  return `#!/bin/sh
${MARKER}
# 提交前把暂存的 PNG/JPEG 图片转成 WebP。临时跳过：SKIP_WEBP_HOOK=1 git commit ...
[ "\${SKIP_WEBP_HOOK:-0}" = "1" ] && exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
script="$root/${scriptPath}"
[ -f "$script" ] || exit 0

if command -v python >/dev/null 2>&1; then
  py=python
elif command -v python3 >/dev/null 2>&1; then
  py=python3
else
  echo "[webp] 未找到 Python，跳过图片转码（安装 Python + Pillow 后重试）" >&2
  exit 0
fi

export PYTHONIOENCODING=utf-8
exec "$py" "$script" --staged
`
}

function writeHook(file, content, label) {
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8')
    if (!existing.includes(MARKER)) {
      console.warn(`[hooks] ${label} 已有其他 pre-commit，跳过（未覆盖）：${file}`)
      return false
    }
  }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content.replace(/\r\n/g, '\n'), 'utf8')
  try {
    chmodSync(file, 0o755)
  } catch {
    /* Windows 上无意义 */
  }
  console.log(`[hooks] 已写入 ${label}：${file}`)
  return true
}

function main() {
  if (process.env.CI) {
    console.log('[hooks] CI 环境，跳过 Git hook 安装')
    return
  }

  let root
  try {
    root = git(['rev-parse', '--show-toplevel'])
  } catch {
    console.log('[hooks] 不在 Git 仓库中，跳过')
    return
  }
  process.chdir(root)

  const parentHook = path.join(root, '.githooks', 'pre-commit')
  if (!existsSync(parentHook)) {
    console.warn('[hooks] 找不到 .githooks/pre-commit，跳过')
    return
  }
  try {
    git(['config', 'core.hooksPath', '.githooks'])
    chmodSync(parentHook, 0o755)
    console.log('[hooks] 父仓库：core.hooksPath = .githooks')
  } catch (error) {
    console.warn(`[hooks] 设置 core.hooksPath 失败：${error.message}`)
  }

  let modules = []
  try {
    const raw = git(['config', '-f', '.gitmodules', '--get-regexp', 'path'])
    modules = raw
      .split('\n')
      .map(line => line.trim().split(/\s+/).slice(1).join(' '))
      .filter(Boolean)
  } catch {
    return
  }

  for (const sub of modules) {
    const subRoot = path.join(root, sub)
    if (!existsSync(path.join(subRoot, '.git'))) {
      console.log(`[hooks] 子模块 ${sub} 未初始化，跳过`)
      continue
    }
    let gitPath
    try {
      gitPath = git(['-C', subRoot, 'rev-parse', '--git-path', 'hooks/pre-commit'])
    } catch {
      console.warn(`[hooks] 无法定位 ${sub} 的 hooks 目录，跳过`)
      continue
    }
    const hookFile = path.resolve(subRoot, gitPath)
    const relScript = path
      .relative(subRoot, path.join(root, 'scripts', 'convert_images_to_webp.py'))
      .split(path.sep)
      .join('/')
    writeHook(hookFile, hookScript(relScript), `子模块 ${sub}`)
  }
}

main()
