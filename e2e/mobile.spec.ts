import { expect, test, type Page } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@college.edu';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMeNow!2026';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('College email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

test('mobile venue calendar and booking form stay usable', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto('/venues');
  await expect(page.getByRole('heading', { name: 'Find the right space' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();

  await page.getByRole('link', { name: 'Main Auditorium' }).click();
  await expect(page.getByRole('heading', { name: 'Main Auditorium' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.locator('.calendar-week')).toBeVisible();

  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.locator('.calendar-day-list, .calendar-day-empty')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan your event' })).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(horizontalOverflow).toBe(false);
});
