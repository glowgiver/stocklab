import { test, expect, type Page } from '@playwright/test'

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome to StockLab' })).toBeVisible()
}
async function studentLogin(page: Page, code: string, password: string) {
  await page.getByRole('radio', { name: 'Student' }).click()
  await page.getByLabel('Class code').fill(code)
  await page.getByLabel('Pseudonym').fill('fox')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('Passwort vergessen: Lehrkraft setzt neu, Schüler meldet sich an und ändert es', async ({ page }) => {
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
  await logout(page)

  await page.getByRole('radio', { name: 'Student' }).click()
  await page.getByRole('radio', { name: 'Join class' }).click()
  await page.getByLabel('Class code').fill(joinCode)
  await page.getByLabel('Pseudonym').fill('fox')
  await page.getByLabel('Password').fill('forgotten-pass-1')
  await page.getByRole('button', { name: 'Join class' }).click()
  await expect(page.getByRole('heading', { name: 'Hello, fox' })).toBeVisible()
  await logout(page)

  await page.getByRole('radio', { name: 'Teacher' }).click()
  await page.getByRole('radio', { name: 'Sign in' }).click()
  await page.getByLabel('Email').fill('teacher@school.test')
  await page.getByLabel('Password').fill('teacher-pass-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Students & passwords').click()
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: 'New password' }).click()
  const temp = (await page.getByTestId('temp-password').innerText()).trim()
  expect(temp).toHaveLength(10)
  await logout(page)

  // altes Passwort gilt nicht mehr, das Übergangspasswort schon
  await studentLogin(page, joinCode, 'forgotten-pass-1')
  await expect(page.getByRole('alert')).toContainText('Sign-in failed')
  await studentLogin(page, joinCode, temp)
  await expect(page.getByRole('heading', { name: 'Hello, fox' })).toBeVisible()

  // selbst ändern: falsches bisheriges Passwort wird abgelehnt
  await page.getByRole('link', { name: 'Password' }).click()
  await page.getByLabel('Current password').fill('wrong-pass-9')
  await page.getByLabel('New password').fill('my-own-pass-2')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('alert')).toHaveText('The current password is wrong.')
  await page.getByLabel('Current password').fill(temp)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed.')).toBeVisible()
  await logout(page)
  await studentLogin(page, joinCode, 'my-own-pass-2')
  await expect(page.getByRole('heading', { name: 'Hello, fox' })).toBeVisible()
})
