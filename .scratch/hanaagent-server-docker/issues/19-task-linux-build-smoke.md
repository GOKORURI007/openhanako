# 19 — 实际 Linux build + bookworm container smoke

Type: task
Status: open
Blocked by: (none)

## Question

R1 反复强调"`scripts/build-server.mjs linux x64` 自带 in-place smoke，artifact emit 前会 fail" 是**未经验证的假设**。本 checkout 无 `dist-server/linux-x64/` 存在；CI smoke 也是基于 `dist:linux` electron-builder 路径而非 bookworm-slim 容器路径。

整个 destination 依赖：

1. `scripts/build-server.mjs linux x64` 在 Windows checkout 之外的 Linux host 上能跑通
2. 产出的 `bundle/index.js` + `node` binary + `node_modules` 在 `node:24-bookworm-slim` 容器里能被 uid 1000 启动
3. `better-sqlite3` / `@node-rs/jieba` / `@firecrawl/anydoc` / `node-pty` / `@silvia-odwyer/photon-node` 的 prebuilt 跟 Debian bookworm glibc 2.36 匹配（不是 musl prebuild）
4. 容器内 `which bwrap` + `bwrap --unshare-pid --unshare-net ...` 真的能跑（user namespaces + Docker seccomp profile 兼容）
5. `HANA_HOME=/hana/home node /app/bundle/index.js` 启动到 listening on 0.0.0.0:7777 的端到端 smoke

## 谁做

- **HITL**（agent 在 Windows checkout 内无法跑）—— 需 maintainer 在 Linux host 上执行
- 或 CI 提供 Linux runner 后改 AFK

## 步骤草案

1. Linux host（Debian bookworm）跑 `node scripts/build-server.mjs linux x64`
2. 产 `dist-server/linux-x64/`，tar 成 `hana-server-<sha>.tar.gz`
3. `docker run -it --rm -v $(pwd)/dist-server/linux-x64:/app -v /tmp/test-home:/hana/home -p 7777:7777 node:24-bookworm-slim bash -c 'apt-get update && apt-get install -y bubblewrap && useradd -u 1000 node-user && chown -R 1000:1000 /app /hana/home && su node-user -c "cd /app && ./hana-server"'`
4. 外部 `curl http://localhost:7777/<some-health-or-info-endpoint>` 应返回
5. 验证 `better-sqlite3` 真的 load（不是 stub / 报 fallback error）

## 失败处理

任何一步 fail → 关闭 ticket 为 wontfix-of-R1，**回烤** R1 findings 或派生新 research ticket（指向具体 failure mode）