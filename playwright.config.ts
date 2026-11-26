import { defineConfig } from '@playwright/test'

// E2E läuft gegen den lokalen Demo-Modus (PGlite im Browser, gleiche SQL-Migrationen wie Supabase).
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5199', locale: 'en-US', trace: 'retain-on-failure' },
  webServer: {
    command: 'VITE_BACKEND=local npx vite --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
