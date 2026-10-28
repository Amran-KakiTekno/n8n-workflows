# Workflow Resilience Lab (`n8n-workflows`)

A clean-room, fully client-side single-page demo of **workflow orchestration patterns**. It shows
validation, branching, bounded retry, per-node state and a chronological execution log for a small
six-node flow.

> **This is a pattern simulation, not an n8n installation and not a workflow collection.**
> The page does not run n8n, does not embed an n8n workflow export, and cannot be imported into n8n.
> The flow, the payload and every log message were invented for this demo. Nothing here is
> derived from a real workflow definition, a real asset record, a customer system or any
> credential.

## What it demonstrates

The demo runs one synthetic asset reading through six nodes:

```
trigger → validate → enrich → route → write → notify
```

| Node | Stage | Retry budget | Behaviour |
|---|---|---:|---|
| `trigger` | Source | 1 | Loads the synthetic reading into the run. |
| `validate` | Guard | 1 | Rejects a malformed payload before any downstream work. |
| `enrich` | Transform | 1 | Derives normalised measures from the raw samples. |
| `route` | Decision | 1 | Chooses `priority-review` or `standard-review` from the anomaly score. |
| `write` | Sink | 2 | Stores the enriched record; the only node with a retry budget. |
| `notify` | Side effect | 1 | Prepares the outcome notification. |

Four scenarios are selectable:

| Scenario | Outcome | Key behaviour |
|---|---|---|
| Clean run | `Completed` | All six nodes succeed, one attempt each. |
| Transient write failure | `Completed` | `write` fails attempt 1, records `retry 1`, succeeds on attempt 2. |
| Persistent write failure | `Failed` | `write` fails both allowed attempts and stops; there is no third attempt and `notify` is skipped. |
| Invalid input | `Rejected` | `validate` fails; `enrich`, `route`, `write` and `notify` are skipped. |

The log can be stepped through event by event (`Step back` / `Step forward`), and `Replay scenario`
re-executes the current scenario from scratch, so no state leaks between runs.

## Synthetic data

The single payload in `src/data.ts` is invented:

```ts
{
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
}
```

The identifiers, the sensor values, the asset family and the derived measures (anomaly score
`0.91`, `79` days since service, branch `priority-review`) are all made up for the demo. The
`Invalid input` scenario removes `readingId` from a copy of this payload so that validation can
reject it.

## Architecture

| File | Purpose |
|---|---|
| `src/data.ts` | Presentation metadata: node definitions, the invented reading, the scenario catalogue. |
| `src/domain.ts` | Pure deterministic simulation: `executeWorkflow(scenario)` plus log/attempt/state selectors. No I/O, no timers, no randomness. |
| `src/App.tsx` | Accessible scenario controls, node diagram, route/status panel and the log viewer. |
| `src/styles.css` | Dark lab styling, responsive down to 390 px. |
| `src/domain.test.ts` | Vitest suite pinning every scenario contract, retry bound, skip, log order and replay purity. |
| `tests/demo.spec.ts` | Playwright suite: scenario behaviour, replay, reset, stepping, 390 px overflow, axe, offline runtime. |
| `scripts/verify-build.mjs` | Static build gate: exactly one HTML file, non-empty JS/CSS, demo marker. |

The simulation is fully deterministic: the same scenario always produces the same node states, the
same attempt counts and the same ordered log. The log carries a simulated logical clock
(`t+00140ms`) instead of a wall-clock timestamp so that replays are byte-identical.

## Commands

```bash
npm install          # install dependencies
npm run dev          # dev server on http://127.0.0.1:4104
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit suite (src/domain.test.ts)
npm run build        # typecheck + production build into dist/
npm run test:e2e     # Playwright against `vite preview` on port 4104 (system Chrome)
npm run verify       # typecheck -> unit -> build -> Playwright -> verify-build
```

`npm run verify` finishes by printing `VERIFY_OK n8n-workflows`.

## Constraints

- No backend, no API, no external request, no analytics, no fonts or assets from a CDN.
- No persistence: nothing is stored in cookies, `localStorage` or `sessionStorage`.
- No workflow import/export, no credentials, no routing, no additional pages.
- The build output is a static `dist/` folder containing exactly one HTML file.
