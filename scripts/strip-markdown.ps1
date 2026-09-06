# strip-markdown.ps1
# 用法: .\strip-markdown.ps1 <目标文档.md>
# 作用: 洗掉文档中除粗体之外的 Markdown 格式标记，
#       并将 GFM 引用块抬头 ([!note] 等) 映射为中文标题。

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,

    # 指定输出文件；不指定则输出到控制台
    [Parameter(Position = 1)]
    [Alias("o")]
    [string]$Output,

    # 直接覆盖原文件（忽略 -Output）
    [Alias("r")]
    [switch]$Override
)

if (-not (Test-Path $Path -PathType Leaf)) {
    Write-Error "找不到文件: $Path"
    exit 1
}

# 统一按 UTF-8 读写，保留原换行风格
$raw = [System.IO.File]::ReadAllText((Resolve-Path $Path))
$crlf = $raw -match "`r`n"
$nl = if ($crlf) { "`r`n" } else { "`n" }
$lines = $raw -replace "`r`n", "`n" -split "`n"

# GFM 提示块抬头映射表
$calloutMap = @{
    'note'     = '注意'
    'important'= '重要'
    'warning'  = '警告'
    'danger'   = '危险'
    'tip'      = '提示'
}

$inCodeFence = $false
$out = New-Object System.Collections.Generic.List[string]

foreach ($line in $lines) {

    # --- 代码围栏: 整块原样保留或删除？这里删除围栏标记本身，内容保留为普通文本 ---
    if ($line -match '^\s*(```+|~~~+)') {
        $inCodeFence = -not $inCodeFence
        continue   # 去掉 ``` / ~~~ 围栏行
    }
    if ($inCodeFence) {
        $out.Add($line)   # 代码内容不动（里面的标记不是 Markdown 语义）
        continue
    }

    # --- 水平分割线: 删除 ---
    if ($line -match '^\s{0,3}([-*_])(\s*\1){2,}\s*$') {
        continue
    }

    # --- GFM 提示块 (> [!note] ...) ---
    if ($line -match '^\s*>\s*\[!(\w+)\]\s*(.*)$') {
        $type = $Matches[1].ToLower()
        $title = $Matches[2]
        $head = if ($calloutMap.ContainsKey($type)) { $calloutMap[$type] } else { $type }
        # 抬头加粗；若用户写了自定义标题则附在后面
        if ($title) { $out.Add("**$head**：$title") } else { $out.Add("**$head**") }
        continue
    }

    # --- 标题: 去掉前导 # ---
    $line = $line -replace '^\s{0,3}#{1,6}\s+', ''
    # --- 引用标记: 去掉 "> ---
    $line = $line -replace '^\s*>\s?', ''

    # --- 图片: ![alt](url) -> alt ---
    $line = $line -replace '!\[([^\]]*)\]\([^)]*\)', '$1'
    # --- 链接: [text](url) -> text ---
    $line = $line -replace '\[([^\]]*)\]\([^)]*\)', '$1'
    # --- 引用式链接/脚本引用 [text][ref] -> text ---
    $line = $line -replace '\[([^\]]+)\]\[[^\]]*\]', '$1'

    # --- 行内代码 `code` -> code (先处理，避免其中的 * _ 等被误删) ---
    $line = $line -replace '`([^`]*)`', '$1'
    # --- 删除/高亮 ~~text~~ 和 ==text== ---
    $line = $line -replace '~~([^~]*)~~', '$1'
    $line = $line -replace '==([^=]*)==', '$1'
    # --- 斜体/斜体粗体: *text* / _text_ -> text (保留 ** 和 __) ---
    $line = $line -replace '(?<!\*)\*(?!\*)([^*]+)\*(?!\*)', '$1'
    $line = $line -replace '(?<!_)_(?!_)([^_]+)_(?!_)', '$1'
    # --- 行内 HTML 标签: 去掉标签本身 ---
    $line = $line -replace '<[^>]+>', ''

    $out.Add($line)
}

# --- 表格处理: 去掉分隔行 (|---|---|) 及单元格分隔符 ---
$result = for ($i = 0; $i -lt $out.Count; $i++) {
    $l = $out[$i]
    if ($l -match '^\s*\|?\s*:?-{2,}.*\|') {
        continue   # 表头分隔行直接删除
    }
    if ($l -match '\|') {
        # 将 "|a|b|c|" 变为 "a b c"
        $cells = $l.Trim() -replace '^\|', '' -replace '\|$', ''
        $l = ($cells -split '\|' | ForEach-Object { $_.Trim() }) -join ' '
    }
    $l
}

$text = ($result -join $nl)
if ($Override) {
    [System.IO.File]::WriteAllText((Resolve-Path $Path), $text, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "完成: 已覆盖原文件 $Path。"
} elseif ($Output) {
    $outPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
    $outDir = Split-Path -Parent $outPath
    if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    [System.IO.File]::WriteAllText($outPath, $text, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "完成: 已写入 $outPath。"
} else {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $text
}
