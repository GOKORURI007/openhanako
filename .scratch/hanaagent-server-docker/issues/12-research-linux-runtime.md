# 12 — research: Linux server runtime 来源与 native modules 兼容性

Type: research
Status: open
Blocked by: (none)

## Question

`hanaagent server` 在 Linux 容器内运行所需的 runtime：

1. repo 中**是否已经存在**可用于 Linux 的 server artifact？检查 `dist-server/linux-x64/`（若存在）内容是否完整（`bundle/index.js`、`bundle/cli.js`、`hana-server`、native modules 等）
2. server bundle 在 **Node 24 + Debian bookworm glibc** 上是否能直接启动？特别是：
   - `better-sqlite3` 是否提供 prebuilt glibc wheel？
   - 是否有其他 native modules（grep `*.node` 或 `node-gyp-build` 痕迹）
   - server 启动时调起的子进程（git？浏览器后端？minGit？）在容器内是否可用
3. server 当前对 `HANA_HOME` / `HANA_ROOT` / `HANA_SERVER_ENTRY` 等 env 的实际行为
4. server bundle 是否需要 Linux 平台特有的 wrapper（参照 Windows 的 `hana-server.exe`），还是 `node` 直接跑即可

## Findings

(subagent 写入此处)

## Answer

(subagent 写入此处)