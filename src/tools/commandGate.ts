// This agent's own real shell capability — needed only to actually run the
// targeted `npx playwright test` verification after a heal, same mechanism
// appliqation-scriptgen/appliqation-defect-fix already established for the
// same reason.
//
// Hardcoded, non-negotiable invariant (same class of thing as
// destructiveActionGate.ts / the appq tool allowlists elsewhere in this
// family): an explicit allowlist of (command, argv-shape), checked BEFORE
// execution, never widened by prompt text. The actual execution path
// (codingTools.ts) uses child_process.execFile with an argv array — never a
// shell string — so even an allowed command can't smuggle a second command
// via `;`/`&&`/backticks; the OS never parses the arguments as shell syntax
// in the first place. The allowlist is defense in depth on top of that, not
// the only layer.
//
// Deliberately narrower than scriptgen/defect-fix's allowlist: this agent
// operates on an already-set-up repo with an already-working script — it
// never bootstraps a project or installs packages, so there's no `npm
// init`/`npm install`/`npx playwright install` case here at all. Only
// `npx playwright test` (targeted — a `--grep`/spec-path pair, never a full
// suite) plus basic read-only sanity commands.

/** A path-shaped argument (a test file glob/relative path) — no traversal, no shell metacharacters. */
function isSafePathArg(arg: string): boolean {
  return !arg.includes('..') && !/[;&|`$(){}<>]/.test(arg) && !arg.startsWith('-');
}

type Validator = (args: string[]) => boolean;

const ALLOWED_COMMANDS: Record<string, Validator> = {
  npx: (args) => {
    if (args[0] !== 'playwright') return false;
    if (args[1] === '--version' && args.length === 2) return true;
    if (args[1] === 'test') {
      // A --grep "<title>" pair and/or a relative spec file path — always
      // targeted at the one test case being healed, never a bare, unscoped
      // full-suite run.
      return args.slice(2).every((a) => a === '--grep' || isSafePathArg(a));
    }
    return false;
  },
  node: (args) => args.length === 1 && args[0] === '--version',
  git: (args) => {
    if (args.length === 1 && args[0] === 'status') return true;
    if (args.length === 1 && args[0] === 'diff') return true;
    if (args.length === 2 && args[0] === 'diff' && args[1] === '--stat') return true;
    return false;
  },
};

export function assertCommandAllowed(command: string, args: string[]): void {
  const validator = ALLOWED_COMMANDS[command];
  if (!validator || !validator(args)) {
    throw new Error(
      `Command "${command} ${args.join(' ')}" is not in the allowlist. This is a hardcoded boundary — no ` +
        `workflow prompt can widen it. Allowed: npx playwright --version/test (targeted — --grep and/or a spec ` +
        `path), node --version, git status/diff. No npm install/init or npx playwright install — this agent ` +
        `never bootstraps a project, only heals an existing, already-working one.`,
    );
  }
}
