import { expect, test } from '@playwright/test'

// 今日この時点でグリーンに走ることを実証するスモーク。M3 の UI 実装が入ったら
// ここに画面ごとのシナリオを足していく。現状はプレースホルダページの疎通のみ確認。
test('placeholder page renders', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('human-1')
  await expect(page.getByTestId('app-root')).toBeVisible()
  await expect(page.getByTestId('app-title')).toHaveText('human-1')
})
