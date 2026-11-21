import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth.js';

test('mobile venue calendar and booking form stay usable', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto('/venues');
  await expect(page.getByRole('heading', { name: 'Find the right space' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();
  await page.getByRole('button', { name: 'Open date calendar' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a date' })).toBeVisible();
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await page.getByRole('button', { name: 'Check availability' }).click();

  await page.getByRole('link', { name: 'Review this slot for Main Auditorium' }).click();
  await expect(page.getByRole('heading', { name: 'Main Auditorium' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Week', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.locator('.calendar-week')).toBeVisible();

  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.locator('.calendar-day-list, .calendar-day-empty')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plan your event' })).toBeVisible();

  async function expectNoHorizontalOverflow() {
    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);
  }

  await expectNoHorizontalOverflow();

  for (const [path, heading] of [
    ['/my-events', 'My events'],
    ['/approvals', 'Approval inbox'],
    ['/admin', 'Administration overview'],
    ['/admin/users', 'User accounts'],
    ['/admin/venues', 'Manage venues'],
    ['/admin/departments', 'Departments'],
    ['/admin/workflows', 'Approval workflows'],
    ['/account', 'My account'],
  ]) {
    await page.goto(path!);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow();
  }

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
