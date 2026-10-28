/**
 * Pure, deterministic workflow simulation.
 *
 * `executeWorkflow` performs no I/O, uses no random numbers and no timers.
 * Every outcome is modelled explicitly by the scenario definition, so the same
 * scenario always produces byte-identical results.
 */

import {
  ASSET_FAMILIES,
  ASSET_READING,
  EVALUATION_DATE,
  FLOW_NODES,
  NOMINAL_CASE_TEMPERATURE,
  PRIORITY_SCORE_THRESHOLD,
  SCENARIOS,
  nodeLabel,
  type AssetReading,
  type FinalStatus,
  type InputVariant,
  type LogEntry,
  type LogEvent,
  type NodeDefinition,
  type NodeId,
  type NodeState,
  type ScenarioDefinition,
  type ScenarioId,
} from './data';

/** Terminal status of a finished run. */
export type RunStatus = 'Completed' | 'Failed' | 'Rejected';

export interface EnrichedRecord {
  readingId: string;
  assetId: string;
  family: string;
  capturedAt: string;
  sampleCount: number;
  totalLumenHours: number;
  caseTemperature: number;
  anomalyScore: number;
  daysSinceService: number;
}

export interface RouteOutcome {
  branch: string;
  reason: string;
  anomalyScore: number;
}

export interface NodeOutcome {
  id: NodeId;
  state: NodeState;
  attempts: number;
  detail: string;
}

export interface WorkflowRun {
  scenario: ScenarioId;
  status: RunStatus;
  log: LogEntry[];
  nodes: Record<NodeId, NodeOutcome>;
  route: RouteOutcome | null;
  written: EnrichedRecord | null;
  summary: string;
}

/** Virtual cost of each log event, in milliseconds of simulated logical time. */
const EVENT_COST_MS: Record<LogEvent, number> = {
  started: 40,
  succeeded: 60,
  failed: 80,
  retry: 30,
  skipped: 5,
};

/** Look up a scenario definition. */
export function getScenario(id: ScenarioId): ScenarioDefinition {
  const definition = SCENARIOS.find((scenario) => scenario.id === id);
  if (!definition) {
    throw new Error(`Unknown scenario: ${id}`);
  }
  return definition;
}

/** Build the synthetic input payload for a scenario. */
export function buildInput(variant: InputVariant): AssetReading {
  const reading: AssetReading = {
    ...ASSET_READING,
    samples: ASSET_READING.samples.map((sample) => ({ ...sample })),
  };
  if (variant === 'missing-reading-id') {
    reading.readingId = '';
  }
  return reading;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Validate a reading. An empty list means the payload is acceptable. */
export function validateReading(reading: AssetReading): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (reading.readingId.trim() === '') {
    issues.push({ field: 'readingId', message: 'readingId is required' });
  }
  if (reading.assetId.trim() === '') {
    issues.push({ field: 'assetId', message: 'assetId is required' });
  }
  if (Number.isNaN(Date.parse(reading.capturedAt))) {
    issues.push({ field: 'capturedAt', message: 'capturedAt must be an ISO timestamp' });
  }
  if (reading.samples.length === 0) {
    issues.push({ field: 'samples', message: 'at least one sample is required' });
  }
  return issues;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return 0;
  }
  return Math.round((to - from) / 86_400_000);
}

/** Derive the normalised measures used by the route decision. */
export function enrichReading(reading: AssetReading): EnrichedRecord {
  const lumenHours = reading.samples.find((sample) => sample.metric === 'lumen-hours')?.value ?? 0;
  const caseTemperature =
    reading.samples.find((sample) => sample.metric === 'case-temperature')?.value ?? 0;
  const span = NOMINAL_CASE_TEMPERATURE.max - NOMINAL_CASE_TEMPERATURE.min;
  const raw = (caseTemperature - NOMINAL_CASE_TEMPERATURE.min) / span;
  const anomalyScore = round2(Math.min(1, Math.max(0, raw)));
  const familyKey = reading.assetId.split('-').slice(0, 2).join('-');

  return {
    readingId: reading.readingId,
    assetId: reading.assetId,
    family: ASSET_FAMILIES[familyKey] ?? 'Unclassified asset',
    capturedAt: reading.capturedAt,
    sampleCount: reading.samples.length,
    totalLumenHours: lumenHours,
    caseTemperature,
    anomalyScore,
    daysSinceService: daysBetween(reading.capturedAt, EVALUATION_DATE),
  };
}

/** Branch decision made by the route node. */
export function decideRoute(record: EnrichedRecord): RouteOutcome {
  if (record.anomalyScore >= PRIORITY_SCORE_THRESHOLD) {
    return {
      branch: 'priority-review',
      reason: `anomaly score ${record.anomalyScore} is at or above the threshold ${PRIORITY_SCORE_THRESHOLD}`,
      anomalyScore: record.anomalyScore,
    };
  }
  return {
    branch: 'standard-review',
    reason: `anomaly score ${record.anomalyScore} is below the threshold ${PRIORITY_SCORE_THRESHOLD}`,
    anomalyScore: record.anomalyScore,
  };
}

/** Fresh node outcomes, all waiting with zero attempts. */
export function createNodeOutcomes(): Record<NodeId, NodeOutcome> {
  const outcomes = {} as Record<NodeId, NodeOutcome>;
  for (const node of FLOW_NODES) {
    outcomes[node.id] = { id: node.id, state: 'waiting', attempts: 0, detail: 'Not started' };
  }
  return outcomes;
}

/** An empty run used before anything has been executed. */
export function createIdleRun(): WorkflowRun {
  return {
    scenario: 'clean',
    status: 'Completed',
    log: [],
    nodes: createNodeOutcomes(),
    route: null,
    written: null,
    summary: 'No run yet. Choose a scenario and run the workflow.',
  };
}

function failureMessage(node: NodeDefinition, attempt: number, reading: AssetReading): string {
  if (node.id === 'validate') {
    const issues = validateReading(reading);
    const detail = issues.length > 0 ? issues.map((issue) => issue.message).join('; ') : 'invalid input';
    return `payload rejected: ${detail}`;
  }
  if (node.id === 'write') {
    return `simulated sink error on attempt ${attempt}`;
  }
  return `simulated failure on attempt ${attempt}`;
}

/**
 * Execute one scenario end to end and return the complete, deterministic run.
 *
 * The result contains the full node states, the chronological log and the
 * terminal status. Nothing outside the returned object is mutated.
 */
export function executeWorkflow(scenario: ScenarioId): WorkflowRun {
  const definition = getScenario(scenario);
  const reading = buildInput(definition.inputVariant);
  // Derived once, up front: every downstream node reads the same values.
  const enriched = enrichReading(reading);
  const nodes = createNodeOutcomes();
  const log: LogEntry[] = [];
  let clock = 0;

  const push = (nodeId: NodeId, event: LogEvent, attempt: number, message: string): void => {
    clock += EVENT_COST_MS[event];
    log.push({
      seq: log.length + 1,
      nodeId,
      nodeLabel: nodeLabel(nodeId),
      event,
      attempt,
      message,
      at: `t+${String(clock).padStart(5, '0')}ms`,
    });
  };

  let route: RouteOutcome | null = null;
  let written: EnrichedRecord | null = null;
  let status: RunStatus = 'Completed';
  let halted = false;

  for (const node of FLOW_NODES) {
    if (halted) {
      push(node.id, 'skipped', 0, 'skipped after upstream failure');
      nodes[node.id].state = 'skipped';
      nodes[node.id].detail = 'Skipped after upstream failure';
      continue;
    }

    const failingAttempts = definition.failingAttempts[node.id] ?? [];
    let failed = false;

    for (let attempt = 1; attempt <= node.maxAttempts; attempt += 1) {
      push(node.id, 'started', attempt, `attempt ${attempt} started`);
      nodes[node.id].attempts = attempt;
      nodes[node.id].state = 'running';
      nodes[node.id].detail = `Attempt ${attempt} in progress`;

      const willFail = failingAttempts.includes(attempt);

      if (!willFail) {
        let detail: string;
        switch (node.id) {
          case 'trigger':
            detail = `loaded reading ${reading.readingId === '' ? '(missing id)' : reading.readingId}`;
            break;
          case 'validate':
            detail = 'payload accepted';
            break;
          case 'enrich':
            detail = `derived anomaly score ${enriched.anomalyScore}`;
            break;
          case 'route':
            route = decideRoute(enriched);
            detail = `routed to ${route.branch}`;
            break;
          case 'write':
            written = { ...enriched };
            detail = `stored record ${enriched.readingId}`;
            break;
          case 'notify':
          default:
            detail = `notification prepared for ${route ? route.branch : 'unknown branch'}`;
            break;
        }
        push(node.id, 'succeeded', attempt, detail);
        nodes[node.id].state = 'succeeded';
        nodes[node.id].detail = detail;
        break;
      }

      const message = failureMessage(node, attempt, reading);
      push(node.id, 'failed', attempt, message);
      nodes[node.id].state = 'failed';
      nodes[node.id].detail = message;

      if (attempt < node.maxAttempts) {
        push(node.id, 'retry', attempt, `retry ${attempt}`);
        nodes[node.id].state = 'running';
        nodes[node.id].detail = `retry ${attempt} scheduled`;
        continue;
      }

      failed = true;
      break;
    }

    if (failed) {
      halted = true;
      status = node.id === 'validate' ? 'Rejected' : 'Failed';
    }
  }

  const succeeded = FLOW_NODES.filter((node) => nodes[node.id].state === 'succeeded').length;
  const skipped = FLOW_NODES.filter((node) => nodes[node.id].state === 'skipped').length;
  const totalAttempts = FLOW_NODES.reduce((sum, node) => sum + nodes[node.id].attempts, 0);

  return {
    scenario: definition.id,
    status,
    log,
    nodes,
    route,
    written,
    summary: `${succeeded} of ${FLOW_NODES.length} nodes succeeded, ${skipped} skipped, ${totalAttempts} attempts recorded.`,
  };
}

function clampCursor(cursor: number, length: number): number {
  if (!Number.isFinite(cursor)) {
    return 0;
  }
  return Math.min(Math.max(Math.trunc(cursor), 0), length);
}

/** The log entries revealed up to (and excluding) the cursor. */
export function selectVisibleLog(log: LogEntry[], cursor: number): LogEntry[] {
  return log.slice(0, clampCursor(cursor, log.length));
}

/** Node states derived from the revealed part of the log. */
export function selectNodeStates(log: LogEntry[], cursor: number): Record<NodeId, NodeState> {
  const states = {} as Record<NodeId, NodeState>;
  for (const node of FLOW_NODES) {
    states[node.id] = 'waiting';
  }
  for (const entry of selectVisibleLog(log, cursor)) {
    switch (entry.event) {
      case 'started':
        states[entry.nodeId] = 'running';
        break;
      case 'succeeded':
        states[entry.nodeId] = 'succeeded';
        break;
      case 'failed':
        states[entry.nodeId] = 'failed';
        break;
      case 'skipped':
        states[entry.nodeId] = 'skipped';
        break;
      case 'retry':
        states[entry.nodeId] = 'running';
        break;
      default:
        break;
    }
  }
  return states;
}

/** Attempt counts derived from the revealed part of the log. */
export function selectAttempts(log: LogEntry[], cursor: number): Record<NodeId, number> {
  const attempts = {} as Record<NodeId, number>;
  for (const node of FLOW_NODES) {
    attempts[node.id] = 0;
  }
  for (const entry of selectVisibleLog(log, cursor)) {
    if (entry.event === 'started') {
      attempts[entry.nodeId] = entry.attempt;
    }
  }
  return attempts;
}

/** Terminal status for the revealed part of the run. */
export function selectFinalStatus(run: WorkflowRun | null, cursor: number): FinalStatus {
  if (!run) {
    return 'idle';
  }
  if (clampCursor(cursor, run.log.length) < run.log.length) {
    return 'Running';
  }
  return run.status;
}

/** Route outcome, available once the route node has succeeded. */
export function selectRouteOutcome(
  run: WorkflowRun | null,
  cursor: number,
): RouteOutcome | null {
  if (!run) {
    return null;
  }
  const states = selectNodeStates(run.log, cursor);
  if (states.route !== 'succeeded') {
    return null;
  }
  return run.route;
}
