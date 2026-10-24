"use client";

import { useState, type FormEvent } from "react";

type Row = {
  ticket_id: string;
  expected: { category: string | null; priority: string | null };
  predicted: {
    category: string | null;
    priority: string | null;
    summary?: string;
    suggested_action?: string;
  };
  outcome: string;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  tags?: string;
};

type Summary = {
  outcome_counts: Record<string, number>;
  count: number;
  ok_count: number;
  category_match: number;
  category_mismatch: number;
  priority_match: number;
  priority_mismatch: number;
  category_accuracy: number | null;
  priority_accuracy: number | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_duration_ms: number;
  total_cost_usd: number | null;
};

type SmokeResponse = {
  dataset: "labelled100" | "unlabelled500";
  sample_size: number;
  seed: number;
  model: string;
  saved: string | null;
  rows: Row[];
  summary: Summary;
};

export default function SmokePage() {
  const [dataset, setDataset] = useState<"labelled100" | "unlabelled500">(
    "labelled100",
  );
  const [sampleSize, setSampleSize] = useState(10);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SmokeResponse | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning) return;
    setIsRunning(true);
    setError(null);
    setData(null);

    try {
      const response = await fetch("/api/smoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset, sample_size: sampleSize }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const detail =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : "unknown error";
        throw new Error(detail);
      }
      setData(json as SmokeResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="admin">
      <h1>Smoke test</h1>
      <p>
        Pick a dataset and a sample size, then run the triage against those
        tickets.
      </p>

      <section>
        <form onSubmit={onSubmit} aria-busy={isRunning}>
          <label htmlFor="dataset">Dataset</label>
          <select
            id="dataset"
            value={dataset}
            onChange={(e) =>
              setDataset(e.target.value as "labelled100" | "unlabelled500")
            }
            disabled={isRunning}
          >
            <option value="labelled100">labelled 100 (with ground truth)</option>
            <option value="unlabelled500">unlabelled 500</option>
          </select>

          <label htmlFor="sampleSize">Sample size (random)</label>
          <input
            id="sampleSize"
            type="number"
            min={1}
            max={100}
            value={sampleSize}
            onChange={(e) => setSampleSize(Number(e.target.value))}
            disabled={isRunning}
            required
          />

          <button type="submit" disabled={isRunning}>
            {isRunning ? "Running..." : "Run smoke test"}
          </button>
          {error && <p role="alert">{error}</p>}
          <p style={{ fontSize: "0.85rem", color: "#555" }}>
            Each ticket takes a few seconds. A sample of 100 can run for several
            minutes.
          </p>
        </form>
      </section>

      {data && (
        <>
          <section>
            <h2>Summary</h2>
            <table>
              <tbody>
                <tr>
                  <th>Model</th>
                  <td>{data.model}</td>
                </tr>
                <tr>
                  <th>Dataset</th>
                  <td>{data.dataset}</td>
                </tr>
                <tr>
                  <th>Sample size</th>
                  <td>{data.sample_size}</td>
                </tr>
                <tr>
                  <th>Seed</th>
                  <td>{data.seed}</td>
                </tr>
                <tr>
                  <th>Outcomes</th>
                  <td>
                    {Object.entries(data.summary.outcome_counts)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(" · ")}
                  </td>
                </tr>
                {data.dataset === "labelled100" && (
                  <>
                    <tr>
                      <th>Category mismatches</th>
                      <td>
                        {data.summary.category_mismatch} / {data.summary.ok_count}
                        {data.summary.category_accuracy !== null && (
                          <> ({(data.summary.category_accuracy * 100).toFixed(1)}% accuracy)</>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <th>Priority mismatches</th>
                      <td>
                        {data.summary.priority_mismatch} / {data.summary.ok_count}
                        {data.summary.priority_accuracy !== null && (
                          <> ({(data.summary.priority_accuracy * 100).toFixed(1)}% accuracy)</>
                        )}
                      </td>
                    </tr>
                  </>
                )}
                <tr>
                  <th>Tokens (in / out)</th>
                  <td>
                    {data.summary.total_input_tokens.toLocaleString()} /{" "}
                    {data.summary.total_output_tokens.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <th>Total duration</th>
                  <td>{(data.summary.total_duration_ms / 1000).toFixed(1)}s</td>
                </tr>
                <tr>
                  <th>Total cost</th>
                  <td>
                    {data.summary.total_cost_usd !== null
                      ? `$${data.summary.total_cost_usd.toFixed(6)}`
                      : "—"}
                  </td>
                </tr>
                {data.saved && (
                  <tr>
                    <th>Saved run</th>
                    <td>runs/{data.saved}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section>
            <h2>Rows</h2>
            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Outcome</th>
                  {data.dataset === "labelled100" && <th>Expected cat</th>}
                  <th>Predicted cat</th>
                  {data.dataset === "labelled100" && <th>Expected pri</th>}
                  <th>Predicted pri</th>
                  <th>In tok</th>
                  <th>Out tok</th>
                  <th>Cost</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const catMiss =
                    data.dataset === "labelled100" &&
                    r.outcome === "ok" &&
                    r.predicted.category !== r.expected.category;
                  const priMiss =
                    data.dataset === "labelled100" &&
                    r.outcome === "ok" &&
                    r.predicted.priority !== r.expected.priority;
                  return (
                    <tr key={r.ticket_id}>
                      <td>{r.ticket_id}</td>
                      <td>{r.outcome}</td>
                      {data.dataset === "labelled100" && (
                        <td>{r.expected.category ?? "—"}</td>
                      )}
                      <td style={catMiss ? { color: "#a51d25" } : undefined}>
                        {r.predicted.category ?? "—"}
                      </td>
                      {data.dataset === "labelled100" && (
                        <td>{r.expected.priority ?? "—"}</td>
                      )}
                      <td style={priMiss ? { color: "#a51d25" } : undefined}>
                        {r.predicted.priority ?? "—"}
                      </td>
                      <td>{r.input_tokens ?? "—"}</td>
                      <td>{r.output_tokens ?? "—"}</td>
                      <td>
                        {r.cost_usd !== null
                          ? `$${r.cost_usd.toFixed(6)}`
                          : "—"}
                      </td>
                      <td>{r.duration_ms} ms</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
