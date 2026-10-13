import { test, expect } from '@playwright/test'

test('书架页渲染卡片与新建入口', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '新建笔记' })).toBeVisible()
  await expect(page.getByRole('button', { name: /全部/ })).toBeVisible()
})

test('新建文件夹对话框可开可关', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新建文件夹' }).click()
  const dialog = page.locator('[data-slot="dialog-content"][data-state="open"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('列表/卡片视图切换', async ({ page }) => {
  await page.goto('/')
  await page.locator('button[aria-label="列表视图"]').click()
  await expect(page.locator('main img.h-12').first()).toBeVisible()
  await page.locator('button[aria-label="卡片视图"]').click()
  await expect(page.locator('main .aspect-video').first()).toBeVisible()
})

test('新建笔记双击也只发一次提交请求', async ({ page }) => {
  // 拦截提交：既数得清发了几次，又不会真启动一次生成（那要烧 API 额度、跑好几分钟）。
  // 回归的是真实事故：一次点击发出两个相差 0.5ms 的请求 → 后端并发跑两份下载 →
  // 其中一份 rename .part 失败 → 书架上多一条"生成失败"，用户以为没成功又点一次。
  const posts: unknown[] = []
  await page.route('**/api/generate_note', async route => {
    posts.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'success',
        data: { task_id: 'e2e00000-1111-4111-8111-111111111111' },
      }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '新建笔记' }).click()
  const dialog = page.locator('[data-slot="dialog-content"][data-state="open"]')
  await expect(dialog).toBeVisible()
  await dialog
    .getByPlaceholder('请输入视频网站链接')
    .fill('https://www.bilibili.com/video/BV1e2e000E2gQ')

  const submit = dialog.getByRole('button', { name: /生成笔记/ })
  await expect(submit).toBeEnabled()
  // 双击 = 用户着急时的真实行为。防重锁必须是同步的 ref：react-hook-form 的校验是异步的，
  // 靠 setState 上锁的话第二次点击会赶在重渲染之前溜进去
  await submit.dblclick()
  await page.waitForTimeout(2000)

  if (posts.length === 0) {
    // 一次都没发出去 = 卡在校验或前端异常，把对话框现状打出来，否则只看到 0 != 1 没法定位
    const text = (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 700)
    throw new Error(`没有发出提交请求。对话框内容：${text}`)
  }
  expect(posts.length, `双击发出了 ${posts.length} 次提交请求`).toBe(1)
})
