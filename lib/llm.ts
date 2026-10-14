import OpenAI from "openai";
import { SYSTEM_MESSAGE, buildUserMessage } from "./prompt";
import { TriageSchema, triageJsonSchema, type TriageResult } from "./schema";
import { LlmInvalidOutputError } from "./errors";

export const llm = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
  timeout: 30_000,
  maxRetries: 2,
});

export const LLM_MODEL = process.env.LLM_MODEL ?? "";

type Mode = "json_schema" | "prompt";
const MODE: Mode =
  process.env.LLM_STRUCTURED_OUTPUT === "prompt" ? "prompt" : "json_schema";

export async function runTriage(ticket: {
  subject: string;
  body: string;
}): Promise<{ result: TriageResult; usage: OpenAI.Completions.CompletionUsage | undefined }> {
  const messages = [
    { role: "system" as const, content: SYSTEM_MESSAGE },
    { role: "user" as const, content: buildUserMessage(ticket) },
  ];

  const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: LLM_MODEL,
    messages,
  };

  if (MODE === "json_schema") {
    request.response_format = {
      type: "json_schema",
      json_schema: {
        name: "support_triage",
        strict: true,
        schema: triageJsonSchema as Record<string, unknown>,
      },
    };
  } else {
    request.response_format = { type: "json_object" };
  }

  const completion = await llm.chat.completions.create(request);
  const choice = completion.choices[0];
  if (choice?.finish_reason === "length") {
    throw new LlmInvalidOutputError("output cut off");
  }

  const text = (choice?.message?.content ?? "").trim();
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    throw new LlmInvalidOutputError("not JSON");
  }

  const parsed = TriageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LlmInvalidOutputError("schema mismatch");
  }
  return { result: parsed.data, usage: completion.usage ?? undefined };
}
