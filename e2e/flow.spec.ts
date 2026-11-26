import { test, expect, type Page } from '@playwright/test'

// Kompletter Kernablauf: Lehrkraft → Klasse/Runde → Schüler tritt bei → Entscheidung →
// Abrechnung → Schüler sieht das Ergebnis. Alles gegen echtes SQL (PGlite).

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome to StockLab' })).toBeVisible()
}

async function teacherLogin(page: Page) {
  await page.getByRole('radio', { name: 'Teacher' }).click()
  await page.getByLabel('Email').fill('teacher@school.test')
  await page.getByLabel('Password').fill('teacher-pass-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function studentLogin(page: Page, code: string, pseudonym: string) {
  await page.getByRole('radio', { name: 'Student' }).click()
  await page.getByLabel('Class code').fill(code)
  await page.getByLabel('Pseudonym').fill(pseudonym)
  await page.getByLabel('Password').fill('fox-secret-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function fillJournal(page: Page, suffix = '') {
  await page.getByLabel('What do you expect to happen?').fill('I expect the price to rise because demand grows.' + suffix)
  await page.getByLabel('Why do you think so?').fill('More customers buy the product every month.')
  await page.getByLabel('Which economic evidence supports this?').fill('Sales figures and a news article about demand.')
  await page.getByLabel('Which risks or counter-arguments did you consider?').fill('A recession could reduce spending.')
}

test('Kernablauf: Beitritt, eine Entscheidung je Tag, Abrechnung, Datenschutz', async ({ page }) => {
  await page.goto('/')

  // ── Lehrkraft registriert sich (Demo-Code steht auf der Seite) und legt Klasse + Demo-Runde an
  await page.getByRole('radio', { name: 'Teacher' }).click()
  await page.getByRole('radio', { name: 'Register' }).click()
  const code = (await page.locator('code').first().innerText()).trim()
  await page.getByLabel('Email').fill('teacher@school.test')
  await page.getByLabel('Password').fill('teacher-pass-1')
  await page.getByLabel('Invitation code').fill(code)
  await page.getByRole('button', { name: 'Register' }).click()

  await expect(page.getByRole('heading', { name: 'Your classes' })).toBeVisible()
  await page.getByLabel('New class').fill('Economics S1')
  await page.getByRole('button', { name: 'Create class' }).click()
  const joinCode = (await page.getByTestId('join-code').innerText()).trim()
  expect(joinCode).toHaveLength(8)

  await page.getByText('Create a new round').click()
  await page.getByLabel('Round name').fill('Autumn round')
  await page.getByLabel('Demo round (fast-forward, reset)').check()
  await page.getByRole('button', { name: 'Create round' }).click()
  await page.getByRole('button', { name: 'Start round' }).click()
  await expect(page.getByText('running', { exact: true })).toBeVisible()
  await logout(page)

  // ── Schüler/in tritt mit Pseudonym bei und bekommt 10.000 $
  await page.getByRole('radio', { name: 'Student' }).click()
  await page.getByRole('radio', { name: 'Join class' }).click()
  await page.getByLabel('Class code').fill(joinCode)
  await page.getByLabel('Pseudonym').fill('fox')
  await page.getByLabel('Password').fill('fox-secret-1')
  await page.getByRole('button', { name: 'Join class' }).click()
  await expect(page.getByRole('heading', { name: 'Hello, fox' })).toBeVisible()
  await expect(page.getByTestId('total-value')).toHaveText('$10,000.00')
  await expect(page.getByText('All prices are simulated')).toBeVisible()

  // ── Entscheidung ohne Begründung ist nicht abschickbar
  await expect(page.getByRole('button', { name: 'Submit decision' })).toBeDisabled()
  await page.getByLabel('Shares').fill('5')
  await fillJournal(page)
  await page.getByRole('button', { name: 'Submit decision' }).click()
  await expect(page.getByText('Saved. You can still change it until')).toBeVisible()

  // ── Zweite Abgabe am selben Tag ändert nur die bestehende (Button heißt jetzt „Update“)
  await page.getByLabel('Shares').fill('7')
  await page.getByRole('button', { name: 'Update decision' }).click()
  await expect(page.getByText('Saved. You can still change it until')).toBeVisible()

  // ── Überausgabe wird abgelehnt (klare Fehlermeldung)
  await page.getByLabel('Shares').fill('100000')
  await page.getByRole('button', { name: 'Update decision' }).click()
  await expect(page.getByRole('alert')).toHaveText('You do not have enough cash for that.')
  await page.getByLabel('Shares').fill('7')
  await page.getByRole('button', { name: 'Update decision' }).click()
  await expect(page.getByText('Saved. You can still change it until')).toBeVisible()

  // ── Datenschutz: Lehrkraft-Seite ist für Schüler gesperrt
  await page.goto('/#/teacher')
  await expect(page.getByRole('heading', { name: 'Hello, fox' })).toBeVisible()
  await logout(page)

  // ── Lehrkraft sieht Entscheidung + Begründung, genau eine; rechnet den Tag ab
  await teacherLogin(page)
  await page.getByRole('link', { name: 'Open' }).click()
  await expect(page.getByTestId('count-buy')).toHaveText('1')
  await expect(page.getByTestId('count-sell')).toHaveText('0')
  await expect(page.getByText('Everyone has submitted.')).toBeVisible()
  await page.getByText('fox', { exact: true }).last().click()
  await expect(page.getByText('I expect the price to rise because demand grows.')).toBeVisible()
  await page.getByRole('button', { name: 'Settle next trading day' }).click()
  await expect(page.getByText(/settled \(completed\)/)).toBeVisible()
  await logout(page)

  // ── Schüler/in sieht Ausführung, Depot ist neu bewertet, Reflexion ist möglich
  await studentLogin(page, joinCode, 'fox')
  await expect(page.getByRole('heading', { name: 'Hello, fox' })).toBeVisible()
  await expect(page.getByTestId('cash')).not.toHaveText('$10,000.00')
  await page.getByRole('radio', { name: 'Review' }).click()
  await expect(page.getByText(/executed at \$/)).toBeVisible()
  await expect(page.getByText('A profit does not automatically mean')).toBeVisible()
  await page.getByLabel('Was my original reasoning convincing?').fill('Yes, but thin on evidence.')
  await page.getByLabel('What did I overlook?').fill('Interest rates and competitors.')
  await page.getByLabel('What would I do differently?').fill('Check more than one source.')
  await page.getByRole('button', { name: 'Save reflection' }).click()
  await expect(page.getByText('My reflection')).toBeVisible()
})

test('Deutsch ist Standard-Alternative und umschaltbar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Auf Deutsch wechseln' }).click()
  await expect(page.getByRole('heading', { name: 'Willkommen bei StockLab' })).toBeVisible()
  await expect(page.getByText('Alle Kurse in StockLab sind simuliert')).toBeVisible()
})

test('falscher Klassencode wird verständlich abgelehnt', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: 'Join class' }).click()
  await page.getByLabel('Class code').fill('NOPE0000')
  await page.getByLabel('Pseudonym').fill('ghost')
  await page.getByLabel('Password').fill('ghost-secret-1')
  await page.getByRole('button', { name: 'Join class' }).click()
  await expect(page.getByRole('alert')).toHaveText('This class code does not exist (or the class is closed).')
})
