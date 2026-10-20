import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type LogEntry = {
  ts: string;
  route: "triage" | "chat";
  api: "chat_completions";
  prompt_ver: string | null;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  duration_ms: number;
  outcome: string;
  http_status: number;
};

const LOG_PATH = join(process.cwd(), "logs", "llm-calls.jsonl");

export async function logCall(entry: Omit<LogEntry, "ts">): Promise<void> {
  const line =
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  try {
    await mkdir(dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, line);
  } catch (err) {
    // Logging must never break a request. Surface to stderr and move on.
    console.error("logCall failed", err);
  }
}

export async function readLog(): Promise<LogEntry[]> {
  try {
    const text = await readFile(LOG_PATH, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEntry);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
