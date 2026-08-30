# Appliqation Heal-Selector

**Heals one broken Playwright selector in an existing, already-working script — narrow and token-efficient, never a full regenerate.**

Point it at a script, the selector that's failing, and why — it decides whether that's genuine selector staleness (heal it) or a real behaviour change (decline, not a healing case), verifies its answer against the live page's own accessibility tree, and only ever patches the one line, only after a real `npx playwright test` run confirms the fix actually works.

## Why this exists

A test-set regression run naturally sorts into three buckets: canonical scripts that still pass (nothing to do), test cases with no canonical script at all (a job for [`appliqation-scriptgen`](https://github.com/appliqation/scriptgen)), and canonical scripts that just started failing. That third bucket is ambiguous by nature — did the *app* regress, or did the *script* just go stale (a renamed id, a restructured DOM, the same element findable a different way)? Regenerating the whole script from scratch to answer that is wasteful when the real fix is one selector. This agent is built specifically for that bucket.

## The one rule that matters more than anything else here

**This agent must never "heal" a selector by finding one that merely makes the assertion pass again.** That's worse than leaving it broken — it fails silently and looks like success. A heal only happens once the model has established, from real evidence, that the new selector targets the *same semantic element* the original one did:

- **Accessibility role + accessible name**, read from the live page itself — the primary signal, always available.
- **The test case's own expected-result text**, from Appliqation — cross-checked against any candidate element.
- **Recorded session data**, when a caller happens to have it — a bonus signal, never required.

No confident match means no heal. It reports a clear decline instead, touches nothing, and hands off to a human or [`appliqation-defect-fix`](https://github.com/appliqation/defect-fix).

## Quick start

```bash
npm install -g @appliqation/heal-selector
npx playwright install chromium
```

Create a `.env` file (in whatever directory you'll run it from) with:

```
APPQ_API_KEY=your-appliqation-api-key   # read-only is enough
ANTHROPIC_API_KEY=your-anthropic-key    # or OPENAI_API_KEY — pick one
```

```bash
appliqation-heal-selector heal \
  --test-case-uuid 2424-8e61a1f0-4bba-4b7b-8fe5-f8ae19e65026 \
  --script-path tests/appliqation/scenario-2424/8e61a1f0.spec.ts \
  --failure "Locator #subscribe-btn not found — likely renamed or restructured" \
  --environment Stage \
  --repo-path /path/to/your/checkout
```

Add `--json`/`--ci` for a structured summary. The exit code is 0 only when a patch was written *and* independently verified by a real, post-patch test run — a decline, or an unverified attempt, both exit non-zero; the JSON summary's `declined` field tells them apart.

## Configuration

Copy `.env.example` to `.env`. Requires `APPQ_API_KEY` (read-only access is sufficient — this agent never calls an appq write tool) and one of `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`.

## Running this safely

This agent has real filesystem write access (scoped to `--repo-path`, path-escape and symlink protected), a real shell (allowlisted to a targeted `npx playwright test` and nothing else — no package installation, no bootstrap commands), and a real browser. It never calls an Appliqation write tool and never touches git — a separate agent ([`appliqation-pr-raise`](https://github.com/appliqation/pr-raise)) is responsible for committing and pushing whatever this one patches.

**Run this inside a container with an egress allowlist**, same as every agent in this family. This process only ever legitimately needs to reach:

- your LLM provider (`api.anthropic.com` or `api.openai.com`)
- your configured `APPQ_ORIGIN` (`appq.appliqation.io` by default)
- the site under test — whatever `--environment` resolves to

Anything else this process tries to reach is unexpected and worth investigating.

## Development

```bash
git clone https://github.com/appliqation/heal-selector.git
cd heal-selector
npm install
cp .env.example .env   # fill in APPQ_API_KEY (read-only) and an LLM key
npm run dev -- heal --test-case-uuid <uuid> --script-path <path> --failure "<text>" --environment <name> --repo-path <path>
npm run typecheck
npm test
```

See `CLAUDE.md` for a map of this repo if you're working in it with an AI coding assistant.

## License

MIT — see [LICENSE](./LICENSE).
