// This agent's own domain knowledge of which appq tools it may touch — the
// enforcement mechanism (assertToolAllowed / the gated dispatcher) lives in
// @appliqation/agent-core, shared with every sibling agent; only the
// allowlist content is local. Zero write tools — genuinely absent, not
// gated behind a flag. This agent never calls an appq write tool and never
// performs a git operation; it patches local files only, and a separate
// agent (appliqation-pr-raise) is responsible for reviewing/committing/
// pushing them.

export const READONLY_CONTEXT_TOOLS = new Set([
  // The test case's own expected_result/steps — the ground truth a healed
  // selector's semantic identity gets checked against.
  'get_scenario',
  // If the caller knows a defect linked to this failure, its evidence
  // (routes_visited, console/network errors) is useful diagnostic context —
  // optional, this agent works fine without it.
  'get_defect_context',
]);
