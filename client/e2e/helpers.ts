import { expect, type Browser, type Page } from '@playwright/test';
import { E2E_PASSWORD } from './constants';

export async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username or Email').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /^Login/ }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function staffPage(browser: Browser, username: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, username);
  return { page, context };
}
