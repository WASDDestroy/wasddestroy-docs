<script setup lang="ts">
// 自组装的"阅读增强"面板：内容与 NolebaseEnhancedReadabilitiesMenu 一致，
// 末尾追加字体切换一节。Nolebase 的 Menu 组件未提供 slot，只能这样扩展。
import {
  InjectionKey,
  LayoutSwitch,
  LayoutSwitchContentLayoutMaxWidthSlider,
  LayoutSwitchPageLayoutMaxWidthSlider,
  Spotlight,
  SpotlightStyles,
} from '@nolebase/vitepress-plugin-enhanced-readabilities/client'
import { useMounted } from '@vueuse/core'
import { inject, ref } from 'vue'
import VPFlyout from 'vitepress/dist/client/theme-default/components/VPFlyout.vue'
import FontSection from './FontSection.vue'

const options = inject(InjectionKey, {})
const mounted = useMounted()
const el = ref<HTMLElement>()
</script>

<template>
  <VPFlyout
    icon="i-icon-park-outline:book-open"
    class="VPNolebaseEnhancedReadabilitiesMenu VPNolebaseEnhancedReadabilitiesMenuFlyout"
    aria-label="阅读增强"
    role="menuitem"
  >
    <div v-if="mounted" aria-label="阅读增强" min-w-64 p-2 space-y-2>
      <LayoutSwitch />
      <LayoutSwitchPageLayoutMaxWidthSlider />
      <LayoutSwitchContentLayoutMaxWidthSlider />
      <Spotlight v-if="!options.spotlight?.disabled" />
      <SpotlightStyles v-if="!options.spotlight?.disabled" />
      <div class="font-section-divider" aria-hidden="true" />
      <FontSection />
    </div>
  </VPFlyout>
</template>

<style>
.font-section-divider {
  height: 1px;
  background-color: var(--vp-c-divider);
}

.font-section-title {
  margin: 0;
}
</style>
