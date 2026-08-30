import { describe, it, expect, vi } from 'vitest';
import { exitCodeFor, printJsonSummary, printHumanSummary } from './output.js';
import type { HealSummary } from './output.js';

function summary(overrides: Partial<HealSummary> = {}): HealSummary {
  return {
    testCaseUuid: '2424-abc',
    scriptPath: 'tests/spec.ts',
    writtenPaths: [],
    declined: true,
    testRan: false,
    verified: false,
    report: 'x',
    ...overrides,
  };
}

describe('exitCodeFor', () => {
  it('is 0 only when a patch both ran and passed verification', () => {
    expect(exitCodeFor(summary({ writtenPaths: ['tests/spec.ts'], declined: false, testRan: true, verified: true }))).toBe(0);
  });

  it('is 1 for a genuine decline (nothing written, nothing to verify)', () => {
    expect(exitCodeFor(summary({ declined: true, testRan: false, verified: false }))).toBe(1);
  });

  it('is 1 when a patch was written but never verified', () => {
    expect(exitCodeFor(summary({ writtenPaths: ['tests/spec.ts'], declined: false, testRan: false, verified: false }))).toBe(1);
  });

  it('is 1 when a patch was written and verification actually failed', () => {
    expect(exitCodeFor(summary({ writtenPaths: ['tests/spec.ts'], declined: false, testRan: true, verified: false }))).toBe(1);
  });
});

describe('printJsonSummary', () => {
  it('prints the summary as JSON, including declined', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printJsonSummary(summary({ declined: true }));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"declined": true'));
    logSpy.mockRestore();
  });
});

describe('printHumanSummary', () => {
  it('reports a decline plainly, without listing any patched files', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHumanSummary(summary({ declined: true }));
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toMatch(/Declined — not a healing case/);
    expect(output).not.toMatch(/patched/);
    logSpy.mockRestore();
  });

  it('lists patched files and verification status for a real heal', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHumanSummary(summary({ writtenPaths: ['tests/spec.ts'], declined: false, testRan: true, verified: true }));
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('patched  tests/spec.ts');
    expect(output).toContain('PASSED');
    logSpy.mockRestore();
  });

  it('reports "never actually ran" when a patch was written but no test run happened', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHumanSummary(summary({ writtenPaths: ['tests/spec.ts'], declined: false, testRan: false, verified: false }));
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toMatch(/Never actually ran/);
    logSpy.mockRestore();
  });
});
