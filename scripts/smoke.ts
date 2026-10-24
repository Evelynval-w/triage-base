import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { LLM_MODEL, runTriage } from "../lib/llm";
import { PROMPT_VERSION } from "../lib/prompt";
import { LlmInvalidOutputError } from "../lib/errors";
import { priceFor } from "../lib/pricing";

type LabelledTicket = {
  ticket_id: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  tags: string;
  language?: string;
};

type Outcome =
  | "ok"
  | "invalid_model_output"
  | "rate_limited"
  | "triage_unavailable"
  | "triage_timeout"
  | "internal_error";

type Row = {
  ticket_id: string;
  expected: { category: string; priority: string };
  predicted: {
    category: string | null;
    priority: string | null;
    summary?: string;
    suggested_action?: string;
  };
  outcome: Outcome;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  tags: string;
};

const CATEGORIES = [
  "billing",
  "technical_bug",
  "account",
  "feature_request",
] as const;

function parseArgs(): { limit: number } {
  const args = process.argv.slice(2);
  let limit = Infinity;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return { limit };
}

function classify(err: unknown): Outcome {
  if (err instanceof LlmInvalidOutputError) return "invalid_model_output";
  if (err instanceof OpenAI.APIError) {
    const s = err.status ?? 500;
    if (s === 429) return "rate_limited";
    if (s === 408) return "triage_timeout";
    if (s >= 500) return "triage_unavailable";
    return "internal_error";
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "triage_timeout";
  if (err instanceof OpenAI.APIConnectionError) return "triage_unavailable";
  return "internal_error";
}

async function main() {
  if (!process.env.LLM_API_KEY) {
    console.error(
      "LLM_API_KEY is not set. Run with: node --env-file=.env.local --import tsx scripts/smoke.ts  (or: npm run smoke)",
    );
    process.exit(2);
  }

  const { limit } = parseArgs();
  const raw = await readFile(
    "data/support_tickets_100_labelled.json",
    "utf8",
  );
  const dev = (JSON.parse(raw) as LabelledTicket[]).slice(0, limit);

  console.log(
    `Running ${dev.length} tickets | model=${LLM_MODEL} | prompt=${PROMPT_VERSION}`,
  );

  const rows: Row[] = [];
  for (let i = 0; i < dev.length; i++) {
    const t = dev[i];
    const start = Date.now();
    try {
      const { result, usage } = await runTriage({
        subject: t.subject,
        body: t.body,
      });
      const inputTokens = usage?.prompt_tokens ?? null;
      const outputTokens = usage?.completion_tokens ?? null;
      rows.push({
        ticket_id: t.ticket_id,
        expected: { category: t.category, priority: t.priority },
        predicted: { ...result },
        outcome: "ok",
        duration_ms: Date.now() - start,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: priceFor(LLM_MODEL, inputTokens, outputTokens),
        tags: t.tags,
      });
    } catch (err) {
      rows.push({
        ticket_id: t.ticket_id,
        expected: { category: t.category, priority: t.priority },
        predicted: { category: null, priority: null },
        outcome: classify(err),
        duration_ms: Date.now() - start,
        input_tokens: null,
        output_tokens: null,
        cost_usd: null,
        tags: t.tags,
      });
    }
    const last = rows[rows.length - 1];
    process.stdout.write(
      `\r[${String(i + 1).padStart(3, " ")}/${dev.length}] ${t.ticket_id} ${last.outcome.padEnd(22, " ")}`,
    );
  }
  process.stdout.write("\n");

  const summary = summarize(rows);
  printSummary(summary);
  await save(rows, summary);
}

function summarize(rows: Row[]) {
  const outcome_counts: Record<string, number> = {};
  const confusion: Record<string, Record<string, number>> = {};
  for (const c of CATEGORIES) {
    confusion[c] = Object.fromEntries(
      [...CATEGORIES, "errored"].map((x) => [x, 0]),
    );
  }

  let catCorrect = 0;
  let priCorrect = 0;
  let okCount = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalMs = 0;
  let totalCost = 0;
  let hasCost = false;

  for (const r of rows) {
    outcome_counts[r.outcome] = (outcome_counts[r.outcome] ?? 0) + 1;
    totalMs += r.duration_ms;
    totalIn += r.input_tokens ?? 0;
    totalOut += r.output_tokens ?? 0;
    if (r.cost_usd !== null) {
      totalCost += r.cost_usd;
      hasCost = true;
    }

    const exp = r.expected.category;
    if (r.outcome === "ok") {
      okCount++;
      if (r.predicted.category === r.expected.category) catCorrect++;
      if (r.predicted.priority === r.expected.priority) priCorrect++;
      const pred = r.predicted.category ?? "errored";
      if (confusion[exp]) {
        confusion[exp][pred] = (confusion[exp][pred] ?? 0) + 1;
      }
    } else if (confusion[exp]) {
      confusion[exp]["errored"]++;
    }
  }

  return {
    outcome_counts,
    category_accuracy: okCount ? catCorrect / okCount : null,
    priority_accuracy: okCount ? priCorrect / okCount : null,
    confusion_matrix: confusion,
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
    total_duration_ms: totalMs,
    total_cost_usd: hasCost ? totalCost : null,
    count: rows.length,
    ok_count: okCount,
  };
}

function printSummary(s: ReturnType<typeof summarize>) {
  console.log("\n=== Outcome counts ===");
  for (const [k, v] of Object.entries(s.outcome_counts)) {
    console.log(`  ${k.padEnd(22, " ")} ${v}`);
  }

  const pct = (n: number | null) =>
    n === null ? "—" : `${(n * 100).toFixed(1)}%`;
  console.log("\n=== Accuracy (ok rows only) ===");
  console.log(`  category: ${pct(s.category_accuracy)} (${s.ok_count} rows)`);
  console.log(`  priority: ${pct(s.priority_accuracy)} (${s.ok_count} rows)`);

  console.log("\n=== Confusion matrix — rows: expected, cols: predicted ===");
  const cols = [...CATEGORIES, "errored"];
  const header = ["expected\\pred", ...cols].map((h) => h.padStart(16, " "));
  console.log(header.join(""));
  for (const c of CATEGORIES) {
    const row = [c, ...cols.map((x) => String(s.confusion_matrix[c][x] ?? 0))];
    console.log(row.map((cell) => cell.padStart(16, " ")).join(""));
  }

  const costStr =
    s.total_cost_usd !== null ? ` cost=$${s.total_cost_usd.toFixed(6)}` : "";
  console.log(
    `\nTotals: input=${s.total_input_tokens} tokens, output=${s.total_output_tokens} tokens, duration=${(s.total_duration_ms / 1000).toFixed(1)}s${costStr}`,
  );
}

async function save(rows: Row[], summary: ReturnType<typeof summarize>) {
  const date = new Date().toISOString().slice(0, 10);
  const modelSlug = LLM_MODEL.replace(/\//g, "_");
  const path = join("runs", `${date}-${PROMPT_VERSION}-${modelSlug}.json`);
  await mkdir("runs", { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        prompt_version: PROMPT_VERSION,
        model: LLM_MODEL,
        ...summary,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nSaved: ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
