import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type RunSummary = {
  file: string;
  date: string;
  prompt_version: string;
  model: string;
  count: number;
  ok_count: number;
  category_accuracy: number | null;
  priority_accuracy: number | null;
  outcome_counts: Record<string, number>;
  total_input_tokens: number;
  total_output_tokens: number;
  total_duration_ms: number;
};

const RUNS_DIR = join(process.cwd(), "runs");

export async function listRuns(): Promise<RunSummary[]> {
  let names: string[];
  try {
    names = await readdir(RUNS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const files = names.filter((n) => n.endsWith(".json"));
  const summaries: RunSummary[] = [];
  for (const name of files) {
    const path = join(RUNS_DIR, name);
    try {
      const text = await readFile(path, "utf8");
      const run = JSON.parse(text) as Partial<RunSummary> & {
        rows?: unknown[];
      };
      summaries.push({
        file: name,
        date: run.date ?? "",
        prompt_version: run.prompt_version ?? "",
        model: run.model ?? "",
        count: run.count ?? run.rows?.length ?? 0,
        ok_count: run.ok_count ?? 0,
        category_accuracy: run.category_accuracy ?? null,
        priority_accuracy: run.priority_accuracy ?? null,
        outcome_counts: run.outcome_counts ?? {},
        total_input_tokens: run.total_input_tokens ?? 0,
        total_output_tokens: run.total_output_tokens ?? 0,
        total_duration_ms: run.total_duration_ms ?? 0,
      });
    } catch {
      // Skip unreadable files silently.
    }
  }

  // Newest first.
  const withMtime = await Promise.all(
    summaries.map(async (s) => {
      const st = await stat(join(RUNS_DIR, s.file));
      return { s, mtime: st.mtimeMs };
    }),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime);
  return withMtime.map((w) => w.s);
}
