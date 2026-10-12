import { defineConfig } from 'vitepress'
import tbConfig from '../tb710fu-doc/.vitepress/config.mjs'

// 为 tb710fu-doc 子模块的 sidebar/nav 链接添加 /tb710fu-doc 前缀
function prefixLinks(items: any[] | any, prefix: string): any[] | any {
  if (!Array.isArray(items)) return items
  return items.map(item => {
    const newItem = { ...item }
    if (item.link) {
      newItem.link = item.link === '/' ? prefix + '/' : prefix + item.link
    }
    if (item.items) {
      newItem.items = prefixLinks(item.items, prefix)
    }
    return newItem
  })
}

// 从 tbConfig 中提取 sidebar 并添加前缀
const tbSidebar: Record<string, any> = {}
if (tbConfig.themeConfig?.sidebar) {
  if (Array.isArray(tbConfig.themeConfig.sidebar)) {
    // sidebar 是数组（适用于所有页面），整体挂载到 /tb710fu-doc/ 下
    tbSidebar['/tb710fu-doc/'] = prefixLinks(tbConfig.themeConfig.sidebar, '/tb710fu-doc')
  } else {
    for (const [key, sections] of Object.entries(tbConfig.themeConfig.sidebar)) {
      const newKey = '/tb710fu-doc' + key
      tbSidebar[newKey] = prefixLinks(sections, '/tb710fu-doc')
    }
  }
}

// 从 tbConfig 中提取 nav，添加前缀（排除 "主页" 项以免重复）
const tbNav = tbConfig.themeConfig?.nav
  ?.filter(item => item.link !== '/') // 去掉 tb710fu-doc 的"主页"，由根站点统一
  ?? []
const prefixedTbNav = prefixLinks(tbNav, '/tb710fu-doc')

// 合并到根站点的 sidebar
const rootSidebar = {
  ...tbSidebar,
  'misc': [
    {
      text: "杂项",
      collapsed: false,
      items: [
        { text: "小米新设备解锁 Bootloader", link: "/misc/mi_unlock_bootloader" },
        { text: "8750_Ennea.img 初步分析", link: "/misc/qualcomm_unlock_exploit"},
        { text: "AVB 机制入门", link: "/misc/avb_guide" },
        { text: "avbtool.py 简易教程", link: "/misc/avbtool_tutorial" },
        { text: "dd命令", link: "/misc/dd_command" },
      ]
    }
  ],
  'generic_knowledge': [
    {
      text: "通识",
      collapsed: false,
      items: [
        { text: "提问的智慧", link: "/generic_knowledge/how_to_ask" },
        { text: "刷机有风险", link: "/generic_knowledge/generic_flashing_warns" },
        { text: "Root 教程导航", link: "/generic_knowledge/root_guide" },
        { text: "术语表", link: "/generic_knowledge/glossary" },
        { text: "命令行入门", link: "/generic_knowledge/basic_command_line_skills" },
        { text: "刷机工具教程——高通工具箱", link: "/generic_knowledge/qcom_toolbox" },
        { text: "刷机工具教程——匣", link: "/generic_knowledge/geekflashtool" },
      ],
    },
  ],
  'lenovo': [
    {
      text: "联想通用教程",
      collapsed: false,
      items: [
        { text: "官方刷机工具小妙招", link: "/lenovo/lenovo_quick_fix_tips" },
        { text: "解锁流程逆向", link: "/lenovo/research_on_sn_img" },
        { text: "解锁申请网站前端 JavaScript 分析", link: "/lenovo/unlock_application_page" }
      ],
    },
  ],
  'data-structure': [
    {
      text: "数据结构（C 语言第三版）",
      collapsed: false,
      items: [
        { text: "数据结构基本知识", link: "/data-structure/basics"},
        { text: "线性表", link: "/data-structure/linear_list"}
      ]
    }
  ]
}

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

    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '主页', link: '/' },
      {
         text: 'TB710FU Doc',
         items: [
           { text: '文档首页', link: '/tb710fu-doc/' },
           ...prefixedTbNav,
         ]
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
