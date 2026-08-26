# 13 — research: HANA_HOME 数据结构 + 与 desktop 互通

Type: research
Status: resolved
Blocked by: (none)

## Question

1. 现有 desktop 部署下 `HANA_HOME` 目录内容结构（sessions / memory / agents / skills / config / workspaces 等）
2. 这些目录在 Linux 文件系统上路径是否硬编码到 Windows 风格？
3. Docker 部署产出的 volume 能否**直接**被 desktop 客户端挂载消费？反过来，desktop 现成的 HANA_HOME 能否被 `docker run -v` 挂到容器内？两者是否要求路径完全一致？
4. 数据迁移 / 升级路径：desktop 数据 → Docker volume 的迁移步骤是什么？是否需要 `scripts/migrate-hanahome.mjs`？
5. desktop 与 Docker 是否会共享同一份数据（即"一台机器多人用 HanaAgent" 场景）——若是，需要考虑并发写入的 lock 策略

## Findings

**1. HANA_HOME resolution（platform-neutral）**

- Single canonical resolver：`shared/hana-runtime-paths.cjs:13-16` `resolveHanakoHome(input, homeDir=os.homedir())` — 用 `path.resolve(expandHome(raw))`。Default fallback `path.join(homeDir, ".hanako")`（`shared/hana-runtime-paths.cjs:14`）。同一 routine 被 `cli/local-server.ts:5-7`（`resolveCliHanaHome`）、`desktop/bootstrap.cjs:129-131`、`desktop/main.cjs:161-162`、`server/index.ts:253-254`、`shared/hana-runtime-paths.ts:1-10` consume。
- Expansion rules（`shared/hana-runtime-paths.cjs:4-11`）：`~`、`~/...`、`~<sep>...` 通过 `os.homedir()` 重写。其他 pass through to `path.resolve()`。Resolver 无 implicit backslash / Windows-style literal。
- Process-level invariants：每个 resolve `HANA_HOME` 的 entry point 立即 re-export resolved value via `process.env.HANA_HOME` so child-process inherit（`desktop/main.cjs:1689`、`desktop/main.cjs:1743`、`server/index.ts:254`、`scripts/smoke-open-server.mjs:106`、`scripts/verify-standalone-server-artifact.mjs:120,284`、`tests/api-health-session-store-integration.test.ts:67`）。
- Tilde expansion in CLI mirror（`cli/local-server.ts:9-17`）same algorithm。Note `cli/local-server.ts:13` 用 `\` + `path.sep`（platform-dependent）—— works on Windows 因为 `path.sep` 是 `\`，但 portable；both `~/foo` 和 `~\foo` resolve identically。
- `data-epoch-checkpoint-provider.ts:96-98` defines `toPosixPath(value)` 仅 for **display**（POSIX slashes in check-pointed metadata `relPath`）；never rejoins a real filesystem path，所以 doesn't leak Windows-only separators。

**2. HANA_HOME top-level directory layout**

The set of immediate children enumerated by first-run seeding（`core/first-run.ts:56–63, 109, 124`）+ sandbox-policy source of truth（`lib/sandbox/policy.ts:14–52`）。Aggregated from those plus `path.join(hanakoHome, …)` sites：

- `agents/` —— per-agent subdir（`core/engine.ts:358`、`core/first-run.ts:57, 61`）；each contains `config.yaml`、`memory/`、`sessions/`、`desk/`、`avatars/`、plus `pinned.md` / `AGENTS.md` / `ishiki.md` / `identity.md` / `yuan.md`（`lib/sandbox/policy.ts:20–43`、`core/agent.ts:190–191, 361`、`core/first-run.ts:175–179`）。
- `user/` —— read-only（sandbox-wise）preferences + window state、last-seen-version、browser-sessions.json、gpu-startup.json 等（`core/first-run.ts:56, 124`、`lib/sandbox/policy.ts:32`、`desktop/main.cjs:2339–2422`）。
- `channels/` —— channel registry `*.md` files（`core/engine.ts:360`、`core/migrations.ts:2088, 4638–4727`、`lib/sandbox/policy.ts:52`）。
- `skills/` —— seeded from `skills2set/` on first run（`core/first-run.ts:109–113`、`core/engine.ts:2499`、`core/migrations.ts:3100`）。
- `session-files/` —— content-addressed blob cache for uploaded media per session（`core/engine.ts:372`、`lib/session-files/session-file-registry.ts:17–22`、`lib/sandbox/policy.ts:32, 142`）。
- `file-history/` —— versioned file snapshots（`core/engine.ts:380`）。
- `logs/` —— `crash.log`、`security-audit.jsonl`、`browser-ws.log`、`switch-error.log`（`lib/sandbox/policy.ts:52`、`core/security-audit-log.ts:8,12`、`desktop/main.cjs:2281`、`server/index.ts:433,1167`、`server/routes/sessions.ts:2363`）。
- `uploads/` —— HTTP upload staging（`server/routes/upload.ts:202`、`lib/sandbox/policy.ts:52`）。
- `studios/` + `studios/<id>/desk/cron-runs/` —— studio state + cron jobs（`core/migrations.ts:1623,2078,2771,2801`、`core/studio-cron-service.ts:209,225`）。
- `runtime/pi-sdk/` —— managed Node-tooling runtime（`shared/hana-runtime-paths.cjs:24–39`）。
- `artifacts/` —— OTA pointers、extracted version trees、sentinel files、`quarantine.json`、`lock`（flock file）。See `shared/artifact-core/pointer-store.cjs:24–50` and `desktop/src/shared/artifact-repair.cjs:23,45–56`。
- `plugin-data/` —— `mcp/config.json`、`image-gen/config.json|tasks.json` 等（`core/engine.ts:433`、`core/engine.ts:2742` with `PLUGIN_DATA_DIRNAME = "plugin-data"`、`core/credential-file-healer.ts:148`、`core/migrations.ts:2558–2723`）。
- `plugins/`、`plugins-dev/`、`plugin-dev-runs/`、`plugin-dev-sources/`、`plugin-install-sources/<pluginId>/<version>/`、`plugin-installs.json`、`plugin-marketplace/marketplace.json`、`plugin-backups/<pluginId>/`（`core/engine.ts:2738–2742`、`lib/plugin-install-records.ts:35`、`lib/plugin-install-backups.ts:41`、`lib/plugin-marketplace.ts:104`、`server/routes/plugins.ts:666`）。
- `security/` —— `grants.json`、`execution-leases.json`、ticket-key material 等（`core/security-dir.ts:16,20`、`core/execution-lease-registry.ts:80`、`core/grant-registry.ts:104`、`core/credential-file-healer.ts:60`）。
- `migration-backups/` —— directory for in-place backups written by individual migrations（`core/migration-backups.ts:15–19`、`core/credential-backup-retention.ts:30,64`、`core/migrations.ts:60`）。
- `data-epoch-checkpoints/<transitionId>/{metadata.json,stores/<storeId>/…}` —— captured snapshots for the DATA_EPOCH coordinator（`core/data-epoch-checkpoint-provider.ts:36` `DATA_EPOCH_CHECKPOINTS_DIRNAME`，layout documented at `core/data-epoch-checkpoint-provider.ts:19–33`）。
- `.ephemeral/` —— scratch dir for plugin tasks、loop state、deferred tasks、character-card imports/exports/uploads、runtime cache、skill-bundle exports、skill-name translation cache、browser sessions（`core/engine.ts:675`、`server/index.ts:483,490`、`core/migrations.ts:699,4462`、`core/input-drafts-store.ts:27`、`lib/character-cards/service.ts:556,924`、`lib/skill-bundles/package-service.ts:178`、`lib/skills/skill-name-translation-cache.ts:16`、`lib/sandbox/policy.ts:52`、`tests/win32-sandbox-policy.test.ts:175`）。
- Root-level state files：`server-info.json`（`server/index.ts:275,1231`、`desktop/main.cjs:1181,6297`、`cli/local-server.ts:20`）、`server-network.json`（`core/server-port-selection.ts:130`、`core/server-network-config.ts:15`）、`auth.json` / `models.json` / `added-models.yaml` / `providers.yaml`（BLOCKED_FILES，`lib/sandbox/policy.ts:14`，`core/engine.ts:1458`，`core/model-manager.ts:158,190–191`）、`usage-ledger.json`（`core/engine.ts:728`）、`subagent-runs.json` / `subagent-threads.json` / `reusable-subagents.json` / `workflow-activity.json`（`server/index.ts:705–722`、`core/migrations.ts:4419,4512–4543,4582`）、`session-manifest.db`（SQLite）、`data-epoch.json` / `data-epoch-transition.json`（`shared/data-epoch.cjs` via `core/server-identity.ts` + `core/data-epoch-checkpoint-provider.ts:140`）、`crash.log`、`browser-data/`、`playwright-browsers/`（BLOCKED_DIRS，`lib/sandbox/policy.ts:17`）、`diagnostics/desktop-launch/`（`desktop/bootstrap.cjs:132`、`desktop/src/shared/desktop-launch-diagnostics.cjs:18`）、`attachments/`（`hub/index.ts:215,239`）、`tmp/`（route scratch，`server/routes/desk.ts:712`，`server/utils/uploaded-skill-package.ts:37`）、`trash/`（`lib/resource-io/sandbox-resource-io.ts:64`）。
- Terminal session root：`TERMINAL_ROOT` joined onto `hanakoHome`（`lib/terminal/terminal-session-manager.ts:78`）。Skill bundle store file：`lib/skill-bundles/store.ts:85`。

**3. HANA_HOME 内 file types**

- **SQLite（better-sqlite3）** with WAL mode：
  - `session-manifest.db` at HANA_HOME root + `session-manifest.db-wal`、`session-manifest.db-shm`（`core/engine.ts:1458`、`core/session-manifest/db-files.ts:5–7`、`core/session-manifest/store.ts:250,255–259`）。Pragmas：`journal_mode = WAL`、`synchronous = NORMAL`、`cache_size = -16000`、`temp_store = MEMORY`、`mmap_size = 30000000`。
  - Per-agent `memory/facts.db`（and legacy `memory/memories.db`）（`core/agent.ts:190–191, 361–379`）。
  - `file-history` store declared as sqlite in store registry（`build/persistence-store-inventory.json` `id: "file-history-sqlite"`）。
- **JSON**：hundreds of root-level + per-agent + per-studio files（e.g. `auth.json`、`models.json`、`preferences.json`、`server-info.json`、`usage-ledger.json`、`subagent-*.json`、`data-epoch.json`、`data-epoch-transition.json`、`metadata.json` inside every data-epoch-checkpoint）。Atomic writes via temp-file + rename 主导 pattern（see `shared/artifact-core/pointer-store.cjs:59–71`）。
- **JSONL**：`agents/<id>/sessions/*.jsonl`（session turn log）、archived variants `agents/<id>/sessions/archived/*.jsonl`、`security-audit.jsonl`、`studios/<id>/desk/cron-runs/<jobId>.jsonl`、`agents/<id>/desk/cron-runs/<jobId>.jsonl`。（`core/session-coordinator.ts:3243,4641,6106,6839,7130`、`core/security-audit-log.ts:8`、`core/studio-cron-service.ts:276–277`、`lib/desk/cron-store.ts:791,813`、`core/message-utils.ts:371,382`）。
- **YAML**：`agents/<id>/config.yaml`（`core/agent.ts:190`）、`added-models.yaml` / `providers.yaml`（`lib/sandbox/policy.ts:14`、`core/migrations.ts:1380,1447,3427`、`core/migrate-providers.ts:60–64`）。
- **Markdown front-matter**：channel files（`channels/*.md`）、`pinned.md`、`AGENTS.md`、`ishiki.md`、`identity.md`、`yuan.md`（`lib/channels/channel-store.ts`、`lib/sandbox/policy.ts:20–43,49`）。
- **Binary blob tree**：`artifacts/{server,renderer}/<version>/...`、`playwright-browsers/`、`browser-data/`（declared mixed-directory / binary-cache in registry；`core/data-epoch-checkpoint-provider.ts:32–33` documents mixed capture）。
- **PID / lock files**：`artifacts/lock`（per-directory flock via `fsp.open(filePath, "wx")`，see `shared/artifact-core/pointer-store.cjs:13–17, 193–219`）。
- Complete store inventory enumerated in `shared/persistence/store-registry.ts` + serialized to `build/persistence-store-inventory.json`（generated by `scripts/scan-persistent-stores.mjs`）。

**4. Windows path handling — hard-coded vs platform-neutral**

- HANA_HOME join entirely platform-neutral。Each directory above 用 `path.join`（e.g. `core/first-run.ts:56–57, 109, 124`、`core/engine.ts:358–380`、`core/migration-backups.ts:19`、`lib/sandbox/policy.ts:120–136`、`desktop/main.cjs:171–198, 2281, 2339–2422`、`server/index.ts:275, 483–722`、`shared/hana-runtime-paths.cjs:26–43`）。Only exception = desktop bootstrap where `path.join(os.tmpdir(), "hanako-desktop-launch")` 用 as fallback diagnostics dir before `HANA_HOME` resolution（`desktop/bootstrap.cjs:15`）；not part of HANA_HOME proper。
- `path.win32.*` usages confined to **Win32 sandbox/exec plumbing**，never to HANA_HOME layout：
  - `lib/sandbox/win32-exec.ts:78–110`、`lib/sandbox/win32-sandbox-helper.ts:30–46`、`lib/sandbox/win32-policy.ts:65`、`lib/sandbox/win32-legacy-migration.ts:25–59`、`lib/sandbox/win32-path.ts:6–75`、`lib/shell/shell-utils.ts:15–42, 171`、`lib/execution-cwd.ts:47`、`desktop/src/shared/server-process-env.cjs:113`、`desktop/src/shared/win32-install-acl-heal.cjs:53–67`、`lib/tools/web-reader.ts:38`（markdown escape only）、`core/mcp/clients/stdio-client.ts:311,323`（Windows stdio client）、`core/current-turn-native-media.ts:164–165`（Win path normalization）、`computer-use/providers/macos-cua-provider.ts:39–128`（macOS code only）。None touch HANA_HOME tree。
  - In `server/`：`server/standalone-runtime-smoke.ts:19–20, 56` 仅 normalizes already-set Windows-path env vars（`HANA_ROOT`、`HANA_SERVER_ENTRY`、`HANA_WIN32_SANDBOX_HELPER`）—— purely Windows-only exec-smoke probe，gated by `process.platform !== "win32"` at line 49。
  - `server/routes/html-preview.ts:330` + `server/routes/upload.ts:148` 用 `path.win32.isAbsolute` 仅 to detect absolute Windows paths in user-supplied URL/path input，never to construct HANA_HOME。
- `path.posix.*` used in `computer-use/providers/macos-cua-provider.ts`（macOS-only）+ `scripts/compute-cli-closure.mjs:796`（`.node` extension check）。Neither touches HANA_HOME。
- Single-instance lock normalization for Electron（`desktop/src/shared/single-instance-lock.cjs:11–14`）lower-cases paths on win32 only；on-disk format unaffected。
- **Conclusion**：HANA_HOME layout **fully portable**。Same directory 可 mount on Linux without any path translation。

**5. Concurrency / single-writer model**

- **Hard "one kernel per HANA_HOME" invariant** —— code refuses to start a second kernel against the same data directory：
  - `server/index.ts:263–292` 跑 "same-HANA_HOME mutex" gate（`同宅互斥闸`）before any store opens。Reads `server-info.json`，then calls `probeServerInfo({ info: existingServerInfo })`（`shared/server-info-probe.cjs:82–127`）。If probe returns `alive-same-home` or `alive-unauthorized`，new kernel exits 1 with bilingual message from `describeForeignServerBlock`（`shared/server-info-probe.cjs:148–166`）。Stale `not-hana` / `dead` records self-cleaned。
  - `desktop/main.cjs:1246–1305, 1689–1743, 6295–6300` mirrors same gate before spawning its own server，including `FOREIGN_SERVER_RUNNING` branch（covered by `tests/desktop-foreign-server-guard.test.ts:22–67`）。
  - `server/index.ts:1246–1249, 1335` + `cli/local-server.ts:90–97`（`isProcessAlive`）用 PID + port probing。
  - `server/index.ts:264–273` documents the **accepted race**：two cold-started kernels writing `server-info.json` within same second — fallback is bare-port `EADDRINUSE` from `listen()`。
- **In-process** serialization：`shared/artifact-core/pointer-store.cjs:223–244` keeps per-`homeDir` `Promise` queue for pointer mutations；`lib/channels/channel-store.ts:23–38` keeps per-`filePath` in-process mutex map（`withFileLock`）。
- **Cross-process artifact lock**：`shared/artifact-core/pointer-store.cjs:182–219` `acquireLock(homeDir)` creates `artifacts/lock` via `fsp.open(filePath, "wx")`（exclusive-create — chosen specifically over `flock` for Windows portability，see module's doc comment at lines 13–17）。Stale locks older than `5 * 60 * 1000` ms stolen。Note this lock covers `artifacts/` only，not rest of HANA_HOME。
- **SQLite concurrency**：`session-manifest.db` opened with `journal_mode = WAL`（`core/session-manifest/store.ts:255`）。`data-epoch-checkpoint-provider.ts:288–296, 337` calls `better-sqlite3`'s online-backup API explicitly so backup folds in un-checkpointed WAL — and refuses to capture `-wal`/`-shm` as independent files。
- **Atomic writes**：temp-file-then-rename everywhere（`shared/artifact-core/pointer-store.cjs:53–71`、`shared/secret-fs.ts` etc.）。No torn writes。
- **Multi-writer today** is therefore **not** a supported scenario：same-host `desktop` and `hana serve`（or two `hana serve`）cannot co-open HANA_HOME；only **one kernel process** can own the home。Multiple **readers** via HTTP API fine。
- **"Multi-user / multi-host shared HANA_HOME"**（e.g. NFS volume from desktop + Docker）is **not** a supported configuration。Same-home mutex probes `127.0.0.1:<port>`（`shared/server-info-probe.cjs:97`）+ `isProcessAlive(pid)`（`cli/local-server.ts:90–97`）—— both assume single kernel on single host。Docker container on Linux + desktop process on Windows = two kernels on two hosts opening same directory，current probe cannot detect that。SQLite WAL relies on POSIX advisory locks（NFS / SMB mishandle）+ `fs.fsync` semantics that differ across filesystems。

**6. Existing migration / backup / restore machinery**

There is **no `scripts/migrate-hanahome.mjs`**。Existing tooling split between operator-only CLI + in-process migrations：

- **In-process migrations**（`core/migrations.ts`, hundreds of lines）。Self-copies parked under `migration-backups/` via `migrationBackupsRoot(hanakoHome)`（`core/migration-backups.ts:18–20`、`core/credential-backup-retention.ts:30,64`、`core/migrations.ts:60`）。Credential-file healer additionally tightens modes（`core/credential-file-healer.ts:60,127–148`）。
- **DATA_EPOCH coordinator**（`core/data-epoch-checkpoint-provider.ts:36`、`core/data-epoch-coordinator.ts`、`core/data-epoch-restore.ts`）。Snapshots under `{homeDir}/data-epoch-checkpoints/{transitionId}/{metadata.json,stores/<id>/…}`。Retention：`DATA_EPOCH_CHECKPOINT_RETAINED_COUNT = 2`、`DATA_EPOCH_CHECKPOINT_MAX_TOTAL_BYTES = 2 GiB`（`core/data-epoch-checkpoint-provider.ts:37–38`）。Current `DATA_EPOCH = 1`（pinned），so production never actually transitions today（`server/index.ts:294–311` comment block）。Checkpoint provider wired but does not currently trigger on real upgrade。
- **Operator CLI**：`hana data diagnose|checkpoints|restore <transitionId>`（`cli/data.ts:1–298`）。Restore gated by typing literal phrase `restore <transitionId>`（`cli/data.ts:264–279`）；same gate re-checked inside `restoreDataEpochCheckpoint`。Read-only `diagnose` never writes（`cli/data.ts:114–172`）。
- **Audit tools**：
  - `scripts/session-manifest-audit.mjs` —— `HANA_HOME=/path/to/data node scripts/session-manifest-audit.mjs [--json] [--fail-on-anomaly]`（line 32）。Reads，never writes。
  - `scripts/session-manifest-rollback.mjs`、`scripts/session-path-identity-audit.mjs` —— companion audit / rollback scripts。
  - `scripts/scan-persistent-stores.mjs` —— regenerates `build/persistence-store-inventory.json` + `build/persistence-schema-fingerprint.json`。
- **Packaging helper**：`scripts/build-standalone-server-artifact.mjs:103–122, 156, 267–275` —— Windows-only stand-alone artifact build；not relevant for Linux Docker but shows `path.win32.join(..., ".ephemeral", "win32-sandbox-env")` style used for native sandbox env，all of which is Windows-only。
- **No generic tar/zip of HANA_HOME** exists；recipe from ticket #06（`docker run --rm -v hana-data:/data -v $PWD:/backup busybox tar czf …`）is operator's job。

**7. Additional structural notes that affect a Docker volume**

- `HANA_HOME/.ephemeral/win32-sandbox-runtime/` referenced in `lib/sandbox/win32-exec.ts:1023` for Windows cached POSIX runtimes；irrelevant on Linux，can be left empty / absent。
- `runtime/pi-sdk/` filled by desktop's Windows installer；on Linux empty until first seed（this is why ticket #12 — Linux runtime — exists）。Same true for `artifacts/server/`、`artifacts/renderer/` populated by bootstrap path described in `desktop/main.cjs:942, 1272, 1743` + `desktop/src/shared/artifact-boot.cjs:48`。
- `desktop-diagnostics/`、`diagnostics/desktop-launch/`（`desktop/bootstrap.cjs:132`）Electron-only；can be excluded from Linux-only volume by policy。
- `browser-data/` + `playwright-browsers/` sandbox-blocked（`lib/sandbox/policy.ts:17`）；on Docker typically absent，that's fine。
- `.pi/agent/bin/` legacy fallback path (`shared/hana-runtime-paths.cjs:41–44`)；safely empty on Linux。

## Answer

**1. HANA_HOME directory structure.** Fully enumerated in §2. Single tree with ~25 immediate subdirectories（`agents/`、`user/`、`channels/`、`skills/`、`session-files/`、`file-history/`、`logs/`、`uploads/`、`studios/`、`runtime/pi-sdk/`、`artifacts/`、`plugin-data/`、`plugins*`、`security/`、`migration-backups/`、`data-epoch-checkpoints/`、`.ephemeral/`、plus `attachments/`、`tmp/`、`trash/`、`diagnostics/`），and root-level state files（`server-info.json`、`server-network.json`、`auth.json`、`models.json`、`added-models.yaml`、`providers.yaml`、`usage-ledger.json`、`subagent-*.json`、`session-manifest.db`、`data-epoch.json`、`data-epoch-transition.json`、`crash.log`、`input-drafts.v1.json`、`browser-data/`、`playwright-browsers/`）。Per-agent subdirs add `memory/`、`sessions/`、`desk/`、`avatars/`、`config.yaml`、plus persona files。

**2. Windows hard-coding.** None for HANA_HOME layout itself。Resolver（`shared/hana-runtime-paths.cjs`）用 `path.resolve` / `path.join` exclusively，every consumer（`core/engine.ts`、`core/first-run.ts`、`core/migration-backups.ts`、`lib/sandbox/policy.ts`、`server/index.ts`、`desktop/main.cjs`、`cli/local-server.ts`）joins subpaths with `path.join`。All `path.win32.*` usages confined to Win32 sandbox/exec code paths that don't touch HANA_HOME tree；`path.posix.*` only appears in macOS / `.node` extension checks。Single piece of platform-specific text in layout = `path.sep` in `cli/local-server.ts:13`（CLI `~` expansion），portable by construction。

**3. Volume compatibility.** Docker volume written by Linux server + desktop client's HANA_HOME byte-compatible on wire；nothing Windows-encoded。One caveat：desktop install on Windows carries Electron-only state under `artifacts/server`、`artifacts/renderer`、`runtime/pi-sdk`、`artifacts/.installing`、`artifacts/staging`、`diagnostics/desktop-launch/` —— populated by desktop update pipeline，should not be carried into Linux container that doesn't run desktop bootstrap。Conversely Linux container's `runtime/pi-sdk/` empty until container's first launch reseeds。

**4. Migration / upgrade path.** No `scripts/migrate-hanahome.mjs` exists。Available primitives：(a) operator copies tree with `tar`/`rsync`（per ticket #06 recipe），(b) `core/migrations.ts` runs on every kernel boot — idempotent + self-parking to `migration-backups/`，(c) `hana data diagnose|checkpoints|restore`（`cli/data.ts:114–298`）gives typed confirmation gate for DATA_EPOCH-rollback。New script only needed if we want single one-shot "import desktop tree into Docker volume, strip Windows-only paths, rewrite artefacts" — but mostly `tar` + filter，not code logic，because format already portable。`DATA_EPOCH = 1`（pinned；`shared/contract-versions.cjs:64`）means in practice no checkpointed restore path exists today。

**5. Concurrent writers.** Not supported + not safe。Same-HANA_HOME mutex（`server/index.ts:263–292`, mirrored at `desktop/main.cjs:1246–1305`）explicitly blocks second kernel on same machine；does not generalize across hosts。Sharing one volume between Electron desktop process and Linux Docker container, or between two containers, would mean two kernels opening same SQLite WAL files — possible on POSIX-correct shared filesystems (e.g. host bind mount with proper POSIX locks) but unsafe on NFS / SMB, and unsupported by existing probe。Multi-reader via HTTP is supported concurrent model。

## Gaps / follow-ups

- **Cross-host same-volume support**：if Docker map wants to support "one machine, many users, HanaAgent"（ticket #13 sub-question 5），same-HANA_HOME probe in `shared/server-info-probe.cjs:82–127` needs host-aware variant —— probe that hits `127.0.0.1:<port>` on remote host cannot work。Open question for future ticket。
- **SQLite on shared FS**：`journal_mode = WAL`（`core/session-manifest/store.ts:255`）assumes POSIX advisory locks + atomic `rename`。Needs explicit matrix（host bind mount + ext4 / overlayfs / NFS / SMB）before declaring shared volumes supported。
- **HANA_HOME portable migration script**：today `scripts/migrate-hanahome.mjs` does not exist。If we want one-shot desktop→Docker migration that strips Electron-only artefacts, small script（probably in `scripts/`）wrapping `tar` + exclude list would close that gap。Excludes at minimum：`artifacts/.installing`、`artifacts/staging`、`diagnostics/`、`runtime/pi-sdk/`（Linux will reseed）、`.pi/`（legacy）、Windows ACL state in `user/win32-install-acl-heal.json`。
- **`.ephemeral/win32-sandbox-runtime/`**（`lib/sandbox/win32-exec.ts:1023`）+ **`runtime/pi-sdk/`** on Linux server：confirmed irrelevant（Windows-only paths）；worth documenting in README so operators don't copy them across。
- **DATA_EPOCH wiring**：`createDataEpochCheckpointProvider()` injected into `coordinateDataEpochStartup` at `server/index.ts:311` but DATA_EPOCH pinned at 1，so no checkpoint ever produced today。First real bump（currently nothing in flight）will need follow-up ticket to validate `hana data restore` works on Linux volume。
- **Desktop-only subpaths that survive across hosts**：`desktop-window-version-state`、`desktop-update-channel`、`desktop-gpu-startup-state`、`desktop-win32-install-acl-heal-state`、`device-access-registries`、`user/browser-sessions.json`、`user/window-state.json` —— all declared in `build/persistence-store-inventory.json`。Future ticket should classify each as `host-portable` / `host-locked` / `optional-on-server` so cross-host volume policy unambiguous。
- **Tests using `HANA_HOME` as fixture** assume isolated temp dir（`tests/cli-server-runner.test.ts:68–92`、`tests/config-loader.test.ts:33–39`、`tests/server-home-guards.test.ts:20`）；Docker image needs same isolation pattern for CI（no shared `~/.hanako` between concurrent test runs）。
- **Audit / verify scripts**（`scripts/session-manifest-audit.mjs`、`scripts/session-path-identity-audit.mjs`、`scripts/session-manifest-rollback.mjs`）operator-only + read-only；should be exposed in Docker image（or documented as `docker exec hanaagent hana data diagnose`）so operators have parity with desktop install。