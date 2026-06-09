import { test, expect } from '@playwright/test';

test.describe('Products', () => {
  test('商品一覧ページが表示される', async ({ page }) => {
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'グッズ' })).toBeVisible();
  });

  test('コンテンツ一覧ページが表示される', async ({ page }) => {
    await page.goto('/contents');
    await expect(page.getByRole('heading', { name: 'コンテンツ' })).toBeVisible();
  });
});
