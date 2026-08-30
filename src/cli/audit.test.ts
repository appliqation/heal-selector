import { describe, it, expect, vi } from 'vitest';
import { recordHealRun } from './audit.js';
import type { AuditSink } from '@appliqation/agent-core';

const usage = { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 };

describe('recordHealRun', () => {
  it('records one call with agent/subcommand and the outcome shaped like HealSummary, including declined', async () => {
    const sink: AuditSink = { record: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    await recordHealRun({
      sink,
      startedAt: 1000,
      endedAt: 3000,
      model: 'claude-sonnet-5',
      usage,
      testCaseUuid: '2424-abc',
      scriptPath: 'tests/x.spec.ts',
      result: {
        report: 'healed',
        turns: 4,
        budgetExceeded: false,
        writtenPaths: ['tests/x.spec.ts'],
        testRun: { ran: true, ok: true, exitCode: 0 },
      },
    });

    expect(sink.record).toHaveBeenCalledTimes(1);
    const record = (sink.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record).toMatchObject({
      agent: 'appliqation-heal-selector',
      subcommand: 'heal',
      startedAt: 1000,
      endedAt: 3000,
      durationMillis: 2000,
      model: 'claude-sonnet-5',
      usage,
      exitCode: 0,
    });
    expect(record.outcome).toEqual({
      testCaseUuid: '2424-abc',
      scriptPath: 'tests/x.spec.ts',
      writtenPaths: ['tests/x.spec.ts'],
      declined: false,
      testRan: true,
      verified: true,
      report: 'healed',
    });
  });

  it('declined is true and exitCode is 1 when nothing was written — a genuine decline', async () => {
    const sink: AuditSink = { record: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    await recordHealRun({
      sink,
      startedAt: 0,
      endedAt: 1,
      model: 'x',
      usage,
      testCaseUuid: 'tc-1',
      scriptPath: 'tests/x.spec.ts',
      result: { report: 'declined', turns: 2, budgetExceeded: false, writtenPaths: [], testRun: { ran: false, ok: false, exitCode: null } },
    });
    const record = (sink.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.exitCode).toBe(1);
    expect(record.outcome.declined).toBe(true);
  });

  it('records exitCode 1 and an error outcome when result is undefined — heal() threw', async () => {
    const sink: AuditSink = { record: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    await recordHealRun({ sink, startedAt: 0, endedAt: 1, model: 'x', usage, testCaseUuid: 'tc-1', scriptPath: 'tests/x.spec.ts', result: undefined });
    const record = (sink.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(record.exitCode).toBe(1);
    expect(record.outcome).toEqual({ testCaseUuid: 'tc-1', scriptPath: 'tests/x.spec.ts', error: true });
  });

  it('a sink failure never rejects — safeRecord swallows it', async () => {
    const sink: AuditSink = { record: vi.fn().mockRejectedValue(new Error('down')), close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordHealRun({
        sink,
        startedAt: 0,
        endedAt: 1,
        model: 'x',
        usage,
        testCaseUuid: 'tc-1',
        scriptPath: 'tests/x.spec.ts',
        result: { report: 'r', turns: 1, budgetExceeded: false, writtenPaths: [], testRun: { ran: true, ok: true, exitCode: 0 } },
      }),
    ).resolves.toBeUndefined();
  });

  it('closes the sink after recording', async () => {
    const sink: AuditSink = { record: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    await recordHealRun({ sink, startedAt: 0, endedAt: 1, model: 'x', usage, testCaseUuid: 'tc-1', scriptPath: 'tests/x.spec.ts', result: undefined });
    expect(sink.close).toHaveBeenCalledTimes(1);
  });

  it('still closes the sink even when record() failed', async () => {
    const sink: AuditSink = { record: vi.fn().mockRejectedValue(new Error('down')), close: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await recordHealRun({ sink, startedAt: 0, endedAt: 1, model: 'x', usage, testCaseUuid: 'tc-1', scriptPath: 'tests/x.spec.ts', result: undefined });
    expect(sink.close).toHaveBeenCalledTimes(1);
  });
});
