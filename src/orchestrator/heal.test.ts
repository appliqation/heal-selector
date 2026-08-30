import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLaunch } = vi.hoisted(() => ({ mockLaunch: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch: mockLaunch } }));

const { mockFetchAppqToolDefs, mockCreateGatedAppqDispatcher, mockRunLoop } = vi.hoisted(() => ({
  mockFetchAppqToolDefs: vi.fn(),
  mockCreateGatedAppqDispatcher: vi.fn(),
  mockRunLoop: vi.fn(),
}));
vi.mock('@appliqation/agent-core', async (importOriginal) => {
  // PlaywrightBrowserTools/BROWSER_TOOL_DEFS come through as the real
  // implementation — this suite verifies actual dispatch routing against
  // the real class, not just that some function was called.
  const actual = await importOriginal<typeof import('@appliqation/agent-core')>();
  return {
    ...actual,
    fetchAppqToolDefs: mockFetchAppqToolDefs,
    createGatedAppqDispatcher: mockCreateGatedAppqDispatcher,
    runLoop: mockRunLoop,
  };
});

const { mockCodingDispatch, mockGetWrittenPaths, mockLastPlaywrightTestRun, MockCodingTools } = vi.hoisted(() => {
  const mockCodingDispatch = vi.fn();
  const mockGetWrittenPaths = vi.fn();
  const mockLastPlaywrightTestRun = vi.fn();
  class MockCodingTools {
    dispatch = mockCodingDispatch;
    getWrittenPaths = mockGetWrittenPaths;
    lastPlaywrightTestRun = mockLastPlaywrightTestRun;
  }
  return { mockCodingDispatch, mockGetWrittenPaths, mockLastPlaywrightTestRun, MockCodingTools };
});
vi.mock('../tools/codingTools.js', () => ({
  CodingTools: MockCodingTools,
  CODING_TOOL_DEFS: [
    { name: 'read_file', description: 'x', inputSchema: {} },
    { name: 'write_file', description: 'x', inputSchema: {} },
    { name: 'list_directory', description: 'x', inputSchema: {} },
    { name: 'run_command', description: 'x', inputSchema: {} },
  ],
}));

import { heal } from './heal.js';
import type { McpClient, ProviderAdapter, RunBudget } from '@appliqation/agent-core';

function fakePage() {
  return { on: vi.fn(), goto: vi.fn().mockResolvedValue(undefined), ariaSnapshot: vi.fn().mockResolvedValue('') };
}

function fakeClient(): McpClient {
  return {
    fetchPrompt: vi.fn(),
    startWorkflow: vi.fn(),
    callTool: vi.fn(),
    listTools: vi.fn(),
    uploadScreenshot: vi.fn(),
  };
}

const budget: RunBudget = { maxCalls: 30, maxPages: 20, maxMillis: 600_000, maxTurns: 30 };

function baseOpts() {
  return {
    client: fakeClient(),
    adapter: { complete: vi.fn() } as ProviderAdapter,
    testCaseUuid: '2424-abc',
    scriptPath: 'tests/appliqation/scenario-2424/abc.spec.ts',
    failureDescription: 'Locator #old-id not found — the button was likely renamed.',
    url: 'https://stage.example.com/subscribe',
    repoPath: '/tmp/repo',
    budget,
    commandTimeoutMs: 30_000,
  };
}

describe('heal', () => {
  beforeEach(() => {
    const browser = { close: vi.fn().mockResolvedValue(undefined), newPage: vi.fn().mockResolvedValue(fakePage()) };
    mockLaunch.mockReset().mockResolvedValue(browser);
    mockFetchAppqToolDefs.mockReset().mockResolvedValue([{ name: 'get_scenario', description: 'x', inputSchema: {} }]);
    mockCreateGatedAppqDispatcher.mockReset().mockReturnValue(vi.fn().mockResolvedValue({ ok: true, text: 'appq result' }));
    mockRunLoop.mockReset().mockResolvedValue({ report: 'done', turns: 3, budgetExceeded: false });
    mockCodingDispatch.mockReset().mockResolvedValue({ ok: true, text: 'coding result' });
    mockGetWrittenPaths.mockReset().mockReturnValue(new Map());
    mockLastPlaywrightTestRun.mockReset().mockReturnValue(null);
  });

  it('calls runLoop with the local heal policy as the system prompt — no appq-served prompt exists for this', async () => {
    await heal(baseOpts());
    const call = mockRunLoop.mock.calls[0][0];
    expect(call.system).toContain('you heal ONE broken selector');
    expect(call.system).toContain('Non-negotiable');
  });

  it('the seed message includes the test case, script, failure description, URL, and repo path', async () => {
    await heal(baseOpts());
    const call = mockRunLoop.mock.calls[0][0];
    expect(call.seedMessage).toContain('2424-abc');
    expect(call.seedMessage).toContain('tests/appliqation/scenario-2424/abc.spec.ts');
    expect(call.seedMessage).toContain('Locator #old-id not found');
    expect(call.seedMessage).toContain('https://stage.example.com/subscribe');
    expect(call.seedMessage).toContain('/tmp/repo');
  });

  it('includes the defect ID in the seed message only when given', async () => {
    await heal({ ...baseOpts(), defectId: 'defect-123' });
    const withDefect = mockRunLoop.mock.calls[0][0].seedMessage;
    expect(withDefect).toContain('defect-123');

    mockRunLoop.mockClear();
    await heal(baseOpts());
    const withoutDefect = mockRunLoop.mock.calls[0][0].seedMessage;
    expect(withoutDefect).not.toContain('Linked defect ID');
  });

  it('offers appq context tools, browser tools, and coding tools together', async () => {
    await heal(baseOpts());
    const call = mockRunLoop.mock.calls[0][0];
    const toolNames = call.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(['get_scenario', 'browser_navigate', 'browser_snapshot', 'read_file', 'write_file', 'run_command']));
  });

  it('routes browser_-prefixed dispatches to browser tools, coding-tool names to CodingTools, everything else to the gated appq dispatcher', async () => {
    await heal(baseOpts());
    const dispatch = mockRunLoop.mock.calls[0][0].dispatch;

    await dispatch('browser_snapshot', {});
    await dispatch('write_file', { path: 'x', content: 'y' });
    expect(mockCodingDispatch).toHaveBeenCalledWith('write_file', { path: 'x', content: 'y' });

    const gatedFn = mockCreateGatedAppqDispatcher.mock.results[0].value;
    await dispatch('get_scenario', { scenario_id: 2424 });
    expect(gatedFn).toHaveBeenCalledWith('get_scenario', { scenario_id: 2424 });
  });

  it('closes the browser even when runLoop throws', async () => {
    const browser = { close: vi.fn().mockResolvedValue(undefined), newPage: vi.fn().mockResolvedValue(fakePage()) };
    mockLaunch.mockResolvedValue(browser);
    mockRunLoop.mockRejectedValue(new Error('boom'));
    await expect(heal(baseOpts())).rejects.toThrow('boom');
    expect(browser.close).toHaveBeenCalled();
  });

  it('returns loopResult.report/turns/budgetExceeded unchanged', async () => {
    mockRunLoop.mockResolvedValue({ report: 'my report', turns: 5, budgetExceeded: true });
    const result = await heal(baseOpts());
    expect(result.report).toBe('my report');
    expect(result.turns).toBe(5);
    expect(result.budgetExceeded).toBe(true);
  });

  describe('testRun outcome — never trusts the model, only real coding-tool state', () => {
    it('ran=false, ok=false when no playwright test invocation ever happened (e.g. a genuine decline)', async () => {
      mockLastPlaywrightTestRun.mockReturnValue(null);
      const result = await heal(baseOpts());
      expect(result.testRun).toEqual({ ran: false, ok: false, exitCode: null });
      expect(result.writtenPaths).toEqual([]);
    });

    it('ok=true when the last test run succeeded and happened after the patch', async () => {
      mockGetWrittenPaths.mockReturnValue(new Map([['tests/spec.ts', 1000]]));
      mockLastPlaywrightTestRun.mockReturnValue({ command: 'npx', args: ['playwright', 'test'], ok: true, exitCode: 0, timestamp: 2000 });
      const result = await heal(baseOpts());
      expect(result.testRun).toEqual({ ran: true, ok: true, exitCode: 0 });
    });

    it('ok=false when the test run failed, even though it happened after the patch', async () => {
      mockGetWrittenPaths.mockReturnValue(new Map([['tests/spec.ts', 1000]]));
      mockLastPlaywrightTestRun.mockReturnValue({ command: 'npx', args: ['playwright', 'test'], ok: false, exitCode: 1, timestamp: 2000 });
      const result = await heal(baseOpts());
      expect(result.testRun).toEqual({ ran: true, ok: false, exitCode: 1 });
    });

    it('ok=false when a PASSING run happened BEFORE the patch — stale, proves nothing about the file as it stands now', async () => {
      mockGetWrittenPaths.mockReturnValue(new Map([['tests/spec.ts', 5000]])); // written after the test ran
      mockLastPlaywrightTestRun.mockReturnValue({ command: 'npx', args: ['playwright', 'test'], ok: true, exitCode: 0, timestamp: 2000 });
      const result = await heal(baseOpts());
      expect(result.testRun.ok).toBe(false);
      expect(result.testRun.ran).toBe(true);
    });

    it('reports the patched path when one was written', async () => {
      mockGetWrittenPaths.mockReturnValue(new Map([['tests/spec.ts', 1]]));
      const result = await heal(baseOpts());
      expect(result.writtenPaths).toEqual(['tests/spec.ts']);
    });
  });
});
