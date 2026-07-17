import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lastUpdated: true,
  title: "WASDDestroy 的个人文档站",
  description: "Explore all my docs there",

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
          { text: '文档首页', link: '/tb710fu-doc/index' },
          { text: '开始了解', link: '/tb710fu-doc/before_we_start' },
          { text: 'Root 导航', link: '/tb710fu-doc/state_machine' },
          { text: '更新日志', link: '/tb710fu-doc/updatelog' },
          { text: '资源下载', link: '/tb710fu-doc/resource_download' },
        ]
      },
    ],

    sidebar: {
      '/tb710fu-doc/': [
        {
          text: "教程本篇",
          collapsed: false,
          items: [
            { text: "序言", link: "/tb710fu-doc/before_we_start" },
            { text: "提问的智慧", link: "/tb710fu-doc/how_to_ask" },
            { text: "风险告知", link: "/tb710fu-doc/generic_flashing_warns" },
            { text: "解锁 Bootloader", link: "/tb710fu-doc/flash_unlocked_device" },
            { text: "锁定 Bootloader", link: "/tb710fu-doc/lock_bootloader" },
            { text: "刷机工具教程——高通工具箱", link: "/tb710fu-doc/qcom_toolbox" },
            { text: "刷机工具教程——匣", link: "/tb710fu-doc/geekflashtool" },
            { text: "重要警告 ⭐", link: "/tb710fu-doc/important_warns" },
            { text: "刷机前必做 ⭐", link: "/tb710fu-doc/before_flashing" },
            { text: "Root 方案比较和须知事项", link: "/tb710fu-doc/comparison_and_warn" },
            { text: "Root 教程导航 ⭐", link: "/tb710fu-doc/state_machine" },
            {
              text: "Root 相关教程",
              collapsed: false,
              items: [
                { text: "刷写 GKI Root ❌", link: "/tb710fu-doc/flash_gki_root" },
                { text: "9008 刷写 LKM Root ⭐", link: "/tb710fu-doc/flash_lkm_root_9008" },
                { text: "TWRP 刷写 LKM Root", link: "/tb710fu-doc/flash_lkm_root_twrp" },
                { text: "移除 GKI Root", link: "/tb710fu-doc/unroot_gki" },
                { text: "移除 LKM Root", link: "/tb710fu-doc/unroot_lkm" },
              ]
            },
            { text: "刷入 TWRP", link: "/tb710fu-doc/flash_twrp" },
            {
              text: "保留 用户数据 和 Root 权限进行系统增量更新",
              link: "/tb710fu-doc/update_while_keeping_root",
            },
            {
              text: "刷入第三方 ROM 和自己创建的备份",
              link: "/tb710fu-doc/flash_3rd_party_rom",
            },
            {
              text: "救砖",
              link: "/tb710fu-doc/unbrick_device",
            },
          ],
        },
        {
          text: "正篇附录",
          collapsed: false,
          items: [
            { text: "附录1：常见问题速查", link: "/tb710fu-doc/faq" },
            { text: "附录2：第三方 ROM 信息汇总", link: "/tb710fu-doc/appendix_3rd_party_roms" },
            { text: "附录3：术语表", link: "/tb710fu-doc/glossary" },
            { text: "附录4：资源下载", link: "/tb710fu-doc/resource_download" },
          ],
        },
        {
          text: "扩展篇",
          collapsed: true,
          items: [
            { text: "dd命令", link: "/tb710fu-doc/dd_command" },
            { text: "制作通用 9008 包", link: "/tb710fu-doc/make_generic_pc_firmware" },
            { text: "修复 GSN", link: "/tb710fu-doc/fix_gsn" },
            { text: "官方 9008 刷机包说明", link: "/tb710fu-doc/notes_on_official_edl_roms" },
          ],
        },
      ],
      'misc': [
        {
          collapsed: false,
          items: [
            { text: "说明", link: "/misc/index" },
            { text: "小米新设备解锁 Bootloader", link: "/misc/mi_unlock_bootloader" },
            { text: "AVB 机制入门", link: "/misc/avb_guide" },
            { text: "avbtool.py 简易教程", link: "/misc/avbtool_tutorial" },
          ]
        }
      ],
    },

    editLink: {
      pattern: 'https://gitee.com/WASDDestroy/wasddestroy-docs/blob/master/:path'
    },

    socialLinks: [
      { icon: 'gitee', link: 'https://gitee.com/WASDDestroy/tb710fu-doc' },
    ],

    footer: {
      message:
        '<a href="http://beian.miit.gov.cn" target="_blank">浙ICP备2025219672号-1</a>',
      copyright:
        "Copyright © 2025 - 至今， 酷安 @WASD_Destroy, 采用 CC BY-SA 4.0 许可",
    },
  },
})
