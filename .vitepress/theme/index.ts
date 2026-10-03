import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import { NolebaseHighlightTargetedHeading } from '@nolebase/vitepress-plugin-highlight-targeted-heading/client'
import '@nolebase/vitepress-plugin-enhanced-readabilities/client/style.css'
import '@nolebase/vitepress-plugin-highlight-targeted-heading/client/style.css'
import 'lxgw-wenkai-screen-webfont/lxgwwenkaiscreen.css'
import EnhancedReadabilitiesWithFont from './EnhancedReadabilitiesWithFont.vue'
import ScreenMenuWithFont from './ScreenMenuWithFont.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // 聚焦标记：通过目录/锚点跳转时高亮目标标题
      'doc-before': () => h(NolebaseHighlightTargetedHeading),
      // 阅读增强面板（布局模式、页面宽度、聚焦等 + 字体切换），替换原版 Nolebase 菜单
      'nav-bar-content-after': () => h(EnhancedReadabilitiesWithFont),
      'nav-screen-content-after': () => h(ScreenMenuWithFont),
    })
  },
}
