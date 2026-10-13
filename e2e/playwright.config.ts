import { defineConfig } from '@playwright/test'

// 用系统已装的 Edge（channel），不下载 Playwright 自带浏览器。
// headless 页面的 visibilityState 是 visible，所以 scroll-spy / smooth 滚动这些
// "后台标签页验不了"的用例在这里能真跑。
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost',
    channel: process.env.E2E_CHANNEL || 'msedge',
    headless: true,
  },
})
