import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth.js';

test('campus workflows fit the viewport and the calendar is usable', async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/home$/);

  if (isMobile) {
    const navigation = page.getByRole('navigation', { name: 'Primary mobile' });
    await navigation.getByRole('link', { name: 'Admin' }).click();
    await page.getByRole('navigation', { name: 'Administration', exact: true }).getByRole('link', { name: 'Venues' }).click();
    await expect(page.getByRole('heading', { name: 'Manage venues' })).toBeVisible();
  }

  await page.goto('/venues');
  await expect(page.getByRole('heading', { name: 'Find your next space.' })).toBeVisible();
  await page.getByRole('link', { name: 'Check slots for Main Auditorium' }).click();
  await expect(page.getByRole('heading', { name: 'Main Auditorium' })).toBeVisible();
  if (isMobile) {
    await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible();
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.locator('.date-week .date-cells button:enabled').first().click();
  } else {
    await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible();
  }
  const slots = page.getByRole('group', { name: 'Hourly time slots' });
  await slots.getByRole('button', { name: /10–11 AM Open/ }).click();
  await expect(slots.getByRole('button', { pressed: true })).toHaveCount(1);
  if (isMobile) {
    const size = await page.locator('.date-week .date-cells button:enabled').first().boundingBox();
    expect(size?.height).toBeGreaterThanOrEqual(48);
  }
  await expect(page.getByRole('button', { name: 'Request venue' })).toBeEnabled();

  async function expectNoHorizontalOverflow() {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  }

  await expectNoHorizontalOverflow();
  for (const [path, heading] of [
    ['/home', 'What are you planning?'],
    ['/bookings', 'My bookings'],
    ['/approvals', 'Approvals'],
    ['/admin', 'Administration'],
    ['/admin/users', 'User accounts'],
    ['/admin/venues', 'Manage venues'],
    ['/admin/departments', 'Departments'],
    ['/admin/workflows', 'Approval steps'],
    ['/account', 'My account'],
  ]) {
    await page.goto(path!);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow();
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
