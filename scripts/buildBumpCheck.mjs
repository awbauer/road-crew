// Decides whether a branch still owes a build-number bump.
//
// AGENTS.md has said "every new feature branch must advance the build number"
// for a long time, and branches kept shipping without one. Prose in a file an
// agent reads once at session start does not survive eight PRs of context, so
// the rule lives here instead, where it can fail loudly.
//
// Pure functions only — no git, no fs — so the classification is testable.

/** Paths whose contents reach a user: the app and the shared packages. */
const SHIPPED_PREFIXES = [
  "apps/",
  "packages/",
];

/**
 * Changes that ship nothing on their own. Documentation, tests, CI config and
 * tooling can land without a build bump — requiring one there would make the
 * check noise, and a check people route around is worse than no check.
 */
export function isExemptPath(file) {
  if (!file) return true;
  if (file.endsWith(".md")) return true;
  if (file.startsWith("docs/")) return true;
  if (file.startsWith(".github/")) return true;
  if (file.startsWith(".claude/")) return true;
  if (file.startsWith("scripts/")) return true;
  if (file.includes("/tests/") || file.includes("/__tests__/")) return true;
  if (file.includes("/e2e/")) return true;
  if (/\.test\.(mjs|ts|tsx|js)$/.test(file)) return true;
  return false;
}

/** True when this file shipping to a device or the edge needs a new build. */
export function requiresBuildBump(file) {
  if (isExemptPath(file)) return false;
  return SHIPPED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

export const VERSION_FILE = "packages/config/src/version.ts";
export const HISTORY_FILE = "packages/config/VERSION_HISTORY.md";

/**
 * @param {object} input
 * @param {string[]} input.changedFiles Paths changed against the base branch.
 * @param {string|null} input.baseBuild  Build number on the base branch.
 * @param {string|null} input.headBuild  Build number on this branch.
 * @returns {{ ok: boolean, reason: string|null, shipping: string[] }}
 */
export function checkBuildBump({ changedFiles = [], baseBuild = null, headBuild = null } = {}) {
  const shipping = changedFiles.filter(requiresBuildBump);
  if (!shipping.length) {
    return { ok: true, reason: null, shipping };
  }
  if (!headBuild) {
    return { ok: false, reason: `Could not read the build number from ${VERSION_FILE}.`, shipping };
  }
  if (baseBuild && headBuild === baseBuild) {
    return {
      ok: false,
      reason: `The build number is still ${headBuild}, unchanged from the base branch.`,
      shipping,
    };
  }
  // A lower build than the base means the branch is stale or was reset; the
  // build is a UTC timestamp, so it only ever moves forward.
  if (baseBuild && Number(headBuild) < Number(baseBuild)) {
    return {
      ok: false,
      reason: `The build number ${headBuild} is older than the base branch's ${baseBuild}.`,
      shipping,
    };
  }
  return { ok: true, reason: null, shipping };
}

/** Pull CURRENT_BUILD out of version.ts without importing it. */
export function parseBuild(source) {
  const match = /const\s+CURRENT_BUILD\s*=\s*"([^"]+)"/.exec(String(source ?? ""));
  return match ? match[1] : null;
}

/** The build number convention: first 8 digits of the UTC Unix timestamp. */
export function suggestedBuild(nowMs = Date.now()) {
  return String(Math.floor(nowMs / 1000)).slice(0, 8);
}
