#!/usr/bin/env node
import fs from "node:fs/promises";

import { validateRouteData } from "../../../packages/core/src/validation.ts";

const DATA_PATH = "packages/data/routes/sequences.json";
const MARKER = "<!-- rc-route-data-diagnostics -->";

function outputArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function appendOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function summarize(data) {
  const routes = Array.isArray(data?.routes) ? data.routes : [];
  const sequenceCount = routes.reduce((sum, route) => sum + (route.sequences?.length || 0), 0);
  return {
    generatedAt: data?.generated_at || "unknown",
    routeCount: routes.length,
    sequenceCount,
  };
}

function renderMarkdown(summary, issues) {
  const lines = [
    MARKER,
    "## Route Data Diagnostics",
    "",
    `Generated: \`${summary.generatedAt}\``,
    `Routes: \`${summary.routeCount}\``,
    `Sequences: \`${summary.sequenceCount}\``,
    "",
  ];

  if (!issues.length) {
    lines.push("No route-data diagnostics were reported.");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`Reported diagnostics: \`${issues.length}\``, "");
  issues.forEach((issue) => lines.push(`- ${issue}`));
  return `${lines.join("\n")}\n`;
}

async function main() {
  let data = null;
  let issues = [];
  try {
    data = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
    issues = validateRouteData(data);
  } catch (err) {
    issues = [`Unable to read or parse ${DATA_PATH}: ${err.message}`];
  }

  const markdown = renderMarkdown(summarize(data), issues);
  const outPath = outputArg("out");
  if (outPath) await fs.writeFile(outPath, markdown);
  else process.stdout.write(markdown);

  await appendOutput("has_diagnostics", issues.length ? "true" : "false");
  await appendOutput("diagnostic_count", String(issues.length));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
