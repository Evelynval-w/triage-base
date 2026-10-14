import OpenAI from "openai";
import { runTriage } from "../../../lib/llm";
import { LlmInvalidOutputError } from "../../../lib/errors";

const MAX_TICKET_CHARS = 5000;

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

  try {
    const { result } = await runTriage({
      subject: ticket.subject,
      body: ticket.body,
    });
    return Response.json(result);
  } catch (err) {
    return mapError(err);
  }
}

function mapError(err: unknown): Response {
  if (err instanceof LlmInvalidOutputError) {
    return Response.json({ error: "invalid_model_output" }, { status: 502 });
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 500;
    if (status === 429) {
      return Response.json({ error: "rate_limited" }, { status: 429 });
    }
    if (status === 408) {
      return Response.json({ error: "triage_timeout" }, { status: 504 });
    }
    if (status >= 500) {
      return Response.json({ error: "triage_unavailable" }, { status: 502 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return Response.json({ error: "triage_timeout" }, { status: 504 });
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return Response.json({ error: "triage_unavailable" }, { status: 502 });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}
