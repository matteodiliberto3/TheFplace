import { defineConfig, devices } from '@playwright/test'

const liveUrl = (process.env.LIVE_URL || 'https://the-fplace.vercel.app').replace(/\/$/, '')

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/live-*.spec.ts',
    timeout: 90_000,
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 2 : 1,
    reporter: 'list',
    use: {
        baseURL: liveUrl,
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {
            args: [
                '--autoplay-policy=no-user-gesture-required',
                '--disable-features=PreloadMediaEngagementData',
                '--no-sandbox',
            ],
        },
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Permit sound autoplay
                permissions: [],
            },
        },
    ],
})
