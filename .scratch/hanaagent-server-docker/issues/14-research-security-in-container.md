# 14 — research: 容器内安全机制有效性

Type: research
Status: resolved
Blocked by: (none)

## Question

`hanaagent server` 现有安全姿态在容器化后哪些仍生效、哪些失效：

1. **PathGuard**（四级访问控制，应用层）—— 在容器内是否需要调整配置（路径前缀、工作目录）？当 `HANA_HOME=/hana/home` 时，PathGuard 默认白名单是否要修改？
2. **沙盒**：desktop 上的 Bubblewrap（Linux）/ Seatbelt（macOS）/ restricted token（Windows）—— Docker 容器场景下 server 进程是否仍尝试调起这些？需要跳过吗？
3. **non-root user 1000**：server bundle 启动时是否会要求某些文件由特定 uid 拥有（pidfile / socket / log）？与官方 `node:24-bookworm-slim` 默认 uid 是否冲突？
4. **capabilities**：container 默认 capability 是否足够？是否需要 `--cap-drop=ALL` + 显式 `--cap-add`？agent runtime 是否调 `ptrace` / `setuid` 等？
5. **网络**：server 是否对外主动发起（LLM API 调用），容器内 outbound 网络限制的影响
6. **secrets**：API key 现在存在哪里？容器场景下推荐挂载 `/run/secrets/<name>` 还是写入 env？

## Findings

**PathGuard — 配置 & 默认值**

- PathGuard 构造函数 + check logic：`D:\Projects\openhanako\lib\sandbox\path-guard.ts`（`class PathGuard` lines 39–225；access-level ladder lines 114–187）。纯 `path.resolve` + `fs.realpathSync`，无平台特定调用，Linux/Docker unchanged。
- 默认 allow/deny 列表（single source of truth）：`D:\Projects\openhanako\lib\sandbox\policy.ts:14–52`：
  - `BLOCKED_FILES = ["auth.json","models.json","added-models.yaml","crash.log"]`（line 14）—— 均相对 `hanakoHome` root。
  - `BLOCKED_DIRS = ["browser-data","playwright-browsers"]`（line 17）。
  - `READ_ONLY_AGENT_FILES = ["AGENTS.md","ishiki.md","config.yaml","identity.md","yuan.md"]`（lines 20–29）。
  - `READ_ONLY_AGENT_DIRS = []`（line 46）。
  - `READ_ONLY_HOME_DIRS = ["user","skills","session-files"]`（line 32）。
  - `READ_WRITE_AGENT_DIRS = ["memory","sessions","desk","heartbeat","book","activity","avatars"]`（lines 35–43）。
  - `READ_WRITE_AGENT_FILES = ["pinned.md","channels.md"]`（line 49）。
  - `READ_WRITE_HOME_DIRS = ["channels","logs","uploads",".ephemeral"]`（line 52）。
- `deriveSandboxPolicy({agentDir, cwd, workspace, workspaceFolders, hanakoHome, runtimeWritablePaths, mode})`（`policy.ts:90–145`）是 PathGuard 消费的形式。路径 `path.join(...)` 入参的 `hanakoHome` / `agentDir`，改 HANA_HOME 自动 rebase whitelist——无 Windows 硬编码常量。
- 入口：`createSandboxedTools()`（`D:\Projects\openhanako\lib\sandbox\index.ts:76–363`）。调 `deriveSandboxPolicy` with `mode: "standard"`（line 116），每次调都构造新 PathGuard（lines 117–120）。`mode: "full-access"` 短路 allow-all（constructor lines 51–53）。

**Server startup sandbox strategy 选择**

- `startServer()` 在 `D:\Projects\openhanako\server\index.ts:121–1369`。`startServer` 与 `D:\Projects\openhanako\server\main-open.ts` / `D:\Projects\openhanako\server\main-full.ts` **都不直接** invoke sandbox。Platform check 在 `createSandboxedTools` 内 lazy、per-session。
- Linux path gated on `process.platform === "linux"`，`node:24-bookworm-slim` 容器 always true。`lib/sandbox/platform.ts:7–12` 返回 `"bwrap"`，`checkAvailability` 跑 `execFileSync("which", ["bwrap"], { stdio: "ignore" })`（line 21）。
- `createSandboxedTools`（`lib/sandbox/index.ts:131–146`）将 missing `bwrap` 视为 **fail-closed**：`isOneShotSandboxEnforced` 在 platform === `"bwrap"` 时返回 `true`，**不**看 `checkAvailability`。Lines 336–345 装一个 "unavailable" bash tool，print `sandbox.osRequired` 而非跑命令。容器 image 不 bundle `bwrap` 时，**每个** agent `bash` tool call 会硬 fail 该 i18n message——server **不** silent fallback to direct execution。
- Linux sandbox 要 `--unshare-pid` / `--unshare-net` / `--die-with-parent`（`lib/sandbox/bwrap.ts:131–137`）。需 user namespaces + working `clone(2)`。Most unprivileged Docker 默认 config（`--security-opt seccomp=unconfined` 或允许 `clone(CLONE_NEWUSER)` 的 custom seccomp profile）能跑；Docker 默认 seccomp profile 已 allow。
- Windows-only legacy hook：`if (process.platform === "win32") engine.startWin32LegacySandboxMaintenance();`（`server/index.ts:474`）。Linux 无等价调用。

**Sandbox helper 引用**

- `bwrap`：仅 `createBwrapExec`（`lib/sandbox/bwrap.ts:22–44`）+ `buildBwrapArgs`（`bwrap.ts:116–200`）。Runtime binary 通过 `which bwrap`（`platform.ts:21`）发现。无 Linux sandbox 的 fallback。
- `sandbox-exec`（macOS）：`createSeatbeltExec`（`lib/sandbox/seatbelt.ts`），通过 `which sandbox-exec`（`platform.ts:16–18`）。Linux 不 invoke。
- `HANA_WIN32_SANDBOX_HELPER`：env 由 `desktop/main.cjs:1802` 设（`serverEnv.HANA_WIN32_SANDBOX_HELPER = guardianBin`）。helper 在 `lib/sandbox/win32-sandbox-helper.ts` 解析，`lib/sandbox/win32-exec.ts` 用。**Desktop-only contract**——Linux server 从不读。Linux server 无需设此 var。
- `startWin32LegacySandboxMaintenance`（`core/engine.ts:1961`）是 Windows-only 方法；`server/index.ts:474` 是唯一 call site，已 `process.platform === "win32"` guard。

**Secrets 在 rest / startup 时存储**

- 所有 credentials 是 plain（或 YAML/JSON-encoded）文本存于 `HANA_HOME`。Repo 无 `keytar` / `safeStorage` / `electron-store` 用法（grep 跨 `core/` / `lib/` / `server/` / `desktop/` 验证）。
- File locations（`D:\Projects\openhanako\core\credential-file-healer.ts:33–60` + `core\security-dir.ts:16`）：
  - `TOP_LEVEL_SECRET_FILES = ["provider-catalog.json","models.json","added-models.yaml","auth.json","device-credentials.json","devices.json","pairing-sessions.json","local-user-auth.json","users.json","web-sessions.json"]`（lines 33–44）。
  - `SECRET_TREES = [MIGRATION_BACKUPS_DIR, LOCAL_PROVIDER_PLUGINS_DIR, "security"]`（line 60）。
  - `auth.json`（`D:\Projects\openhanako\core\model-manager.ts:158,160`）存 OAuth refresh tokens（per `core/oauth-force-refresh.ts:32`）。
  - API keys 在 `added-models.yaml`（`core/migrations.ts:115` + `core/provider-registry.ts:1491–1533` 把它从 `auth.json` 迁出）。Comment in `model-manager.ts:370–371`：Hana 的 API-key provider 凭证源是 Provider Catalog → `models.json`，AuthStorage 只保留 OAuth 条目。
- 所有 writes 走 `writeSecretFileSync`（`D:\Projects\openhanako\shared\secret-fs.ts:108–153`），以 mode `0o600` 打开、写 `<file>.tmp` 后 `rename`（lines 130–148）。Direct callers：sample 见 `core/first-run.ts:200`、`core/local-provider-plugin-store.ts:308,314`、`core/local-user-account.ts:257`、`core/model-sync.ts:493`、`core/plugin-config.ts:70`、`core/migrate-providers.ts:43,47`、`core/provider-media-config.ts:126`、`core/device-registry.ts:376`。
- 每次 server start，`healCredentialFileModes`（`core/credential-file-healer.ts:92–164`）遍历 data dir + `chmod 0o600` credential files + `chmod 0o700` credential dirs via `ensureSecretFileModeSync`/`ensureSecretDirModeSync`（`shared/secret-fs.ts:160–182`）。Linux/POSIX work；非 POSIX FS（如 SMB / 9p）chmod succeed 但 bit 不 applied——`currentMode()` re-check at `secret-fs.ts:84,163,180` 让 healer self-correct。
- In-memory：`_redactOptions` + `redactLogText`（`D:\Projects\openhanako\lib\log-redactor.ts`）secret 进 debug log 前 scrub。Logs 落到 `HANA_HOME/logs/`（`server/index.ts:433`）。
- Server 的 loopback auth token 持久化到 `HANA_HOME/server-info.json`（mode `0o600`，`server/index.ts:1234,1252–1254`）。Token 是 128-bit loopback credential。Owner-only read 强制。

**Server 写时假设的所有权**

- 无 standalone PID file。PID 仅嵌入 `HANA_HOME/server-info.json`（`server/index.ts:1235`）。"Mutex" gate 读 `server-info.json`，通过 `probeServerInfo` / `shared/server-info-probe.cjs` 探测嵌入 PID，"Postgres postmaster.pid 取舍一致" at `server/index.ts:264–272`。
- 无 Unix socket。All transport = HTTP/WS on loopback port（`server/index.ts:402–405, 1127–1156`）。`req.socket?.remoteAddress`（`server/index.ts:600,1133`）是 TCP socket。
- Temp dirs：`engine.hanakoHome/tmp/markdown-cover-uploads`（`server/routes/desk.ts:712`）、`engine.hanakoHome/tmp/skill-install-uploads`（`server/utils/uploaded-skill-package.ts:37`）、`os.tmpdir()/plugin-install-*`（`server/routes/plugins.ts:403`，**OS tmpdir 非 HANA_HOME**）、`shared/persistence/store-registry.ts:1423,1429` various plugin installs。
- Debug logs：`HANA_HOME/logs/`（`server/index.ts:433`, `lib/debug-log.ts:210`）。Browser-WS log 到 `HANA_HOME/browser-ws.log`（`server/index.ts:1167`），仅 `HANA_DEBUG=1` 时。
- Server path 无 `fs.chown`、无 `process.umask`。Permission strategy 纯 "write with mode `0o600`/`0o700` + chmod again"，假设 running uid 已 own 文件。
- Atomic-write：每 credential write 走 `secret-fs.ts`（mode-on-create + chmod + rename）。Lockless gate 依赖 owner-only mode，非 file locking（无 `fs.flock` / `proper-lockfile`，grep 仅 advisory per-process temp dirs with `process.pid` suffix）。
- Default workspace seeded at first run：`~/.hanako/Desktop/OH-WorkSpace`（mac/Windows）或 `~/Desktop/OH-WorkSpace`（Linux）—— `D:\Projects\openhanako\shared\default-workspace.ts:14–22` + `default-workspace-constants.ts:1`。`home_folder` in `config.yaml` from `ensureDefaultWorkspace()` at `core/first-run.ts:192`。

**Server outbound network**

- Server 仅 outbound 流量给 LLM provider + bridge platforms（Telegram/QQ/DingTalk/Feishu）。Endpoints 全 HTTPS：
  - `https://api.openai.com/v1`（`D:\Projects\openhanako\lib\providers\openai.ts:60`）
  - `https://api.anthropic.com`（`lib/providers/anthropic.ts:10`）
  - `https://api.groq.com/openai/v1`（`lib/providers/groq.ts:13`）
  - + `dashscope` / `gemini` / `deepseek` / `minimax` / `baichuan` / `hunyuan` / `kimi` / `mistral` / `volcengine` etc. 全 in `D:\Projects\openhanako\lib\providers\*.ts`。
- Proxy：`D:\Projects\openhanako\lib\net\outbound-proxy.ts` + `shared\network-proxy.ts`。`createOutboundProxyRuntime`（line 115）为每个 URL 构 undici `ProxyAgent`/`Socks5ProxyAgent`。MCP clients also read `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` direct（`D:\Projects\openhanako\core\mcp\clients\http-client.ts:361`）。Runtime mounted at `server/index.ts:448–453`。
- Server 层无硬编码 outbound allowlist。baseUrl per-provider + user config override（`core/provider-registry.ts:916`）。

**`HANA_HOME=/hana/home` 时 core/ & cli/ 调整**

- `resolveHanakoHome`（`D:\Projects\openhanako\shared\hana-runtime-paths.cjs:13–16`）默认 `<HOME>/.hanako`（HANA_HOME unset），supports `~` expansion。设 `HANA_HOME=/hana/home` 直接 work。
- `resolveCliHanaHome`（`D:\Projects\openhanako\cli\local-server.ts:5–17`）同。无 code change for path。
- 但一些 code path 用 `os.homedir()` 而非 `HANA_HOME` derive 其他 dirs：
  - `D:\Projects\openhanako\core\engine.ts:2503` — `const homeDir = os.homedir()` 用于 scan `WELL_KNOWN_SKILL_PATHS`（`engine.ts:65–71`：`.claude/skills`、`.codex/skills`、`.openclaw/skills`、`.pi/agent/skills`、`.agents/skills`）。Docker 中这些 absent；scan 是 no-op。
  - `D:\Projects\openhanako\shared\default-workspace.ts:14–22` — `resolveDefaultWorkspacePath(homeDir)` 返回 `<homeDir>/Desktop/OH-WorkSpace`。uid 1000 + HOME unset 时即 `~/.Desktop/...`。Default workspace 写进 `config.yaml` 的 `desk.home_folder`（`core/first-run.ts:192`）。容器 image 需让 `$HOME` 与 `/hana/home` coherent（如 `HOME=/hana/home`），或 pre-seed workspace at custom path。
  - `D:\Projects\openhanako\lib\sandbox\bwrap.ts:188` — `const hostHome = env?.HOME || os.homedir();` 用于在 bubblewrap namespace 内 shadow `<hostHome>/.cache` + `<hostHome>/.npm` with tmpfs。独立于 `HANA_HOME`。
  - `D:\Projects\openhanako\lib\debug-log.ts:44` — `this._redactOptions = { homeDir: os.homedir() };` for path redaction in logs。
  - `D:\Projects\openhanako\core\computer-use\providers\macos-cua-provider.ts:36,46,136` + `D:\Projects\openhanako\lib\sandbox\win32-legacy-migration.ts:94,256,445,529,636` 用 `os.homedir()` for macOS/Windows-only paths——irrelevant in Linux container。
  - `D:\Projects\openhanako\lib\bridge\media-roots.ts:24` + `lib\bridge\media-utils.ts` 用 `os.homedir()` for media-root discovery；cosmetic。
- `cli/entry.ts` + `cli/server-runner.ts` shell out to `bootstrap.js`（或 `server/main-full.ts`/`server/main-open.ts`）。`HANA_HOME=/hana/home` 通过 env 自动传递（`spawn(env: spec.env)` at `server-runner.ts:192,212`）。Bootstrap 在 `D:\Projects\openhanako\server\bootstrap.ts:21` log 已 resolved HANA_HOME。
- `startServer()` re-resolves + writes back：`server/index.ts:253–254`（`const hanakoHome = resolveHanakoHome(process.env.HANA_HOME); process.env.HANA_HOME = hanakoHome;`）。一切 downstream 用 `hanakoHome`，所以 PathGuard / credentials / server-info.json layout 会正确 rebase 到 `/hana/home`。

## Answer

**1. PathGuard under `HANA_HOME=/hana/home`.** `lib/sandbox/policy.ts:14–52` 的 policy constants 都 relative to supplied `hanakoHome`/`agentDir`；constructor（`path-guard.ts:50–65`）用 `path.resolve` + `fs.realpathSync` join。Policy 与 PathGuard 都无 Windows 专属——swap `HANA_HOME=/hana/home` rebase 整 whitelist，无 edit。单一 Windows quirk：`secret-fs.ts:52` 跳过 `win32` 的 POSIX chmod；这条 path 在容器内不适用。唯一 collateral 依赖 `os.homedir()`、会 surprise operator 的是 `shared/default-workspace.ts:14–22`，seed `~/Desktop/OH-WorkSpace`（`$HOME/Desktop/OH-WorkSpace`，`$HOME` 是容器 user home，不是 `/hana/home`）；Dockerfile 应设 `HOME=/hana/home` 或 pre-create workspace，否则 default agent 的 `desk.home_folder` 指向不存在 / 在持久 volume 外的目录。

**2. Docker 内 sandbox.** Server 进程从不直接 invoke `bwrap` / `sandbox-exec` / `HANA_WIN32_SANDBOX_HELPER`。`detectPlatform()` at `lib/sandbox/platform.ts:7–12` 无条件 `process.platform === "linux"` 时返回 `"bwrap"`，`isOneShotSandboxEnforced()` at `lib/sandbox/index.ts:131–146` 是 fail-closed：image 没装 `bwrap` 时，每个 agent `bash` tool call 硬 fail `sandbox.osRequired`。要么 image ship `bwrap`（Debian `bubblewrap` 包），要么 operator 接受 agent 不能跑 shell commands。无 graceful degrade。`bwrap.ts:131–137` 要 `clone(CLONE_NEWUSER|CLONE_NEWPID)` + `--unshare-net`；Docker 默认 seccomp profile 允许，但跑 strict custom seccomp / `--cap-drop=ALL` 不 `--security-opt seccomp=unconfined` 会 silently break sandbox。Windows-only `startWin32LegacySandboxMaintenance`（`server/index.ts:474`）正确 gate，Linux 是 no-op。

**3. uid 1000 file ownership.** Server 从不写 standalone `pidfile`、从不创 Unix socket、从不 `fs.chown`、从不 `process.umask`。唯一 PID-bearing file 是 `HANA_HOME/server-info.json`（mode `0o600`），loopback mutex 读 file 的 token 而非信任嵌入 PID（`server/index.ts:263–292`）。Permission strategy = "write with mode + explicit chmod + rename via tmp"（`shared/secret-fs.ts:108–153`, `server/index.ts:1232–1254`）。所有 credential files `0o600`，所有 credential dirs `0o700`，per-startup `healCredentialFileModes` walk 强制（`core/credential-file-healer.ts:92–164`）。uid 1000 fine as long as volume mount 让 POSIX bits stick（多数 bind-mount + named volume 即可；SMB/9p 不行——`secret-fs.ts:80–96,160–182` 显式 handle：re-read `mode & 0o777` 后 chmod，仅 FS 真接受时 report change）。无 call site pin specific uid；root 启动容器，`0o600` 文件 owned by root，uid 1000 不能读。Image 的 `USER 1000` 必须 set before `node` exec，或 entrypoint 跑 `chown -R 1000:1000 /hana/home`。

**4. Linux capabilities.** Codebase 从不用 `ptrace` / `setuid` / `setgid` / `cap_sys_admin` 等（grep cross `core/` / `lib/` / `server/` / `desktop/`；only `capabilities` hits 是 unrelated plugin-grant vocab in `core/capability-policy.ts` + `core/grant-registry.ts`）。`bwrap` 自己需要的是 new user/network/PID namespaces via `clone` + bind mounts；bubblewrap binary 后 drop own privileges，无 ambient capabilities。Default Docker caps（`--cap-drop=ALL` + `--cap-add CHOWN,DAC_OVERRIDE,FOWNER,SETUID,SETGID,NET_BIND_SERVICE,KILL`）足够且推荐。**不要** add `SYS_ADMIN`——bwrap 不要；加上去 weaken host 比 sandbox help 多。

**5. Network.** Server outbound HTTPS calls to user-configured LLM provider base URLs（defaults：`https://api.openai.com/v1` at `lib/providers/openai.ts:60`, `https://api.anthropic.com` at `lib/providers/anthropic.ts:10`, plus all `lib/providers/*.ts`）。Provider base URLs user-overridable via `added-models.yaml` / Provider Catalog（`core/provider-registry.ts:916`）。Proxy：`lib/net/outbound-proxy.ts`（`createOutboundProxyRuntime`, mounted at `server/index.ts:448–453`）读 `HTTP(S)_PROXY` / `NO_PROXY` + HTTP/HTTPS/SOCKS5。无硬编码 endpoint allowlist，operator 应 network 层 whitelist LLM provider domains 或 `HTTPS_PROXY=http://...` 强制 egress 过 proxy。Incoming 仅 loopback HTTP/WS port（或 `HANA_PORT` / `server-network.json` 配置）。

**6. Secrets.** All credentials plain text under `HANA_HOME`：`auth.json`（OAuth refresh tokens）、`added-models.yaml`（API keys after migration, see `core/migrations.ts:115`）、`provider-catalog.json`、`local-user-auth.json`、加 `security/` tree（`SECURITY_DIR = "security"`, `core/security-dir.ts:16`）+ local provider plugin tree。无 `keytar` / `safeStorage` / `electron-store`。Every write 走 `shared/secret-fs.ts` with `0o600`。For Docker，both options workable，但 `/run/secrets/<name>`（tmpfs，never on persistent volume）更 fit API-key path——`added-models.yaml` 在每次 model call（`core/provider-registry.ts:1533`）+ 每次 startup read；可经 tiny loader convert to env。Cleanest pattern：API keys as env vars（`HANA_PROVIDER_<ID>_API_KEY` 或 single secret per provider）at container start，either symlink `added-models.yaml` to a `/run/secrets/...` file entrypoint renders，或 extend provider resolver to read env vars before falling back to file。`/hana/home/auth.json` 应 keep on persistent volume——丢 OAuth refresh tokens 强 re-auth flow on next container start。**不要** write API keys 进 `docker run -e KEY=...` 命令行——`ps` / `/proc/<pid>/environ` expose them；用 `--env-file` 或 Docker secrets。

## Gaps / follow-ups

- `mode: "full-access"` 是否要 adjust？`lib/sandbox/policy.ts:99–101` 确认 full-access 旁路 PathGuard entirely。建议 follow-up ticket 决定 Docker entrypoint 是否 pin `HANA_ACCESS_MODE=full-access`（likely no——keep PathGuard on），或 engine 是否暴露 Docker-aware mode that loosens it for shared-volume scenarios。
- `bwrap` is hard requirement today；either 包 `bubblewrap` in Dockerfile 或加 fallback 让 agent shell out without it。无 ticket for latter；filing one 可让 image smaller + platform story 简单。
- `$HOME` 下的 well-known skill paths（`.claude/skills` / `.codex/skills` 等, `core/engine.ts:65–71`）无条件 scan；容器内 absent，但 future ticket 应 consider making configurable so image with mounted shared skill dirs can advertise them。
- Default workspace `~/Desktop/OH-WorkSpace`（`shared/default-workspace.ts:14–22`）hardcode against `os.homedir()`。小 ticket 读 `HANA_DEFAULT_WORKSPACE` env var 可让 Docker image 避免 `HOME == HANA_HOME` coupling。
- `server/index.ts:474` 每次 Windows process 跑 legacy Windows sandbox maintenance hook。Linux teardown 无需 today，但若 team add unattended-bwrap-cleanup story，mirror 该 conditional。
- `secret-fs.ts:84,168,180` re-read `mode & 0o777` 检测 ignore chmod 的 FS；healer 把每 file log 到 `errorBus`（`credential-file-healer.ts:117–120`）。CI/Docker 管道用 non-POSIX volume 时 warnings 会 pile up。建议 ticket 把它们 surface 为 startup check 而非 silent event-bus reports。
- 无 ticket yet for shipping Provider Catalog entries（model metadata, non-secrets）进 image——current path requires user to manually populate `provider-catalog.json` 或 rely on first-run defaults。`HANA_PROVIDER_CATALOG` env-injection story 会让 Docker image reproducible。