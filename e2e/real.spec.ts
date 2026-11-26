import { test, expect } from '@playwright/test'

// Echte Schlusskurse: Startkurse eintragen → Runde starten → Schüler sieht echte Kurse + Lesetipp.

test('Runde mit echten Schlusskursen und Lesetipps', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: 'Teacher' }).click()
  await page.getByRole('radio', { name: 'Register' }).click()
  const code = (await page.locator('code').first().innerText()).trim()
  await page.getByLabel('Email').fill('teacher@school.test')
  await page.getByLabel('Password').fill('teacher-pass-1')
  await page.getByLabel('Invitation code').fill(code)
  await page.getByRole('button', { name: 'Register' }).click()

  await page.getByLabel('New class').fill('Economics S1')
  await page.getByRole('button', { name: 'Create class' }).click()
  const joinCode = (await page.getByTestId('join-code').innerText()).trim()

  await page.getByText('Create a new round').click()
  await page.getByLabel('Round name').fill('Real round')
  await page.getByRole('radio', { name: 'Real closing prices' }).click()
  await expect(page.getByLabel('Demo round (fast-forward, reset)')).toHaveCount(0)   // Demo gibt es nur simuliert
  await page.getByRole('button', { name: 'Create round' }).click()

  // Ohne Startkurse lässt sich die Runde nicht starten
  await page.getByRole('button', { name: 'Start round' }).click()
  await expect(page.getByRole('alert')).toContainText('First enter the real closing prices')

  // Startkurse einfügen (eine Zeile je Wertpapier, Dezimalkomma erlaubt)
  await page.getByRole('link', { name: 'Enter start prices' }).click()
  await page.getByLabel('Paste prices (optional)').fill(
    'AAPL 193,09\nMSFT 421.50\nAMZN 180\nTSLA 250\nKO 62\nNKE 95\nDIS 110\nMCD 290\nURTH 165')
  await page.getByRole('button', { name: 'Save prices' }).click()
  await expect(page.getByText('9 prices saved. Nothing is missing.')).toBeVisible()
  await page.getByRole('link', { name: 'Back' }).click()
  await page.getByRole('link', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Start round' }).click()
  await expect(page.getByText('running', { exact: true })).toBeVisible()
  await expect(page.locator('li').getByText('Real closing prices')).toBeVisible()   // Badge an der Runde

  // Lesetipp anlegen (nur https)
  await page.getByRole('link', { name: 'Open' }).click()
  await expect(page.getByRole('heading', { name: 'Closing prices' })).toBeVisible()
  await page.getByLabel('Headline').fill('Interest rates stay high')
  await page.getByLabel('Source (e.g. Tagesschau)').fill('Tagesschau')
  await page.getByLabel('Link').fill('https://www.tagesschau.de/wirtschaft/')
  await page.getByRole('button', { name: 'Add reading tip' }).click()
  await expect(page.getByRole('link', { name: 'Interest rates stay high' })).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()

  // Schüler/in: echte Kurse (Startkurs sichtbar), Banner „Real…“, Lesetipp mit sicheren Link-Attributen
  await page.getByRole('radio', { name: 'Join class' }).click()
  await page.getByLabel('Class code').fill(joinCode)
  await page.getByLabel('Pseudonym').fill('fox')
  await page.getByLabel('Password').fill('fox-secret-1')
  await page.getByRole('button', { name: 'Join class' }).click()
  await expect(page.getByText('Real end-of-day prices of the US stock market')).toBeVisible()
  await expect(page.getByRole('option', { name: /AAPL — Apple · \$193\.09/ })).toBeAttached()
  const tip = page.getByRole('link', { name: 'Interest rates stay high' })
  await expect(tip).toHaveAttribute('href', 'https://www.tagesschau.de/wirtschaft/')
  await expect(tip).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(tip).toHaveAttribute('target', '_blank')
})
