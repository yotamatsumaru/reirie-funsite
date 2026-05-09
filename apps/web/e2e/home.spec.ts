import { test, expect } from '@playwright/test';

test.describe('Home', () => {
  test('トップページが表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('アイドル');
    await expect(page.getByRole('link', { name: 'コンテンツを見る' })).toBeVisible();
  });

  test('ヘッダーから登録ページに遷移できる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '登録' }).first().click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole('heading', { name: '新規会員登録' })).toBeVisible();
  });
});
