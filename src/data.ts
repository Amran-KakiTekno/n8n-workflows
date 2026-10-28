/**
 * Static UI metadata for the Workflow Resilience Lab demo.
 *
 * Everything in this file is invented for this demo. It is presentation data
 * (node labels, a synthetic sensor reading, scenario definitions) and it is
 * deliberately NOT an n8n workflow export: there is no n8n JSON schema, no
 * n8n node type registry, no credentials and no real asset identifiers here.
 */

/** The six nodes of the demo flow: trigger -> validate -> enrich -> route -> write -> notify. */
export type NodeId = 'trigger' | 'validate' | 'enrich' | 'route' | 'write' | 'notify';

/** Lifecycle state of a single node inside one run. */
export type NodeState = 'waiting' | 'running' | 'succeeded' | 'failed' | 'skipped';

/** Kind of entry written to the chronological execution log. */
export type LogEvent = 'started' | 'succeeded' | 'failed' | 'retry' | 'skipped';

/** One chronological entry of the execution log. */
export interface LogEntry {
  /** 1-based position in the log. */
  seq: number;
  nodeId: NodeId;
  nodeLabel: string;
  event: LogEvent;
  /** Attempt number the event belongs to; 0 for skipped nodes. */
  attempt: number;
  message: string;
  /** Simulated logical timestamp, for example `t+00140ms`. */
  at: string;
}

/** The four scenarios the user can run. */
export type ScenarioId =
  | 'clean'
  | 'transient-write-failure'
  | 'persistent-write-failure'
  | 'invalid-input';

/** Status shown in the run summary panel. */
export type FinalStatus = 'idle' | 'Running' | 'Completed' | 'Failed' | 'Rejected';

/** Which synthetic input payload the scenario starts from. */
export type InputVariant = 'valid' | 'missing-reading-id';

export interface NodeDefinition {
  id: NodeId;
  label: string;
  purpose: string;
  stage: string;
  /** Retry bound: the maximum number of attempts this node may ever make. */
  maxAttempts: number;
}

/** The flow definition. `maxAttempts` is the bounded-retry budget of each node. */
export const FLOW_NODES: readonly NodeDefinition[] = [
  {
    id: 'trigger',
    label: 'Trigger',
    purpose: 'Loads one synthetic asset reading into the run.',
    stage: 'Source',
    maxAttempts: 1,
  },
  {
    id: 'validate',
    label: 'Validate',
    purpose: 'Rejects malformed payloads before any downstream work happens.',
    stage: 'Guard',
    maxAttempts: 1,
  },
  {
    id: 'enrich',
    label: 'Enrich',
    purpose: 'Derives normalised measures from the raw sensor samples.',
    stage: 'Transform',
    maxAttempts: 1,
  },
  {
    id: 'route',
    label: 'Route',
    purpose: 'Chooses the review branch from the enriched anomaly score.',
    stage: 'Decision',
    maxAttempts: 1,
  },
  {
    id: 'write',
    label: 'Write',
    purpose: 'Stores the enriched record in the simulated sink store.',
    stage: 'Sink',
    maxAttempts: 2,
  },
  {
    id: 'notify',
    label: 'Notify',
    purpose: 'Prepares the outcome notification for the chosen branch.',
    stage: 'Side effect',
    maxAttempts: 1,
  },
];

/** Ordered node identifiers, handy for iteration in tests. */
export const NODE_IDS: readonly NodeId[] = FLOW_NODES.map((node) => node.id);

export interface ReadingSample {
  metric: string;
  value: number;
  unit: string;
}

/** The single invented asset-reading payload used by the demo. */
export interface AssetReading {
  readingId: string;
  assetId: string;
  capturedAt: string;
  sourceChannel: string;
  operatorLane: string;
  samples: ReadingSample[];
}

/**
 * Synthetic asset reading. The identifiers are invented for the demo and do
 * not refer to any real asset, device, customer or system.
 */
export const ASSET_READING: AssetReading = {
  readingId: 'rdg-0042',
  assetId: 'AST-LAMP-07',
  capturedAt: '2026-03-14T00:00:00Z',
  sourceChannel: 'bench-2-photometric',
  operatorLane: 'lane-04',
  samples: [
    { metric: 'lumen-hours', value: 812.5, unit: 'lh' },
    { metric: 'switch-cycles', value: 46, unit: 'cycles' },
    { metric: 'case-temperature', value: 38.2, unit: 'degC' },
  ],
};

/** Fixed reference date so that derived durations stay deterministic. */
export const EVALUATION_DATE = '2026-06-01T00:00:00Z';

/** Nominal operating band of the synthetic case-temperature sample. */
export const NOMINAL_CASE_TEMPERATURE = { min: 20, max: 40 } as const;

/** Anomaly score at or above this value takes the priority branch. */
export const PRIORITY_SCORE_THRESHOLD = 0.75;

/** Asset family lookup, keyed by the first two segments of the asset id. */
export const ASSET_FAMILIES: Record<string, string> = {
  'AST-LAMP': 'Lumen fixture',
  'AST-PUMP': 'Fluid pump',
  'AST-VALVE': 'Control valve',
};

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  summary: string;
  expectation: string;
  inputVariant: InputVariant;
  /** Attempt numbers (1-based) on which the listed node fails. */
  failingAttempts: Partial<Record<NodeId, number[]>>;
}

/** The four runnable scenarios, in display order. */
export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'clean',
    label: 'Clean run',
    summary: 'Every node succeeds on its first attempt.',
    expectation: 'Final status Completed. All six nodes succeed with one attempt each.',
    inputVariant: 'valid',
    failingAttempts: {},
  },
  {
    id: 'transient-write-failure',
    label: 'Transient write failure',
    summary: 'The write node fails once, retries, then succeeds.',
    expectation:
      'Final status Completed. The write node records retry 1 and succeeds on attempt 2; every other node uses one attempt.',
    inputVariant: 'valid',
    failingAttempts: { write: [1] },
  },
  {
    id: 'persistent-write-failure',
    label: 'Persistent write failure',
    summary: 'The write node fails on both allowed attempts and the run stops.',
    expectation:
      'Final status Failed. The write node stops after two attempts (no third attempt) and the notify node is skipped.',
    inputVariant: 'valid',
    failingAttempts: { write: [1, 2] },
  },
  {
    id: 'invalid-input',
    label: 'Invalid input',
    summary: 'Validation rejects the payload, so nothing downstream runs.',
    expectation:
      'Final status Rejected. The validate node fails and enrich, route, write and notify are skipped.',
    inputVariant: 'missing-reading-id',
    failingAttempts: { validate: [1] },
  },
];

/** Human readable label for a node id. */
export function nodeLabel(id: NodeId): string {
  const definition = FLOW_NODES.find((node) => node.id === id);
  return definition ? definition.label : id;
}
