import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = 'http://127.0.0.1:4104';

async function selectScenario(page: Page, id: string): Promise<void> {
  await page.getByTestId(`scenario-radio-${id}`).check();
}

async function runScenario(page: Page, id: string): Promise<void> {
  await selectScenario(page, id);
  await page.getByTestId('run-workflow').click();
  await expect(page.getByTestId('final-status')).not.toHaveText('Not run');
}

async function logEntries(page: Page): Promise<string[]> {
  return page.getByTestId('log-entry-event').allTextContents();
}

async function logMessages(page: Page): Promise<string[]> {
  return page.getByTestId('log-entry-message').allTextContents();
}

async function logPairs(page: Page): Promise<string[]> {
  const nodes = await page.getByTestId('log-entry-node').allTextContents();
  const events = await page.getByTestId('log-entry-event').allTextContents();
  return nodes.map((node, index) => `${node} ${events[index]}`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Workflow Resilience Lab' })).toBeVisible();
  await expect(page.getByTestId('notice-synthetic')).toHaveText('Synthetic data');
  await expect(page.getByTestId('notice-simulation')).toHaveText(
    'Browser simulation — no n8n runtime',
  );
});

test('the clean run succeeds on every node with one attempt each', async ({ page }) => {
  await runScenario(page, 'clean');

  await expect(page.getByTestId('final-status')).toHaveText('Completed');
  await expect(page.getByTestId('route-output')).toHaveText('priority-review');

  for (const id of ['trigger', 'validate', 'enrich', 'route', 'write', 'notify']) {
    await expect(page.getByTestId(`node-state-${id}`)).toHaveText('succeeded');
    await expect(page.getByTestId(`node-attempts-${id}`)).toHaveText('1');
  }

  await expect(page.getByTestId('execution-log').getByRole('listitem')).toHaveCount(12);
});

test('the transient write failure retries once and still completes', async ({ page }) => {
  await runScenario(page, 'transient-write-failure');

  await expect(page.getByTestId('final-status')).toHaveText('Completed');
  await expect(page.getByTestId('node-state-write')).toHaveText('succeeded');
  await expect(page.getByTestId('node-attempts-write')).toHaveText('2');

  for (const id of ['trigger', 'validate', 'enrich', 'route', 'notify']) {
    await expect(page.getByTestId(`node-attempts-${id}`)).toHaveText('1');
  }

  const events = await logEntries(page);
  expect(events).toEqual([
    'started',
    'succeeded',
    'started',
    'succeeded',
    'started',
    'succeeded',
    'started',
    'succeeded',
    'started',
    'failed',
    'retry',
    'started',
    'succeeded',
    'started',
    'succeeded',
  ]);

  const messages = await logMessages(page);
  expect(messages).toContain('retry 1');
  await expect(page.getByTestId('execution-log')).toContainText('retry 1');
});

test('the persistent write failure stops after two attempts and skips notify', async ({ page }) => {
  await runScenario(page, 'persistent-write-failure');

  await expect(page.getByTestId('final-status')).toHaveText('Failed');
  await expect(page.getByTestId('node-state-write')).toHaveText('failed');
  await expect(page.getByTestId('node-attempts-write')).toHaveText('2');
  await expect(page.getByTestId('node-state-notify')).toHaveText('skipped');
  await expect(page.getByTestId('node-attempts-notify')).toHaveText('0');

  const events = await logEntries(page);
  expect(events).toHaveLength(14);
  // Six node starts: trigger, validate, enrich, route, then write on attempt 1 and attempt 2.
  expect(events.filter((event) => event === 'started')).toHaveLength(6);
  expect(events.filter((event) => event === 'failed')).toHaveLength(2);
  expect(events.filter((event) => event === 'retry')).toHaveLength(1);
  expect(events[events.length - 1]).toBe('skipped');

  const pairs = await logPairs(page);
  expect(pairs.filter((pair) => pair === 'Write started')).toHaveLength(2);
  expect(pairs[pairs.length - 1]).toBe('Notify skipped');
});

test('the invalid input scenario is rejected before any downstream work', async ({ page }) => {
  await runScenario(page, 'invalid-input');

  await expect(page.getByTestId('final-status')).toHaveText('Rejected');
  await expect(page.getByTestId('node-state-validate')).toHaveText('failed');
  await expect(page.getByTestId('node-attempts-validate')).toHaveText('1');
  await expect(page.getByTestId('route-output')).toHaveText('—');

  for (const id of ['enrich', 'route', 'write', 'notify']) {
    await expect(page.getByTestId(`node-state-${id}`)).toHaveText('skipped');
    await expect(page.getByTestId(`node-attempts-${id}`)).toHaveText('0');
  }

  await expect(page.getByTestId('execution-log').getByRole('listitem')).toHaveCount(8);
});

test('replaying a scenario reproduces the log without duplicating it', async ({ page }) => {
  await runScenario(page, 'transient-write-failure');
  const first = await logEntries(page);
  expect(first).toHaveLength(15);

  await page.getByTestId('replay-workflow').click();
  await expect(page.getByTestId('execution-log').getByRole('listitem')).toHaveCount(15);
  expect(await logEntries(page)).toEqual(first);

  await page.getByTestId('replay-workflow').click();
  await expect(page.getByTestId('execution-log').getByRole('listitem')).toHaveCount(15);
  expect(await logEntries(page)).toEqual(first);
});

test('reset clears the log, the attempts and the node states', async ({ page }) => {
  await runScenario(page, 'transient-write-failure');
  await expect(page.getByTestId('execution-log').getByRole('listitem')).toHaveCount(15);

  await page.getByTestId('reset-workflow').click();

  await expect(page.getByTestId('log-empty')).toBeVisible();
  await expect(page.getByTestId('execution-log')).toHaveCount(0);
  await expect(page.getByTestId('final-status')).toHaveText('Not run');

  for (const id of ['trigger', 'validate', 'enrich', 'route', 'write', 'notify']) {
    await expect(page.getByTestId(`node-state-${id}`)).toHaveText('waiting');
    await expect(page.getByTestId(`node-attempts-${id}`)).toHaveText('0');
  }
});

test('stepping through the log replays the run one event at a time', async ({ page }) => {
  await runScenario(page, 'clean');
  await expect(page.getByTestId('log-cursor')).toHaveText('12 / 12 events');

  await page.getByTestId('step-back').click();
  await expect(page.getByTestId('log-cursor')).toHaveText('11 / 12 events');
  await expect(page.getByTestId('node-state-notify')).toHaveText('running');
  await expect(page.getByTestId('final-status')).toHaveText('Running');

  await page.getByTestId('step-forward').click();
  await expect(page.getByTestId('log-cursor')).toHaveText('12 / 12 events');
  await expect(page.getByTestId('node-state-notify')).toHaveText('succeeded');
  await expect(page.getByTestId('final-status')).toHaveText('Completed');
});

test('choosing another scenario clears the previous run', async ({ page }) => {
  await runScenario(page, 'clean');
  await expect(page.getByTestId('execution-log').getByRole('listitem')).toHaveCount(12);

  await selectScenario(page, 'invalid-input');
  await expect(page.getByTestId('log-empty')).toBeVisible();
  await expect(page.getByTestId('final-status')).toHaveText('Not run');
});

test('the page does not overflow horizontally at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await runScenario(page, 'transient-write-failure');

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test('the page has no serious or critical accessibility violations', async ({ page }) => {
  await runScenario(page, 'transient-write-failure');

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(blocking).toEqual([]);
});

test('the running page makes no request to a non-local origin', async ({ page }) => {
  const externalRequests: string[] = [];

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      !url.startsWith(BASE_URL) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:') &&
      !url.startsWith('about:')
    ) {
      externalRequests.push(url);
    }
    await route.continue();
  });

  await runScenario(page, 'invalid-input');
  await expect(page.getByTestId('final-status')).toHaveText('Rejected');

  expect(externalRequests).toEqual([]);
});

test('the workflow still runs when every non-local request is blocked', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.startsWith(BASE_URL) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await runScenario(page, 'transient-write-failure');
  await expect(page.getByTestId('final-status')).toHaveText('Completed');
  await expect(page.getByTestId('node-attempts-write')).toHaveText('2');
});
