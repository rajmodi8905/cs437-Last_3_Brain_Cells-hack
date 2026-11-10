import { test, expect } from '@playwright/test';
import { CAMPUS_PACK_NOTES } from '../../src/app/campusPack';
// S17 in the production build: a fresh profile adds the campus pack with one tap, with no
// request leaving the local server, and the notes and their originals survive a reload.
test('[S17] a fresh profile adds the campus pack in one tap and keeps it after reload', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url());
  });
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByText('No saved items yet.')).toBeVisible();
  const offer = page.getByRole('button', { name: 'Add the IITGN campus pack' });
  await offer.click();
  await expect(page.getByRole('status')).toContainText(
    `${CAMPUS_PACK_NOTES.length} items saved locally`,
  );
  await expect(page.locator('.item-row')).toHaveCount(CAMPUS_PACK_NOTES.length);
  await expect(offer).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.item-row')).toHaveCount(CAMPUS_PACK_NOTES.length);
  await expect(offer).toHaveCount(0);
  await page.getByRole('button', { name: /IITGN: which hall is my exam in\? Notes/ }).click();
  await expect(page.locator('.original-text')).toContainText('do not publish exam seating plans');
  await expect(page.locator('.original-text')).toContainText(
    'Source: https://iitgn.ac.in/academics/calendar/acadcal-2026-27',
  );
  expect(external).toEqual([]);
});
