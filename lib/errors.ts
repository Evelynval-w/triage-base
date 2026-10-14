export class LlmInvalidOutputError extends Error {
  constructor(public reason: string) {
    super(`LLM output invalid: ${reason}`);
    this.name = "LlmInvalidOutputError";
  }
}
