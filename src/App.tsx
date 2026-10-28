import { useMemo, useState } from 'react';
import {
  FLOW_NODES,
  SCENARIOS,
  type NodeState,
  type ScenarioId,
} from './data';
import {
  executeWorkflow,
  selectAttempts,
  selectFinalStatus,
  selectNodeStates,
  selectRouteOutcome,
  selectVisibleLog,
  type WorkflowRun,
} from './domain';

const STATE_LABEL: Record<NodeState, string> = {
  waiting: 'waiting',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
};

function scenarioIdOf(value: string): ScenarioId {
  return value as ScenarioId;
}

export default function App() {
  const [scenario, setScenario] = useState<ScenarioId>('clean');
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [cursor, setCursor] = useState(0);

  const logLength = run ? run.log.length : 0;
  const visibleLog = useMemo(
    () => (run ? selectVisibleLog(run.log, cursor) : []),
    [run, cursor],
  );
  const states = useMemo(
    () => (run ? selectNodeStates(run.log, cursor) : null),
    [run, cursor],
  );
  const attempts = useMemo(
    () => (run ? selectAttempts(run.log, cursor) : null),
    [run, cursor],
  );
  const finalStatus = selectFinalStatus(run, cursor);
  const routeOutcome = selectRouteOutcome(run, cursor);
  const activeScenario = SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[0];

  const handleScenarioChange = (next: ScenarioId): void => {
    // Switching scenario clears the previous result so no state leaks between runs.
    setScenario(next);
    setRun(null);
    setCursor(0);
  };

  const handleRun = (): void => {
    const result = executeWorkflow(scenario);
    setRun(result);
    setCursor(result.log.length);
  };

  const handleReplay = (): void => {
    if (!run) {
      handleRun();
      return;
    }
    const result = executeWorkflow(run.scenario);
    setRun(result);
    setCursor(result.log.length);
  };

  const handleReset = (): void => {
    setRun(null);
    setCursor(0);
  };

  const handleStepForward = (): void => {
    setCursor((current) => Math.min(current + 1, logLength));
  };

  const handleStepBack = (): void => {
    setCursor((current) => Math.max(current - 1, 0));
  };

  const handleShowAll = (): void => {
    setCursor(logLength);
  };

  const statusText = finalStatus === 'idle' ? 'Not run' : finalStatus;

  return (
    <div className="app">
      <header className="site-header">
        <p className="eyebrow">Dual Orbit — workflow orchestration patterns</p>
        <h1>Workflow Resilience Lab</h1>
        <p className="lede">
          A clean-room, fully client-side simulation of a six-node workflow. It models validation,
          branching, bounded retry, per-node state and a chronological execution log. Nothing here
          runs n8n, and no workflow definition is imported or exported.
        </p>
        <ul className="notices">
          <li className="notice notice-synthetic" data-testid="notice-synthetic">
            Synthetic data
          </li>
          <li className="notice notice-simulation" data-testid="notice-simulation">
            Browser simulation — no n8n runtime
          </li>
        </ul>
      </header>

      <main>
        <section className="panel" aria-labelledby="scenario-heading">
          <h2 id="scenario-heading">1. Choose a scenario</h2>
          <fieldset className="scenario-fieldset">
            <legend className="visually-hidden">Workflow scenario</legend>
            {SCENARIOS.map((item) => (
              <label className="scenario-option" key={item.id} htmlFor={`scenario-${item.id}`}>
                <input
                  type="radio"
                  id={`scenario-${item.id}`}
                  name="scenario"
                  value={item.id}
                  data-testid={`scenario-radio-${item.id}`}
                  checked={scenario === item.id}
                  onChange={() => handleScenarioChange(scenarioIdOf(item.id))}
                />
                <span className="scenario-option-body">
                  <span className="scenario-option-label">{item.label}</span>
                  <span className="scenario-option-summary">{item.summary}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <p className="expectation" data-testid="scenario-expectation">
            {activeScenario.expectation}
          </p>

          <div className="button-row">
            <button type="button" className="button button-primary" onClick={handleRun} data-testid="run-workflow">
              Run workflow
            </button>
            <button
              type="button"
              className="button"
              onClick={handleReplay}
              data-testid="replay-workflow"
              disabled={!run}
            >
              Replay scenario
            </button>
            <button type="button" className="button" onClick={handleReset} data-testid="reset-workflow">
              Reset workflow
            </button>
          </div>
        </section>

        <section className="panel" aria-labelledby="flow-heading">
          <h2 id="flow-heading">2. Node states</h2>
          <p className="panel-note">
            Flow: <code>trigger → validate → enrich → route → write → notify</code>. The write node is
            the only node with a retry budget of two attempts; every other node is limited to one.
          </p>
          <ol className="flow" data-testid="flow-nodes">
            {FLOW_NODES.map((node) => {
              const state: NodeState = states ? states[node.id] : 'waiting';
              const attemptCount = attempts ? attempts[node.id] : 0;
              return (
                <li className="flow-node" key={node.id} data-testid={`node-card-${node.id}`}>
                  <div className="flow-node-head">
                    <span className="flow-node-label">{node.label}</span>
                    <span className={`state-badge state-${state}`} data-testid={`node-state-${node.id}`}>
                      {STATE_LABEL[state]}
                    </span>
                  </div>
                  <p className="flow-node-stage">{node.stage}</p>
                  <p className="flow-node-purpose">{node.purpose}</p>
                  <p className="flow-node-attempts">
                    attempts:{' '}
                    <span data-testid={`node-attempts-${node.id}`}>{attemptCount}</span>
                  </p>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="panel" aria-labelledby="outcome-heading">
          <h2 id="outcome-heading">3. Route output and final status</h2>
          <div className="outcome-grid">
            <div className="outcome-card">
              <h3>Route output</h3>
              <p className="outcome-value" data-testid="route-output">
                {routeOutcome ? routeOutcome.branch : '—'}
              </p>
              <p className="outcome-detail" data-testid="route-reason">
                {routeOutcome ? routeOutcome.reason : 'The route node has not produced a branch yet.'}
              </p>
            </div>
            <div className="outcome-card">
              <h3>Final status</h3>
              <p
                className={`outcome-value status-${finalStatus.toLowerCase()}`}
                data-testid="final-status"
              >
                {statusText}
              </p>
              <p className="outcome-detail" data-testid="run-summary">
                {run ? run.summary : 'No run yet. Choose a scenario and run the workflow.'}
              </p>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="log-heading">
          <h2 id="log-heading">4. Execution log</h2>
          <p className="panel-note">
            Chronological events with simulated logical time. Step through the log to replay the run
            one event at a time.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={handleStepBack}
              data-testid="step-back"
              disabled={!run || cursor === 0}
            >
              Step back
            </button>
            <button
              type="button"
              className="button"
              onClick={handleStepForward}
              data-testid="step-forward"
              disabled={!run || cursor >= logLength}
            >
              Step forward
            </button>
            <button
              type="button"
              className="button"
              onClick={handleShowAll}
              data-testid="show-all"
              disabled={!run || cursor >= logLength}
            >
              Show full log
            </button>
            <span className="cursor-readout" data-testid="log-cursor">
              {cursor} / {logLength} events
            </span>
          </div>

          {visibleLog.length === 0 ? (
            <p className="empty-note" data-testid="log-empty">
              No events yet. Run a scenario to record the execution log.
            </p>
          ) : (
            <ol className="log" data-testid="execution-log">
              {visibleLog.map((entry) => (
                <li className="log-entry" key={entry.seq} data-testid={`log-entry-${entry.seq}`}>
                  <span className="log-seq">#{entry.seq}</span>
                  <span className="log-node" data-testid="log-entry-node">
                    {entry.nodeLabel}
                  </span>
                  <span className={`log-event log-event-${entry.event}`} data-testid="log-entry-event">
                    {entry.event}
                  </span>
                  <span className="log-message" data-testid="log-entry-message">
                    {entry.message}
                  </span>
                  <span className="log-time">{entry.at}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <p>
          Synthetic data · Browser simulation — no n8n runtime. The six-node flow, the payload and
          every log message are invented for this demo; the page has no backend, performs no
          network request and stores nothing.
        </p>
      </footer>
    </div>
  );
}
