<script setup lang="ts">
// 手机端（窄屏）导航抽屉里的"阅读增强"面板，同样在原版内容后追加字体切换。
import {
  InjectionKey,
  ScreenLayoutSwitch,
  ScreenSpotlight,
} from '@nolebase/vitepress-plugin-enhanced-readabilities/client'
import { useMounted } from '@vueuse/core'
import { inject } from 'vue'
import FontSection from './FontSection.vue'

const options = inject(InjectionKey, {})
const mounted = useMounted()
</script>

<template>
  <div v-if="mounted" space-y-2 class="VPNolebaseEnhancedReadabilitiesMenu">
    <h3
      class="screen-menu-title"
      text="[14px] $vp-nolebase-enhanced-readabilities-menu-text-color"
      inline-flex select-none items-center align-middle font-medium
    >
      <span i-icon-park-outline:book-open mr-1 aria-hidden="true" />
      <span>阅读增强</span>
    </h3>
    <div flex="~ col" pl-4 space-y-2>
      <ScreenLayoutSwitch />
      <ScreenSpotlight v-if="!options.spotlight?.disabled" />
      <FontSection screen />
    </div>
  </div>
</template>

<style>
.screen-menu-title {
  margin: 0;
}
</style>
