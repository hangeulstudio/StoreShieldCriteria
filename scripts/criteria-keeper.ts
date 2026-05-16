#!/usr/bin/env bun
/**
 * Criteria Keeper — StoreShield
 *
 * Weekly automation that scrapes Apple's official sources + community signals,
 * diffs against current YAML criteria, and opens a PR with any changes.
 *
 * Sources (by tier):
 *   Tier 1 (authoritative): Required Reason API docs, Third-Party SDK list,
 *                            App Store Review Guidelines, Apple Developer News
 *   Tier 3 (early warning):  RevenueCat blog, Emerge Tools blog, iOS Dev Weekly
 *   Tier 4 (supply chain):   GitHub releases of major SDKs on Apple's list
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import * as crypto from "crypto";
import { execFileSync } from "child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const CRITERIA_FILES = [
  "sensitive_apis.yaml",
  "risky_frameworks.yaml",
  "risk_scoring.yaml",
] as const;

// Apple documentation JSON API (server-side rendered — avoids JS requirement of HTML pages)
const APPLE_JSON_SOURCES = {
  requiredReasonAPI:
    "https://developer.apple.com/tutorials/data/documentation/bundleresources/privacy_manifest_files/describing_use_of_required_reason_api.json",
  privacyManifest:
    "https://developer.apple.com/tutorials/data/documentation/bundleresources/privacy_manifest_files.json",
};

// Plain HTML sources (not SPA — fetch works)
const APPLE_HTML_SOURCES = {
  thirdPartySDKs:
    "https://developer.apple.com/support/third-party-SDK-requirements/",
  reviewGuidelines:
    "https://developer.apple.com/app-store/review/guidelines/",
  developerNews: "https://developer.apple.com/news/releases/",
};

const COMMUNITY_RSS = [
  {
    name: "RevenueCat Blog",
    url: "https://www.revenuecat.com/blog/rss.xml",
    filter: ["privacy", "app store", "rejection", "manifest", "sdk"],
  },
  {
    name: "Emerge Tools Blog",
    url: "https://www.emergetools.com/rss.xml",
    filter: ["privacy", "app store", "binary", "sdk", "api"],
  },
  {
    name: "iOS Dev Weekly",
    url: "https://iosdevweekly.com/issues.rss",
    filter: ["privacy", "app store", "rejection", "manifest"],
  },
];

// Major SDKs on Apple's required list — watch for privacy manifest updates
const TRACKED_SDK_REPOS = [
  "firebase/firebase-ios-sdk",
  "amplitude/Amplitude-iOS",
  "adjust/ios_sdk",
  "BranchMetrics/ios-branch-deep-linking-attribution",
  "braze-inc/braze-swift-sdk",
  "mixpanel/mixpanel-swift",
  "segmentio/analytics-swift",
  "getsentry/sentry-cocoa",
  "DataDog/dd-sdk-ios",
  "onesignal/OneSignal-iOS-SDK",
];

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const LOG_PATH = path.join(import.meta.dir, "criteria-keeper.log");
const logLines: string[] = [];

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function writeLog() {
  fs.writeFileSync(LOG_PATH, logLines.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchText(url: string, timeoutMs = 15_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "StoreShield-CriteriaKeeper/1.0 (compliance-bot)" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function safeFetchText(url: string): Promise<string | null> {
  try {
    return await fetchText(url);
  } catch (e) {
    log(`WARN: Failed to fetch ${url}: ${e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// RSS parser (minimal — no external dependency)
// ---------------------------------------------------------------------------

function parseRSSItems(
  xml: string,
  filter: string[]
): Array<{ title: string; link: string; date: string }> {
  const items: Array<{ title: string; link: string; date: string }> = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  const cutoff = Date.now() - 8 * 24 * 60 * 60 * 1000; // last 8 days

  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1")
      .trim() ?? "";
    const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1]
      ?.trim() ?? "";
    const dateStr = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) || [])[1]
      ?.trim() ?? "";

    const date = dateStr ? new Date(dateStr).getTime() : 0;
    if (date && date < cutoff) continue;

    const lc = title.toLowerCase();
    const relevant = filter.some((f) => lc.includes(f));
    if (relevant) items.push({ title, link, date: dateStr });
  }
  return items;
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

async function fetchLatestSDKRelease(
  repo: string
): Promise<{ tag: string; body: string; date: string } | null> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "StoreShield-CriteriaKeeper/1.0",
    };
    if (process.env.GH_TOKEN) headers["Authorization"] = `Bearer ${process.env.GH_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!res.ok) return null;
    const data = await res.json() as { tag_name: string; body?: string; published_at: string };
    return { tag: data.tag_name, body: data.body ?? "", date: data.published_at };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Load current criteria
// ---------------------------------------------------------------------------

function loadCurrentCriteria(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const file of CRITERIA_FILES) {
    const fullPath = path.join(REPO_ROOT, file);
    try {
      result[file] = yaml.load(fs.readFileSync(fullPath, "utf8"));
    } catch (e) {
      log(`WARN: Could not load ${file}: ${e}`);
      result[file] = null;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Scrape Apple sources
// ---------------------------------------------------------------------------

/** Extract readable text from Apple's documentation JSON format. */
function extractAppleDocText(obj: unknown): string {
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(extractAppleDocText).join(" ");
  if (obj && typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    // Prefer code voice verbatim
    if (o["type"] === "codeVoice" && typeof o["code"] === "string") return o["code"];
    return Object.values(o)
      .filter((v) => typeof v === "string" || Array.isArray(v) || (v && typeof v === "object"))
      .map(extractAppleDocText)
      .join(" ");
  }
  return "";
}

async function scrapeAppleSources(): Promise<string> {
  log("Scraping Apple Tier 1 sources…");
  const parts: string[] = [];

  // JSON API sources (full content, no JS needed)
  for (const [name, url] of Object.entries(APPLE_JSON_SOURCES)) {
    const raw = await safeFetchText(url);
    if (!raw) { parts.push(`### ${name}\n[fetch failed]\n`); continue; }
    try {
      const json = JSON.parse(raw);
      const text = extractAppleDocText(json.primaryContentSections ?? json)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 10000);
      parts.push(`### ${name}\nURL: ${url}\n\n${text}\n`);
      log(`  ✓ ${name} JSON (${text.length} chars)`);
    } catch {
      parts.push(`### ${name}\n[JSON parse failed]\n`);
    }
  }

  // HTML sources (simpler pages that don't require JS)
  for (const [name, url] of Object.entries(APPLE_HTML_SOURCES)) {
    const html = await safeFetchText(url);
    if (!html) { parts.push(`### ${name}\n[fetch failed]\n`); continue; }
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
    parts.push(`### ${name}\nURL: ${url}\n\n${text}\n`);
    log(`  ✓ ${name} HTML (${text.length} chars)`);
  }

  return parts.join("\n---\n");
}

// ---------------------------------------------------------------------------
// Scrape community signals (Tier 3)
// ---------------------------------------------------------------------------

async function scrapeCommunitySignals(): Promise<string> {
  log("Scraping Tier 3 community RSS feeds…");
  const parts: string[] = [];

  for (const feed of COMMUNITY_RSS) {
    const xml = await safeFetchText(feed.url);
    if (!xml) { parts.push(`### ${feed.name}\n[fetch failed]\n`); continue; }
    const items = parseRSSItems(xml, feed.filter);
    if (items.length === 0) {
      parts.push(`### ${feed.name}\nNo relevant articles in last 7 days.\n`);
      log(`  - ${feed.name}: no relevant items`);
    } else {
      const lines = items.map((i) => `- [${i.title}](${i.link}) (${i.date})`).join("\n");
      parts.push(`### ${feed.name}\n${lines}\n`);
      log(`  ✓ ${feed.name}: ${items.length} relevant items`);
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Scrape SDK supply chain (Tier 4)
// ---------------------------------------------------------------------------

async function scrapeSDKSignals(): Promise<string> {
  log("Checking Tier 4 SDK GitHub releases…");
  const parts: string[] = [];
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // last 14 days

  for (const repo of TRACKED_SDK_REPOS) {
    const release = await fetchLatestSDKRelease(repo);
    if (!release) { continue; }
    const date = new Date(release.date).getTime();
    if (date < cutoff) continue;

    // Only surface releases that mention privacy/manifest
    const lc = (release.tag + " " + release.body).toLowerCase();
    if (!["privacy", "manifest", "required_reason", "xcprivacy"].some((kw) => lc.includes(kw))) continue;

    const snippet = release.body.slice(0, 500);
    parts.push(`### ${repo} @ ${release.tag} (${release.date})\n${snippet}\n`);
    log(`  ✓ ${repo} ${release.tag} — privacy-related release`);
  }

  return parts.length > 0 ? parts.join("\n") : "No privacy-related SDK releases in last 14 days.\n";
}

// ---------------------------------------------------------------------------
// Claude API — analyze and produce diff
// ---------------------------------------------------------------------------

interface CriteriaChange {
  file: string;
  type: "add" | "modify" | "remove";
  field: string;
  current: unknown;
  proposed: unknown;
  reason: string;
  source: string;
  confidence: "high" | "medium" | "low";
}

interface ClaudeAnalysisResult {
  changes: CriteriaChange[];
  summary: string;
  sources_checked: string[];
  no_changes_reason?: string;
}

async function analyzeWithClaude(
  appleSources: string,
  communitySignals: string,
  sdkSignals: string,
  currentCriteria: Record<string, unknown>
): Promise<ClaudeAnalysisResult> {
  log("Calling Claude API for analysis…");

  const client = new Anthropic();

  const systemPrompt = `You are the Criteria Keeper for StoreShield, a macOS app that scans iOS apps for App Store compliance.

Your job: compare freshly-scraped Apple documentation against the current YAML criteria files, then identify ONLY concrete changes Apple has made.

Rules:
1. Tier 1 Apple sources = authoritative. Only propose changes backed by Tier 1.
2. Tier 3 (community) and Tier 4 (SDK) = early warning signals ONLY. Use them to flag things to watch, never as sole basis for a change.
3. Be conservative. False positives waste developer time. Only propose high-confidence changes.
4. Reason codes (e.g. "C617.1") must come verbatim from Apple docs — never invent them.
5. api_type values must match "NSPrivacyAccessedAPIType*" pattern exactly.
6. For risky_frameworks: only add SDKs explicitly listed on Apple's Third-Party SDK Requirements page.

Output STRICT JSON matching this TypeScript type:
{
  changes: Array<{
    file: string,           // "sensitive_apis.yaml" | "risky_frameworks.yaml" | "risk_scoring.yaml"
    type: "add" | "modify" | "remove",
    field: string,          // YAML path, e.g. "sensitive_apis.FileTimestamp.symbols[3]"
    current: unknown,       // current value (null for add)
    proposed: unknown,      // proposed value (null for remove)
    reason: string,         // why this change is needed
    source: string,         // exact URL of Apple page that justifies this
    confidence: "high" | "medium" | "low"
  }>,
  summary: string,          // 1-3 sentence human summary
  sources_checked: string[],// list of source URLs actually consulted
  no_changes_reason?: string // explain why no changes if changes array is empty
}`;

  const userPrompt = `## Current criteria files

\`\`\`json
${JSON.stringify(currentCriteria, null, 2)}
\`\`\`

## Apple documentation (Tier 1 — authoritative)

${appleSources}

---

## Community signals (Tier 3 — early warning only, not authoritative)

${communitySignals}

---

## SDK supply chain signals (Tier 4 — early warning only)

${sdkSignals}

---

Analyze the above. Produce the JSON output as specified. If nothing has changed in Apple's docs, return an empty changes array with a no_changes_reason.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // Extract JSON from response (may be wrapped in ```json ... ```)
  const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/) || text.match(/(\{[\s\S]+\})/);
  if (!jsonMatch) throw new Error("Claude returned no JSON block");

  const result = JSON.parse(jsonMatch[1]) as ClaudeAnalysisResult;
  log(`Analysis complete: ${result.changes.length} proposed changes`);
  return result;
}

// ---------------------------------------------------------------------------
// Apply changes to YAML files
// ---------------------------------------------------------------------------

function applyChanges(
  changes: CriteriaChange[],
  currentCriteria: Record<string, unknown>
): Record<string, unknown> {
  const updated = JSON.parse(JSON.stringify(currentCriteria)) as Record<string, unknown>;

  for (const change of changes) {
    if (change.confidence === "low") {
      log(`  SKIP low-confidence change: ${change.field}`);
      continue;
    }

    try {
      const data = updated[change.file] as Record<string, unknown>;
      if (!data) continue;

      const parts = change.field
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean);

      if (change.type === "add" || change.type === "modify") {
        // Navigate to parent, set final key
        let cursor: Record<string, unknown> = data;
        for (let i = 0; i < parts.length - 1; i++) {
          const key = parts[i];
          if (!(key in cursor)) cursor[key] = {};
          cursor = cursor[key] as Record<string, unknown>;
        }
        cursor[parts[parts.length - 1]] = change.proposed;
        log(`  APPLY ${change.type} ${change.file}:${change.field}`);
      } else if (change.type === "remove") {
        let cursor: Record<string, unknown> = data;
        for (let i = 0; i < parts.length - 1; i++) {
          cursor = cursor[parts[i]] as Record<string, unknown>;
          if (!cursor) break;
        }
        if (cursor) {
          delete cursor[parts[parts.length - 1]];
          log(`  APPLY remove ${change.file}:${change.field}`);
        }
      }
    } catch (e) {
      log(`  ERROR applying ${change.field}: ${e}`);
    }
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Compute checksums
// ---------------------------------------------------------------------------

function sha256Hex(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function packageCriteriaZip(): Buffer {
  const distDir = path.join(REPO_ROOT, "dist");
  const zipPath = path.join(distDir, "criteria.zip");
  fs.mkdirSync(distDir, { recursive: true });
  fs.rmSync(zipPath, { force: true });
  execFileSync("zip", ["-X", "-j", zipPath, ...CRITERIA_FILES], {
    cwd: REPO_ROOT,
    stdio: "ignore",
  });
  return fs.readFileSync(zipPath);
}

function signCriteriaZipIfPossible(): string | null {
  const pem = process.env.CRITERIA_SIGNING_KEY;
  if (!pem) return null;
  const privateKey = crypto.createPrivateKey(pem);
  return crypto.sign(null, packageCriteriaZip(), privateKey).toString("base64");
}

// ---------------------------------------------------------------------------
// Bump version
// ---------------------------------------------------------------------------

function bumpVersion(current: string, bumpType: "patch" | "minor"): string {
  const parts = current.split(".").map(Number);
  if (bumpType === "minor") { parts[1] += 1; parts[2] = 0; }
  else parts[2] += 1;
  return parts.join(".");
}

// ---------------------------------------------------------------------------
// Write updated files + manifest
// ---------------------------------------------------------------------------

function writeUpdatedFiles(
  updated: Record<string, unknown>,
  currentManifest: Record<string, unknown>,
  bumpType: "patch" | "minor",
  changelog: string,
  zipSignature: string | null = null
): { newVersion: string; checksums: Record<string, string> } {
  const newVersion = bumpVersion(currentManifest["version"] as string, bumpType);
  const checksums: Record<string, string> = {};

  for (const file of CRITERIA_FILES) {
    if (!updated[file]) continue;
    const content = yaml.dump(updated[file], { lineWidth: 120, sortKeys: false });
    fs.writeFileSync(path.join(REPO_ROOT, file), content, "utf8");
    checksums[file] = `sha256:${sha256Hex(content)}`;
  }

  const newManifest: Record<string, unknown> = {
    manifest_version: "2",
    version: newVersion,
    url: `https://github.com/hangeulstudio/StoreShieldCriteria/releases/download/v${newVersion}/criteria.zip`,
    checksums,
    changelog,
  };
  if (zipSignature) newManifest["signature"] = zipSignature;

  fs.writeFileSync(
    path.join(REPO_ROOT, "manifest.json"),
    JSON.stringify(newManifest, null, 2) + "\n",
    "utf8"
  );

  return { newVersion, checksums };
}

// ---------------------------------------------------------------------------
// Open GitHub PR via API
// ---------------------------------------------------------------------------

async function createGitHubPR(
  branchName: string,
  title: string,
  body: string
): Promise<string | null> {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repo || !token) { log("WARN: GH_TOKEN or GITHUB_REPOSITORY not set — skipping PR"); return null; }

  const [owner, repoName] = repo.split("/");

  // Get default branch SHA
  const refRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/ref/heads/main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  const refData = await refRes.json() as { object: { sha: string } };
  const baseSha = refData.object.sha;

  // Create branch
  await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/refs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  });

  // Commit changed files
  for (const file of [...CRITERIA_FILES, "manifest.json"]) {
    const content = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    const encoded = Buffer.from(content).toString("base64");

    // Get current file SHA (needed for update)
    const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${file}?ref=${branchName}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    const fileData = await fileRes.json() as { sha?: string };

    await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${file}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `criteria: auto-update ${file}`,
        content: encoded,
        branch: branchName,
        sha: fileData.sha,
      }),
    });
  }

  // Create PR
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      body,
      head: branchName,
      base: "main",
      draft: false,
    }),
  });
  const prData = await prRes.json() as { html_url?: string; number?: number };
  return prData.html_url ?? null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("=== Criteria Keeper starting ===");

  const forcePR = process.env.FORCE_PR === "true";
  const dryRun = process.env.DRY_RUN === "true";

  if (!process.env.ANTHROPIC_API_KEY) {
    log("ERROR: ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  // 1. Load current criteria
  const currentCriteria = loadCurrentCriteria();
  const currentManifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "manifest.json"), "utf8")
  ) as Record<string, unknown>;
  log(`Current criteria version: ${currentManifest.version}`);

  // 2. Scrape sources in parallel
  const [appleSources, communitySignals, sdkSignals] = await Promise.all([
    scrapeAppleSources(),
    scrapeCommunitySignals(),
    scrapeSDKSignals(),
  ]);

  // 3. Analyze with Claude
  const analysis = await analyzeWithClaude(
    appleSources,
    communitySignals,
    sdkSignals,
    currentCriteria
  );

  log(`Summary: ${analysis.summary}`);

  // 4. Filter to high/medium confidence changes
  const actionable = analysis.changes.filter((c) => c.confidence !== "low");

  if (actionable.length === 0 && !forcePR) {
    log(`No actionable changes. ${analysis.no_changes_reason ?? ""}`);
    writeLog();
    process.exit(0);
  }

  if (dryRun) {
    log("DRY RUN — changes that would be applied:");
    for (const c of actionable) {
      log(`  [${c.type}] ${c.file}:${c.field} (${c.confidence}) — ${c.reason}`);
    }
    writeLog();
    process.exit(0);
  }

  // 5. Apply changes
  const updatedCriteria = applyChanges(actionable, currentCriteria);

  // 6. Write files + bump manifest
  const bumpType = actionable.some((c) => c.type === "add") ? "minor" : "patch";
  const changelogEntry =
    `${new Date().toISOString().slice(0, 10)}: ${analysis.summary} ` +
    actionable.map((c) => `[${c.type}] ${c.field}`).join(", ");

  const { newVersion } = writeUpdatedFiles(
    updatedCriteria,
    currentManifest,
    bumpType,
    changelogEntry
  );

  const zipSignature = signCriteriaZipIfPossible();
  if (zipSignature) {
    const manifestPath = path.join(REPO_ROOT, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest["signature"] = zipSignature;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    log("Criteria ZIP signed; manifest signature updated.");
  } else {
    log("WARN: CRITERIA_SIGNING_KEY not set — PR will be checksum-only.");
  }

  log(`New version: ${newVersion}`);

  // 7. Open PR
  const date = new Date().toISOString().slice(0, 10);
  const branchName = `criteria/auto-${date}`;
  const prTitle = `criteria: auto-update ${date} — ${actionable.length} change${actionable.length !== 1 ? "s" : ""}`;

  const changeTable = actionable
    .map((c) => `| \`${c.file}\` | ${c.type} | \`${c.field}\` | ${c.confidence} | ${c.reason} |`)
    .join("\n");

  const prBody = `## Criteria auto-update ${date}

${analysis.summary}

### Changes

| File | Type | Field | Confidence | Reason |
|---|---|---|---|---|
${changeTable}

### Sources consulted

${analysis.sources_checked.map((s) => `- ${s}`).join("\n")}

### Community / SDK signals

Checked RevenueCat blog, Emerge Tools blog, iOS Dev Weekly, and ${TRACKED_SDK_REPOS.length} tracked SDK repos.

---
> Generated by Criteria Keeper — review carefully before merging.
> Tier 3/4 signals are early warning only; all changes are backed by Tier 1 Apple sources.`;

  const prURL = await createGitHubPR(branchName, prTitle, prBody);
  if (prURL) log(`PR opened: ${prURL}`);

  writeLog();
  log("=== Criteria Keeper done ===");
}

main().catch((e) => {
  log(`FATAL: ${e}`);
  writeLog();
  process.exit(1);
});
