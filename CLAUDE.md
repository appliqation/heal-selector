# CLAUDE.md — appliqation-heal-selector

Part of the Appliqation workspace. See `~/Sites/localhost/CLAUDE.md` for how the
product fits together; this file is the map of **this repo only**.

## What this repo is

A standalone agent that heals ONE broken Playwright selector in an existing,
already-working script. It is not `appliqation-scriptgen` (never drafts a script from
scratch) and not `appliqation-defect-fix` (never touches application code) — narrow,
token-efficient, single-purpose. Fifth consumer of `@appliqation/agent-core`
(`~/Sites/localhost/appliqation-agent-core/`); read that repo's `CLAUDE.md` first for
the shared engine this is built from.

**Built to close a real gap surfaced this session**: a test-set regression sweep should
run the deterministic canonical-script pass first (free), then treat a TC whose
canonical script exists but just failed as a candidate for verification and healing —
not silently skip it (the old `on-script-absence` default) and not blindly re-generate
its whole script from scratch either. This agent is the "healing" half of that; the
"escalate a failed canonical to real verification" half lives in
`appliqation-autotest`'s `coveragePolicy.ts` (`on-failure-or-absence`).

## The one rule that matters more than the mechanism

**Never heal by finding a selector that merely makes the assertion pass again.** That's
worse than leaving it broken — it fails silently and looks like success, exactly the
hallucinated-verdict failure mode this whole agent family exists to prevent, just
sharper here because "make it pass" and "heal correctly" can actively point in opposite
directions. A heal is only valid once the model has established, from real evidence,
that the new selector targets the SAME semantic element the original one did:

- **Accessibility role + accessible name** (`browser_snapshot` → `page.ariaSnapshot`) —
  the primary grounding signal, always available.
- **The test case's own `expected_result`/step text** (`get_scenario`) — cross-checked
  against a candidate element.
- **Rrweb original-interaction data** — a bonus signal, used only when a caller happens
  to provide it. Confirmed (this session) that no current appq MCP tool exposes rrweb
  data at all, so this is genuinely optional plumbing for later, never a dependency.

If identity can't be established with confidence, the model must decline — touch
nothing, report clearly why, and let a human or `appliqation-defect-fix` take it from
there. See `src/policy/healPrompt.ts` for the full methodology text (the actual
"Non-negotiable" instruction lives there, word for word).

## No appq-served prompt exists for this (unlike scriptgen/defect-fix/explorer)

Every other "thin" agent in this family (`scriptgen`, `defect-fix`, `explorer`) is
deliberately thin because its methodology lives entirely in an appq-served MCP prompt
(`appq:automate`/`appq:fix`/`appq:runman`) fetched via `runWorkflow()`. Healing has no
server-side equivalent yet — building one was explicitly out of scope for the change
that created this repo (bigger blast radius, affects every `appq:*` caller, not just
this family). So this agent's methodology is **local**, bundled in
`src/policy/healPrompt.ts`, and driven through `@appliqation/agent-core`'s `runLoop()`
directly — the same pattern `appliqation-autopilot` uses for its own local policy, not
`runWorkflow()`'s appq-prompt-fetch indirection. If a real `appq:heal` prompt is ever
built, this is the file that would move server-side; nothing else about this repo's
shape would need to change.

## Three tool surfaces combined — a first for this family

`src/orchestrator/heal.ts` offers the model, in one session: **read-only appq context**
(`get_scenario`, `get_defect_context` — `src/tools/safety.ts`'s
`READONLY_CONTEXT_TOOLS`), a **real Playwright browser** (`@appliqation/agent-core`'s
`BROWSER_TOOL_DEFS`/`PlaywrightBrowserTools` — needed to inspect the live page's
accessibility tree, the grounding signal above), and **real coding tools**
(`src/tools/codingTools.ts`'s `CodingTools` — read the script, patch the one locator,
run a targeted verification). No prior agent in this family combined browser tools
with coding tools in one loop; the composition itself (a flat tool-def array +
name-prefix dispatch routing: `browser_*` → browser tools, coding-tool names →
`CodingTools`, else → the gated appq dispatcher) is a direct, low-risk extension of the
pattern `appliqation-explorer` already uses for browser+appq — confirmed via research
before building this, not invented fresh.

## Never trust the model's own claim

Same discipline as every sibling agent, applied to a narrower patch: `heal()`'s result
and the CLI's exit code are derived only from `CodingTools.lastPlaywrightTestRun()`'s
real, `execFile`-reported exit code — and that run only counts as verifying the current
patch if its timestamp is at or after the most recent `write_file` call. "The model said
it healed" is never sufficient on its own.

**`declined` is a third, equally real outcome** — see `src/cli/output.ts`. A heal
attempt is not just pass/fail: `writtenPaths.length === 0` means the model touched
nothing (a genuine decline, per the policy's own instruction), distinct from "wrote a
patch but verification never happened or failed" (an unverified attempt, needs human
review, never silently retried). `exitCodeFor()` is 0 only for a verified success;
`declined`/`testRan`/`verified` in the JSON summary let a caller tell the other two
apart without a different exit code for each.

## Where to find what

- `src/cli/index.ts` — `heal` command. `--test-case-uuid`/`--script-path`/`--failure`/
  `--environment` are required; `--defect-id` is optional extra context;
  `--repo-path` defaults to `process.cwd()`. `scenario_id`/`project_id` are always
  derived from `--test-case-uuid` (`resolveScenarioId`/`fetchScenarioInfo` from
  `@appliqation/agent-core`), never accepted as separate inputs — same reasoning as
  every sibling agent. The live page URL is resolved from `--environment` via
  `resolveUrl`, never accepted directly.
- `src/orchestrator/heal.ts` — `heal()`: launches a real `chromium` browser, builds the
  combined tool palette (see above), calls `runLoop()` with the local policy as the
  system prompt, shapes the result via `CodingTools`'s tracked state.
- `src/policy/healPrompt.ts` — `buildHealPrompt()`: the actual methodology (Phase 0
  prerequisites → Phase 1 load context → Phase 2 diagnose on the live page → Phase 3
  compose the healed locator → Phase 4 patch narrowly (the WHOLE file rewritten with
  only the one line changed, never a partial/blind edit) → Phase 5 verify for real →
  Phase 6 report, explicitly distinguishing healed-and-verified from declined).
- `src/tools/codingTools.ts` — `CodingTools`: filesystem + shell surface, adapted from
  `appliqation-scriptgen`'s own copy — identical hardening (path-escape/symlink
  protection, a narrow safe-env-var allowlist for the child process), minus the
  `npm install --ignore-scripts` auto-append (this agent never runs `npm install` at
  all — see below).
- `src/tools/commandGate.ts` — `assertCommandAllowed()`: **deliberately narrower** than
  scriptgen/defect-fix's allowlist. Only `npx playwright test` (targeted — `--grep`
  and/or a spec path, never a bare full-suite run) plus `npx playwright --version`/
  `node --version`/`git status`/`git diff`. No `npm init`/`npm install`/`npx playwright
  install` at all — this agent operates on an already-set-up, already-working repo, it
  never bootstraps a project.
- `src/tools/safety.ts` — `READONLY_CONTEXT_TOOLS`: just `get_scenario` and
  `get_defect_context`. Zero write tools, genuinely absent — this agent never calls an
  appq write tool and never performs a git operation.
- `src/cli/output.ts` — `HealSummary`/`printJsonSummary`/`printHumanSummary`/
  `exitCodeFor()` — see "Never trust the model's own claim" above for the `declined`
  field's reasoning.
- `src/config/env.ts` — this agent's own config. Single `resolveModel()` (no
  executor/validator split). `ringBufferCap` for the browser tools' evidence buffer
  (small default — one page's accessibility tree, not a multi-step flow).
  `BUDGET_MAX_PAGES` is a real, reachable cap here (unlike scriptgen's
  effectively-unreachable one) since this agent genuinely drives `browser_navigate`.
  `auditSink` resolves `AUDIT_MONGO_*`/`AUDIT_JSONL_PATH` via
  `@appliqation/agent-core/audit`'s `resolveAuditSink()` — opt-in, no-op when
  unconfigured.
- `src/cli/audit.ts` — `recordHealRun()`, extracted out of `cli/index.ts` for the same
  testability reason as every sibling agent's audit module. `outcome` is exactly
  `HealSummary`'s shape (including `declined`); `exitCode` reuses `output.ts`'s own
  `exitCodeFor()`.

## Explicitly out of scope for v1

- Any appq write tool call, any git/GitHub operation — a separate agent
  (`appliqation-pr-raise`) is responsible for committing/pushing what this one patches
  locally.
- Whole-script regeneration, whole-scenario/batch mode — this agent heals one selector
  in one already-identified script. Deciding *which* TC/script needs healing (e.g. from
  a test-set sweep's failed-canonical bucket) is the caller's job.
- A real `appq:heal` server-side prompt — discussed above; the local policy is the
  deliberate v1 choice, not a placeholder assumed to move server-side soon.
- Consuming rrweb selector-chain data — confirmed no appq tool exposes it yet; the
  policy already accounts for its absence as the normal case, not an edge case.

## Commands

- `npm run dev -- heal --test-case-uuid <uuid> --script-path <path> --failure "<text>" --environment <name> [--defect-id <id>] [--repo-path <path>] [--max-turns <n>] [--json|--ci]`
- `npm run build` / `npm run typecheck`
- `npm test` / `npm run test:watch` — vitest, colocated `src/**/*.test.ts` files
- `npx playwright install chromium` — needed once before a real (non-mocked) run

## Config

Copy `.env.example` to `.env`. Requires `APPQ_API_KEY` (read-only access is sufficient —
this agent never calls an appq write tool) and one of `ANTHROPIC_API_KEY`/
`OPENAI_API_KEY`.

## Keeping this file current

When you add, remove, or rename a top-level file or a directory under `src/`, update
the map above in the same change.
