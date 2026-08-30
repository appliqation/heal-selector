// --json/--ci's renderer, matching the family's shape (scriptgen/defect-fix
// output.ts). exitCodeFor() never trusts the model's own report text — only
// HealResult.testRun.ok (a real execFile exit code, only counting if it
// happened after the last write) decides success.
//
// `declined` is the one field genuinely new to this agent: a heal attempt
// has three real outcomes, not two — verified success, a genuine decline
// (nothing was touched, this isn't a stale-selector case, escalate to a
// human or defect-fix), or an attempted-but-unverified state (wrote
// something, verification never happened or failed — needs human review,
// never silently retried). `writtenPaths.length === 0` is the objective
// signal for "declined": the policy's own Phase 2/6 instructs it to touch
// nothing when it can't establish semantic identity, so an empty write set
// IS the decline, not something inferred from report prose.

export interface HealSummary {
  testCaseUuid: string;
  scriptPath: string;
  writtenPaths: string[];
  declined: boolean;
  testRan: boolean;
  verified: boolean;
  report: string;
}

export function printJsonSummary(summary: HealSummary): void {
  console.log(JSON.stringify(summary, null, 2));
}

export function printHumanSummary(summary: HealSummary): void {
  console.log(`\n=== Test case ${summary.testCaseUuid} (${summary.scriptPath}) ===\n`);
  if (summary.declined) {
    console.log('  Declined — not a healing case. No files were touched. See the report for why.');
    return;
  }
  for (const p of summary.writtenPaths) console.log(`  patched  ${p}`);
  if (!summary.testRan) {
    console.log('\n  Never actually ran `npx playwright test` after the patch — not verified.');
  } else {
    console.log(`\n  Verification: ${summary.verified ? 'PASSED' : 'FAILED (or stale — run predates the patch)'}`);
  }
}

/** 1 unless the heal both wrote something AND was verified — via a real, post-write execFile pass — 0 in that one case, 1 for a decline or an unverified attempt alike. */
export function exitCodeFor(summary: HealSummary): number {
  return summary.testRan && summary.verified ? 0 : 1;
}
