# WASDDestroy.site

仓库的 vitepress 分发被部署在 https://wasddestroy.site, 作为我的非交互式站点提供文档服务。

## 站点特性

- 基于 VitePress 默认主题，并集成了 [Nolebase](https://nolebase-integrations.ayaka.io/) 的阅读增强插件：
  - **阅读增强菜单**（导航栏右侧）：支持在"全宽 / 适中"两种布局间切换、调节页面宽度、行高、字间距，以及页面排版（是否从右到左）等，设置会保存在浏览器本地。
  - **聚焦标记**：通过目录或锚点链接跳转时，目标标题会被短暂高亮，方便定位。
- 相关代码位于 `.vitepress/theme/index.ts`（挂载插件组件）与 `.vitepress/config.mts` 中的 `vite.ssr.noExternal` 配置（SSR 构建需要）。

## 预览、编辑和部署
要使用 vitepress 预览网页，遵循下面的步骤：

1. 安装 node.js

2. 安装 pnpm：
```shell
npm install -g pnpm
```

1. 克隆仓库并切换到它：
```shell
git clone https://gitee.com/WASDDestroy/tb710fu-doc.git
cd tb710fu-doc
```

1. 安装 vitepress：
```shell
pnpm install -D vitepress
```

1. 将仓库中的文件复制到 vitepress 所在目录，如有冲突，选择覆盖。

2. 在终端启动 vitepress 开发服务器：
```shell
pnpm docs:dev
```

1. 访问终端中给出的地址即可预览页面。直接打开目录下的 Markdown 文件就可以编辑。所有对文件的更改在保存后即刻生效，不需要重启服务器。

> [!note]
> 话虽如此，更改资源时还是有可能导致网页*暂时*出错的。不过解决也简单，*刷新*就好。

10. 构建最终上传到服务器的产物：
```shell
pnpm docs:build
```

几秒钟后程序就能运行完成，在 `.vitepress` 目录下会多出一个 `dist` 文件夹，里面存放的内容就是可以直接上传到服务器的内容了。

> [!warning]
> 每次输出构建内容时记得提前清空或者删除 `dist` 文件夹！