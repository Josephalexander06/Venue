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
  await expect(page.getByRole('heading', { name: 'Find a venue' })).toBeVisible();
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
  await expect(page.getByLabel('Event name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Event details' })).toBeVisible();
  await expect(page.getByLabel('Event name')).toBeVisible();
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

test('opens the event team from a booking and edits the roster on mobile', async ({ page, isMobile }, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
  await loginAsAdmin(page);
  const origin = new URL(page.url()).origin;
  const csrf = (await page.context().cookies(origin)).find((cookie) => cookie.name === 'venue_csrf')!.value;
  const headers = { origin, 'x-csrf-token': csrf };

  const stamp = Date.now().toString(36);
  const title = `Mobile team test ${stamp}`;
  const email = `team.${stamp}@college.edu`;
  const departments = await (await page.request.get('/api/v1/departments')).json();
  const departmentId = departments.departments.find((department: { code: string }) => department.code === 'CS').id;
  const registration = await page.request.post('/api/v1/auth/register', {
    headers,
    data: { email, departmentId, password: 'CampusTeamCheck123!', firstName: 'Team', lastName: 'Member' },
  });
  expect(registration.status()).toBe(201);
  const { user } = await registration.json();
  const approval = await page.request.patch(`/api/v1/admin/users/${user.id}/approve`, {
    headers, data: { roles: [{ role: 'STUDENT', departmentId }] },
  });
  expect(approval.ok()).toBe(true);

  const catalog = await page.request.get('/api/v1/venues?limit=9&offset=0');
  expect(catalog.status()).toBe(200);
  const { venues } = await catalog.json();
  const start = new Date();
  start.setDate(start.getDate() + (isMobile ? 41 : 42));
  const booking = await page.request.post('/api/v1/venue-requests', {
    headers, data: {
      venueId: venues[0].id,
      startTime: start.toISOString(),
      endTime: new Date(start.getTime() + 60 * 60_000).toISOString(),
      event: { title, expectedAttendance: 4 },
    },
  });
  expect(booking.status()).toBe(201);
  const { request } = await booking.json();

  await page.goto('/bookings');
  const card = page.getByRole('article').filter({ hasText: title }).filter({
    has: page.getByRole('link', { name: `View booking for ${request.venue.name}` }),
  });
  await card.getByRole('link', { name: `View booking for ${request.venue.name}` }).first().click();
  await page.getByRole('button', { name: 'Event team' }).click();
  const team = page.getByRole('dialog', { name: 'Event team' });
  await expect(team.getByRole('heading', { name: 'Organizers' })).toBeVisible();
  await expect(team.getByText('Owner', { exact: true })).toBeVisible();
  await expect(team.getByLabel('College email')).toHaveCount(0);
  await expect(team.getByLabel('Choose a faculty member')).toHaveCount(0);
  const size = await team.evaluate((dialog) => ({ width: dialog.offsetWidth, height: dialog.offsetHeight }));
  if (isMobile) {
    expect(size).toEqual({ width: 375, height: 812 });
  } else {
    expect(size.width).toBeLessThan(page.viewportSize()!.width);
  }

  await team.getByRole('button', { name: 'Add organizer' }).click();
  await team.getByLabel('College email').fill(email);
  await team.getByRole('button', { name: 'Add organizer' }).click();
  await expect(team.getByText(email, { exact: true })).toBeVisible();
  if (isMobile && process.env.VENUE_CAPTURE) {
    await page.screenshot({ path: testInfo.outputPath('mobile-event-team.png'), animations: 'disabled' });
  }
  await team.getByRole('button', { name: 'Remove Team Member' }).click();
  await expect(team.getByText('Remove Team Member from the event team?')).toBeVisible();
  await team.getByRole('button', { name: 'Remove organizer', exact: true }).click();
  await expect(team.getByText(email, { exact: true })).toHaveCount(0);
  await team.getByRole('button', { name: 'Close dialog' }).click();
  await expect(team).toBeHidden();
  await expect(page.getByRole('button', { name: 'Event team' })).toBeFocused();
});
