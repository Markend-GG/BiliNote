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
