<script setup lang="ts">
import { NuInputHorizontalRadioGroup } from '@nolebase/ui'
import { useStorage } from '@vueuse/core'
import { watch } from 'vue'

const props = defineProps<{
  screen?: boolean
}>()

const STORAGE_KEY = 'user-font'
const FONT_CLASS = 'use-lxgw-font'

// useStorage 在 SSR 环境下安全（客户端 hydration 后才读取）
const font = useStorage<'default' | 'lxgw'>(STORAGE_KEY, 'default')

watch(
  font,
  (value) => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle(FONT_CLASS, value === 'lxgw')
  },
  { immediate: true },
)

const options = [
  {
    value: 'default',
    title: '默认字体',
    ariaLabel: '使用默认字体',
    text: '默认',
    name: '字体切换',
  },
  {
    value: 'lxgw',
    title: '霞鹜文楷屏幕版',
    ariaLabel: '使用霞鹜文楷屏幕版字体',
    text: '文楷',
    name: '字体切换',
  },
]
</script>

<template>
  <div space-y-2 role="radiogroup">
    <h3
      class="font-section-title"
      text="[14px] $vp-nolebase-enhanced-readabilities-menu-text-color"
      inline-flex select-none items-center align-middle font-medium
    >
      <span i-icon-park-outline:text mr-1 aria-hidden="true" />
      <span>字体</span>
    </h3>
    <NuInputHorizontalRadioGroup
      v-model="font"
      :bg="props.screen ? '$vp-c-bg-soft' : '$vp-nolebase-enhanced-readabilities-menu-background-color'"
      text="sm $vp-nolebase-enhanced-readabilities-menu-text-color"
      :options="options"
    />
  </div>
</template>
