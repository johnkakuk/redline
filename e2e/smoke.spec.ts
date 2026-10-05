import { chromium, expect, test, webkit, devices, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Ephemeral WebKit contexts have no OPFS, so the app runs on its in-memory fallback:
// every test starts from a clean database. Persistence is covered separately below.

async function keys(page: Page, digits: string) {
  for (const d of digits) await page.locator('.kp-key', { hasText: new RegExp(`^${d === '.' ? '\\.' : d}$`) }).click();
}
const sheet = (page: Page) => page.locator('.sheet');

async function onboard(page: Page, dumbbellCapLb?: number, program: 'Build my own' | 'Bodyweight' = 'Build my own') {
  await page.goto('/');
  await expect(page).toHaveURL(/onboarding/);
  await page.getByRole('button', { name: 'lb', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  if (dumbbellCapLb) {
    await page.getByRole('group', { name: 'Dumbbells' }).getByRole('tab', { name: 'Have' }).click();
    await page.getByRole('button', { name: 'Heaviest dumbbell (per hand)' }).click();
    await keys(page, String(dumbbellCapLb));
    await sheet(page).getByRole('button', { name: 'Done' }).click();
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('tab', { name: program }).click();
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

async function createRoutine(page: Page, name: string, exercise: string) {
  await page.getByRole('button', { name: 'Create routine' }).click();
  await page.getByPlaceholder('Upper A · Push').fill(name);
  await page.getByRole('button', { name: 'Add exercises' }).click();
  await page.getByPlaceholder('Search exercises').fill(exercise);
  await page.getByRole('button', { name: new RegExp(`^${exercise}`) }).first().click();
  await page.getByRole('button', { name: /^Add \(1\)/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/routines$/);
}

/** Press "Start workout" on the live workout screen if it hasn't been started yet. */
async function startIfNeeded(page: Page) {
  await page.locator('.wk-head').waitFor();
  await page.locator('.ex-card').first().waitFor();
  const start = page.locator('.start-bar').getByRole('button', { name: 'Start workout' });
  if (await start.count()) await start.click();
}

/** Log every working set of the first exercise as weight × reps via the keypad, then ▶/■ each set. */
async function logAll(page: Page, weight: string | null, reps: string, sets = 3) {
  await startIfNeeded(page);
  await page.getByRole('button', { name: 'Set 1 reps' }).first().click();
  if (weight) {
    await sheet(page).getByRole('tab', { name: 'Weight' }).click();
    await keys(page, weight);
    await page.locator('.kp-key.next').click();
  }
  for (let i = 0; i < sets; i++) {
    if (i > 0) await page.locator('.kp-key.next').click(); // later sets open on weight: keep the carried value
    await keys(page, reps);
    await page.locator('.kp-key.next').click();
  }
  if (await sheet(page).count()) await sheet(page).getByRole('button', { name: 'Done' }).click();
  for (let i = 0; i < sets; i++) {
    await page.getByRole('button', { name: 'Start set' }).first().click();
    await expect(page.locator('.set-clock')).toBeVisible();
    await page.getByRole('button', { name: 'Finish set' }).click();
  }
  await expect(page.getByRole('button', { name: 'Mark set not done' })).toHaveCount(sets);
}

test('core loop: routine → workout → finish → next session progresses and respects the cap', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await onboard(page, 50);
  await createRoutine(page, 'Push A', 'DB Bench Press');

  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page).toHaveURL(/\/workout$/);
  await expect(page.getByText('3 × 10 · cap 50')).toBeVisible();
  await expect(page.locator('.ex-progress')).toBeVisible(); // overview: collapsed until Start
  await expect(page.getByLabel('Elapsed')).toHaveText('Ready');

  await logAll(page, '45', '10');
  await expect(page.locator('.rest-bar')).toBeVisible();

  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/summary/);
  await expect(page.getByText('Hit 10/10/10 → +5 lb next time')).toBeVisible(); // 50×9 wouldn't beat 45×10, so reps stay
  await page.getByRole('button', { name: 'Done' }).click();

  // Trained days on the week strip open that day's workout; other days aren't buttons.
  await expect(page.locator('.week button.day')).toHaveCount(1);
  await page.getByRole('button', { name: /trained, view workout/ }).click();
  await expect(page).toHaveURL(/\/history\//);
  await expect(page.getByRole('heading', { name: 'Push A' })).toBeVisible();
  await page.goBack();

  // Session 2: pre-filled at 50 lb × 10, which is the cap.
  await page.getByRole('button', { name: 'Start workout' }).click();
  await startIfNeeded(page);
  const w1 = page.getByRole('button', { name: 'Set 1 weight' });
  await expect(w1).toHaveText('50');
  await expect(page.getByRole('button', { name: 'Set 1 reps' })).toHaveText('10');
  await expect(page.locator('.set-row').first().locator('.prev')).toHaveText('45 × 10');
  await w1.click();
  // The cap informs but never blocks what you log.
  await expect(sheet(page).getByText('At your 50 lb max')).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: 'Plus 5' })).toBeEnabled();
  // Dumbbell pairs: enter both together; stored per dumbbell.
  await sheet(page).getByRole('tab', { name: 'Both' }).click();
  await expect(sheet(page).locator('.kp-value')).toContainText('100');
  await sheet(page).getByRole('tab', { name: 'Each' }).click();
  await sheet(page).getByRole('button', { name: 'Done' }).click();

  await logAll(page, null, '10');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByText(/Capped at 50 lb on DB Bench Press/)).toBeVisible();
  await expect(page.locator('.badge.pr').first()).toBeVisible(); // 50 × 12 beats 45 × 12
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(page.getByText('Swapped to Paused DB Bench Press')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('link', { name: 'Routines' }).click();
  await page.getByRole('button', { name: /^Push A/ }).click();
  await expect(page.locator('.item-card').getByText('Paused DB Bench Press')).toBeVisible();
  expect(errors).toEqual([]);
});

test('no equipment → bodyweight-only starter program', async ({ page }) => {
  await onboard(page, undefined, 'Bodyweight');
  await expect(page.getByText('Bodyweight A')).toBeVisible();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByRole('heading', { name: 'Push-up' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Split Squat' })).toBeVisible();
  // The picker only offers what you own.
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await page.getByPlaceholder('Search exercises').fill('bench');
  await expect(page.getByRole('button', { name: /^DB Bench Press/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter exercises' }).click();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('.sheet').last().getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /^DB Bench Press/ })).toBeVisible();
});

// Playwright's WebKit can't navigate through a service worker while offline, so this one runs in Chromium.
test('works offline after the first load', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // let the SW take control
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Pick a routine, lift what it suggests')).toBeVisible();
  await browser.close();
});

test('data survives closing and reopening the app (OPFS)', async () => {
  const { defaultBrowserType: _d, ...iphone } = devices['iPhone 15'];
  const dir = path.join(os.tmpdir(), `redline-e2e-${Date.now()}`);
  const open = async () => {
    const ctx = await webkit.launchPersistentContext(dir, { ...iphone, baseURL: 'http://localhost:4173' });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    return { ctx, page };
  };

  let { ctx, page } = await open();
  await page.goto('/');
  await page.waitForFunction(() => location.pathname.includes('onboarding') || !!document.querySelector('h1'));
  await expect(page.locator('.banner')).toHaveCount(0); // real storage, not the memory fallback
  if (!page.url().includes('onboarding')) {
    // OPFS is per origin, so clear anything left by an earlier run.
    await page.goto("/settings");
    await page.getByRole('button', { name: 'Reset app' }).click();
    await page.getByLabel('Type RESET to confirm').fill('RESET');
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await expect(page).toHaveURL(/onboarding/);
  }
  await onboard(page);
  await page.getByRole('button', { name: /^Weight/ }).click();
  await keys(page, '182.5');
  await sheet(page).getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.quick').getByText('182.5')).toBeVisible();
  await ctx.close();

  ({ ctx, page } = await open());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.quick').getByText('182.5')).toBeVisible();
  await ctx.close();
});

test('login is optional and lives at /login', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Local only')).toBeVisible();
  await page.getByRole('button', { name: /^Log in/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Accounts are invite-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeDisabled();
  await page.getByRole('button', { name: 'Redline' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});

test('routine editor: create an exercise mid-edit without losing anything; picks keep their order', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Create routine' }).click();
  await page.getByPlaceholder('Upper A · Push').fill('Push day');
  await page.getByRole('button', { name: 'Add exercises' }).click();
  const search = page.getByPlaceholder('Search exercises');
  await search.fill('push-up');
  await page.getByRole('button', { name: /^Push-up/ }).click();
  await search.fill('inverted row');
  await page.getByRole('button', { name: /^Inverted Row/ }).click();
  await expect(page.getByLabel('Selected 2')).toBeVisible();

  // Not in the library: create it inline, prefilled from the search.
  await search.fill('Ring Dip');
  await page.getByRole('button', { name: /New exercise “Ring Dip”/ }).click();
  await expect(page.locator('.sheet').last().getByPlaceholder('Incline DB Press')).toHaveValue('Ring Dip');
  await page.locator('.sheet').last().getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Selected 3')).toBeVisible();
  await page.getByRole('button', { name: /^Add \(3\)/ }).click();

  // Nothing typed before was lost, and items are in the order they were picked.
  await expect(page.getByPlaceholder('Upper A · Push')).toHaveValue('Push day');
  await expect(page.locator('.item-card .grow > div:first-child')).toHaveText(['Push-up', 'Inverted Row', 'Ring Dip']);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/routines$/);
  await page.getByRole('button', { name: /^Push day/ }).click();
  await expect(page.locator('.item-card .grow > div:first-child')).toHaveText(['Push-up', 'Inverted Row', 'Ring Dip']);

  // Unsaved edits survive leaving the editor, and Cancel asks before throwing them away.
  await page.getByPlaceholder('Upper A · Push').fill('Push day v2');
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: 'Routines' }).click();
  await page.getByRole('button', { name: /^Push day/ }).click();
  await expect(page.getByText('Restored your unsaved changes.')).toBeVisible();
  await expect(page.getByPlaceholder('Upper A · Push')).toHaveValue('Push day v2');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Discard changes?')).toBeVisible();
  await page.locator('.sheet').getByRole('button', { name: 'Discard' }).click();
  await page.getByRole('button', { name: /^Push day/ }).click();
  await expect(page.getByPlaceholder('Upper A · Push')).toHaveValue('Push day');
  await expect(page.getByText('Restored your unsaved changes.')).toHaveCount(0);
});
