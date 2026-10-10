import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staffPage } from './helpers';

/** Renders the account-page test ticket to PDF exactly as the browser would print it, then inspects the PDF. */
test('reception can set the printer and the printed ticket follows the settings', async ({ browser }) => {
  const rec = await staffPage(browser, 'reception');
  const page = rec.page;
  await page.goto('/account');
  await page.getByLabel('Paper').selectOption('58mm');
  await page.getByLabel('Copies per ticket').selectOption('2');
  await page.getByLabel('People ahead of you').uncheck();

  // Settings survive a reload on this computer.
  await page.reload();
  await expect(page.getByLabel('Paper')).toHaveValue('58mm');
  await expect(page.getByLabel('Copies per ticket')).toHaveValue('2');

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const file = join(mkdtempSync(join(tmpdir(), 'hqms-print-')), 'ticket.pdf');
  writeFileSync(file, pdf);
  const info = execFileSync('pdfinfo', [file]).toString();
  expect(info).toMatch(/Pages:\s+2\b/);
  const mm = (pts: number) => (pts / 72) * 25.4;
  const size = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(info)!;
  expect(mm(Number(size[1]))).toBeGreaterThan(57); expect(mm(Number(size[1]))).toBeLessThan(59);
  expect(mm(Number(size[2]))).toBeGreaterThan(94); expect(mm(Number(size[2]))).toBeLessThan(96);
  const text = execFileSync('pdftotext', [file, '-']).toString();
  expect(text).toContain('R-001');
  expect(text).not.toContain('ahead of you');
  expect(text).not.toContain('Printer settings'); // the settings panel never prints
  await rec.context.close();
});
