#!/usr/bin/env node
/**
 * build-server-docker-image.mjs — build the standalone HanaAgent Server
 * Docker image end-to-end on a Linux x64 host.
 *
 * Pipeline:
 *   1. Ensure dist-server/linux-x64/ exists. If missing, invoke
 *      `node scripts/build-server.mjs linux x64` to produce it.
 *      That script's final `packDualKindSeed` step is macOS Apple-notary
 *      bookkeeping that fails on Linux; the artifact on disk is already
 *      complete by then, so the failure is non-fatal and we proceed.
 *   2. `docker build` the image from the repo root, tagging it
 *      `hanako:dev-<git-sha>`.
 *   3. Write `.docker-image-tag` (single line, just the tag) so compose
 *      files and helper scripts can read it back.
 *
 * Prerequisites on the build host:
 *   - Linux x64
 *   - Node 24 in PATH (matching package.json:engines.node)
 *   - Docker Engine with BuildKit enabled
 *   - git (for the short-sha tag)
 *
 * Usage:
 *   node scripts/build-server-docker-image.mjs [--no-build] [--tag <name>]
 *
 *     --no-build   Skip step 1; assume dist-server/linux-x64/ is already in
 *                  place (e.g. produced by CI's caching layer).
 *     --tag NAME   Override the image tag. Default: hanako:dev-<git-sha>.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, "..");
const ARTIFACT_DIR = path.join(ROOT, "dist-server", "linux-x64");
const TAG_FILE = path.join(ROOT, ".docker-image-tag");

function log(line) {
  process.stdout.write(`${line}\n`);
}

function runStep(label, command, args, opts) {
  const merged = Object.assign({ cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], shell: false }, opts || {});
  log(`[docker-image] ${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, merged);
  if (result.error) {
    throw new Error(`[docker-image] ${label} failed to start: ${result.error.message}`);
  }
  return result;
}

function shortGitSha() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `dirty-${stamp}`;
}

function parseArgs(argv) {
  const args = { noBuild: false, tag: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-build") args.noBuild = true;
    else if (a === "--tag") args.tag = argv[++i];
    else throw new Error(`[docker-image] unknown arg: ${a}`);
  }
  return args;
}

function artifactMissing() {
  return !fs.existsSync(path.join(ARTIFACT_DIR, "bundle", "index.js"));
}

async function ensureArtifact(skipBuild) {
  if (!artifactMissing()) {
    log(`[docker-image] artifact already present at ${ARTIFACT_DIR}; skipping rebuild`);
    return;
  }
  if (skipBuild) {
    throw new Error(`[docker-image] --no-build passed but ${ARTIFACT_DIR}/bundle/index.js is missing`);
  }
  log(`[docker-image] artifact missing at ${ARTIFACT_DIR}; building it now`);
  const build = runStep(
    "artifact",
    process.execPath,
    [path.join("scripts", "build-server.mjs"), "linux", "x64"],
  );
  // build-server.mjs ends with `packDualKindSeed`, which is Apple-notary
  // bookkeeping and fails on Linux. The artifact on disk is already
  // complete by then; ignore that specific failure and only re-throw if
  // the artifact is still missing.
  if (build.status !== 0 && artifactMissing()) {
    throw new Error(
      `[docker-image] scripts/build-server.mjs linux x64 failed (exit ${build.status}) and produced no artifact`,
    );
  }
}

async function dockerBuild(tag) {
  log(`[docker-image] building image ${tag}`);
  const build = runStep("docker build", "docker", ["build", "-t", tag, "."], {
    env: Object.assign({}, process.env, { DOCKER_BUILDKIT: "1" }),
  });
  if (build.status !== 0) {
    throw new Error(`[docker-image] docker build failed (exit ${build.status})`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tag = args.tag || `hanako:dev-${shortGitSha()}`;

  await ensureArtifact(args.noBuild);
  await dockerBuild(tag);

  fs.writeFileSync(TAG_FILE, `${tag}\n`, "utf8");
  log(`[docker-image] wrote ${TAG_FILE} -> ${tag}`);
  log(`[docker-image] done. Next: docker compose up -d`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}