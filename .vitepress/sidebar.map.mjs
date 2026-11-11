/**
 * 根站点 sidebar 映射 —— 只记录「扫描文件系统推不出来」的信息。
 *
 * 结构来源：各分区的子目录层级（scripts/gen-sidebar.mjs 自动扫描 .md）。
 * 本文件负责：
 *   sections  顶层分区：侧栏键、条目顺序、折叠状态、排除项；
 *             分组方式与目录层级不一致时（tb710fu-doc 的 generic/ 被拆成三组），用 tree 覆盖。
 *   dirs      子目录的中文名（英文目录名 → 侧栏索引文字），可附带 order / collapsed。
 *   titles    稀疏短名：长 H1 在侧栏里显示的名字，缺省回退到文档 H1。
 *
 * 键的约定：
 *   sections 的键      → 仓库根的顶层目录名（纯英文）
 *   dirs 的键          → 相对仓库根的目录路径，如 'data-structure/linear_list'
 *   titles 的键        → 相对仓库根、去掉 .md 的文件路径，如 'misc/dd_command'
 *   order 与 tree 的项 → 相对「所属分区根」的路径（去 .md；目录写目录名）
 *
 * 数组顺序即侧栏顺序；order 里没列出的新文件会按文件名追加到末尾并告警。
 * 折叠状态写在分组的 collapsed 上（默认 false，即展开）。
 */

export default {
  sections: {
    misc: {
      label: '杂项',
      collapsed: false,
      order: [
        'mi_unlock_bootloader',
        'qualcomm_unlock_exploit',
        'avb_guide',
        'avbtool_tutorial',
        'dd_command',
        'make_generic_pc_firmware',
        'oppo_mediatek_ubl',
      ],
    },

    generic_knowledge: {
      label: '通识',
      collapsed: false,
      order: [
        'how_to_ask',
        'generic_flashing_warns',
        'root_guide',
        'glossary',
        'basic_command_line_skills',
        'qcom_toolbox',
        'geekflashtool',
      ],
    },

    lenovo: {
      label: '联想通用教程',
      collapsed: false,
      order: ['lenovo_quick_fix_tips', 'research_on_sn_img', 'unlock_application_page'],
    },

    // 子目录按目录名排序：basics / linear_list / stack_and_queue /
    // string_array_and_list / tree，中文名见下方 dirs。
    'data-structure': {
      label: '数据结构（C 语言第三版）',
      collapsed: false,
    },

    // 子站的分组与目录层级不一致（generic/ 拆成三个分组，且交错放置），
    // 这里按原样显式复刻；updatelog 只出现在顶栏，不进侧栏。
    'tb710fu-doc': {
      label: 'TB710FU Doc',
      exclude: ['README.md', 'generic/updatelog'],
      tree: [
        {
          text: '通用教程',
          collapsed: false,
          items: [
            'generic/before_we_start',
            'generic/specs',
            'generic/versions',
            'generic/flash_unlocked_device',
            'generic/lock_bootloader',
            'generic/before_flashing',
            'generic/root_your_device_lkm',
            'generic/unbrick_device',
            'generic/update_while_keeping_root',
            'generic/flash_yu_s_third_party_rom',
            'generic/flash_fix_module_yu_c16',
          ],
        },
        {
          text: '附录',
          collapsed: false,
          items: ['generic/faq', 'generic/resource_download', 'generic/feedback'],
        },
        {
          text: '扩展篇',
          collapsed: true,
          items: ['generic/fix_gsn', 'generic/notes_on_official_edl_roms'],
        },
        {
          text: '免解锁刷机',
          collapsed: true,
          items: [
            'without_unlock/before_we_start',
            'without_unlock/dangerous_things',
            'without_unlock/important_warns',
            {
              text: '高版本用户必读',
              collapsed: false,
              items: [
                'without_unlock/high_versions/overview',
                'without_unlock/high_versions/restore_trust_chain_on_android',
                'without_unlock/high_versions/create_profile_avbdroid',
              ],
            },
            {
              text: 'Root 你的设备',
              collapsed: false,
              items: [
                'without_unlock/comparison_and_warn',
                'without_unlock/state_machine',
                {
                  text: 'Root 相关教程（1.5.04.445 以下）',
                  collapsed: false,
                  items: [
                    'without_unlock/flash_gki_root',
                    'without_unlock/flash_lkm_root_9008',
                    'without_unlock/flash_lkm_root_twrp',
                    'without_unlock/unroot_gki',
                    'without_unlock/unroot_lkm',
                  ],
                },
              ],
            },
            'without_unlock/flash_twrp',
            'without_unlock/flash_3rd_party_rom',
            'without_unlock/update_while_keeping_root',
            'without_unlock/unroot',
          ],
        },
      ],
    },
  },

  dirs: {
    'data-structure/basics': '基本知识',
    'data-structure/linear_list': {
      label: '线性表',
      // 按教材顺序：定义/数组与链表 → 顺序表与链表的比较 → 应用
      order: ['linked_list', 'compare_seq_list_and_linked_list', 'linear_list_usages'],
    },
    'data-structure/stack_and_queue': '栈和队列',
    'data-structure/string_array_and_list': '串、数组和广义表',
    'data-structure/tree': {
      label: '树',
      order: [
        'definition_and_features',
        'implement_a_binary_tree',
        'traverse_a_binary_tree',
        'threaded_binary_tree',
        'tree_and_forest',
        'huffman_encoding',
      ],
    },
  },

  // 只列「H1 太长或与侧栏习惯叫法不同」的条目；其余直接用 H1。
  titles: {
    'misc/mi_unlock_bootloader': '小米新设备解锁 Bootloader',
    'misc/qualcomm_unlock_exploit': '8750_Ennea.img 初步分析',
    'misc/avb_guide': 'AVB 机制入门',
    'misc/avbtool_tutorial': 'avbtool.py 简易教程',
    'misc/dd_command': 'dd 命令',

    'generic_knowledge/generic_flashing_warns': '刷机有风险',
    'generic_knowledge/root_guide': 'Root 教程导航',

    'lenovo/lenovo_quick_fix_tips': '官方刷机工具小妙招',
    'lenovo/research_on_sn_img': '解锁流程逆向',
    'lenovo/unlock_application_page': '解锁申请网站前端 JavaScript 分析',

    'tb710fu-doc/generic/before_we_start': '序言',
    'tb710fu-doc/generic/specs': '设备参数',
    'tb710fu-doc/generic/versions': '版本目录',
    'tb710fu-doc/generic/flash_unlocked_device': '解锁 Bootloader',
    'tb710fu-doc/generic/lock_bootloader': '锁定 Bootloader',
    'tb710fu-doc/generic/before_flashing': '全量备份 (必做) ⭐',
    'tb710fu-doc/generic/root_your_device_lkm': '刷 Root (Ramdisk)',
    'tb710fu-doc/generic/update_while_keeping_root': '保留用户数据和 Root 权限进行系统增量更新',
    'tb710fu-doc/generic/flash_yu_s_third_party_rom': '刷入第三方 ROM (兰微卡鱼版)',
    'tb710fu-doc/generic/flash_fix_module_yu_c16': '刷入兰微卡鱼 ColorOS 专用修复模块',
    'tb710fu-doc/generic/faq': '常见问题速查',
    'tb710fu-doc/generic/resource_download': '资源下载',
    'tb710fu-doc/generic/notes_on_official_edl_roms': '联想官方 9008 刷机包说明',
    'tb710fu-doc/without_unlock/before_we_start': '开始免解锁刷机之前',
    'tb710fu-doc/without_unlock/dangerous_things': '免解锁基础知识',
    'tb710fu-doc/without_unlock/important_warns': '重要警告 ⭐',
    'tb710fu-doc/without_unlock/high_versions/overview': '现状概述',
    'tb710fu-doc/without_unlock/high_versions/restore_trust_chain_on_android':
      '使用 Android 设备恢复高版本系统为 AOSP 信任链',
    'tb710fu-doc/without_unlock/comparison_and_warn': 'Root 方案比较和须知事项',
    'tb710fu-doc/without_unlock/state_machine': 'Root 教程导航 ⭐',
    'tb710fu-doc/without_unlock/flash_gki_root': '刷写 GKI Root ❌',
    'tb710fu-doc/without_unlock/flash_lkm_root_9008': '9008 刷写 LKM Root ⭐',
    'tb710fu-doc/without_unlock/flash_lkm_root_twrp': 'TWRP 刷写 LKM Root',
    'tb710fu-doc/without_unlock/unroot_gki': '移除 GKI Root',
    'tb710fu-doc/without_unlock/unroot_lkm': '移除 LKM Root',
    'tb710fu-doc/without_unlock/flash_twrp': '刷入 TWRP',
    'tb710fu-doc/without_unlock/flash_3rd_party_rom': '刷入第三方 ROM 和自己创建的备份',
    'tb710fu-doc/without_unlock/update_while_keeping_root': '进行系统增量更新',
    'tb710fu-doc/without_unlock/unroot': '移除 Root',
  },
}
