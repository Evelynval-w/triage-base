# Support ticket triage app

A small Next.js app that classifies incoming support tickets with an LLM. A
support agent pastes a ticket; the server sends it to an OpenAI-compatible
chat-completions endpoint and returns a validated object with a category, a
priority, a concise summary, and one suggested next action.

Built for the BCS S5 — EPITA — AI Systems Integration & Operations course.

## Run locally

Requires Node.js 20.9 or newer.

```sh
cp .env.example .env.local            # then fill in your provider details
npm install
npm run dev
```

Then open:
- http://localhost:3033 — the mock chat (keeps conversation history client-side)
- http://localhost:3033/triage — the triage form (subject + body → 4 fields)
- http://localhost:3033/admin — call history, tokens, cost per model/prompt

### Environment variables

`.env.local` (gitignored):

```
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-v1-...
LLM_MODEL=openai/gpt-4o-mini
LLM_STRUCTURED_OUTPUT=json_schema      # or `prompt`
```

Any provider that speaks the OpenAI chat-completions API works
(OpenRouter, OpenAI, your school server, …). The key never reaches the browser.

## Project layout

```
app/
  page.tsx                 chat page (conversation history held client-side)
  triage/page.tsx          triage form + four-field result view
  admin/page.tsx           server component: reads logs/llm-calls.jsonl
  api/
    chat/route.ts          POST { messages: [...] } → { answer }
    triage/route.ts        POST { ticket } → validated TriageResult
lib/
  llm.ts                   shared OpenAI client, runTriage(ticket)
  prompt.ts                PROMPT_VERSION + SYSTEM_MESSAGE + buildUserMessage
  schema.ts                Zod TriageSchema + generated JSON schema
  errors.ts                LlmInvalidOutputError
  logging.ts               appendCall / readLog for logs/llm-calls.jsonl
  pricing.ts               model slug → USD per 1M tokens
  config.ts                providerFromBaseUrl
scripts/
  smoke.ts                 run the labelled dev set, save runs/<date>-<v>-<m>.json
data/                      500 unlabelled + 100 labelled sample tickets
logs/                      llm-calls.jsonl (gitignored)
runs/                      smoke-test outputs (gitignored)
EXPERIMENTS.md             experiment log (one row per change)
```

## Smoke test

Runs the 100 labelled dev-set tickets through `runTriage`, prints outcome
counts, category/priority accuracy and a confusion matrix, and saves a run
file to `runs/<date>-<prompt-version>-<model>.json`.

```sh
npm run smoke -- --limit 5     # start small to sanity-check wiring
npm run smoke                   # full dev set
```

## Quality checklist

### Architecture
- [x] One LLM module (`lib/llm.ts`); the SDK is only imported there and in the
      route-level error-mapping. No SDK imports in client components or pages.
- [x] Prompts live in `lib/prompt.ts` with a `PROMPT_VERSION` constant
      (currently `"triage-v2"`).
- [x] All provider settings come from environment configuration
      (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_STRUCTURED_OUTPUT`).
      Prices live in `lib/pricing.ts`. Nothing hard-coded in route handlers.

### Error handling
- [x] Every failure in `/api/triage` maps to one HTTP status and one safe
      error code, via `classify()`:

      | Failure                              | Status | Outcome                 |
      |--------------------------------------|-------:|-------------------------|
      | Invalid JSON / schema mismatch       |    502 | `invalid_model_output`  |
      | Provider 429                         |    429 | `rate_limited`          |
      | Provider 5xx / connection error      |    502 | `triage_unavailable`    |
      | Timeout                              |    504 | `triage_timeout`        |
      | 400 / 401 / 403 / 404 / other        |    500 | `internal_error`        |

- [x] Timeout and retries set explicitly on the OpenAI client
      (`timeout: 30_000`, `maxRetries: 2`).
- [x] No stack trace or provider message reaches the browser — only the short
      error code, which the client maps to a friendly message.

### Security
- [x] The API key is used only server-side. The browser Network tab shows no
      `Authorization` header, no key in request/response bodies.
- [x] `.env.local` is gitignored (`.gitignore` has `.env*` with an
      `.env.example` exception). `git check-ignore -v .env.local` confirms.
- [x] The API rejects over-long input at `MAX_TICKET_CHARS = 5000` with a 400,
      before any provider call.
- [x] Logs contain no API key and no full ticket text — only
      model/provider/tokens/duration/outcome. See `lib/logging.ts`.
- [x] **Fixed in Activity 7:** `buildUserMessage` now strips any
      `<ticket>` / `</ticket>` tags from customer input, closing the
      TCK-10087 "close the tag and inject new instructions" vector. Role
      separation is still just a convention; the Zod schema at the exit is
      the hard guarantee that output stays in shape.

## Switch and compare providers / models

The code reads provider settings only from env vars, so switching is a file
swap. Templates are provided for two configurations; copy and fill in the key:

```sh
cp .env.openrouter-mini.example   .env.openrouter-mini    # then edit the key
cp .env.openrouter-haiku.example  .env.openrouter-haiku   # then edit the key
```

To make one of them active:

```sh
cp .env.openrouter-mini .env.local
# restart `npm run dev` so Next.js picks up the new env
npm run smoke                      # or hit /triage in the browser
```

Then swap and re-run:

```sh
cp .env.openrouter-haiku .env.local
# restart dev
npm run smoke
```

Each run writes `runs/<date>-<prompt-version>-<model>.json`. The admin page
reads that directory and shows one row per run under *Smoke-test runs*:
accuracy, outcome counts, tokens, duration.

### Comparison table (fill in from your runs)

| Config | Model | Category acc | Priority acc | Avg latency | Cost / 100 tickets | Notes |
|--------|-------|--------------|--------------|-------------|--------------------|-------|
| A      |       |              |              |             |                    |       |
| B      |       |              |              |             |                    |       |

Write three concrete differences you observed (e.g. structured-output
support, error-message format, latency, tokens on the same prompt).

## Sample data

The `data/` folder contains two support-ticket datasets:

- **500 unlabelled tickets** in
  [`support_tickets_500.csv`](./data/support_tickets_500.csv) and
  [`support_tickets_500.json`](./data/support_tickets_500.json), for exploring
  and developing the triage workflow. A few are deliberately adversarial
  (e.g. TCK-10087 closes `</ticket>` and injects pirate instructions).
- **100 labelled tickets** in
  [`support_tickets_100_labelled.csv`](./data/support_tickets_100_labelled.csv)
  and
  [`support_tickets_100_labelled.json`](./data/support_tickets_100_labelled.json).
  These include triage annotations (category, priority, needs-human-review)
  and `tags` such as `multilingual`, `adversarial|prompt_injection`,
  `ambiguous`, `long`.

## Checks

```sh
npm run typecheck
npm run build
```
