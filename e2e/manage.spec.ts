import { test, expect } from '@playwright/test'

test('Klasse und Runde umbenennen; echte Runde nur nach Ende und mit Namen löschen', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('radio', { name: 'Teacher' }).click()
  await page.getByRole('radio', { name: 'Register' }).click()
  const code = (await page.locator('code').first().innerText()).trim()
  await page.getByLabel('Email').fill('teacher@school.test')
  await page.getByLabel('Password').fill('teacher-pass-1')
  await page.getByLabel('Invitation code').fill(code)
  await page.getByRole('button', { name: 'Register' }).click()
  await page.getByLabel('New class').fill('Testklasse')
  await page.getByRole('button', { name: 'Create class' }).click()

  await page.getByText('Rename class').click()
  await page.getByLabel('New class name').fill('Economics S1')
  await page.getByRole('button', { name: 'Rename', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Economics S1' })).toBeVisible()

  await page.getByText('Create a new round').click()
  await page.getByLabel('Round name').fill('Alt')
  await page.getByRole('button', { name: 'Create round' }).click()
  await page.getByText('Manage (rename, delete)').click()
  await page.getByLabel('New round name').fill('Herbst')
  await page.locator('li').getByRole('button', { name: 'Rename' }).click()
  await expect(page.locator('li').getByText('Herbst')).toBeVisible()

  // echte (nicht-Demo) Runde: laufend nicht löschbar
  await page.getByRole('button', { name: 'Start round' }).click()
  await page.getByText('Manage (rename, delete)').click()
  await expect(page.getByText('A running round cannot be deleted.')).toBeVisible()

  // beenden → nur mit richtig getipptem Namen
  page.on('dialog', d => d.accept())
  await page.getByRole('button', { name: 'End', exact: true }).click()
  await expect(page.getByText('ended', { exact: true })).toBeVisible()
  const forever = page.getByRole('button', { name: 'Delete round permanently' })
  if (!(await forever.isVisible())) await page.getByText('Manage (rename, delete)').click()
  await expect(forever).toBeDisabled()
  await page.getByLabel('To confirm, type the round name: Herbst').fill('Herbst')
  await forever.click()
  await expect(page.locator('li').getByText('Herbst')).toHaveCount(0)
})
