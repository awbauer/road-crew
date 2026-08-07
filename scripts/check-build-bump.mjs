#!/usr/bin/env node
// Fails when a branch changes shipped code without advancing the build number.
//
// Wired two ways, because the two audiences fail differently:
//   - `npm run check:build-bump`, for humans and CI.
//   - a Claude Code Stop hook (.claude/settings.json), which is the one that
//     matters for agents: it fires before the turn ends, and its stderr comes
//     back as feedback, so the rule reasserts itself instead of relying on a
//     line in AGENTS.md staying in context.
//
// Exits 2 (not 1) so the Stop hook surfaces the message rather than treating it
// as a crashed script.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  HISTORY_FILE,
  VERSION_FILE,
  checkBuildBump,
  parseBuild,
  suggestedBuild,
} from "./buildBumpCheck.mjs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/** The branch this work will merge into: beta if it exists, else main. */
function baseRef() {
  for (const candidate of ["origin/beta", "origin/main"]) {
    if (tryGit(["rev-parse", "--verify", "--quiet", candidate])) return candidate;
  }
  return null;
}

function main() {
  if (!tryGit(["rev-parse", "--git-dir"])) return 0;

  const base = baseRef();
  if (!base) return 0;

  const branch = tryGit(["branch", "--show-current"]);
  // On the base branch itself there is nothing to compare against.
  if (branch && base.endsWith(`/${branch}`)) return 0;

  const mergeBase = tryGit(["merge-base", base, "HEAD"]);
  if (!mergeBase) return 0;

  // Committed changes plus anything still in the working tree, so the check
  // fires while the work is in progress rather than only after committing.
  const committed = tryGit(["diff", "--name-only", `${mergeBase}..HEAD`]) || "";
  const working = tryGit(["diff", "--name-only", "HEAD"]) || "";
  const staged = tryGit(["diff", "--name-only", "--cached"]) || "";
  const changedFiles = [...new Set([...committed.split("\n"), ...working.split("\n"), ...staged.split("\n")])]
    .map((line) => line.trim())
    .filter(Boolean);

  if (!changedFiles.length) return 0;

  let headBuild = null;
  try {
    headBuild = parseBuild(readFileSync(VERSION_FILE, "utf8"));
  } catch {
    headBuild = null;
  }
  const baseBuild = parseBuild(tryGit(["show", `${mergeBase}:${VERSION_FILE}`]) ?? "");

  const result = checkBuildBump({ changedFiles, baseBuild, headBuild });
  if (result.ok) return 0;

  const sample = result.shipping.slice(0, 5);
  const more = result.shipping.length - sample.length;
  console.error(
    [
      `Build number not advanced. ${result.reason}`,
      "",
      `This branch changes ${result.shipping.length} shipped file(s):`,
      ...sample.map((file) => `  ${file}`),
      ...(more > 0 ? [`  ...and ${more} more`] : []),
      "",
      `Set CURRENT_BUILD in ${VERSION_FILE} to ${suggestedBuild()} (first 8 digits of`,
      `the UTC Unix timestamp), and add a matching top entry to ${HISTORY_FILE}`,
      "describing the change.",
    ].join("\n"),
  );
  return 2;
}

process.exit(main());
