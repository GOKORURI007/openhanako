# Map: HanaAgent Server Docker Deployment

`wayfinder:map`

## Destination

repo 拥有**一条独立的 Docker 交付线**，让 hanaagent server 能在 Linux 服务器上以容器形式独立部署：base 为 `node:24-bookworm-slim`，以官方内置的 non-root `node` user 运行，默认监听 `0.0.0.0:7777`，`HANA_HOME` 落在 named volume（默认 `hana-data`）上，配置通过 env vars 与挂载 config 都支持且优先级文档化，沙盒由 Docker 隔离替代 Linux Bubblewrap。镜像 tag 走 semver + git-sha + latest 三段，CI 做 build + 内部 smoke，**发布动作人工触发**。`/mobile/` PWA 不进镜像；现有 Windows `HanaCore` artifact 不动。Docker 与 desktop 是两个独立部署面，不在镜像里复现 Bubblewrap / Windows sandbox helper。

## Notes

- 本仓库 issue tracker = local markdown（见 `docs/agents/issue-tracker.md`），不依赖 `gh` CLI
- skills: 任何 ticket 进入 implementation 前调用 `/implement`；build 命令遵循 `AGENTS.md` 中 `## 极简与可控开发规范`
- 现有 standalone 流水线参考 `scripts/build-standalone-server-artifact.mjs`（**仅作参考，不复用产物**——本线交付独立的 Linux server runtime）
- Linux server runtime 来源待定：可能复用 `dist-server/linux-x64/`（若该 tree 已存在且内容完整），也可能基于 source 重 build——由 R1 决定

## Decisions so far

- [Q1 destination: Docker 镜像 + compose](./issues/01-destination-scope.md) — 交付 Linux Docker 镜像 + compose；含 Dockerfile、compose、build 脚本、smoke；不接 K8s/Helm，不打包 nginx
- [Q2 standalone 平台：独立交付线](./issues/02-standalone-isolation.md) — Docker 与 Windows HanaCore 互不依赖；不动现有 `build-standalone-server-artifact.mjs`
- [Q3 mobile/PWA：不进镜像](./issues/03-mobile-out-of-scope.md) — `/mobile/` PWA 容器外提供或后续单独处理
- [Q4 CI: build + 手动发布](./issues/04-ci-publish-strategy.md) — GitHub Actions 跑 build + smoke；push 到 ghcr.io 的动作由人工触发
- [Q5 base image: node:24-bookworm-slim](./issues/05-base-image.md) — 默认 Debian slim；不为 size 切 alpine / distroless
- [Q6 持久化: named volume 默认](./issues/06-persistence-named-volume.md) — compose 默认 `hana-data`；使用者可改为 bind mount，文档说明
- [Q7 网络: 默认 0.0.0.0:7777](./issues/07-network-default-port.md) — 不打包反代；README 明示生产应自接 nginx/Caddy + TLS
- [Q8 sandbox: Docker 隔离足够](./issues/08-sandbox-replaced-by-container.md) — 不在镜像里复现 Bubblewrap；PathGuard 在容器内继续生效，依赖 non-root user 1000
- [Q9 配置: env 与 mount config 都支持](./issues/09-config-priority.md) — env 优先于 mount config；文档明示优先级，secrets 走 docker secrets 或 mount file
- [Q10 tag: semver + git-sha + latest](./issues/10-image-tag-strategy.md) — CI 产出 git-sha tag；手动发布时 re-tag 为 v<version> + latest
- [Q11 运行身份: non-root (nodejs builtin)](./issues/11-run-as-nonroot.md) — uid 1000；HANA_HOME 文件拥有者由 entrypoint chown
- [R1 research: Linux server runtime 来源与 native modules 兼容性](./issues/12-research-linux-runtime.md) — `dist-server/linux-x64/` 不存在；`scripts/build-server.mjs linux x64` 可产 artifact，sh wrapper 直接 exec `node bootstrap.js`；native modules 需匹配容器 glibc/musl；`bwrap` 由容器自备、`HANA_HOME` 默认 `~/.hanako`、MinGit 仅 Windows
- [R2 research: HANA_HOME 数据结构 + 与 desktop 互通](./issues/13-research-hanahome-schema.md) — HANA_HOME layout **fully portable**、无 Windows 硬编码；25 个 immediate subdirs + root state files；multi-writer **not supported**（同宅互斥闸 probe 假设单 host）；migration 只需 `tar` + Electron-only 子树 exclude 列表；DATA_EPOCH=1 永远 pinned，无 checkpoint restore path
- [R3 research: 容器内安全机制有效性](./issues/14-research-security-in-container.md) — PathGuard 全平台 neutral、rebase 自动；`bwrap` 缺失 fail-closed；uid 1000 OK as long as `USER 1000` before `node` exec；Docker caps `--cap-drop=ALL` + 限定 `--cap-add` 已足；API keys 应走 `/run/secrets`、OAuth tokens 留 persistent volume

## Not yet specified

- multi-arch 镜像（`linux/amd64` + `linux/arm64`）——影响 Dockerfile buildx 配置，未决定
- image size 上限 / CVE 扫描策略（trivy / grype？）——影响 CI 步骤，未决定
- healthcheck endpoint——server 端是否暴露 `/health`？未确认
- entrypoint 脚本形态——是 shell wrapper 还是 Node entrypoint？未决定
- 多容器编排（Postgres / Redis 等）—— destination 是 single-container，未明确禁止，但 compose v2 文件允许不含
- 日志收集策略（json-file driver 限额 / journald / 外接）—— 未决定
- 镜像 release notes 模板 / 自动生成 changelog 切片 —— 未决定
- 实际在 Linux host build + bookworm container smoke（验证 R1 "build script 自带 smoke" 假设）——HITL task，需要 Linux 环境
- Windows ACL 状态在跨 host migrate 时是否要 strip——R2 gap 子问题
- Desktop-only subpaths 分类（`host-portable` / `host-locked` / `optional-on-server`）—— R2 gap，未来 ticket
- `HANA_ACCESS_MODE=full-access` 在 Docker 是否 pin——R3 gap
- well-known skill paths (`$HOME/.claude/skills` etc.) 是否配置化——R3 gap
- `HANA_PROVIDER_<ID>_API_KEY` / per-provider secrets env loader 具体契约——R3 answer §6 提及，但具体 env 命名 + 优先级未 spec
- secret-fs 在 non-POSIX volume 上 warning surface——R3 gap
- DATA_EPOCH 真实 bump 后 `hana data restore` 在 Linux volume 上的验证——R2 gap，DATA_EPOCH=1 当前不触发

## Out of scope

- 把 `/mobile/` PWA 打进同一个镜像（决策见 03）
- 重构 `scripts/build-standalone-server-artifact.mjs` 为跨平台 artifact（决策见 02）
- K8s / Helm chart、terraform module（destination 是 Docker 镜像 + compose）
- 镜像中打包 nginx / Caddy 反代（决策见 07）
- Windows 容器镜像（destination 限定 Linux 服务器）
- Mac Catalyst / Mac native 容器化（与 Q3 类似，独立部署面）
- agent runtime 的 native module 重编译——除非 R1 报必要 issue，否则不动
- 多容器编排（Postgres / Redis 等）——destination 是 single-container per host（Q6 + Q7），多容器不在本 effort 范围
- DATA_EPOCH 真实 bump 后 `hana data restore` 在 Linux volume 上的验证——R2 gap 提的；DATA_EPOCH=1 当前 pinned（`shared/contract-versions.cjs:64`），bump 是产品演进的事，不在本 effort