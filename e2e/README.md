# BiliNote 浏览器冒烟测试

独立于前端包（不进 Docker 构建、不动 pnpm-lock）。用系统已装的 Edge，不下载 Playwright 浏览器。

```bash
cd e2e
npm install          # 只装 @playwright/test
npm test             # 对着 http://localhost 跑（先确保容器在跑）
```

headless 页面的 visibilityState 是 visible，所以 scroll-spy、smooth 滚动这些
"后台标签页验不了"的用例在这里能真跑。环境变量：E2E_BASE_URL、E2E_CHANNEL（默认 msedge，可改 chrome）。
