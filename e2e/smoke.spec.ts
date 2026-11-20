/** Creates a game, lets bots draft every pick, starts the season and plays it to the end. */
import { expect, test } from '@playwright/test';

test('create a game, bot-draft it and play a season', async ({ page }) => {
  // Skip the first-visit walkthrough so it does not cover the page.
  await page.addInitScript(() => localStorage.setItem('walkthrough:done', '1'));

  await page.goto('/login');
  await page.getByLabel('Display name').fill('Smoke Tester');
  await page.locator('form').getByRole('button', { name: /play as guest|continue|join/i }).click();
  await expect(page.getByRole('link', { name: /Smoke Tester/ })).toBeVisible();

  await page.goto('/create');
  await page.getByLabel('Team name').fill('Smoke United');
  await page.getByLabel('Monogram').fill('SMK');
  await page.getByRole('button', { name: 'Create lobby' }).click();
  await expect(page).toHaveURL(/\/lobby\/[A-Z0-9]{6}$/);

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add bot' }).click();
  await expect(page.getByText(/Bot/).first()).toBeVisible();
  await page.getByRole('button', { name: "I'm ready" }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  // Draft room: hand our own team to a bot so every pick is made automatically.
  await expect(page).toHaveURL(/\/draft\//);
  const enter = page.getByRole('button', { name: 'Enter the draft room' });
  if (await enter.isVisible().catch(() => false)) await enter.click();
  await page.getByRole('button', { name: 'Replace with bot' }).click();

  // 4 drafting teams x 11 picks, then the reveal.
  await expect(page).toHaveURL(/\/reveal\//, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Team Reveal' })).toBeVisible();
  await page.getByRole('button', { name: 'Start Season' }).click();

  await expect(page).toHaveURL(/\/season\//, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Skip to the end' }).click();
  await expect(page.getByRole('heading', { name: 'Full time' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /champion/i })).toBeVisible();

  await page.getByRole('link', { name: 'Season results' }).click();
  await expect(page).toHaveURL(/\/results\//);
  await expect(page.getByText(/Smoke United/).first()).toBeVisible();
  await expect(page.getByText('Unofficial fan game, not affiliated with any club, league or player.')).toBeVisible();
});
