import { test, expect } from '@playwright/test';

test.describe('Auth', () => {
  test('ログインページのフォーム要素', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.getByLabel('メールアドレス')).toBeVisible();
    await expect(page.getByLabel('パスワード')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible();
  });

  test('未ログインで /me にアクセスすると /signin にリダイレクト', async ({ page }) => {
    await page.goto('/me');
    await expect(page).toHaveURL(/\/signin/);
  });

  test('未ログインで /admin にアクセスすると /signin にリダイレクト', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/signin/);
  });

  test('間違ったパスワードはエラー表示', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('メールアドレス').fill('nonexistent@example.com');
    await page.getByLabel('パスワード').fill('wrongpassword');
    await page.getByRole('button', { name: 'ログイン' }).click();
    await expect(page.getByText(/正しくありません/)).toBeVisible({ timeout: 10000 });
  });
});
