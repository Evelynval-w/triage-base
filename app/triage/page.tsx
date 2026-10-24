"use client";

import { useState, type FormEvent } from "react";

type TriageResult = {
  category: "billing" | "technical_bug" | "account" | "feature_request";
  priority: "low" | "medium" | "high";
  summary: string;
  suggested_action: string;
  _meta?: {
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    cost_usd: number | null;
  };
};

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "The provider is rate-limiting us. Try again in a bit.",
  triage_unavailable: "The triage service is temporarily unavailable.",
  triage_timeout: "The triage request timed out. Try again.",
  invalid_model_output: "The model returned a response we couldn't use.",
  internal_error: "Something went wrong. Please try again.",
};

export default function TriagePage() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<TriageResult | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || !subject.trim() || !body.trim()) return;

    setIsSending(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: { subject, body } }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const code =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "internal_error";
        throw new Error(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal_error);
      }

      setResult(data as TriageResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : ERROR_MESSAGES.internal_error);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="chat">
      <h1>Triage a ticket</h1>
      <p>Paste a support ticket and get a category, priority, summary and next action.</p>
      <form onSubmit={onSubmit} aria-busy={isSending}>
        <label htmlFor="subject">Subject</label>
        <input
          id="subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
          disabled={isSending}
        />
        <label htmlFor="body">Body</label>
        <textarea
          id="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={8}
          required
          disabled={isSending}
        />
        <button
          type="submit"
          disabled={isSending || !subject.trim() || !body.trim()}
        >
          {isSending ? "Triaging..." : "Triage"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      {result && (
        <section className="messages" aria-label="Triage result">
          <div className="message assistant">
            <strong>Category</strong>
            <p>{result.category}</p>
          </div>
          <div className="message assistant">
            <strong>Priority</strong>
            <p>{result.priority}</p>
          </div>
          <div className="message assistant">
            <strong>Summary</strong>
            <p>{result.summary}</p>
          </div>
          <div className="message assistant">
            <strong>Suggested action</strong>
            <p>{result.suggested_action}</p>
          </div>
          {result._meta && (
            <div className="message assistant usage">
              <strong>LLM usage</strong>
              <p>
                model: {result._meta.model}
                <br />
                input tokens: {result._meta.input_tokens ?? "—"}
                <br />
                output tokens: {result._meta.output_tokens ?? "—"}
                <br />
                total tokens: {result._meta.total_tokens ?? "—"}
                <br />
                cost: {result._meta.cost_usd !== null
                  ? `$${result._meta.cost_usd.toFixed(6)}`
                  : "—"}
              </p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
