import OpenAI from "openai";
import { runTriage, LLM_MODEL } from "../../../lib/llm";
import { LlmInvalidOutputError } from "../../../lib/errors";
import { PROMPT_VERSION } from "../../../lib/prompt";
import { logCall } from "../../../lib/logging";
import { priceFor } from "../../../lib/pricing";
import { providerFromBaseUrl } from "../../../lib/config";

const MAX_TICKET_CHARS = 5000;
const PROVIDER = providerFromBaseUrl(process.env.LLM_BASE_URL);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("ticket" in body) ||
    typeof body.ticket !== "object" ||
    body.ticket === null
  ) {
    return Response.json({ error: "ticket is required." }, { status: 400 });
  }

  const ticket = body.ticket as { subject?: unknown; body?: unknown };
  if (typeof ticket.subject !== "string" || typeof ticket.body !== "string") {
    return Response.json(
      { error: "ticket.subject and ticket.body must be strings." },
      { status: 400 },
    );
  }
  if (!ticket.subject.trim() || !ticket.body.trim()) {
    return Response.json(
      { error: "ticket.subject and ticket.body must be non-empty." },
      { status: 400 },
    );
  }
  if (ticket.subject.length + ticket.body.length > MAX_TICKET_CHARS) {
    return Response.json({ error: "ticket is too long." }, { status: 400 });
  }

  const start = Date.now();
  try {
    const { result, usage } = await runTriage({
      subject: ticket.subject,
      body: ticket.body,
    });
    const inputTokens = usage?.prompt_tokens ?? null;
    const outputTokens = usage?.completion_tokens ?? null;
    await logCall({
      route: "triage",
      api: "chat_completions",
      prompt_ver: PROMPT_VERSION,
      provider: PROVIDER,
      model: LLM_MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: priceFor(LLM_MODEL, inputTokens, outputTokens),
      duration_ms: Date.now() - start,
      outcome: "ok",
      http_status: 200,
    });
    return Response.json(result);
  } catch (err) {
    const { outcome, status } = classify(err);
    await logCall({
      route: "triage",
      api: "chat_completions",
      prompt_ver: PROMPT_VERSION,
      provider: PROVIDER,
      model: LLM_MODEL,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      duration_ms: Date.now() - start,
      outcome,
      http_status: status,
    });
    return Response.json({ error: outcome }, { status });
  }
}

function classify(err: unknown): { outcome: string; status: number } {
  if (err instanceof LlmInvalidOutputError) {
    return { outcome: "invalid_model_output", status: 502 };
  }
  if (err instanceof OpenAI.APIError) {
    const s = err.status ?? 500;
    if (s === 429) return { outcome: "rate_limited", status: 429 };
    if (s === 408) return { outcome: "triage_timeout", status: 504 };
    if (s >= 500) return { outcome: "triage_unavailable", status: 502 };
    return { outcome: "internal_error", status: 500 };
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return { outcome: "triage_timeout", status: 504 };
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return { outcome: "triage_unavailable", status: 502 };
  }
  return { outcome: "internal_error", status: 500 };
}
