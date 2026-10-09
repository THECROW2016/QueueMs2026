import { expect, test } from '@playwright/test';
import { staffPage } from './helpers';

test.describe('login', () => {
  test('rejects a wrong password and does not reveal which part was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username or Email').fill('reception');
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: /^Login/ }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid|incorrect|try again/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('validates empty fields before calling the server', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /^Login/ }).click();
    await expect(page.getByText('Enter your username or email')).toBeVisible();
    await expect(page.getByText('Enter your password')).toBeVisible();
  });

  test('keeps reception staff out of administration pages', async ({ browser }) => {
    const { page, context } = await staffPage(browser, 'reception');
    await page.goto('/admin/users');
    await expect(page.getByText('Your account does not have access to this page.')).toBeVisible();
    await context.close();
  });
});

test('a patient moves from registration through triage to consultation, and the public display never shows their name', async ({ browser }) => {
  const patientName = `Synthetic Patient ${Date.now()}`;

  // The public screen is open (no login) before anyone is called.
  const displayContext = await browser.newContext();
  const display = await displayContext.newPage();
  await display.goto('/display');
  await expect(display.getByText('No patients are being called right now.')).toBeVisible();

  // Reception registers the patient and prints the ticket slip.
  const rec = await staffPage(browser, 'reception');
  await rec.page.getByRole('button', { name: '+ Register patient' }).click();
  await rec.page.getByLabel('Full name').fill(patientName);
  await rec.page.getByLabel('Date of birth').fill('1988-03-14');
  await rec.page.getByLabel('Sex').selectOption('FEMALE');
  await rec.page.getByLabel('Phone').fill('0712000111');
  await rec.page.getByRole('button', { name: 'Register and issue ticket' }).click();
  await expect(rec.page.getByTestId('slip-number')).toHaveText(/^R-\d{3}$/);
  const receptionNumber = (await rec.page.getByTestId('slip-number').textContent())!;

  // Duplicate protection: registering the same person again is stopped.
  await rec.page.goto('/');
  await rec.page.getByRole('button', { name: '+ Register patient' }).click();
  await rec.page.getByLabel('Full name').fill(patientName);
  await rec.page.getByLabel('Date of birth').fill('1988-03-14');
  await rec.page.getByLabel('Phone').fill('0712000111');
  await rec.page.getByRole('button', { name: 'Register and issue ticket' }).click();
  await expect(rec.page.getByText('A similar patient already exists')).toBeVisible();
  await rec.page.keyboard.press('Escape');

  // Reception calls the patient; the public display announces the number only.
  await rec.page.getByLabel('My counter').selectOption({ index: 1 });
  await rec.page.getByRole('button', { name: 'Call next patient' }).click();
  await expect(display.getByTestId('call-banner')).toContainText(receptionNumber, { timeout: 15_000 });
  await expect(display.locator('body')).not.toContainText(patientName);
  await expect(display.locator('body')).not.toContainText('0712000111');

  // Start service and send on to Triage.
  const card = rec.page.getByTestId(`active-${receptionNumber}`);
  await card.getByRole('button', { name: 'Start service' }).click();
  await card.getByRole('button', { name: 'Complete…' }).click();
  await rec.page.getByRole('checkbox', { name: /Triage/ }).check();
  await rec.page.getByRole('button', { name: 'Complete and route' }).click();
  await expect(rec.page.getByText(`${receptionNumber} completed and routed`)).toBeVisible();

  // Triage picks it up in real time and passes it to Consultation.
  const tri = await staffPage(browser, 'triage');
  await expect(tri.page.getByRole('cell', { name: /^T-\d{3}/ })).toBeVisible({ timeout: 15_000 });
  await tri.page.getByLabel('My room').selectOption({ index: 1 });
  await tri.page.getByRole('button', { name: 'Call next patient' }).click();
  await tri.page.getByRole('button', { name: 'Start service' }).click();
  await tri.page.getByRole('button', { name: 'Complete…' }).click();
  await tri.page.getByRole('checkbox', { name: /Consultation/ }).check();
  await tri.page.getByRole('button', { name: 'Complete and route' }).click();

  // Consultation sees the patient, with their journey.
  const con = await staffPage(browser, 'consultation');
  await expect(con.page.getByText(patientName)).toBeVisible({ timeout: 15_000 });

  // The administrator dashboard reflects real counts.
  const admin = await staffPage(browser, 'admin');
  await admin.page.goto('/');
  await expect(admin.page.getByRole('heading', { name: 'Hospital overview' })).toBeVisible();
  await expect(admin.page.getByText('Patients registered').locator('..')).toContainText('1');

  await Promise.all([rec.context.close(), tri.context.close(), con.context.close(), admin.context.close(), displayContext.close()]);
});

test('the journey of the visit is visible to clinical staff', async ({ browser }) => {
  const admin = await staffPage(browser, 'admin');
  await admin.page.goto('/visits');
  await admin.page.getByRole('link', { name: /^V-|VIS-|\d{4}/ }).first().click();
  await expect(admin.page.getByRole('region', { name: 'Patient journey' })).toBeVisible();
  await expect(admin.page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  await admin.context.close();
});
