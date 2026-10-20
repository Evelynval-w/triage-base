import { llm, LLM_MODEL } from "../../../lib/llm";
import { logCall } from "../../../lib/logging";
import { priceFor } from "../../../lib/pricing";
import { providerFromBaseUrl } from "../../../lib/config";

const SYSTEM_MESSAGE = "You are a helpful assistant. Answer concisely.";
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
    !("messages" in body) ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return Response.json(
      { error: "Please provide a non-empty messages array." },
      { status: 400 },
    );
  }

  for (const m of body.messages) {
    if (
      typeof m !== "object" ||
      m === null ||
      !("role" in m) ||
      !("content" in m) ||
      typeof m.content !== "string" ||
      !m.content.trim() ||
      (m.role !== "user" && m.role !== "assistant")
    ) {
      return Response.json(
        {
          error:
            "Each message must have role 'user' or 'assistant' and a non-empty string content.",
        },
        { status: 400 },
      );
    }
  }

  const start = Date.now();
  try {
    const completion = await llm.chat.completions.create({
      model: LLM_MODEL,
      messages: [{ role: "system", content: SYSTEM_MESSAGE }, ...body.messages],
    });

    const answer = completion.choices[0]?.message?.content ?? "";
    const inputTokens = completion.usage?.prompt_tokens ?? null;
    const outputTokens = completion.usage?.completion_tokens ?? null;

    await logCall({
      route: "chat",
      api: "chat_completions",
      prompt_ver: null,
      provider: PROVIDER,
      model: LLM_MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: priceFor(LLM_MODEL, inputTokens, outputTokens),
      duration_ms: Date.now() - start,
      outcome: "ok",
      http_status: 200,
    });

    return Response.json({ answer });
  } catch (err) {
    await logCall({
      route: "chat",
      api: "chat_completions",
      prompt_ver: null,
      provider: PROVIDER,
      model: LLM_MODEL,
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      duration_ms: Date.now() - start,
      outcome: "internal_error",
      http_status: 500,
    });
    console.error("chat route failed", err);
    return Response.json(
      { error: "Chat is currently unavailable." },
      { status: 500 },
    );
  }
}
