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

  // Tapping today on the week strip opens the Day screen, which lists the workout.
  await page.getByRole('button', { name: /\(today\): trained/ }).click();
  await expect(page).toHaveURL(/\/day\/\d{4}-\d{2}-\d{2}$/);
  await page.getByRole('button', { name: /^Push A/ }).click();
  await expect(page).toHaveURL(/\/history\//);
  await expect(page.getByRole('heading', { name: 'Push A' })).toBeVisible();
  await page.goBack();
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

  await page.getByRole('link', { name: 'Training' }).click();
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

  // A blank "New exercise" opens at the top with the name field focused (after the slide-up).
  await search.fill('');
  await page.getByRole('button', { name: 'New exercise', exact: true }).click();
  const nameField = page.locator('.sheet').last().getByPlaceholder('Incline DB Press');
  await expect(nameField).toBeFocused();
  expect(await page.locator('.sheet').last().locator('.sheet-body').evaluate((el) => el.scrollTop)).toBe(0);
  expect(await nameField.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThan(0);
  await page.locator('.sheet').last().getByRole('button', { name: 'Cancel' }).click();

  // Not in the library: create it inline, prefilled from the search.
  await search.fill('Ring Dip');
  await page.getByRole('button', { name: /New exercise “Ring Dip”/ }).click();
  await expect(page.locator('.sheet').last().getByPlaceholder('Incline DB Press')).toHaveValue('Ring Dip');
  await page.locator('.sheet').last().getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Selected 3')).toBeAttached();
  await expect(search).toHaveValue(''); // back to the full list to keep picking
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
  await page.getByRole('link', { name: 'Training' }).click();
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

test('Today week strip: swipe back one week only, today stays marked, snaps back', async ({ page }) => {
  await onboard(page, undefined, 'Bodyweight');
  // Log a workout today so today's dot is a tappable button.
  await page.getByRole('button', { name: 'Start workout' }).click();
  await startIfNeeded(page);
  await page.getByRole('button', { name: 'Start set' }).first().click();
  await page.getByRole('button', { name: 'Finish set' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Finish' }).click();
  await expect(page).toHaveURL(/summary/);
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  const strip = page.locator('.week-viewport');
  const box = (await strip.boundingBox())!;
  const swipe = async (dx: number, fromX = box.x + box.width / 2) => {
    const y = box.y + box.height / 2;
    await page.mouse.move(fromX, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(fromX + (dx * i) / 6, y);
    await page.mouse.up();
  };

  await expect(strip).toHaveAttribute('aria-label', /^This week/);
  // A swipe that starts on today's (tappable) dot moves the strip and does not open the workout.
  const todayDot = page.getByRole('button', { name: /\(today\)/ });
  const dotBox = (await todayDot.boundingBox())!;
  await swipe(150, dotBox.x + dotBox.width / 2);
  await expect(strip).toHaveAttribute('aria-label', /^Last week/);
  await expect(page).not.toHaveURL(/\/day\//);
  await expect(page.locator('.day.today')).toHaveCount(1); // only today is ever marked

  await swipe(150); // nothing before last week
  await expect(strip).toHaveAttribute('aria-label', /^Last week/);
  await swipe(-150);
  await expect(strip).toHaveAttribute('aria-label', /^This week/);
  await swipe(-150); // never into the future
  await expect(strip).toHaveAttribute('aria-label', /^This week/);

  // Snaps back to this week after leaving Today.
  await swipe(150);
  await expect(strip).toHaveAttribute('aria-label', /^Last week/);
  await page.getByRole('link', { name: 'Nutrition' }).click();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('.week-viewport')).toHaveAttribute('aria-label', /^This week/);
});

test('workout cards: Start opens the first exercise, per-set remove, collapse arrow, no bodyweight cap badge', async ({ page }) => {
  await onboard(page, undefined, 'Bodyweight');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.locator('.ex-card').first().waitFor();
  const first = page.locator('.ex-card').first();

  // Peek at the first exercise before starting, then close it again.
  await first.locator('.ex-progress').click();
  await expect(first.locator('.set-row')).toHaveCount(3);
  await first.getByRole('button', { name: /^Collapse/ }).click();
  await expect(first.locator('.set-row')).toHaveCount(0);

  // Start still opens it.
  await page.locator('.start-bar').getByRole('button', { name: 'Start workout' }).click();
  await expect(first.locator('.set-row')).toHaveCount(3);
  await expect(first.getByRole('button', { name: /^Collapse/ })).toBeVisible();
  await expect(first.locator('.badge.capped')).toHaveCount(0);

  // Remove a specific (not the last) set.
  await first.getByRole('button', { name: 'Set 2 reps' }).click();
  await keys(page, '7');
  await sheet(page).getByRole('button', { name: 'Done' }).click();
  await first.getByRole('button', { name: 'Remove set 2' }).click();
  await expect(first.locator('.set-row')).toHaveCount(2);
  await expect(first.getByRole('button', { name: 'Set 2 reps' })).not.toHaveText('7');

  // A logged set asks before it goes.
  await first.getByRole('button', { name: 'Start set' }).first().click();
  await first.getByRole('button', { name: 'Finish set' }).click();
  await first.getByRole('button', { name: 'Remove set 1' }).click();
  await expect(page.getByText('Remove this logged set?')).toBeVisible();
  await page.locator('.sheet').getByRole('button', { name: 'Cancel' }).click();
  await expect(first.locator('.set-row')).toHaveCount(2);
});

test('Day screen: log nutrition and bodyweight for a past day', async ({ page }) => {
  await onboard(page);
  // Swipe the strip back to last week and open its Monday.
  const strip = page.locator('.week-viewport');
  const box = (await strip.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + 60 + i * 30, box.y + box.height / 2);
  await page.mouse.up();
  await expect(strip).toHaveAttribute('aria-label', /^Last week/);
  await page.getByRole('button', { name: /^Monday, .*no workout\. Open day/ }).first().click();
  await expect(page).toHaveURL(/\/day\//);
  await expect(page.getByText('Rest day. No workout logged.')).toBeVisible();

  // Quick-add food for that day (system keyboard is fine outside a workout).
  await page.getByRole('button', { name: 'Calories' }).click();
  await sheet(page).getByRole('tab', { name: 'Quick add' }).click();
  await sheet(page).getByPlaceholder('Snack').fill('Burrito');
  await sheet(page).getByPlaceholder('kcal').fill('2400');
  await sheet(page).getByPlaceholder('g').fill('180');
  await sheet(page).getByRole('button', { name: 'Log', exact: true }).click();
  await page.getByRole('button', { name: 'Bodyweight' }).click();
  await keys(page, '182.5');
  await sheet(page).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Calories' })).toContainText('2400');
  await expect(page.getByRole('button', { name: 'Protein' })).toContainText('180');
  await expect(page.getByRole('button', { name: 'Bodyweight' })).toContainText('182.5');
  await expect(page.getByRole('button', { name: /^Burrito/ })).toBeVisible();

  // It's that day's data, not today's.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.quick').getByText('2400')).toHaveCount(0);
  // Deleting the entry removes it from the day's totals.
  await page.goForward();
  await expect(page).toHaveURL(/\/day\//);
  await page.getByRole('button', { name: /^Burrito/ }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Calories' })).not.toContainText('2400');
});

test('Nutrition: saved meals, servings, quick add saved as a meal, totals, targets', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Nutrition' }).click();
  await expect(page.getByRole('heading', { name: 'Nutrition' })).toBeVisible();
  await expect(page.getByText('Nothing logged yet today.')).toBeVisible();

  // Set a calorie target from the ring.
  await page.getByRole('button', { name: /^Calories 0\. Set target/ }).click();
  await keys(page, '2500');
  await sheet(page).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('2500 kcal left')).toBeVisible();

  // Create a saved meal.
  await page.getByRole('button', { name: 'New meal' }).click();
  await sheet(page).getByPlaceholder('Chicken rice bowl').fill('Chicken bowl');
  await sheet(page).getByPlaceholder('kcal').fill('640');
  await sheet(page).getByPlaceholder('g').fill('52');
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Edit Chicken bowl' })).toBeVisible();

  // Log it with 1.5 servings from the Log food sheet.
  await page.locator('.card .btn.primary', { hasText: 'Log food' }).click();
  await sheet(page).getByRole('button', { name: /^Chicken bowl/ }).click();
  await sheet(page).getByRole('button', { name: 'Increase servings' }).click();
  await expect(sheet(page).getByText('960 kcal · 78 g protein')).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Log Chicken bowl' }).click();
  await expect(page.getByText('1540 kcal left')).toBeVisible();

  // Quick add, saved as a meal for next time.
  await page.locator('.card .btn.primary', { hasText: 'Log food' }).click();
  await sheet(page).getByRole('tab', { name: 'Quick add' }).click();
  await sheet(page).getByPlaceholder('Snack').fill('Protein shake');
  await sheet(page).getByPlaceholder('kcal').fill('160');
  await sheet(page).getByPlaceholder('g').fill('30');
  await sheet(page).getByRole('switch', { name: 'Save as a meal' }).click();
  await sheet(page).getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page.getByText('1380 kcal left')).toBeVisible();
  // One-tap log from the saved list.
  await page.getByRole('button', { name: 'Log Protein shake' }).click();
  await expect(page.getByText('1220 kcal left')).toBeVisible();

  // Today's quick-log tile shows the total.
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('.quick')).toContainText('1280');
});

test('rest timer keeps counting in red after it runs out', async ({ page }) => {
  await page.clock.install();
  await onboard(page, undefined, 'Bodyweight');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await startIfNeeded(page);
  await page.getByRole('button', { name: 'Start set' }).first().click();
  await page.getByRole('button', { name: 'Finish set' }).click();
  const bar = page.locator('.rest-bar');
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveClass(/over/);
  await page.clock.fastForward('05:00'); // well past any rest time
  await expect(bar).toHaveClass(/over/);
  await expect(bar).toContainText('Over rest');
  await expect(bar.locator('.num')).toHaveText(/^\+\d+:\d{2}$/);
  // Still there a while later (no auto-dismiss), until the next set starts.
  await page.clock.fastForward('01:00');
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Start set' }).first().click();
  await expect(bar).toHaveCount(0);
});
