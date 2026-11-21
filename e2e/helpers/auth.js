import { expect } from '@playwright/test';
/**
 * Retrieve administrator credentials from the environment.
 * Evaluates E2E_ADMIN_* first, falling back to SEED_ADMIN_* from .env.
 */
export function getAdminCredentials() {
    const email = process.env.E2E_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
    const password = process.env.E2E_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) {
        throw new Error('Missing administrator test credentials. Please set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD ' +
            '(or SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD) in your .env file or environment variables.');
    }
    return { email, password };
}
/**
 * Perform login using administrative credentials.
 */
export async function loginAsAdmin(page) {
    const { email, password } = getAdminCredentials();
    await login(page, email, password);
}
/**
 * Reusable login helper for any user account.
 */
export async function login(page, email, password) {
    await page.goto('/login');
    await page.getByLabel('College email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).not.toHaveURL(/\/login$/);
}
