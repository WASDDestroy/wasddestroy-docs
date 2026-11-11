import { defineConfig } from 'vitepress'
import type { DefaultTheme } from 'vitepress'
import generatedSidebar from './sidebar.generated.mjs'

// 侧栏由 scripts/gen-sidebar.mjs 扫描各子目录的层级生成，
// 英文目录名与长标题的映射维护在 .vitepress/sidebar.map.mjs。
// 修改映射或新增文档后运行 `pnpm gen:sidebar`（docs:dev / docs:build 会自动执行）。
const rootSidebar = generatedSidebar as DefaultTheme.Sidebar

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lastUpdated: true,
  // Nolebase 插件的客户端产物含 .vue 文件，SSR 构建时需要打包进来而不是 external
  vite: {
    ssr: {
      noExternal: [
        '@nolebase/ui',
        '@nolebase/vitepress-plugin-enhanced-readabilities',
        '@nolebase/vitepress-plugin-highlight-targeted-heading',
      ],
    },
  },
  title: "WASDDestroy 的个人文档站",
  description: "Explore all my docs there",
  ignoreDeadLinks: false,

  head: [
    [
      'meta',
      {
        name: 'copyright',
        content: 'CC BY-NC-SA 4.0',
      },
    ],
    [
      'meta',
      {
        property: 'og:license',
        content: 'CC BY-NC-SA 4.0',
      },
    ],
    [
      'link',
      {
        rel: 'license',
        href: '/legal/CC-BY-NC-SA-4.0.txt',
      },
    ],
  ],

  themeConfig: {
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: "搜索",
                buttonAriaLabel: "搜索",
              },
              modal: {
                displayDetails: "显示详细列表",
                resetButtonTitle: "重置搜索",
                backButtonTitle: "关闭搜索",
                noResultsText: "没有结果",
                footer: {
                  selectText: "选择",
                  selectKeyAriaLabel: "输入",
                  navigateText: "导航",
                  navigateUpKeyAriaLabel: "上箭头",
                  navigateDownKeyAriaLabel: "下箭头",
                  closeText: "关闭",
                  closeKeyAriaLabel: "Esc",
                },
              },
            },
          },
        },
      },
    },

    // 顶栏只有 tb710fu-doc 有下拉子项；侧栏请改 .vitepress/sidebar.map.mjs
    nav: [
      { text: '主页', link: '/' },
      {
        text: 'TB710FU Doc',
        items: [
          { text: '文档首页', link: '/tb710fu-doc/' },
          { text: '通用教程', link: '/tb710fu-doc/generic/before_we_start' },
          { text: '更新日志', link: '/tb710fu-doc/generic/updatelog' },
          { text: '资源下载', link: '/tb710fu-doc/generic/resource_download' },
          { text: '问题反馈与技术交流', link: '/tb710fu-doc/generic/feedback' },
        ],
      },
    ],

    sidebar: rootSidebar,

    editLink: {
      pattern: 'https://gitee.com/WASDDestroy/wasddestroy-docs/blob/master/:path'
    },

    socialLinks: [
      { icon: 'gitee', link: 'https://gitee.com/WASDDestroy/wasddestroy-docs' },
    ],

    footer: {
      message:
        '<a href="http://beian.miit.gov.cn" target="_blank">浙 ICP 备 2025219672 号 - 1</a>， 由 <a href="https://vitepress.dev" target="_blank">VitePress</a> 强力驱动',
      copyright:
        'Copyright © 2025 - 至今， 酷安 @WASD_Destroy， 采用 <a href="/legal/CC-BY-NC-SA-4.0.txt" target="_blank">CC BY-NC-SA 4.0</a> 许可。',
    },
  },
})
