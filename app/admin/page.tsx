import { readLog, type LogEntry } from "../../lib/logging";
import { listRuns } from "../../lib/runs";

export const dynamic = "force-dynamic";

type Totals = {
  calls: number;
  errors: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  has_cost: boolean;
};

const EMPTY: Totals = {
  calls: 0,
  errors: 0,
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  has_cost: false,
};

function add(a: Totals, e: LogEntry): Totals {
  return {
    calls: a.calls + 1,
    errors: a.errors + (e.http_status >= 400 ? 1 : 0),
    input_tokens: a.input_tokens + (e.input_tokens ?? 0),
    output_tokens: a.output_tokens + (e.output_tokens ?? 0),
    cost_usd: a.cost_usd + (e.cost_usd ?? 0),
    has_cost: a.has_cost || e.cost_usd !== null,
  };
}

function groupBy(entries: LogEntry[], key: (e: LogEntry) => string): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const e of entries) {
    const k = key(e);
    out.set(k, add(out.get(k) ?? EMPTY, e));
  }
  return out;
}

function statusCounts(entries: LogEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    const k = `${e.http_status} ${e.outcome}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function fmtCost(n: number, hasCost: boolean): string {
  if (!hasCost) return "—";
  return `$${n.toFixed(6)}`;
}

export default async function AdminPage() {
  const [entries, runs] = await Promise.all([readLog(), listRuns()]);
  const overall = entries.reduce(add, EMPTY);
  const byPrompt = groupBy(entries, (e) => e.prompt_ver ?? "(chat)");
  const byApi = groupBy(entries, (e) => e.api);
  const byModel = groupBy(entries, (e) => e.model || "(none)");
  const statuses = statusCounts(entries);
  const recent = [...entries].reverse().slice(0, 50);

  return (
    <main className="admin">
      <h1>Admin — LLM calls</h1>
      <p>
        Reads <code>logs/llm-calls.jsonl</code>. {entries.length} total calls.
      </p>

      <section>
        <h2>Overall</h2>
        <table>
          <tbody>
            <tr>
              <th>Calls</th>
              <td>{overall.calls}</td>
            </tr>
            <tr>
              <th>Errors (status ≥ 400)</th>
              <td>{overall.errors}</td>
            </tr>
            <tr>
              <th>Input tokens</th>
              <td>{overall.input_tokens.toLocaleString()}</td>
            </tr>
            <tr>
              <th>Output tokens</th>
              <td>{overall.output_tokens.toLocaleString()}</td>
            </tr>
            <tr>
              <th>Cost (USD)</th>
              <td>{fmtCost(overall.cost_usd, overall.has_cost)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>By HTTP outcome</h2>
        <table>
          <thead>
            <tr>
              <th>Status + outcome</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {[...statuses.entries()].map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <BreakdownTable title="By prompt version" rows={byPrompt} />
      <BreakdownTable title="By API" rows={byApi} />
      <BreakdownTable title="By model" rows={byModel} />

      <section>
        <h2>Smoke-test runs (from runs/)</h2>
        {runs.length === 0 ? (
          <p>No runs yet. Try <code>npm run smoke -- --limit 5</code>.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Prompt</th>
                <th>Model</th>
                <th>Count</th>
                <th>Category acc</th>
                <th>Priority acc</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Cost</th>
                <th>Duration</th>
                <th>Outcomes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.file}>
                  <td>{r.file}</td>
                  <td>{r.prompt_version}</td>
                  <td>{r.model}</td>
                  <td>{r.count}</td>
                  <td>
                    {r.category_accuracy !== null
                      ? `${(r.category_accuracy * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td>
                    {r.priority_accuracy !== null
                      ? `${(r.priority_accuracy * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td>{r.total_input_tokens.toLocaleString()}</td>
                  <td>{r.total_output_tokens.toLocaleString()}</td>
                  <td>
                    {r.total_cost_usd !== null
                      ? `$${r.total_cost_usd.toFixed(6)}`
                      : "—"}
                  </td>
                  <td>{(r.total_duration_ms / 1000).toFixed(1)}s</td>
                  <td>
                    {Object.entries(r.outcome_counts)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(" ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Recent calls (last 50)</h2>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Route</th>
              <th>Model</th>
              <th>Prompt</th>
              <th>In</th>
              <th>Out</th>
              <th>Cost</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((e, i) => (
              <tr key={i}>
                <td>{e.ts}</td>
                <td>{e.route}</td>
                <td>{e.model}</td>
                <td>{e.prompt_ver ?? "—"}</td>
                <td>{e.input_tokens ?? "—"}</td>
                <td>{e.output_tokens ?? "—"}</td>
                <td>{e.cost_usd !== null ? `$${e.cost_usd.toFixed(6)}` : "—"}</td>
                <td>{e.duration_ms} ms</td>
                <td>{e.http_status}</td>
                <td>{e.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: Map<string, Totals>;
}) {
  return (
    <section>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Calls</th>
            <th>Errors</th>
            <th>Input tokens</th>
            <th>Output tokens</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {[...rows.entries()].map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v.calls}</td>
              <td>{v.errors}</td>
              <td>{v.input_tokens.toLocaleString()}</td>
              <td>{v.output_tokens.toLocaleString()}</td>
              <td>{fmtCost(v.cost_usd, v.has_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
