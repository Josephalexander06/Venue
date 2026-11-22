import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { getAdminCredentials, login, loginAsAdmin } from './helpers/auth.js';

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

test('venue search checks the selected date and carries the slot into the request', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/venues');

  await page.getByRole('button', { name: 'Open date calendar' }).click();
  const calendar = page.getByRole('dialog', { name: 'Choose a date' });
  await expect(calendar.getByRole('button', { pressed: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(calendar).toBeHidden();
  const date = futureDate(2);
  await expect(page.getByLabel('Event date')).toHaveValue(date);

  await page.getByLabel('Start time').fill('09:15');
  await page.getByLabel('End time').fill('09:00');
  await page.getByRole('button', { name: 'Check availability' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose an end time after the start time.');

  await page.getByLabel('End time').fill('11:45');
  await page.getByLabel('Guests').fill('121');
  await page.getByRole('button', { name: 'Check availability' }).click();
  await page.getByRole('searchbox', { name: 'Building' }).fill('Central');
  await page.getByRole('searchbox', { name: 'Facility' }).fill('whiteboard');
  await expect(page.getByRole('heading', { name: 'No venues match these filters' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Facility' }).fill('stage');
  await expect(page.getByRole('list', { name: 'Matching venues' }).getByRole('article')).toHaveCount(1);
  await page.getByRole('link', { name: 'Review this slot for Main Auditorium' }).click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(date);
  await expect(page.getByLabel('Start', { exact: true })).toHaveValue('09:15');
  await expect(page.getByLabel('End', { exact: true })).toHaveValue('11:45');
  await expect(page.getByLabel('Expected attendance')).toHaveValue('121');

  await page.getByRole('link', { name: 'All venues' }).click();
  await expect(page.getByLabel('Event date')).toHaveValue(date);
  await expect(page.getByLabel('Guests')).toHaveValue('121');
  await expect(page.getByRole('link', { name: 'Review this slot for Main Auditorium' })).toBeVisible();
});

async function register(
  page: Page,
  details: { email: string; firstName: string; lastName: string; password: string; department?: string },
) {
  await page.goto('/register');
  await page.getByLabel('First name').fill(details.firstName);
  await page.getByLabel('Last name').fill(details.lastName);
  await page.getByLabel('College email').fill(details.email);

  const department = page.getByLabel('Department');
  const departmentLabel = details.department ?? 'Computer Science (CS)';
  await expect(department.locator('option', { hasText: departmentLabel })).toHaveCount(1);
  await department.selectOption({ label: departmentLabel });

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
    department: 'Mechanical Engineering (ME)',
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
  const title = `E2E Robotics Showcase ${stamp}`;
  await draft.getByLabel('Event title').fill(title);
  await draft.getByLabel('Description').fill('End-to-end booking flow verification.');
  await draft.getByLabel('Expected attendance').fill('121');
  const created = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/api/v1/events'),
  );
  await draft.getByRole('button', { name: 'Create event' }).click();
  const { event } = await (await created).json();
  await expect(page).toHaveURL(new RegExp(`/venues\\?eventId=${event.id}$`));
  await expect(page.getByRole('heading', { name: 'Find the right space' })).toBeVisible();
  await expect(page.getByText(`${title} · 121 expected attendees`)).toBeVisible();
  await expect(page.getByLabel('Guests')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Matching venues' }).getByRole('article')).toHaveCount(1);
  await page.getByLabel('Event date').fill(futureDate());
  await page.getByRole('button', { name: 'Check availability' }).click();
  await page.getByRole('link', { name: 'Review this slot for Main Auditorium' }).click();
  expect(new URL(page.url()).searchParams.get('eventId')).toBe(event.id);
  await expect(page.getByRole('heading', { name: 'Main Auditorium' })).toBeVisible();
  await expect(page.getByText('Pending requests do not guarantee the venue.')).toBeVisible();

  await expect(page.getByLabel('Event title')).toHaveCount(0);
  await expect(page.getByLabel('Expected attendance')).toHaveCount(0);
  await expect(page.getByText('121 expected · Venue capacity 500')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search faculty' }).fill(`${facultyLastName} mechanical`);
  await expect(page.getByRole('option', { name: /Select a faculty member/ })).toBeAttached();
  await expect(page.getByLabel('Designated faculty coordinator').locator('option')).toHaveCount(2);
  await page
    .getByLabel('Designated faculty coordinator')
    .selectOption({ label: `E2E ${facultyLastName} (Mechanical Engineering)` });
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(futureDate());
  await page.getByLabel('End', { exact: true }).fill('11:00');

  await expect(
    page.getByText(/No conflicts found\.|overlapping pending request/),
  ).toBeVisible();
  const summary = page.getByRole('region', { name: 'Booking summary' });
  await expect(summary.getByText('Faculty coordinator endorsement')).toBeVisible();
  await expect(summary.getByText(`${firstName} ${studentLastName}`)).toBeVisible();
  await page.getByRole('button', { name: 'Submit booking request' }).click();

  await expect(page).toHaveURL(/\/my-events\/requests\/[\da-f-]+$/);
  const requestId = new URL(page.url()).pathname.split('/').at(-1);
  await expect(page.getByRole('heading', { name: 'Booking request submitted' })).toBeVisible();
  await expect(page.getByText(requestId!, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Approval history' })).toBeVisible();
  await page.getByRole('link', { name: 'Manage in My events' }).click();
  await expect(page.getByRole('heading', { name: 'My events' })).toBeVisible();
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
  const pendingEventCard = page.locator(`#event-${event.id}`);
  await expect(pendingEventCard.getByRole('button', { name: /^Cancel/ })).toHaveCount(1);
  await expect(pendingEventCard.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  await pendingEventCard.getByRole('button', { name: 'Event team' }).click();
  const teamDialog = page.getByRole('dialog', { name: 'Event team' });
  await expect(teamDialog.getByRole('heading', { name: 'Organizers' })).toBeVisible();
  await teamDialog.getByRole('button', { name: 'Done' }).click();
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
  await expect(page.getByRole('button', { name: 'Approve & Allot Venue' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Record decision' }).first().click();
  await page.getByRole('button', { name: 'Approve stage' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // Administrator completes the HOD step, the final approval step and the allotment.
  await context.clearCookies();
  await loginAsAdmin(page);
  const origin = new URL(page.url()).origin;
  const csrfToken = (await context.cookies(origin)).find((cookie) => cookie.name === 'venue_csrf')?.value;
  const headers = { origin, 'x-csrf-token': csrfToken! };
  const detailResponse = await page.request.get(`/api/v1/venue-requests/${requestId}`);
  expect(detailResponse.ok()).toBe(true);
  const { request } = await detailResponse.json();
  const competingTitle = `Competing booking ${stamp}`;
  const eventResponse = await page.request.post('/api/v1/events', {
    headers, data: { title: competingTitle, expectedAttendance: 25 },
  });
  expect(eventResponse.ok()).toBe(true);
  const competingEvent = (await eventResponse.json()).event;
  const competingRequest = await page.request.post('/api/v1/venue-requests', {
    headers,
    data: { eventId: competingEvent.id, venueId: request.venue.id, startTime: request.startTime, endTime: request.endTime },
  });
  expect(competingRequest.status()).toBe(201);
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

  await page.getByRole('button', { name: 'Approve & Allot Venue' }).click();
  const finalDialog = page.getByRole('dialog', { name: 'Approve & Allot Venue' });
  await expect(finalDialog.getByRole('list', { name: 'Competing requests' })).toContainText(competingTitle);
  await expect(finalDialog.getByText('1 competing request will be superseded')).toBeVisible();
  await expect(finalDialog.getByLabel('Administrative reason')).toHaveCount(0);
  await finalDialog.getByRole('button', { name: 'Approve & Allot Venue' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Confirmed Venue Reservation')).toBeVisible();

  await page.goto(`/venues?date=${futureDate()}&start=10%3A00&end=11%3A00`);
  const hideBooked = page.getByRole('checkbox', { name: 'Hide fully booked venues' });
  await hideBooked.click();
  await expect(hideBooked).toBeChecked();
  const matchingVenues = page.getByRole('list', { name: 'Matching venues' });
  await expect(matchingVenues).toBeVisible();
  await expect(matchingVenues.getByRole('heading', { name: 'Main Auditorium' })).toHaveCount(0);
  await hideBooked.click();
  await expect(hideBooked).not.toBeChecked();
  await page.getByRole('link', { name: 'Find another time for Main Auditorium' }).click();
  await expect(page.getByText('This slot is already confirmed.')).toBeVisible();
  await page.getByRole('button', { name: /Check 13:00/ }).click();
  await expect(page.getByLabel('Start', { exact: true })).toHaveValue('13:00');
  await expect(page.getByText('No conflicts found.')).toBeVisible();

  // The organizer sees the confirmed booking and can release the slot.
  await context.clearCookies();
  await login(page, studentEmail, studentPassword);
  await page.goto('/my-events');
  const eventCard = page.locator('.event-card', { hasText: title });
  await expect(eventCard.getByText('Confirmed. The venue is reserved for this event.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await eventCard.getByRole('link', { name: 'View confirmation' }).click();
  await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
  await expect(page.getByText('Reserved window', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.getByRole('link', { name: 'Manage in My events' }).click();
  await expect(eventCard.getByRole('button', { name: /^Cancel/ })).toHaveCount(1);
  await eventCard.getByRole('button', { name: 'Cancel booking' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel booking' })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(eventCard.getByText('Cancelled', { exact: true }).first()).toBeVisible();
});

test('shows the capacity empty state and one cancellation action for a draft', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/my-events?create=1');
  const draft = page.getByRole('dialog', { name: 'Create an event' });
  const title = `Capacity check ${Date.now()}`;
  await draft.getByLabel('Event title').fill(title);
  await draft.getByLabel('Expected attendance').fill('10000');
  await draft.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('heading', { name: 'No venues fit this event' })).toBeVisible();
  await expect(page.getByText('No available venue can hold 10000 people.')).toBeVisible();
  await page.getByRole('link', { name: 'My events' }).first().click();
  const event = page.locator('.event-card', { hasText: title });
  await expect(event.getByRole('button', { name: /^Cancel/ })).toHaveCount(1);
  await expect(event.getByRole('button', { name: 'Cancel event' })).toBeVisible();
});

async function checked<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function apiSession(client: APIRequestContext, credentials: { email: string; password: string }) {
  const { csrfToken } = await checked<{ csrfToken: string }>(await client.post('/api/v1/auth/login', { data: credentials }));
  return { 'x-csrf-token': csrfToken };
}

const roleFixtures = {
  student: ['STUDENT', 'CS'], faculty: ['FACULTY', 'ME'], hod: ['HOD', 'ME'],
  bursar: ['BURSAR', 'ADMIN'], principal: ['PRINCIPAL', 'ADMIN'],
} as const;

test.describe('scoped approval and concurrent booking', () => {
  const accounts = new Map<keyof typeof roleFixtures, { id: string; email: string; password: string }>();
  const stamp = Date.now().toString(36);
  let routedVenueId: string;
  let competingVenueId: string;

  test.beforeAll(async ({ playwright, baseURL }) => {
    const client = await playwright.request.newContext({ baseURL });
    try {
      const headers = await apiSession(client, getAdminCredentials());
      const { departments } = await checked<{ departments: Array<{ id: string; code: string }> }>(await client.get('/api/v1/departments'));
      const departmentIds = new Map(departments.map(({ id, code }) => [code, id]));
      for (const actor of Object.keys(roleFixtures) as Array<keyof typeof roleFixtures>) {
        const [role, department] = roleFixtures[actor];
        const departmentId = departmentIds.get(department)!;
        const email = `booking.${actor}.${stamp}@college.edu`;
        const password = 'BrowserBookingQa!123';
        const { user } = await checked<{ user: { id: string } }>(await client.post('/api/v1/auth/register', {
          data: { email, password, departmentId, firstName: 'Booking QA', lastName: role },
        }), 201);
        await checked(await client.patch(`/api/v1/admin/users/${user.id}/approve`, {
          headers, data: { roles: [{ role, departmentId: department === 'ADMIN' ? null : departmentId }] },
        }));
        accounts.set(actor, { id: user.id, email, password });
      }

      async function createVenue(label: string, steps: Array<'HOD' | 'BURSAR' | 'PRINCIPAL'>) {
        const { workflow } = await checked<{ workflow: { id: string } }>(await client.post('/api/v1/admin/workflows', {
          headers,
          data: { name: `${label} ${stamp}`, steps: steps.map((role, index) => ({
            requiredRole: role, stepName: `${role} review`, scopeType: role === 'HOD' ? 'CREATOR_DEPARTMENT' : 'COLLEGE_WIDE',
            isFinalAllotmentStep: index === steps.length - 1,
          })) },
        }), 201);
        const { venue } = await checked<{ venue: { id: string } }>(await client.post('/api/v1/admin/venues', {
          headers,
          data: { code: `QA-${label}-${stamp}`, name: `QA ${label}`, building: 'Engineering', floor: 0, capacity: 45,
            departmentId: departmentIds.get('ME'), workflowId: workflow.id },
        }), 201);
        return venue.id;
      }
      [routedVenueId, competingVenueId] = await Promise.all([
        createVenue('ROUTING', ['HOD', 'BURSAR', 'PRINCIPAL']),
        createVenue('CONFLICT', ['BURSAR']),
      ]);
    } finally {
      await client.dispose();
    }
  });

  async function createBooking(client: APIRequestContext, title: string, venueId: string, actor: 'student' | 'faculty') {
    const headers = await apiSession(client, accounts.get(actor)!);
    const { event } = await checked<{ event: { id: string } }>(await client.post('/api/v1/events', {
      headers, data: { title, expectedAttendance: 30, facultyCoordinatorId: actor === 'student' ? accounts.get('faculty')!.id : undefined },
    }), 201);
    const { request } = await checked<{ request: { id: string } }>(await client.post('/api/v1/venue-requests', {
      headers, data: { eventId: event.id, venueId, startTime: `${futureDate(37)}T10:00:00+05:30`, endTime: `${futureDate(37)}T11:00:00+05:30` },
    }), 201);
    return request.id;
  }

  async function switchRole(page: Page, actor: keyof typeof roleFixtures) {
    await page.context().clearCookies();
    const { email, password } = accounts.get(actor)!;
    await login(page, email, password);
  }

  test('routes cross-department endorsement through the venue HOD, Bursar and Principal', async ({ page, request }) => {
    const title = `Cross-department QA ${stamp}`;
    const requestId = await createBooking(request, title, routedVenueId, 'student');
    for (const actor of ['faculty', 'hod', 'bursar', 'principal'] as const) {
      await switchRole(page, actor);
      await page.goto('/approvals');
      await page.getByRole('row').filter({ hasText: title }).getByRole('link', { name: 'Review & decide' }).click();
      if (actor === 'principal') {
        await page.getByRole('button', { name: 'Approve & Allot Venue' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Approve & Allot Venue' }).click();
        await expect(page.getByText('Confirmed Venue Reservation')).toBeVisible();
      } else {
        await page.getByRole('button', { name: 'Record decision' }).first().click();
        await page.getByRole('button', { name: 'Approve stage' }).click();
        await expect(page.getByRole('dialog')).toBeHidden();
      }
    }
    await switchRole(page, 'student');
    await page.goto(`/my-events/requests/${requestId}`);
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Approval history' })).toBeVisible();
  });

  test('lets only one concurrent browser allotment reserve a competing slot', async ({ page, request }) => {
    const titles = [`Competing A ${stamp}`, `Competing B ${stamp}`];
    const ids: string[] = [];
    for (const title of titles) ids.push(await createBooking(request, title, competingVenueId, 'faculty'));
    await switchRole(page, 'bursar');
    const tabs = [page, await page.context().newPage()];
    const action = 'Approve & Allot Venue';
    await Promise.all(tabs.map(async (tab, index) => {
      await tab.goto(`/approvals/${ids[index]}`);
      await tab.getByRole('button', { name: action }).click();
      await expect(tab.getByRole('dialog').getByRole('list', { name: 'Competing requests' })).toContainText(titles[1 - index]!);
    }));
    const statuses = await Promise.all(tabs.map(async (tab) => {
      const response = tab.waitForResponse((res) => res.url().endsWith('/approve-and-allot') && res.request().method() === 'POST');
      await tab.getByRole('dialog').getByRole('button', { name: action }).click();
      return (await response).status();
    }));
    expect([...statuses].sort()).toEqual([200, 409]);
    await expect(tabs[statuses.indexOf(200)]!.getByText('Confirmed Venue Reservation')).toBeVisible();
    await switchRole(page, 'faculty');
    await page.goto(`/my-events/requests/${ids[statuses.indexOf(409)]}`);
    await expect(page.getByText('The venue was allotted to another event. You can choose a new slot in My events.')).toBeVisible();
  });
});
