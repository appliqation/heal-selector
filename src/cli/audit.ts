// Extracted out of cli/index.ts so this is testable without triggering that
// file's top-level program.parseAsync(process.argv) side effect — same
// reasoning as appliqation-autotest's cli/resolvers.ts.

import { safeRecord, safeClose, type AuditSink, type AuditRecord } from '@appliqation/agent-core';
import type { HealResult } from '../orchestrator/heal.js';
import { exitCodeFor } from './output.js';
import type { HealSummary } from './output.js';

export interface RecordHealRunArgs {
  sink: AuditSink;
  startedAt: number;
  endedAt: number;
  model: string;
  usage: AuditRecord['usage'];
  testCaseUuid: string;
  scriptPath: string;
  /** undefined means heal() threw — the run never produced a result. */
  result: HealResult | undefined;
}

export async function recordHealRun(args: RecordHealRunArgs): Promise<void> {
  const { sink, startedAt, endedAt, model, usage, testCaseUuid, scriptPath, result } = args;
  const summary: HealSummary | undefined = result
    ? {
        testCaseUuid,
        scriptPath,
        writtenPaths: result.writtenPaths,
        declined: result.writtenPaths.length === 0,
        testRan: result.testRun.ran,
        verified: result.testRun.ok,
        report: result.report,
      }
    : undefined;

  await safeRecord(sink, {
    agent: 'appliqation-heal-selector',
    subcommand: 'heal',
    startedAt,
    endedAt,
    durationMillis: endedAt - startedAt,
    model,
    usage,
    turns: result?.turns,
    budgetExceeded: result?.budgetExceeded,
    exitCode: summary ? exitCodeFor(summary) : 1,
    outcome: summary ? { ...summary } : { testCaseUuid, scriptPath, error: true },
  });
  await safeClose(sink);
}
