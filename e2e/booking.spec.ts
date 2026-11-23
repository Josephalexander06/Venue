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
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible();
    await statsRequested;

    await page.getByRole('link', { name: 'My account' }).click();
    const statsResponse = page.waitForResponse('**/api/v1/admin/stats');
    await page.getByRole('button', { name: 'Sign out' }).click();
    expect((await statsResponse).status()).toBe(401);
    await expect(page.getByRole('status').getByText('Signing out…')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeHidden();
    await expect(page.getByText('Could not load pending registrations')).toBeHidden();
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

test('venue search carries the selected date into the booking and supports multi-slot selection', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/venues');
  const date = futureDate();
  await page.getByLabel('Date', { exact: true }).fill(date);
  await page.getByRole('searchbox', { name: 'Search venues' }).fill('Main Auditorium');
  await expect(page.locator('.catalog-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Check slots for Main Auditorium' }).click();
  await expect(page).toHaveURL(new RegExp(`date=${date}`));
  const slots = page.getByRole('group', { name: 'Hourly time slots' });
  await slots.getByRole('button', { name: /9–10 AM Open/ }).click();
  await slots.getByRole('button', { name: /10–11 AM Open/ }).click();
  await expect(slots.getByRole('button', { pressed: true })).toHaveCount(2);
  await expect(page.locator('.reservation-selection')).toContainText('9–11 AM');
  await page.getByText('Choose a custom time').click();
  await page.getByLabel('Start time', { exact: true }).fill('09:15');
  await expect(page.locator('.reservation-selection')).toContainText('9:15–11 AM');
  await page.getByRole('link', { name: 'All venues' }).click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(date);
});

async function register(page: Page, name: string, email: string, password: string) {
  await page.goto('/register');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('College email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Request access' }).click();
  await expect(page.getByRole('heading', { name: 'Your account is under review' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
}

async function approveRegistration(page: Page, email: string, role: 'STUDENT' | 'FACULTY') {
  await page.goto('/admin/users');
  await page.getByLabel('Search accounts by name or email').fill(email);
  const participant = page.getByRole('article').filter({ hasText: email });
  await participant.getByRole('button', { name: 'Review and approve' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Department', { exact: true }).selectOption({ label: 'Computer Science' });
  if (role === 'FACULTY') {
    await dialog.getByRole('checkbox', { name: /Student/ }).uncheck();
    await dialog.getByRole('checkbox', { name: /Faculty/ }).check();
  }
  await dialog.getByRole('button', { name: 'Approve account' }).click();
  await expect(dialog).toBeHidden();
}

test('registration, browse-only access, venue-first booking, endorsement and allotment journey', async ({ browser, page }) => {
  const stamp = Date.now().toString(36);
  const student = await browser.newPage();
  const faculty = await browser.newPage();
  const password = 'BrowserVenue!2026';
  const studentEmail = `student.${stamp}@college.edu`;
  const facultyEmail = `faculty.${stamp}@college.edu`;
  const title = `Student workshop ${stamp}`;

  try {
    await register(student, 'Ada Student', studentEmail, password);
    await register(faculty, 'Grace Coordinator', facultyEmail, password);
    await student.getByRole('link', { name: 'Browse venues' }).click();
    await student.getByRole('link', { name: 'Check slots for Main Auditorium' }).click();
    await expect(student.getByText('Booking opens after approval')).toBeVisible();
    await expect(student.getByRole('button', { name: 'Request venue' })).toHaveCount(0);
    await student.getByRole('link', { name: 'View account status' }).click();

    await loginAsAdmin(page);
    await approveRegistration(page, facultyEmail, 'FACULTY');
    await approveRegistration(page, studentEmail, 'STUDENT');
    await expect(student).toHaveURL(/\/home$/, { timeout: 20_000 });
    await expect(faculty).toHaveURL(/\/home$/, { timeout: 20_000 });
    await student.getByRole('link', { name: 'Book a venue' }).click();
    await student.getByLabel('Date', { exact: true }).fill(futureDate(31));
    await student.getByRole('link', { name: 'Check slots for Main Auditorium' }).click();
    await student.getByRole('group', { name: 'Hourly time slots' }).getByRole('button', { name: /10–11 AM Open/ }).click();
    await expect(student.getByLabel('Event name')).toHaveCount(0);
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(student.getByRole('group', { name: 'Hourly time slots' })).toHaveCount(0);
    await expect(student.getByLabel('Event name')).toHaveAttribute('required', '');
    await student.getByLabel('Attendees').fill('30');
    await student.getByLabel('Event name').fill(title);
    const coordinator = student.getByLabel('Faculty coordinator', { exact: true });
    const department = student.getByLabel('Faculty department', { exact: true });
    await expect(coordinator).toBeDisabled();
    await department.selectOption({ label: 'Computer Science' });
    await coordinator.selectOption({ label: 'Grace Coordinator' });
    await student.getByRole('button', { name: 'Change date or time' }).click();
    await expect(student.getByRole('button', { name: /10–11 AM Open/, pressed: true })).toBeVisible();
    await student.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(department).not.toHaveValue('');
    await expect(coordinator).not.toHaveValue('');
    const submitted = student.waitForResponse((response) => response.url().endsWith('/venue-requests') && response.request().method() === 'POST');
    await student.getByRole('button', { name: 'Request venue' }).click();
    const { request } = await checked<{ request: { id: string; venue: { id: string } } }>(await submitted, 201);
    await expect(student).toHaveURL(/\/bookings\/[\da-f-]+$/);
    await expect(student.getByRole('heading', { name: 'Progress' })).toBeVisible();
    await expect(student.getByText('Booking details', { exact: true })).toHaveCount(0);
    await expect(student.getByRole('link', { name: 'Modify booking' })).toBeVisible();

    await faculty.reload();
    const primary = faculty.getByRole('navigation', { name: 'Primary', exact: true });
    const desktopLink = primary.getByRole('link', { name: 'Incoming requests, 1 pending' });
    await desktopLink.click();
    await expect(faculty.getByRole('heading', { name: /Incoming requests/ })).toBeVisible();
    await primary.getByRole('link', { name: 'Home', exact: true }).click();
    await faculty.setViewportSize({ width: 375, height: 812 });
    const mobileNav = faculty.getByRole('navigation', { name: 'Primary mobile' });
    const mobileLink = mobileNav.getByRole('link', { name: 'Incoming requests, 1 pending' });
    await mobileLink.click();
    const card = faculty.getByRole('article').filter({ hasText: title });
    await card.getByRole('button', { name: 'Endorse' }).click();
    await expect(card).toHaveCount(0);
    await expect(mobileNav.getByRole('link', { name: 'Requests', exact: true })).toBeVisible();
    await faculty.getByRole('button', { name: 'Decided' }).click();
    await expect(card).toBeVisible();

    await page.goto(`/approvals/${request.id}`);
    const approved = page.waitForResponse((response) => response.url().endsWith('/decision'));
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    expect((await approved).ok()).toBe(true);
    await page.getByRole('button', { name: 'Approve and confirm' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm allotment' }).click();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();

    await student.reload();
    await expect(student.locator('.booking-progress')).toContainText('Confirmed');
    await student.goto(`/venues/${request.venue.id}?date=${futureDate(31)}`);
    await expect(student.getByRole('group', { name: 'Hourly time slots' }).getByRole('button', { name: /10–11 AM Booked/ })).toBeDisabled();
  } finally {
    await Promise.all([student.close(), faculty.close()]);
  }
});

test('keeps existing draft event links and capacity filtering usable', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/my-events?create=1');
  const draft = page.getByRole('dialog', { name: 'Create an event' });
  const title = `Oversized draft ${Date.now()}`;
  await draft.getByLabel('Event title').fill(title);
  await draft.getByLabel('Expected attendance').fill('10000');
  await draft.getByRole('button', { name: 'Create event' }).click();
  await expect(page.getByRole('heading', { name: 'No venues fit this event' })).toBeVisible();
  await page.goto('/bookings/events');
  const event = page.locator('.event-card').filter({ hasText: title });
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
  let departmentVenueId: string;

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
      [routedVenueId, competingVenueId, departmentVenueId] = await Promise.all([
        createVenue('ROUTING', ['HOD', 'BURSAR', 'PRINCIPAL']),
        createVenue('CONFLICT', ['BURSAR']),
        createVenue('DEPARTMENT', ['HOD']),
      ]);
    } finally {
      await client.dispose();
    }
  });

  async function createBooking(client: APIRequestContext, title: string, venueId: string, actor: 'student' | 'faculty', dayOffset = 37) {
    const headers = await apiSession(client, accounts.get(actor)!);
    const { event } = await checked<{ event: { id: string } }>(await client.post('/api/v1/events', {
      headers, data: { title, expectedAttendance: 30, facultyCoordinatorId: actor === 'student' ? accounts.get('faculty')!.id : undefined },
    }), 201);
    const { request } = await checked<{ request: { id: string } }>(await client.post('/api/v1/venue-requests', {
      headers, data: { eventId: event.id, venueId, startTime: `${futureDate(dayOffset)}T10:00:00+05:30`, endTime: `${futureDate(dayOffset)}T11:00:00+05:30` },
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
      if (actor === 'faculty') await page.goto('/approvals');
      else {
        await expect(page).toHaveURL(/\/approvals$/);
        await expect(page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: 'My bookings' })).toHaveCount(0);
      }
      await page.getByRole('article').filter({ hasText: title }).getByRole('link', { name: actor === 'principal' ? 'Review allotment' : 'Details' }).click();
      if (actor === 'principal') {
        await page.getByRole('button', { name: 'Approve and confirm' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Confirm allotment' }).click();
        await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
      } else {
        const decision = page.waitForResponse((response) => response.url().endsWith('/decision'));
        await page.getByRole('button', { name: actor === 'faculty' ? 'Endorse' : 'Approve', exact: true }).click();
        expect((await decision).ok()).toBe(true);
      }
    }
    await switchRole(page, 'student');
    await page.goto(`/my-events/requests/${requestId}`);
    await expect(page.locator('.booking-progress')).toContainText('Confirmed');
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  });

  test('a HOD can compare all overlaps and choose a later request on mobile', async ({ page, request }) => {
    const titles = [`Club meetup ${stamp}`, `Practice session ${stamp}`, `Scheduled assessment ${stamp}`];
    const ids: string[] = [];
    for (const title of titles) ids.push(await createBooking(request, title, departmentVenueId, 'faculty'));

    await page.setViewportSize({ width: 375, height: 812 });
    await switchRole(page, 'hod');
    const navigation = page.getByRole('navigation', { name: 'Primary mobile' });
    await navigation.getByRole('link', { name: 'Department' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mechanical Engineering' })).toBeVisible();
    await page.getByLabel('Search users').fill(accounts.get('faculty')!.email);
    await expect(page.getByText(accounts.get('faculty')!.email, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Venues', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'QA DEPARTMENT' })).toBeVisible();
    await navigation.getByRole('link', { name: 'Approvals', exact: true }).click();
    await page.getByRole('button', { name: 'Overlaps', exact: true }).click();
    await page.getByRole('article').filter({ hasText: titles[0]! }).getByRole('link', { name: 'Compare requests' }).click();
    const comparison = page.getByRole('region', { name: 'Compare competing requests' });
    for (const title of titles) await expect(comparison.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and confirm' })).toBeDisabled();

    await comparison.getByRole('link', { name: `Review ${titles[2]}` }).click();
    await expect(page).toHaveURL(new RegExp(ids[2]!));
    await comparison.getByRole('button', { name: 'Choose this request' }).click();
    await page.getByRole('button', { name: 'Approve and confirm' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm allotment' });
    await dialog.getByLabel('Why this request has priority').fill('Scheduled assessment required for graduating students.');
    await dialog.getByRole('button', { name: 'Confirm allotment' }).click();
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
    await page.goto(`/approvals/${ids[0]}`);
    await expect(page.getByText('Superseded', { exact: true }).first()).toBeVisible();
  });

  test('Bursar and Principal compare student and faculty bookings for the same venue', async ({ page, request }) => {
    const facultyTitle = `Faculty seminar ${stamp}`;
    const studentTitle = `Student assessment ${stamp}`;
    const facultyId = await createBooking(request, facultyTitle, routedVenueId, 'faculty', 43);
    const studentId = await createBooking(request, studentTitle, routedVenueId, 'student', 43);
    const endorse = await apiSession(request, accounts.get('faculty')!);
    await checked(await request.post(`/api/v1/approvals/${studentId}/decision`, { headers: endorse, data: { decision: 'APPROVED' } }));
    const recommend = async (actor: 'hod' | 'bursar', target: string, competitor: string) => {
      const headers = await apiSession(request, accounts.get(actor)!);
      await checked(await request.post(`/api/v1/approvals/${target}/decision`, {
        headers, data: { decision: 'APPROVED', comments: 'Reviewed for the next approval stage.', reviewedCompetingRequestIds: [competitor] },
      }));
    };
    await recommend('hod', studentId, facultyId);
    await recommend('hod', facultyId, studentId);

    const comparison = page.getByRole('region', { name: 'Compare competing requests' });
    const student = comparison.getByRole('article').filter({ has: page.getByRole('heading', { name: studentTitle }) });
    const faculty = comparison.getByRole('article').filter({ has: page.getByRole('heading', { name: facultyTitle }) });
    const checkPeople = async () => {
      const studentRequester = student.locator('dl[aria-label="Booking participants"] > div').filter({ hasText: 'Student requester' });
      const coordinator = student.locator('dl[aria-label="Booking participants"] > div').filter({ hasText: 'Faculty coordinator' });
      await expect(studentRequester).toContainText('Booking QA STUDENT');
      await expect(studentRequester).toContainText('Computer Science');
      await expect(coordinator).toContainText('Booking QA FACULTY');
      await expect(coordinator).toContainText('Mechanical Engineering');
      await expect(faculty.getByText('Faculty requester', { exact: true })).toBeVisible();
      await expect(faculty).toContainText('Booking QA FACULTY');
      await expect(faculty).toContainText('Mechanical Engineering');
      await expect(faculty.getByText('Faculty coordinator', { exact: true })).toHaveCount(0);
    };
    const openComparison = async () => {
      await page.getByRole('button', { name: 'Overlaps', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'QA ROUTING', exact: true })).toBeVisible();
      await page.getByRole('article').filter({ hasText: studentTitle }).getByRole('link', { name: 'Compare requests' }).click();
      await checkPeople();
    };

    await switchRole(page, 'bursar');
    await openComparison();
    const recommendation = page.getByRole('button', { name: 'Approve with recommendation' });
    await expect(recommendation).toBeDisabled();
    await student.getByRole('button', { name: 'Choose this request' }).click();
    await expect(recommendation).toBeDisabled();
    const bursarNote = 'The student assessment has a fixed academic timetable.';
    await page.getByLabel('Why this request has priority').fill(bursarNote);
    const bursarDecision = page.waitForResponse(`**/api/v1/approvals/${studentId}/decision`);
    await recommendation.click();
    expect((await bursarDecision).ok()).toBe(true);
    await recommend('bursar', facultyId, studentId);

    await page.setViewportSize({ width: 375, height: 812 });
    await switchRole(page, 'principal');
    await openComparison();
    await expect(student).toContainText(bursarNote);
    await expect(page.getByRole('button', { name: 'Approve and confirm' })).toBeDisabled();
    await student.getByRole('button', { name: 'Choose this request' }).click();
    await page.getByRole('button', { name: 'Approve and confirm' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm allotment' });
    await dialog.getByLabel('Why this request has priority').fill('The scheduled student assessment needs this room.');
    await dialog.getByRole('button', { name: 'Confirm allotment' }).click();
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
    await page.goto(`/approvals/${facultyId}`);
    await expect(page.getByText('Superseded', { exact: true }).first()).toBeVisible();
  });

  test('lets only one concurrent browser allotment reserve a competing slot', async ({ page, request }) => {
    const titles = [`Competing A ${stamp}`, `Competing B ${stamp}`];
    const ids: string[] = [];
    for (const title of titles) ids.push(await createBooking(request, title, competingVenueId, 'faculty'));
    await switchRole(page, 'bursar');
    const tabs = [page, await page.context().newPage()];
    const action = 'Approve and confirm';
    await Promise.all(tabs.map(async (tab, index) => {
      await tab.goto(`/approvals/${ids[index]}`);
      await expect(tab.getByRole('button', { name: action })).toBeDisabled();
      await tab.getByRole('button', { name: 'Choose this request' }).click();
      await tab.getByRole('button', { name: action }).click();
      await tab.getByRole('dialog').getByLabel('Why this request has priority').fill('Priority campus activity for scheduled participants.');
      await expect(tab.getByRole('dialog').getByRole('list', { name: 'Competing requests' })).toContainText(titles[1 - index]!);
    }));
    const statuses = await Promise.all(tabs.map(async (tab) => {
      const response = tab.waitForResponse((res) => res.url().endsWith('/approve-and-allot') && res.request().method() === 'POST');
      await tab.getByRole('dialog').getByRole('button', { name: 'Confirm allotment' }).click();
      return (await response).status();
    }));
    expect([...statuses].sort()).toEqual([200, 409]);
    await expect(tabs[statuses.indexOf(200)]!.getByText('Confirmed', { exact: true })).toBeVisible();
    await switchRole(page, 'faculty');
    await page.goto(`/my-events/requests/${ids[statuses.indexOf(409)]}`);
    await expect(page.locator('.booking-progress')).toBeVisible();
  });
});
