import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const baseUrl = 'http://127.0.0.1:4104';

/**
 * The demo is served as a static build. Playwright drives the installed system
 * Chrome (no browser download) against a Vite preview server on the reserved
 * port 4104.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: baseUrl,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run preview',
    cwd: projectRoot,
    url: baseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
