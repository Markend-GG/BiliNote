import { defineConfig } from '@playwright/test'

// 用系统已装的 Edge（channel），不下载 Playwright 自带浏览器。
// headless 页面的 visibilityState 是 visible，所以 scroll-spy / smooth 滚动这些
// "后台标签页验不了"的用例在这里能真跑。
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  globalSetup: './global-setup.ts',
  // 单 worker：每个用例都要渲染两三万字的笔记，3 个 worker 并跑时 CPU 争用会让
  // scroll-spy 这类"滚动后等高亮变化"的用例偶发超时（单跑 3.9s 过、并跑挂）。
  // 整套 14 例串行也只要 45 秒左右，确定性比这点时间值钱。
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost',
    channel: process.env.E2E_CHANNEL || 'msedge',
    headless: true,
  },
})
