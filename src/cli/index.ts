#!/usr/bin/env node
// `heal`: repair one broken Playwright selector in an existing, already-
// working script. See src/orchestrator/heal.ts for the mechanism and
// src/policy/healPrompt.ts for the actual methodology (no appq-served
// prompt exists for this yet — the policy is local, bundled here).
//
// Generic, caller-agnostic inputs — not designed around any one caller.
// project_id/scenario_id are always derived from --test-case-uuid, never
// accepted as separate inputs, same reasoning as every sibling agent.

import { Command } from 'commander';
import {
  createMcpClient,
  createAnthropicAdapter,
  createOpenAiAdapter,
  createOpenAiCompatibleAdapter,
  createUsageAccumulator,
  resolveScenarioId,
  fetchScenarioInfo,
  resolveUrl,
  type ProviderAdapter,
} from '@appliqation/agent-core';
import { config, resolveProvider, resolveModel } from '../config/env.js';
import { heal } from '../orchestrator/heal.js';
import type { HealResult } from '../orchestrator/heal.js';
import { recordHealRun } from './audit.js';
import { printJsonSummary, printHumanSummary, exitCodeFor } from './output.js';
import type { HealSummary } from './output.js';

const client = createMcpClient({ origin: config.appqOrigin, apiKey: config.appqApiKey() });

function buildAdapter(): ProviderAdapter {
  const provider = resolveProvider();
  const model = resolveModel();
  if (provider === 'anthropic') return createAnthropicAdapter(config.anthropicApiKey!, model, config.anthropicMaxTokens);
  if (provider === 'openai') return createOpenAiAdapter(config.openaiApiKey!, model, config.openaiMaxOutputTokens);
  if (provider === 'deepseek') {
    return createOpenAiCompatibleAdapter({ apiKey: config.deepseekApiKey!, baseURL: config.deepseekBaseUrl, model, maxTokens: config.deepseekMaxTokens, providerLabel: 'DeepSeek' });
  }
  return createOpenAiCompatibleAdapter({ apiKey: config.glmApiKey!, baseURL: config.glmBaseUrl, model, maxTokens: config.glmMaxTokens, providerLabel: 'GLM' });
}

function logEvent(prefix: string) {
  return (e: { type: string; detail?: unknown }) => {
    if (e.type === 'assistant') {
      const text = ((e.detail as string) ?? '').trim();
      if (text) console.error(`${prefix}[thinking] ${text}`);
    } else if (e.type === 'tool') {
      const d = e.detail as { name: string; result: string };
      console.error(`${prefix}[tool] ${d.name} -> ${d.result.slice(0, 300)}`);
    } else if (e.type === 'log') {
      console.error(`${prefix}[log] ${e.detail}`);
    } else if (e.type === 'usage') {
      const u = e.detail as { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number };
      const cacheNote = u.cacheReadTokens
        ? ` (${u.cacheReadTokens} from cache)`
        : u.cacheWriteTokens
          ? ` (${u.cacheWriteTokens} written to cache)`
          : '';
      console.error(`${prefix}[usage] in=${u.inputTokens} out=${u.outputTokens}${cacheNote}`);
    }
  };
}

const program = new Command();
program
  .name('appliqation-heal-selector')
  .description(
    'Heal one broken Playwright selector in an existing script — narrow and token-efficient, never a full ' +
      'regenerate. Verifies a healed selector targets the same semantic element before touching anything; ' +
      'declines rather than guesses. See README.md for the full story.',
  );

program
  .command('heal')
  .description(
    'Diagnose whether a failing selector is genuine staleness (heal it) or a real behaviour change (decline, ' +
      "not a healing case) — via the live page's accessibility tree, never by picking whatever makes the " +
      "assertion pass. Only ever patches the one locator, and only after a real, post-patch `npx playwright " +
      "test` run confirms it — never the model's own claim. scenario_id/project_id are always derived from " +
      '--test-case-uuid, never accepted as separate inputs.',
  )
  .requiredOption('--test-case-uuid <uuid>', 'test case this failing selector belongs to')
  .requiredOption('--script-path <path>', 'the script file containing the broken selector, relative to --repo-path')
  .requiredOption(
    '--failure <text>',
    'free-text description of what is failing and why — a step name, the selector, an error message. Whatever the caller already knows.',
  )
  .requiredOption('--environment <name>', 'environment name — its URL (from get_project_settings) is what the browser navigates to')
  .option('--defect-id <id>', 'a defect linked to this failure, if known — offered as extra diagnostic context')
  .option('--repo-path <path>', 'target repo root every file/command tool call is scoped to', process.cwd())
  .option('--max-turns <n>', 'override BUDGET_MAX_TURNS for this run')
  .option('--json', 'print a single structured JSON summary on stdout instead of a human-readable report')
  .option('--ci', 'shorthand for --json; exit code already reflects the real, execFile-verified outcome either way')
  .action(
    async (opts: {
      testCaseUuid: string;
      scriptPath: string;
      failure: string;
      environment: string;
      defectId?: string;
      repoPath: string;
      maxTurns?: string;
      json?: boolean;
      ci?: boolean;
    }) => {
      const json = (opts.json ?? false) || (opts.ci ?? false);
      const adapter = buildAdapter();

      const scenarioId = resolveScenarioId({ testCaseUuid: opts.testCaseUuid });
      const { projectId } = await fetchScenarioInfo(client, scenarioId);
      const url = await resolveUrl(client, opts.environment, projectId);

      const budget = { ...config.budget, ...(opts.maxTurns ? { maxTurns: Number(opts.maxTurns) } : {}) };

      const startedAt = Date.now();
      const usage = createUsageAccumulator();
      const baseLog = logEvent('');
      let result: HealResult | undefined;
      try {
        result = await heal({
          client,
          adapter,
          testCaseUuid: opts.testCaseUuid,
          defectId: opts.defectId,
          scriptPath: opts.scriptPath,
          failureDescription: opts.failure,
          url,
          repoPath: opts.repoPath,
          budget,
          commandTimeoutMs: config.commandTimeoutMs,
          ringBufferCap: config.ringBufferCap,
          onEvent: (e) => {
            baseLog(e);
            if (e.type === 'usage') usage.onUsage(e.detail as { inputTokens: number; outputTokens: number; cacheWriteTokens?: number; cacheReadTokens?: number });
          },
        });
      } finally {
        // Audit write happens whether the run succeeded or threw — see
        // @appliqation/agent-core's audit/sink.ts: safeRecord() (used
        // inside recordHealRun) never lets a failed/unreachable audit sink
        // affect this process's real outcome.
        await recordHealRun({
          sink: config.auditSink,
          startedAt,
          endedAt: Date.now(),
          model: resolveModel(),
          usage: usage.totals(),
          testCaseUuid: opts.testCaseUuid,
          scriptPath: opts.scriptPath,
          result,
        });
      }

      if (!json) {
        console.log('\n=== Report ===\n');
        console.log(result.report);
        console.error(`\n(${result.turns} turns, budget exceeded: ${result.budgetExceeded})`);
      }

      const summary: HealSummary = {
        testCaseUuid: opts.testCaseUuid,
        scriptPath: opts.scriptPath,
        writtenPaths: result.writtenPaths,
        declined: result.writtenPaths.length === 0,
        testRan: result.testRun.ran,
        verified: result.testRun.ok,
        report: result.report,
      };
      if (json) printJsonSummary(summary);
      else printHumanSummary(summary);
      process.exitCode = exitCodeFor(summary);
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
