import { llm, LLM_MODEL } from "../../../lib/llm";

const SYSTEM_MESSAGE = "You are a helpful assistant. Answer concisely.";

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

  const completion = await llm.chat.completions.create({
    model: LLM_MODEL,
    messages: [{ role: "system", content: SYSTEM_MESSAGE }, ...body.messages],
  });

  const answer = completion.choices[0]?.message?.content ?? "";

  return Response.json({ answer });
}
