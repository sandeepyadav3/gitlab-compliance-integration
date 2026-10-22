import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from 'playwright/test';
import { mkdir } from 'node:fs/promises';
import { harness, deferred } from './helpers.ts';

let failRules = false; let forcePush = false; let holdNext = false; let unsafeName = false;
const gate = deferred();
const app = await harness({ beforeReply: async url => {
  if (holdNext && url.pathname === '/api/v4/projects/1') await gate.promise;
}, reply: url => {
  if (unsafeName && url.pathname === '/api/v4/projects/1') return { body: { id: 1,
    name: '<img src=x onerror="window.injected=true">', web_url: 'javascript:alert(1)', visibility: 'private', default_branch: 'main', empty_repo: false } };
  if (url.pathname.endsWith('/projects/1/protected_branches')) {
    if (failRules) return { status: 403 };
    return { body: [{ id: 9, name: 'main', push_access_levels: [{ access_level: 40 }], merge_access_levels: [{ access_level: 40 }],
      unprotect_access_levels: [], allow_force_push: forcePush, code_owner_approval_required: false, inherited: false }] };
  }
  return undefined;
} });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) }).catch(async error => { await app.close(); throw error; });
const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await context.newPage();
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
const detail = () => page.locator('.detail');
const begin = async (name = 'Recollect project') => {
  const response = page.waitForResponse(response => response.url() === app.base + '/api/runs' && response.request().method() === 'POST');
  await page.getByRole('button', { name, exact: true }).click();
  const accepted = await (await response).json();
  if (!accepted.run) throw new Error('Collection was not accepted');
  await expect(page.locator('.run-id')).toContainText(accepted.run.id);
  return accepted.run.id as string;
};
const settle = async () => {
  await expect(page.getByRole('button', { name: 'Recollect project' })).toBeEnabled({ timeout: 15000 });
  await expect(page.locator('.run-progress .badge')).toHaveText('completed');
};
try {
  await page.goto(app.base);
  await expect(page.getByRole('heading', { name: 'Know what was observed.' })).toBeVisible();
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  const ids = page.getByLabel('GitLab project IDs');
  await ids.fill('abc'); await page.getByRole('button', { name: 'Save selection' }).click();
  await expect(page.getByRole('alert')).toContainText('1-25 numeric'); assertNoRun();
  await ids.fill('1\n2\n3'); await page.getByRole('button', { name: 'Save selection' }).click();
  await expect(page.getByRole('status')).toContainText('selection saved');
  await begin('Start collection'); await settle();
  await expect(page.locator('.project-row')).toHaveCount(3);
  await expect(page.locator('.project-row').nth(0)).toContainText('protected');
  await expect(page.locator('.project-row').nth(1)).toContainText('unprotected');
  await expect(page.locator('.project-row').nth(2)).toContainText('no default branch');
  await expect(detail()).toContainText('first observation');
  await expect(detail()).toContainText('Maintainers (40)');
  await detail().getByText('Source references and collection attempts', { exact: true }).click();
  await expect(detail().getByRole('link', { name: 'https://gitlab.com/api/v4/projects/1', exact: false }).first()).toBeVisible();
  holdNext = true; await begin();
  await expect(page.locator('.run-progress .badge')).toHaveText('running');
  const activeId = app.store.getActiveRun()!.id;
  await page.reload(); await expect(page.locator('.run-id')).toContainText(activeId);
  await expect(page.locator('.run-progress .badge')).toHaveText('running');
  gate.resolve(); holdNext = false; await settle();
  forcePush = true; await begin(); await settle();
  await expect(detail()).toContainText('Force push allowed');
  await expect(detail().locator('.old-value')).toHaveText('No'); await expect(detail().locator('.new-value')).toHaveText('Yes');
  failRules = true; await begin(); await settle();
  const partialRun = app.store.listRuns()[0]!; const baseline = partialRun.projects[0]!.baselineRunId!;
  await expect(detail()).toContainText('GitLab denied access');
  await expect(detail()).toContainText('Last complete evidence before this run (historical)');
  await expect(detail()).toContainText('no setting removal is inferred');
  await expect(detail().locator('.old-value')).toHaveCount(0);
  const shots = process.env.SCREENSHOT_DIR ?? join(tmpdir(), 'gitlab-phase5-ui'); await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/partial-desktop.png`, fullPage: true });
  failRules = false; await begin(); await settle();
  await expect(detail()).toContainText('No changes in comparable observed fields.');
  await page.getByRole('button', { name: `Run ${partialRun.sequence} `, exact: false }).click();
  await expect(detail()).toContainText('You are inspecting historical run');
  await expect(detail().getByRole('button', { name: `Open last complete run ${baseline.slice(0,8)}` })).toBeVisible();
  await detail().getByRole('button', { name: 'Open latest attempt' }).click();
  await expect(detail()).not.toContainText('You are inspecting historical run');
  await context.setOffline(true); await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the local server');
  await expect(page.getByRole('heading', { name: 'Project outcomes' })).toBeVisible();
  await context.setOffline(false); await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.clock.setFixedTime(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(detail()).toContainText('This observation is older than 24 hours');
  await page.clock.setFixedTime(new Date());
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(detail()).not.toContainText('This observation is older than 24 hours');
  unsafeName = true; await begin(); await settle();
  await expect(detail().getByRole('heading', { name: '<img src=x onerror="window.injected=true">', exact: true })).toBeVisible();
  if (await page.evaluate(() => 'injected' in window)) throw new Error('Unsafe provider text executed');
  if (await page.locator('a[href^="javascript:"]').count()) throw new Error('Unsafe URL was linked');
  unsafeName = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('GitLab project IDs')).toBeVisible();
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile horizontal overflow');
  await page.screenshot({ path: `${shots}/mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 950 });
  await begin(); await settle();
  await page.screenshot({ path: `${shots}/desktop.png`, fullPage: true });
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  console.log('UI smoke passed: real-backend collection, refresh reconnection, changes, partial failure, historical fallback, recovery, offline retention, safe rendering, and mobile layout.');
} finally { gate.resolve(); await browser.close(); await app.close(); }
function assertNoRun() { if (app.store.listRuns().length) throw new Error('Invalid input created a run'); }
