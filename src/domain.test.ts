import { describe, expect, it } from 'vitest';
import {
  ASSET_READING,
  FLOW_NODES,
  SCENARIOS,
  type LogEntry,
  type ScenarioId,
} from './data';
import {
  buildInput,
  createIdleRun,
  createNodeOutcomes,
  decideRoute,
  enrichReading,
  executeWorkflow,
  getScenario,
  selectAttempts,
  selectFinalStatus,
  selectNodeStates,
  selectRouteOutcome,
  selectVisibleLog,
  validateReading,
  type WorkflowRun,
} from './domain';

const NODE_IDS = FLOW_NODES.map((node) => node.id);

function shape(log: LogEntry[]): string[] {
  return log.map((entry) => `${entry.nodeId} ${entry.event} #${entry.attempt}`);
}

describe('scenario catalogue', () => {
  it('exposes exactly the four required scenarios in display order', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'clean',
      'transient-write-failure',
      'persistent-write-failure',
      'invalid-input',
    ]);
    expect(SCENARIOS.map((scenario) => scenario.label)).toEqual([
      'Clean run',
      'Transient write failure',
      'Persistent write failure',
      'Invalid input',
    ]);
  });

  it('models the six-node flow in order', () => {
    expect(NODE_IDS).toEqual(['trigger', 'validate', 'enrich', 'route', 'write', 'notify']);
  });

  it('gives only the write node a retry budget of two attempts', () => {
    const budgets = Object.fromEntries(
      FLOW_NODES.map((node) => [node.id, node.maxAttempts]),
    );
    expect(budgets).toEqual({
      trigger: 1,
      validate: 1,
      enrich: 1,
      route: 1,
      write: 2,
      notify: 1,
    });
  });

  it('throws for an unknown scenario id', () => {
    expect(() => getScenario('nope' as ScenarioId)).toThrow(/Unknown scenario/);
  });
});

describe('clean run', () => {
  const run = executeWorkflow('clean');

  it('finishes with status Completed', () => {
    expect(run.status).toBe('Completed');
  });

  it('succeeds every node', () => {
    for (const id of NODE_IDS) {
      expect(run.nodes[id].state).toBe('succeeded');
    }
  });

  it('uses exactly one attempt per node', () => {
    for (const id of NODE_IDS) {
      expect(run.nodes[id].attempts).toBe(1);
    }
  });

  it('records the ordered log of twelve events', () => {
    expect(shape(run.log)).toEqual([
      'trigger started #1',
      'trigger succeeded #1',
      'validate started #1',
      'validate succeeded #1',
      'enrich started #1',
      'enrich succeeded #1',
      'route started #1',
      'route succeeded #1',
      'write started #1',
      'write succeeded #1',
      'notify started #1',
      'notify succeeded #1',
    ]);
  });

  it('numbers the log sequentially from one', () => {
    expect(run.log.map((entry) => entry.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('routes to the priority branch and stores the record', () => {
    expect(run.route?.branch).toBe('priority-review');
    expect(run.written?.readingId).toBe('rdg-0042');
  });
});

describe('transient write failure', () => {
  const run = executeWorkflow('transient-write-failure');

  it('finishes with status Completed', () => {
    expect(run.status).toBe('Completed');
  });

  it('retries the write node once and succeeds on the second attempt', () => {
    expect(run.nodes.write.state).toBe('succeeded');
    expect(run.nodes.write.attempts).toBe(2);
  });

  it('records a retry 1 entry between the failed attempt and the second attempt', () => {
    const retry = run.log.find((entry) => entry.event === 'retry');
    expect(retry).toBeDefined();
    expect(retry?.nodeId).toBe('write');
    expect(retry?.message).toBe('retry 1');
    expect(retry?.seq).toBe(11);
  });

  it('keeps every other node at one attempt', () => {
    for (const id of ['trigger', 'validate', 'enrich', 'route', 'notify'] as const) {
      expect(run.nodes[id].attempts).toBe(1);
      expect(run.nodes[id].state).toBe('succeeded');
    }
  });

  it('records the ordered log of fifteen events', () => {
    expect(shape(run.log)).toEqual([
      'trigger started #1',
      'trigger succeeded #1',
      'validate started #1',
      'validate succeeded #1',
      'enrich started #1',
      'enrich succeeded #1',
      'route started #1',
      'route succeeded #1',
      'write started #1',
      'write failed #1',
      'write retry #1',
      'write started #2',
      'write succeeded #2',
      'notify started #1',
      'notify succeeded #1',
    ]);
  });

  it('still routes to the priority branch', () => {
    expect(run.route?.branch).toBe('priority-review');
  });
});

describe('persistent write failure', () => {
  const run = executeWorkflow('persistent-write-failure');

  it('finishes with status Failed', () => {
    expect(run.status).toBe('Failed');
  });

  it('stops the write node after exactly two attempts', () => {
    expect(run.nodes.write.state).toBe('failed');
    expect(run.nodes.write.attempts).toBe(2);
  });

  it('never makes a third write attempt', () => {
    const writeAttempts = run.log
      .filter((entry) => entry.nodeId === 'write' && entry.event === 'started')
      .map((entry) => entry.attempt);
    expect(writeAttempts).toEqual([1, 2]);
  });

  it('skips the notify node', () => {
    expect(run.nodes.notify.state).toBe('skipped');
    expect(run.nodes.notify.attempts).toBe(0);
  });

  it('keeps the upstream nodes succeeded', () => {
    for (const id of ['trigger', 'validate', 'enrich', 'route'] as const) {
      expect(run.nodes[id].state).toBe('succeeded');
      expect(run.nodes[id].attempts).toBe(1);
    }
  });

  it('records the ordered log of fourteen events ending in a skip', () => {
    expect(shape(run.log)).toEqual([
      'trigger started #1',
      'trigger succeeded #1',
      'validate started #1',
      'validate succeeded #1',
      'enrich started #1',
      'enrich succeeded #1',
      'route started #1',
      'route succeeded #1',
      'write started #1',
      'write failed #1',
      'write retry #1',
      'write started #2',
      'write failed #2',
      'notify skipped #0',
    ]);
  });

  it('stores no record because the write never succeeded', () => {
    expect(run.written).toBeNull();
  });
});

describe('invalid input', () => {
  const run = executeWorkflow('invalid-input');

  it('finishes with status Rejected', () => {
    expect(run.status).toBe('Rejected');
  });

  it('fails the validate node', () => {
    expect(run.nodes.validate.state).toBe('failed');
    expect(run.nodes.validate.attempts).toBe(1);
  });

  it('skips every downstream node', () => {
    for (const id of ['enrich', 'route', 'write', 'notify'] as const) {
      expect(run.nodes[id].state).toBe('skipped');
      expect(run.nodes[id].attempts).toBe(0);
    }
  });

  it('still ran the trigger once', () => {
    expect(run.nodes.trigger.state).toBe('succeeded');
    expect(run.nodes.trigger.attempts).toBe(1);
  });

  it('records the ordered log of eight events', () => {
    expect(shape(run.log)).toEqual([
      'trigger started #1',
      'trigger succeeded #1',
      'validate started #1',
      'validate failed #1',
      'enrich skipped #0',
      'route skipped #0',
      'write skipped #0',
      'notify skipped #0',
    ]);
  });

  it('reports the missing reading id as the reason', () => {
    const failure = run.log.find((entry) => entry.event === 'failed');
    expect(failure?.message).toContain('readingId is required');
  });

  it('routes nowhere', () => {
    expect(run.route).toBeNull();
  });
});

describe('determinism and replay purity', () => {
  it('produces byte-identical results for the same scenario', () => {
    for (const scenario of SCENARIOS) {
      const first = executeWorkflow(scenario.id);
      const second = executeWorkflow(scenario.id);
      expect(second).toEqual(first);
      expect(second.log).not.toBe(first.log);
    }
  });

  it('does not append to the previous run when a scenario is replayed', () => {
    const first = executeWorkflow('transient-write-failure');
    const second = executeWorkflow('transient-write-failure');
    expect(second.log.length).toBe(first.log.length);
    expect(shape(second.log)).toEqual(shape(first.log));
  });

  it('does not mutate the previous run when a new scenario is executed', () => {
    const first = executeWorkflow('clean');
    const snapshot = JSON.stringify(first);
    executeWorkflow('persistent-write-failure');
    expect(JSON.stringify(first)).toBe(snapshot);
  });

  it('does not mutate the shared scenario catalogue', () => {
    const snapshot = JSON.stringify(SCENARIOS);
    executeWorkflow('clean');
    executeWorkflow('invalid-input');
    expect(JSON.stringify(SCENARIOS)).toBe(snapshot);
  });
});

describe('reset', () => {
  it('clears the log, the attempts and the node states', () => {
    const idle = createIdleRun();
    expect(idle.log).toEqual([]);
    for (const id of NODE_IDS) {
      expect(idle.nodes[id].state).toBe('waiting');
      expect(idle.nodes[id].attempts).toBe(0);
    }
  });

  it('creates independent node outcome records', () => {
    const first = createNodeOutcomes();
    const second = createNodeOutcomes();
    first.trigger.state = 'failed';
    expect(second.trigger.state).toBe('waiting');
  });

  it('replays the same scenario after a reset with the same ordered log', () => {
    const before = executeWorkflow('transient-write-failure');
    const idle = createIdleRun();
    expect(idle.log).toEqual([]);
    const after = executeWorkflow('transient-write-failure');
    expect(shape(after.log)).toEqual(shape(before.log));
    expect(after.log.length).toBe(before.log.length);
  });
});

describe('selectors', () => {
  const run = executeWorkflow('clean');

  it('reports every node as waiting before the first event', () => {
    const states = selectNodeStates(run.log, 0);
    for (const id of NODE_IDS) {
      expect(states[id]).toBe('waiting');
    }
    expect(selectAttempts(run.log, 0)[NODE_IDS[0]]).toBe(0);
  });

  it('reports a started node as running', () => {
    const states = selectNodeStates(run.log, 1);
    expect(states.trigger).toBe('running');
    expect(states.validate).toBe('waiting');
  });

  it('reports the settled state of every node at the end of the log', () => {
    const states = selectNodeStates(run.log, run.log.length);
    for (const id of NODE_IDS) {
      expect(states[id]).toBe('succeeded');
    }
    const attempts = selectAttempts(run.log, run.log.length);
    for (const id of NODE_IDS) {
      expect(attempts[id]).toBe(1);
    }
  });

  it('clamps the cursor to the log bounds', () => {
    expect(selectVisibleLog(run.log, -5)).toEqual([]);
    expect(selectVisibleLog(run.log, 999)).toHaveLength(run.log.length);
  });

  it('reports Running until the log is fully revealed', () => {
    expect(selectFinalStatus(run, 0)).toBe('Running');
    expect(selectFinalStatus(run, run.log.length)).toBe('Completed');
    expect(selectFinalStatus(null, 0)).toBe('idle');
  });

  it('exposes the route outcome only after the route node succeeded', () => {
    expect(selectRouteOutcome(run, 6)).toBeNull();
    expect(selectRouteOutcome(run, run.log.length)?.branch).toBe('priority-review');
    expect(selectRouteOutcome(null, 0)).toBeNull();
  });

  it('counts the second write attempt only once it is revealed', () => {
    const transient = executeWorkflow('transient-write-failure');
    const beforeSecondAttempt = transient.log.findIndex(
      (entry) => entry.nodeId === 'write' && entry.event === 'started' && entry.attempt === 2,
    );
    expect(selectAttempts(transient.log, beforeSecondAttempt).write).toBe(1);
    expect(selectAttempts(transient.log, transient.log.length).write).toBe(2);
  });
});

describe('synthetic payload', () => {
  it('uses one invented asset reading', () => {
    expect(ASSET_READING.readingId).toBe('rdg-0042');
    expect(ASSET_READING.samples).toHaveLength(3);
  });

  it('accepts the valid payload', () => {
    expect(validateReading(buildInput('valid'))).toEqual([]);
  });

  it('rejects the missing-reading-id payload', () => {
    const issues = validateReading(buildInput('missing-reading-id'));
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('readingId');
  });

  it('derives deterministic measures from the payload', () => {
    const enriched = enrichReading(ASSET_READING);
    expect(enriched.family).toBe('Lumen fixture');
    expect(enriched.sampleCount).toBe(3);
    expect(enriched.totalLumenHours).toBe(812.5);
    expect(enriched.caseTemperature).toBe(38.2);
    expect(enriched.anomalyScore).toBe(0.91);
    expect(enriched.daysSinceService).toBe(79);
  });

  it('routes to the priority branch above the threshold', () => {
    const enriched = enrichReading(ASSET_READING);
    expect(decideRoute(enriched).branch).toBe('priority-review');
  });

  it('routes to the standard branch below the threshold', () => {
    const cool = enrichReading({
      ...ASSET_READING,
      samples: ASSET_READING.samples.map((sample) =>
        sample.metric === 'case-temperature' ? { ...sample, value: 22 } : { ...sample },
      ),
    });
    expect(cool.anomalyScore).toBe(0.1);
    expect(decideRoute(cool).branch).toBe('standard-review');
  });

  it('never exposes n8n workflow fields', () => {
    const run: WorkflowRun = executeWorkflow('clean');
    const serialised = JSON.stringify(run);
    expect(serialised).not.toContain('credentials');
    expect(serialised).not.toContain('n8n');
    expect(serialised).not.toContain('nodeType');
  });
});
