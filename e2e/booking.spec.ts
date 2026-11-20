import { expect, test } from '@playwright/test';
import { login, loginAsAdmin } from './helpers/auth.js';

function futureDate(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

test('registration, admin approval, login and booking flow', async ({ page, context }, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `e2e.${stamp}@college.edu`;
  const firstName = 'E2E';
  const lastName = `Student${stamp.slice(-4)}`;
  const studentPassword = `E2ePass!${Math.random().toString(36).slice(2)}9`;

  await page.goto('/register');
  await page.getByLabel('First name').fill(firstName);
  await page.getByLabel('Last name').fill(lastName);
  await page.getByLabel('College email').fill(email);

  const department = page.getByLabel('Department');
  await expect(department.locator('option', { hasText: 'Computer Science (CS)' })).toHaveCount(1);
  await department.selectOption({ label: 'Computer Science (CS)' });

  await page.getByLabel('Password', { exact: true }).fill(studentPassword);
  await page.getByLabel('Confirm password').fill(studentPassword);
  await page.getByRole('button', { name: 'Submit access request' }).click();

  await expect(
    page.getByRole('heading', { name: 'Your account is in the review queue' }),
  ).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/users');
  await page.getByLabel('Search accounts by name or email').fill(email);

  const participant = page.locator('tr', { hasText: email });
  await expect(participant).toBeVisible();
  await participant.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Approve account' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await context.clearCookies();
  await login(page, email, studentPassword);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(firstName);

  await page.getByRole('link', { name: 'Browse campus venues' }).click();
  await expect(page.getByRole('heading', { name: 'Find the right space' })).toBeVisible();
  await page.getByRole('link', { name: 'Main Auditorium' }).click();
  await expect(page.getByRole('heading', { name: 'Main Auditorium' })).toBeVisible();
  await expect(page.getByText('Pending requests do not guarantee the venue.')).toBeVisible();

  const title = `E2E Robotics Showcase ${stamp}`;
  await page.getByLabel('Event title').fill(title);
  await page.getByLabel('Description').fill('End-to-end booking flow verification.');
  await page.getByLabel('Expected attendance').fill('45');
  await page.getByLabel('Date', { exact: true }).fill(futureDate());
  await page.getByLabel('Start', { exact: true }).fill('10:00');
  await page.getByLabel('End', { exact: true }).fill('11:00');

  await expect(
    page.getByText(/No conflicts found\.|overlapping pending request/),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Submit booking request' }).click();

  await expect(page).toHaveURL(/\/my-events\?highlight=/);
  await expect(page.getByRole('heading', { name: 'My events' })).toBeVisible();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(
    page.getByText('Awaiting approval. Pending requests do not reserve the venue.'),
  ).toBeVisible();
});
