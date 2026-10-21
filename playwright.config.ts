import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5179', channel: 'msedge', headless: true,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://browser-test.supabase.co', VITE_SUPABASE_ANON_KEY: 'isolated-public-test-key', VITE_API_BASE_URL: 'http://127.0.0.1:8199' } },
});
