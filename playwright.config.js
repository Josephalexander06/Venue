import { defineConfig, devices } from '@playwright/test';
// Automatically load local .env if present (supported natively in Node.js 20.6+)
try {
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile();
    }
}
catch {
    // Ignore when .env is absent (e.g. CI environments with injected secrets)
}
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!e2eDatabaseUrl) {
    throw new Error('E2E_DATABASE_URL (or DATABASE_URL) is required for browser tests.');
}
if (process.env.NODE_ENV === 'production') {
    throw new Error('Browser tests refuse to run with NODE_ENV=production.');
}
const databaseHost = decodeURIComponent(new URL(e2eDatabaseUrl).hostname);
const isLocalDatabase = ['localhost', '127.0.0.1', '::1'].includes(databaseHost) || databaseHost.startsWith('/');
if (!isLocalDatabase) {
    throw new Error(`Browser tests refuse to write to non-local database host "${databaseHost}". Use E2E_DATABASE_URL.`);
}
// Keep E2E servers on separate ports so a normal `pnpm dev` session can keep
// running without the browser suite silently hitting the development database.
const webPort = Number(process.env.E2E_WEB_PORT ?? 5174);
const apiPort = Number(process.env.E2E_API_PORT ?? 4100);
const baseURL = `http://localhost:${webPort}`;
export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: [['list']],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'desktop-chromium',
            testMatch: '**/booking.spec.ts',
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } },
        },
        {
            name: 'tablet-chromium',
            testMatch: '**/mobile.spec.ts',
            use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 } },
        },
        {
            name: 'mobile-chromium',
            testMatch: '**/mobile.spec.ts',
            use: { ...devices['Pixel 7'] },
        },
    ],
    webServer: {
        command: 'pnpm db:migrate && pnpm db:seed && pnpm dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...process.env,
            DATABASE_URL: e2eDatabaseUrl,
            NODE_ENV: 'development',
            FRONTEND_URL: baseURL,
            PORT: String(apiPort),
            WEB_PORT: String(webPort),
            API_PROXY_TARGET: `http://localhost:${apiPort}`,
        },
    },
});
