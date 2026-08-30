// Drives the healing methodology (src/policy/healPrompt.ts — no appq-served
// prompt exists for this, so runLoop() is used directly, the same pattern
// appliqation-autopilot uses for its own local policy, not runWorkflow()'s
// appq-prompt-fetch indirection the rest of this family's "thin" agents use)
// with three combined tool surfaces: read-only appq context (get_scenario,
// get_defect_context), a real Playwright browser (to inspect the live
// page's accessibility tree — the grounding signal for a healed selector's
// semantic identity), and real coding tools (read/patch the script, run a
// targeted verification). No agent in this family combined browser tools
// with coding tools before this — the composition itself is a direct,
// low-risk extension of the flat-tool-array + name-prefix-dispatch pattern
// appliqation-explorer already uses for browser+appq.

import { chromium } from 'playwright';
import {
  runLoop,
  fetchAppqToolDefs,
  createGatedAppqDispatcher,
  PlaywrightBrowserTools,
  BROWSER_TOOL_DEFS,
  type McpClient,
  type ProviderAdapter,
  type RunBudget,
  type ToolDispatcher,
} from '@appliqation/agent-core';
import { READONLY_CONTEXT_TOOLS } from '../tools/safety.js';
import { CODING_TOOL_DEFS, CodingTools } from '../tools/codingTools.js';
import { buildHealPrompt } from '../policy/healPrompt.js';

export interface HealOptions {
  client: McpClient;
  adapter: ProviderAdapter;
  /** Test case this failing selector belongs to — its expected_result is the grounding signal. */
  testCaseUuid: string;
  /** Optional defect this failure is linked to, for extra diagnostic context. */
  defectId?: string;
  /** The script file containing the broken selector, relative to repoPath. */
  scriptPath: string;
  /** Free-text description of what's failing and why — a step name, a selector, an error message. Whatever the caller knows. */
  failureDescription: string;
  /** Live page URL to navigate to for the accessibility-tree diagnosis. */
  url: string;
  /** Repo root every file/command tool call is scoped to. */
  repoPath: string;
  budget: RunBudget;
  commandTimeoutMs: number;
  ringBufferCap?: number;
  onEvent?: (event: { type: string; detail?: unknown }) => void;
}

export interface HealResult {
  report: string;
  turns: number;
  budgetExceeded: boolean;
  /** Repo-relative paths written during this run (empty when declined). */
  writtenPaths: string[];
  testRun: {
    /** Whether a `npx playwright test` invocation happened at all. */
    ran: boolean;
    /**
     * Real, execFile-reported success — AND it happened after the most
     * recent file write, so an earlier pass before the patch doesn't count.
     * Never derived from the model's own report text.
     */
    ok: boolean;
    exitCode: number | null;
  };
}

function seedMessage(opts: HealOptions): string {
  const lines = [
    `Test case UUID: ${opts.testCaseUuid}`,
    `Script to heal: ${opts.scriptPath}`,
    `What's failing: ${opts.failureDescription}`,
    `Live page URL (for browser_navigate): ${opts.url}`,
    `Target repo root (every file/command tool call is scoped here): ${opts.repoPath}`,
  ];
  if (opts.defectId) lines.push(`Linked defect ID: ${opts.defectId}`);
  lines.push('Begin now — start with read_file on the script.');
  return lines.join('\n');
}

export async function heal(opts: HealOptions): Promise<HealResult> {
  const coding = new CodingTools(opts.repoPath, opts.commandTimeoutMs);
  const appqToolDefs = await fetchAppqToolDefs(opts.client, READONLY_CONTEXT_TOOLS);
  const gatedAppq = createGatedAppqDispatcher(opts.client, READONLY_CONTEXT_TOOLS);

  const codingToolNames = new Set(CODING_TOOL_DEFS.map((t) => t.name));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const browserTools = new PlaywrightBrowserTools(page, opts.ringBufferCap);
    const dispatch: ToolDispatcher = async (name, args) => {
      if (name.startsWith('browser_')) return browserTools.dispatch(name, args);
      if (codingToolNames.has(name)) return coding.dispatch(name, args);
      return gatedAppq(name, args);
    };

    const loopResult = await runLoop({
      adapter: opts.adapter,
      system: buildHealPrompt(),
      seedMessage: seedMessage(opts),
      tools: [...appqToolDefs, ...BROWSER_TOOL_DEFS, ...CODING_TOOL_DEFS],
      dispatch,
      budget: opts.budget,
      onEvent: opts.onEvent,
    });

    const writtenPaths = coding.getWrittenPaths();
    const lastTestRun = coding.lastPlaywrightTestRun();
    const lastWriteAt = writtenPaths.size > 0 ? Math.max(...writtenPaths.values()) : 0;
    const verifiedAfterLastWrite = lastTestRun !== null && lastTestRun.ok && lastTestRun.timestamp >= lastWriteAt;

    return {
      report: loopResult.report,
      turns: loopResult.turns,
      budgetExceeded: loopResult.budgetExceeded,
      writtenPaths: [...writtenPaths.keys()],
      testRun: {
        ran: lastTestRun !== null,
        ok: verifiedAfterLastWrite,
        exitCode: lastTestRun?.exitCode ?? null,
      },
    };
  } finally {
    await browser.close();
  }
}
