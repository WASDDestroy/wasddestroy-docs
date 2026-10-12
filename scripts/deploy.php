<?php
/**
 * 服务器端部署脚本（常驻 wwwroot，配合 GitHub Actions 使用）
 *
 * 用法（GitHub Actions 中触发）：
 *   curl -fsS -X POST -d "token=<DEPLOY_TOKEN>" https://<域名>/deploy.php
 *
 * 安全设计：
 *   - token 不写在脚本里，读取 wwwroot 上一级的 deploy_token.txt，
 *     即使本文件源码泄露也不泄露 token
 *   - 只接受 POST，token 不进 URL，避开访问日志与 Referer
 *   - 无任何参数化路径/上传功能，最坏后果仅为解压服务器上已有的 dist.zip
 *
 * 运行环境：主机 PHP 已固定为 8.2，可使用现代语法
 */

// 拒绝 GET 等其它方法，减小被扫描器探测的面
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit('method not allowed');
}

// token 文件放在 web 目录之外（wwwroot 的上一级）
// trim 同时处理 LF / CRLF / 尾部空格，Windows 记事本保存的 token 文件也能用
$tokenFile = dirname(__DIR__) . '/deploy_token.txt';
$expected = @file_get_contents($tokenFile);
if ($expected === false) {
    http_response_code(500);
    exit('token file missing');
}
$expected = trim($expected);

$posted = $_POST['token'] ?? '';
if ($posted === '' || !hash_equals($expected, $posted)) {
    http_response_code(403);
    exit('forbidden');
}

set_time_limit(300);
$zipPath = __DIR__ . '/dist.zip';
$zip = new ZipArchive;
if ($zip->open($zipPath) !== TRUE) {
    http_response_code(500);
    exit('zip open failed');
}

// 清空 wwwroot 旧内容，保留本脚本与 zip 自身。
// 若以后在 wwwroot 手动放置常驻文件，需加入此列表（更推荐放进 VitePress 的 public/）
$keep = ['dist.zip', basename(__FILE__)];
foreach (new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator(__DIR__, FilesystemIterator::SKIP_DOTS),
    RecursiveIteratorIterator::CHILD_FIRST) as $item) {
    if (!in_array($item->getFilename(), $keep, true)) {
        $item->isDir() ? @rmdir($item->getPathname()) : @unlink($item->getPathname());
    }
}

$zip->extractTo(__DIR__);
$zip->close();
unlink($zipPath);
echo 'deployed';
