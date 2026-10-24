import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { LLM_MODEL, runTriage } from "../../../lib/llm";
import { PROMPT_VERSION } from "../../../lib/prompt";
import { LlmInvalidOutputError } from "../../../lib/errors";
import { priceFor } from "../../../lib/pricing";
import { providerFromBaseUrl } from "../../../lib/config";
import { logCall } from "../../../lib/logging";

// Smoke runs can be long. Allow up to 10 min per request.
export const maxDuration = 600;

type Dataset = "labelled100" | "unlabelled500";

const DATASET_FILES: Record<Dataset, string> = {
  labelled100: "data/support_tickets_100_labelled.json",
  unlabelled500: "data/support_tickets_500.json",
};

const MAX_SAMPLE = 100;
const PROVIDER = providerFromBaseUrl(process.env.LLM_BASE_URL);

type Ticket = {
  ticket_id: string;
  subject: string;
  body: string;
  category?: string;
  priority?: string;
  tags?: string;
  language?: string;
};

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

function classify(err: unknown): string {
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

// Mulberry32: tiny deterministic PRNG so a given seed gives the same sample.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample<T>(arr: T[], n: number, seed: number): T[] {
  const rng = makeRng(seed);
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "body must be an object" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const dataset = b.dataset as Dataset | undefined;
  const sampleSize = Number(b.sample_size);
  const seed =
    typeof b.seed === "number" ? b.seed : Math.floor(Math.random() * 1e9);

  if (!dataset || !(dataset in DATASET_FILES)) {
    return Response.json(
      { error: "dataset must be 'labelled100' or 'unlabelled500'" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(sampleSize) || sampleSize < 1 || sampleSize > MAX_SAMPLE) {
    return Response.json(
      { error: `sample_size must be between 1 and ${MAX_SAMPLE}` },
      { status: 400 },
    );
  }

  const raw = await readFile(DATASET_FILES[dataset], "utf8");
  const all = JSON.parse(raw) as Ticket[];
  const chosen = sample(all, sampleSize, seed);

  const rows: Row[] = [];
  for (const t of chosen) {
    const start = Date.now();
    try {
      const { result, usage } = await runTriage({
        subject: t.subject,
        body: t.body,
      });
      const inputTokens = usage?.prompt_tokens ?? null;
      const outputTokens = usage?.completion_tokens ?? null;
      const costUsd = priceFor(LLM_MODEL, inputTokens, outputTokens);
      rows.push({
        ticket_id: t.ticket_id,
        expected: {
          category: t.category ?? null,
          priority: t.priority ?? null,
        },
        predicted: { ...result },
        outcome: "ok",
        duration_ms: Date.now() - start,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        tags: t.tags,
      });
      await logCall({
        route: "triage",
        api: "chat_completions",
        prompt_ver: PROMPT_VERSION,
        provider: PROVIDER,
        model: LLM_MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        duration_ms: Date.now() - start,
        outcome: "ok",
        http_status: 200,
      });
    } catch (err) {
      rows.push({
        ticket_id: t.ticket_id,
        expected: {
          category: t.category ?? null,
          priority: t.priority ?? null,
        },
        predicted: { category: null, priority: null },
        outcome: classify(err),
        duration_ms: Date.now() - start,
        input_tokens: null,
        output_tokens: null,
        cost_usd: null,
        tags: t.tags,
      });
    }
  }

  const summary = summarize(rows, dataset);

  // Only write a run file for the labelled set so we have ground truth.
  let saved: string | null = null;
  if (dataset === "labelled100") {
    const date = new Date().toISOString().slice(0, 10);
    const modelSlug = LLM_MODEL.replace(/\//g, "_");
    const file = `${date}-${PROMPT_VERSION}-${modelSlug}-fe-n${chosen.length}.json`;
    const path = join("runs", file);
    await mkdir("runs", { recursive: true });
    await writeFile(
      path,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          prompt_version: PROMPT_VERSION,
          model: LLM_MODEL,
          dataset,
          sample_size: chosen.length,
          seed,
          ...summary,
          rows,
        },
        null,
        2,
      ),
    );
    saved = file;
  }

  return Response.json({
    dataset,
    sample_size: chosen.length,
    seed,
    model: LLM_MODEL,
    saved,
    rows,
    summary,
  });
}

function summarize(rows: Row[], dataset: Dataset) {
  const outcome_counts: Record<string, number> = {};
  let totalIn = 0;
  let totalOut = 0;
  let totalMs = 0;
  let totalCost = 0;
  let hasCost = false;

  let okCount = 0;
  let catMatch = 0;
  let priMatch = 0;
  let catMismatch = 0;
  let priMismatch = 0;

  for (const r of rows) {
    outcome_counts[r.outcome] = (outcome_counts[r.outcome] ?? 0) + 1;
    totalMs += r.duration_ms;
    totalIn += r.input_tokens ?? 0;
    totalOut += r.output_tokens ?? 0;
    if (r.cost_usd !== null) {
      totalCost += r.cost_usd;
      hasCost = true;
    }

    if (r.outcome === "ok" && dataset === "labelled100") {
      okCount++;
      if (r.predicted.category === r.expected.category) catMatch++;
      else catMismatch++;
      if (r.predicted.priority === r.expected.priority) priMatch++;
      else priMismatch++;
    }
  }

  return {
    outcome_counts,
    count: rows.length,
    ok_count: okCount,
    category_match: catMatch,
    category_mismatch: catMismatch,
    priority_match: priMatch,
    priority_mismatch: priMismatch,
    category_accuracy: okCount ? catMatch / okCount : null,
    priority_accuracy: okCount ? priMatch / okCount : null,
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
    total_duration_ms: totalMs,
    total_cost_usd: hasCost ? totalCost : null,
  };
}
