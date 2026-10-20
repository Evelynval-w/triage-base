// USD per 1,000,000 tokens. Approximate; update as you switch models.
// The point is that prices live here, not in route logic.
export const PRICES: Record<string, { input: number; output: number }> = {
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "anthropic/claude-haiku-4-5": { input: 1, output: 5 },
  "anthropic/claude-sonnet-4-5": { input: 3, output: 15 },
  "google/gemini-2.5-flash": { input: 0.075, output: 0.3 },
  "meta-llama/llama-3.3-70b-instruct": { input: 0.59, output: 0.79 },
};

export function priceFor(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  if (inputTokens === null || outputTokens === null) return null;
  const p = PRICES[model];
  if (!p) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
