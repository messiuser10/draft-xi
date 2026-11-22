/** Creates a game, lets bots draft every pick, then plays a whole round: two seasons and their transfer windows. */
import { expect, test } from '@playwright/test';

test('create a game, bot-draft it and play a round', async ({ page }) => {
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
  // First half, then the mid-season window: make a transfer and say done.
  await page.getByRole('button', { name: 'Skip to mid-season' }).click();
  await expect(page.getByRole('heading', { name: /Mid-season transfer window/ })).toBeVisible();
  await page.getByRole('button', { name: 'Replace', exact: true }).first().click();
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.getByText('to spend', { exact: false })).toBeVisible();
  // Affordable players are listed first.
  await page.getByRole('button', { name: 'Sign', exact: true }).first().click();
  await expect(page.getByText('1 of 2 transfers left', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: "I'm done ✓" }).click();

  // Second half: the season finishes and the summer window opens.
  await page.getByRole('button', { name: 'Skip to the end' }).click();
  await expect(page.getByRole('heading', { name: 'Full time' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /champion/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Summer transfer window/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Season 1 stats/ })).toBeVisible();

  // Season 2, both halves, then the round is over.
  await page.getByRole('button', { name: 'Close window & play on' }).click();
  await page.getByRole('button', { name: 'Skip to mid-season' }).click();
  await page.getByRole('button', { name: 'Close window & play on' }).click();
  await page.getByRole('button', { name: 'Skip to the end' }).click();
  await expect(page.getByRole('heading', { name: 'Both seasons are in the books' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Game leaderboard/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Play again/ })).toBeVisible();

  await page.getByRole('link', { name: 'Season results' }).first().click();
  await expect(page).toHaveURL(/\/results\//);
  await expect(page.getByText(/Smoke United/).first()).toBeVisible();
  await expect(page.getByText('Unofficial fan game, not affiliated with any club, league or player.')).toBeVisible();
});
