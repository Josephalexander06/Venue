import { expect, test, type Page } from '@playwright/test';
import { login, loginAsAdmin } from './helpers/auth.js';

test.setTimeout(180_000);

test('sign-out hides the overview while a late statistics request is rejected', async ({ page }) => {
  let releaseStats = () => {};
  const statsGate = new Promise<void>((resolve) => { releaseStats = resolve; });
  let releaseLogout = () => {};
  const logoutGate = new Promise<void>((resolve) => { releaseLogout = resolve; });

  await page.route('**/api/v1/admin/stats', async (route) => {
    await statsGate;
    await route.continue();
  });
  await page.route('**/api/v1/auth/logout', async (route) => {
    const response = await route.fetch();
    releaseStats();
    await logoutGate;
    await route.fulfill({ response });
  });

  const statsRequested = page.waitForRequest('**/api/v1/admin/stats');
  try {
    await loginAsAdmin(page);
    await expect(page.getByRole('heading', { name: 'Administration overview' })).toBeVisible();
    await statsRequested;

    const statsResponse = page.waitForResponse('**/api/v1/admin/stats');
    await page.getByRole('button', { name: 'Sign out' }).click();
    expect((await statsResponse).status()).toBe(401);
    await expect(page.getByRole('status').getByText('Signing out…')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Administration overview' })).toBeHidden();
    await expect(page.getByText('Could not load account statistics')).toBeHidden();
  } finally {
    releaseStats();
    releaseLogout();
  }

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});

function futureDate(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function register(
  page: Page,
  details: { email: string; firstName: string; lastName: string; password: string },
) {
  await page.goto('/register');
  await page.getByLabel('First name').fill(details.firstName);
  await page.getByLabel('Last name').fill(details.lastName);
  await page.getByLabel('College email').fill(details.email);

  const department = page.getByLabel('Department');
  await expect(department.locator('option', { hasText: 'Computer Science (CS)' })).toHaveCount(1);
  await department.selectOption({ label: 'Computer Science (CS)' });

  await page.getByLabel('Password', { exact: true }).fill(details.password);
  await page.getByLabel('Confirm password').fill(details.password);
  await page.getByRole('button', { name: 'Submit access request' }).click();

  await expect(
    page.getByRole('heading', { name: 'Your account is in the review queue' }),
  ).toBeVisible();
  await expect(page.getByText(details.email)).toBeVisible();
}

async function approveRegistration(page: Page, email: string, role: 'STUDENT' | 'FACULTY') {
  await page.goto('/admin/users');
  await page.getByLabel('Search accounts by name or email').fill(email);

  const participant = page.locator('tr', { hasText: email });
  await expect(participant).toBeVisible();
  await participant.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  if (role === 'FACULTY') {
    await page.getByRole('checkbox', { name: /Student/ }).uncheck();
    await page.getByRole('checkbox', { name: /Faculty/ }).check();
  }

  await page.getByRole('button', { name: 'Approve account' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('registration, approval, booking, endorsement and final allotment journey', async ({
  page,
  context,
}, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}-${Math.random().toString(36).slice(2, 7)}`;
  const studentEmail = `e2e.student.${stamp}@college.edu`;
  const facultyEmail = `e2e.faculty.${stamp}@college.edu`;
  const firstName = 'E2E';
  const studentLastName = `Student${stamp.slice(-4)}`;
  const facultyLastName = `Faculty${stamp.slice(-4)}`;
  const studentPassword = `E2ePass!${Math.random().toString(36).slice(2)}9`;
  const facultyPassword = `E2ePass!${Math.random().toString(36).slice(2)}9`;

  await register(page, {
    email: facultyEmail,
    firstName: 'E2E',
    lastName: facultyLastName,
    password: facultyPassword,
  });
  await register(page, {
    email: studentEmail,
    firstName,
    lastName: studentLastName,
    password: studentPassword,
  });

  await loginAsAdmin(page);
  await expect(page).toHaveURL(/\/admin$/);
  await approveRegistration(page, facultyEmail, 'FACULTY');
  await approveRegistration(page, studentEmail, 'STUDENT');

  await context.clearCookies();
  await login(page, studentEmail, studentPassword);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(firstName);

  await page.getByRole('link', { name: 'Create event' }).click();
  const draft = page.getByRole('dialog', { name: 'Create an event' });
  const draftTitle = `E2E Planning Session ${stamp}`;
  await draft.getByLabel('Event title').fill(draftTitle);
  await draft.getByLabel('Expected attendance').fill('30');
  await draft.getByRole('button', { name: 'Create event' }).click();
  await expect(draft).toBeHidden();
  const draftCard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: draftTitle }) });
  await expect(draftCard.getByRole('link', { name: 'Choose a venue' })).toBeVisible();
  await draftCard.getByRole('button', { name: 'Event team' }).click();
  const teamDialog = page.getByRole('dialog', { name: 'Event team' });
  await expect(teamDialog.getByRole('heading', { name: 'Organizers' })).toBeVisible();
  await teamDialog.getByRole('button', { name: 'Done' }).click();
  await page.goto('/home');

  await page.getByRole('link', { name: 'Browse campus venues' }).click();
  await expect(page.getByRole('heading', { name: 'Find the right space' })).toBeVisible();
  await page.getByRole('link', { name: 'Main Auditorium' }).click();
  await expect(page.getByRole('heading', { name: 'Main Auditorium' })).toBeVisible();
  await expect(page.getByText('Pending requests do not guarantee the venue.')).toBeVisible();

  const title = `E2E Robotics Showcase ${stamp}`;
  await page.getByLabel('Event title').fill(title);
  await page.getByLabel('Description').fill('End-to-end booking flow verification.');
  await page.getByLabel('Expected attendance').fill('45');
  await page
    .getByLabel('Designated faculty coordinator')
    .selectOption({ label: `E2E ${facultyLastName} (${facultyEmail})` });
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

  // Faculty coordinator endorses the student's request.
  await context.clearCookies();
  await login(page, facultyEmail, facultyPassword);
  await page.goto('/approvals');
  const facultyCard = page.getByRole('row').filter({ hasText: title });
  await expect(facultyCard).toBeVisible();
  await facultyCard.getByRole('link', { name: 'Review & decide' }).click();
  await page.getByRole('button', { name: 'Record decision' }).first().click();
  await page.getByRole('button', { name: 'Approve stage' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Administrator completes the HOD step, the final approval step and the allotment.
  await context.clearCookies();
  await loginAsAdmin(page);
  await page.goto('/approvals');
  const queueSearch = page.getByRole('searchbox', { name: 'Search event, venue or department' });
  await queueSearch.fill('unique-title-with-no-matches');
  await expect(page.getByRole('heading', { name: 'No matching requests' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await queueSearch.fill(title);
  const adminCard = page.getByRole('row').filter({ hasText: title });
  await expect(adminCard).toBeVisible();
  await adminCard.getByRole('link', { name: 'Review & decide' }).click();

  await page.getByRole('button', { name: 'Record decision' }).first().click();
  await page.getByRole('button', { name: 'Approve stage' }).click();
  await expect(page.getByText(/Venue allotment \(Administrator/)).toBeVisible();

  await page.getByRole('button', { name: 'Record decision' }).first().click();
  await page.getByRole('button', { name: 'Approve stage' }).click();
  await expect(page.getByText('Ready for final venue allotment')).toBeVisible();

  await page.getByRole('link', { name: 'Back to inbox' }).click();
  await page.getByRole('button', { name: /Ready to allot/ }).click();
  await page.getByRole('row').filter({ hasText: title }).getByRole('link', { name: /Review & allot/ }).click();

  await page.getByRole('button', { name: 'Confirm & Allot Venue' }).first().click();
  await page.getByLabel('Administrative reason').fill('Approved by administrator for E2E verification.');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm & Allot Venue' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Confirmed Venue Reservation')).toBeVisible();

  // The organizer sees the confirmed booking and can release the slot.
  await context.clearCookies();
  await login(page, studentEmail, studentPassword);
  await page.goto('/my-events');
  const eventCard = page.locator('.event-card', { hasText: title });
  await expect(eventCard.getByText('Confirmed. The venue is reserved for this event.')).toBeVisible();
  await eventCard.getByRole('button', { name: 'Cancel booking' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel booking' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(eventCard.getByText('Cancelled', { exact: true }).first()).toBeVisible();
});
