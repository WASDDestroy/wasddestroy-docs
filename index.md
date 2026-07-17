---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: 刷机只能中午刷
  text: 因为早晚要出事
  tagline: LD_PRELOAD=./preload.so /system/bin/toybox id
  image:
    src: /hero.png
    alt: WASDDestroy
  actions:
    - theme: brand
      text: 全部文档导航
      link: /

features:
  - icon: 📱
    title: TB710FU Doc
    details: 小新 Pad Pro GT 刷机指南。
    link: /tb710fu-doc/index
    linkText: 跳转
  - icon: 🔬
    title: 扩展篇
    details: dd 命令、制作 9008 包、修复 GSN、AVB 机制深入讲解。
    link: /tb710fu-doc/dd_command
    linkText: 跳转
  - icon: ❓
    title: 杂项
    details: 部分难以归类的内容
    link: /misc/index
    linkText: 跳转
  - icon: ❓
    title: 通识
    details: 都刷机了这些得懂吧？
    link: /generic_knowledge
    linkText: 跳转
---
