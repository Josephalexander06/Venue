import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { RoleName } from '../packages/shared/src/index.js';
import { getAdminCredentials } from './helpers/auth.js';

test.skip(!process.env.VENUE_CAPTURE, 'Set VENUE_CAPTURE=1 to capture screenshots in an isolated E2E database.');

async function call<T>(
  context: BrowserContext,
  origin: string,
  path: string,
  options?: { method: 'POST' | 'PATCH'; data: unknown },
): Promise<T> {
  const csrf = (await context.cookies(origin)).find((cookie) => cookie.name === 'venue_csrf')?.value;
  const response = await context.request.fetch(`${origin}/api/v1${path}`, {
    ...options,
    headers: { origin, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
  });
  expect(response.ok(), `${options?.method ?? 'GET'} ${path} (${response.status()})`).toBe(true);
  return response.json();
}

test('capture rendered workspaces with booking data', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('A local application URL is required.');
  const origin: string = baseURL;
  const browserOptions = { viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Kolkata', reducedMotion: 'reduce' as const };
  const admin = await browser.newContext(browserOptions);
  const student = await browser.newContext(browserOptions);
  const faculty = await browser.newContext(browserOptions);
  const reviewer = await browser.newContext(browserOptions);
  const stamp = Date.now();
  const password = `Sample!Booking${stamp}`;
  const signIn = async (context: BrowserContext, data: { email: string; password: string }) => {
    await call(context, origin, '/departments');
    await call(context, origin, '/auth/login', { method: 'POST', data });
  };

  async function capture(page: Page, name: string, path: string, heading: string | RegExp, ready?: string) {
    await page.goto(`${origin}${path}`);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    if (ready) await expect(page.locator(ready).first()).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(width, `${name} horizontal overflow`).toBeLessThanOrEqual(1);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' });
  }

  try {
    const adminPage = await admin.newPage();
    await capture(adminPage, 'desktop-login', '/login', /Sign in/);
    await capture(adminPage, 'desktop-registration', '/register', 'Request an account');
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await capture(adminPage, 'mobile-login', '/login', /Sign in/);
    await adminPage.setViewportSize(browserOptions.viewport);
    await signIn(admin, getAdminCredentials());
    const { departments } = await call<{ departments: { id: string; code: string }[] }>(admin, origin, '/departments');
    const departmentId = departments.find(({ code }) => code === 'CS')!.id;

    async function createUser(firstName: string, lastName: string, role?: RoleName) {
      const email = `capture.${firstName.toLowerCase()}.${stamp}@college.edu`;
      const { user } = await call<{ user: { id: string } }>(admin, origin, '/auth/register', {
        method: 'POST', data: { firstName, lastName, email, password, departmentId },
      });
      if (role) {
        await call(admin, origin, `/admin/users/${user.id}/approve`, {
          method: 'PATCH', data: { roles: [{ role, departmentId: ['PRINCIPAL', 'BURSAR'].includes(role) ? null : departmentId }] },
        });
      }
      return { id: user.id, email, password };
    }

    const studentUser = await createUser('Anika', 'Rao', 'STUDENT');
    const facultyUser = await createUser('Leena', 'Menon', 'FACULTY');
    await createUser('Nisha', 'Varghese');

    await signIn(student, studentUser);
    await signIn(faculty, facultyUser);
    const { venues } = await call<{ venues: { id: string; name: string }[] }>(admin, origin, '/venues');
    const auditorium = venues.find(({ name }) => name === 'Main Auditorium')!;
    const studio = venues.find(({ id }) => id !== auditorium.id)!;

    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 4);
    const day = eventDate.toISOString().slice(0, 10);
    const requests = [
      { title: 'Robotics project showcase', venue: auditorium, time: '10:00', end: '12:00', size: 120, owner: student },
      { title: 'Intercollegiate debate', venue: auditorium, time: '11:30', end: '13:00', size: 80, owner: student },
      { title: 'Student research poster session', venue: studio, time: '14:00', end: '15:00', size: 25, owner: student },
      { title: 'Department orientation', venue: auditorium, time: '15:30', end: '16:30', size: 60, owner: faculty },
    ];

    let detailPath = '/approvals';
    let readyPath = '/approvals';
    for (const event of requests) {
      const { event: created } = await call<{ event: { id: string } }>(event.owner, origin, '/events', {
        method: 'POST',
        data: {
          title: event.title,
          description: 'A campus event for students and faculty with a short introduction and time for questions.',
          expectedAttendance: event.size,
          facultyCoordinatorId: event.owner === student ? facultyUser.id : undefined,
        },
      });
      const { request } = await call<{ request: { id: string } }>(event.owner, origin, '/venue-requests', {
        method: 'POST',
        data: {
          eventId: created.id,
          venueId: event.venue.id,
          startTime: `${day}T${event.time}:00+05:30`,
          endTime: `${day}T${event.end}:00+05:30`,
        },
      });
      if (event === requests[0]) detailPath = `/approvals/${request.id}`;
      if (event.owner === faculty) {
        readyPath = `/approvals/${request.id}`;
        for (const step of ['Department endorsement', 'Final approval']) {
          await call(admin, origin, `/approvals/${request.id}/decision`, {
            method: 'POST', data: { decision: 'APPROVED', comments: `${step} recorded.` },
          });
        }
      }
    }

    if (process.env.VENUE_CAPTURE === 'baseline') {
      await capture(adminPage, 'desktop-approvals', '/approvals', 'Approval inbox', '.queue-table tbody tr');
      await adminPage.setViewportSize({ width: 390, height: 844 });
      await capture(adminPage, 'mobile-approvals', '/approvals', 'Approval inbox', '.queue-table tbody tr');
      return;
    }

    await capture(adminPage, 'desktop-admin', '/admin', /overview/i, '.review-row');
    await capture(adminPage, 'desktop-approvals', '/approvals', 'Approval inbox', '.queue-table tbody tr');
    await capture(adminPage, 'desktop-approval-detail', detailPath, 'Robotics project showcase', '.comparison-grid');
    await adminPage.goto(`${origin}${readyPath}`);
    await adminPage.getByRole('button', { name: 'Confirm & Allot Venue' }).click();
    await expect(adminPage.getByRole('dialog', { name: 'Confirm venue allotment' })).toBeVisible();
    await adminPage.screenshot({ path: testInfo.outputPath('desktop-allotment.png'), animations: 'disabled' });

    const approvalStages = [
      { role: 'HOD', firstName: 'Arjun', stepName: 'Department review', scopeType: 'CREATOR_DEPARTMENT' },
      { role: 'BURSAR', firstName: 'Dev', stepName: 'Facilities review', scopeType: 'COLLEGE_WIDE' },
      { role: 'PRINCIPAL', firstName: 'Elizabeth', stepName: 'Final approval', scopeType: 'COLLEGE_WIDE' },
    ] as const;
    const { workflow } = await call<{ workflow: { id: string } }>(admin, origin, '/admin/workflows', {
      method: 'POST',
      data: {
        name: `Academic events ${stamp}`,
        steps: approvalStages.map((stage, index) => ({
          stepOrder: index + 1,
          stepName: stage.stepName,
          requiredRole: stage.role,
          scopeType: stage.scopeType,
          isFinalAllotmentStep: stage.role === 'PRINCIPAL',
        })),
      },
    });
    await call(admin, origin, `/admin/venues/${studio.id}`, {
      method: 'PATCH',
      data: { workflowId: workflow.id },
    });
    const { event: reviewEvent } = await call<{ event: { id: string } }>(faculty, origin, '/events', {
      method: 'POST',
      data: { title: 'Capstone project review', expectedAttendance: 20 },
    });
    const { request: reviewRequest } = await call<{ request: { id: string } }>(faculty, origin, '/venue-requests', {
      method: 'POST',
      data: {
        eventId: reviewEvent.id,
        venueId: studio.id,
        startTime: `${day}T16:00:00+05:30`,
        endTime: `${day}T17:00:00+05:30`,
      },
    });
    const viewer = await reviewer.newPage();
    for (const { role, firstName } of approvalStages) {
      const person = await createUser(firstName, 'Menon', role);
      await reviewer.clearCookies();
      await signIn(reviewer, person);
      await capture(viewer, `desktop-${role.toLowerCase()}`, '/home', new RegExp(firstName), 'a:has-text("Capstone project review")');
      await expect(viewer.getByRole('link', { name: /Capstone project review/ })).toBeVisible();
      await call(reviewer, origin, `/approvals/${reviewRequest.id}/decision`, {
        method: 'POST',
        data: { decision: 'APPROVED', comments: 'Approved for the planned time.' },
      });
    }
    const studentPage = await student.newPage();
    await capture(studentPage, 'desktop-student-home', '/home', /Anika/, '.workspace-rows li');
    await capture(studentPage, 'desktop-venues', '/venues', /Find the right space/, '.venue-results li');
    await capture(studentPage, 'desktop-venue', `/venues/${auditorium.id}?date=${day}`, 'Main Auditorium', '.calendar-selection .calendar-day-entry');
    await capture(studentPage, 'desktop-my-events', '/my-events', 'My events', '.event-card h2');
    const facultyPage = await faculty.newPage();
    await capture(facultyPage, 'desktop-endorsements', '/approvals', 'Faculty endorsements', '.queue-table tbody tr');
    await capture(facultyPage, 'desktop-faculty-home', '/home', /Leena/, '.workspace-rows li');
    await capture(adminPage, 'desktop-users', '/admin/users', 'User accounts', '.data-table tbody tr');
    await capture(adminPage, 'desktop-admin-venues', '/admin/venues', 'Manage venues', '.data-table tbody tr');
    await capture(adminPage, 'desktop-workflows', '/admin/workflows', 'Approval workflows', '.workflow-record');
    await capture(adminPage, 'desktop-departments', '/admin/departments', 'Departments', '.data-table tbody tr');
    await adminPage.setViewportSize({ width: 834, height: 1112 });
    await capture(adminPage, 'tablet-approvals', '/approvals', 'Approval inbox', '.queue-table tbody tr');
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await capture(adminPage, 'mobile-approvals', '/approvals', 'Approval inbox', '.queue-table tbody tr');
    await studentPage.setViewportSize({ width: 390, height: 844 });
    await capture(studentPage, 'mobile-student-home', '/home', /Anika/, '.workspace-rows li');
    await capture(studentPage, 'mobile-venue', `/venues/${auditorium.id}?date=${day}`, 'Main Auditorium', '.calendar-selection .calendar-day-entry');
    await studentPage.getByRole('link', { name: 'Request this venue' }).click();
    await expect(studentPage.getByRole('heading', { name: 'Plan your event' })).toBeInViewport();
    await expect(studentPage.getByLabel('Event title')).toBeInViewport();
    await studentPage.screenshot({ path: testInfo.outputPath('mobile-booking.png'), animations: 'disabled' });
    await capture(studentPage, 'mobile-account', '/account', 'My account', '.profile-details');
  } finally {
    await Promise.all([admin.close(), student.close(), faculty.close(), reviewer.close()]);
  }
});
