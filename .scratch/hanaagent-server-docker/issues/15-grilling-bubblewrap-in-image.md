# 15 — Docker image 是否装 `bubblewrap`

Type: grilling
Status: open
Blocked by: (none)

## Question

现有 `lib/sandbox/bwrap.ts` 用 `which bwrap` 探测 bubblewrap，**缺失时 fail-closed**——agent `bash` tool 硬 fail `sandbox.osRequired`（`lib/sandbox/index.ts:336–345`）。Q8 已决定"沙盒由 Docker 隔离替代 Linux Bubblewrap"，但 R3 发现这条 decision 是**两个不同问题**：

- **Q8 解决的是**：desktop 上 Bubblewrap 想防的"agent 误删 home / 越权网络"——Docker 容器隔离替了它。
- **未解决的是**：agent 自己的 sandbox 仍是 `bwrap`，container image 是否仍装 `bubblewrap`？

需要在 image 中装 `bubblewrap`，还是接受 agent 不能跑 shell command（fail-closed 退化）？

## Options（待定）

- A. 装 `bubblewrap`（`apt-get install bubblewrap` 进 Dockerfile）——保留 agent bash tool 全功能，bubblewrap 依赖 user namespaces（Docker 默认 seccomp profile 已 allow）
- B. 不装——agent 跑 shell command 时 fail-closed；使用者在 compose 里手动挂载额外脚本/sidecar 来替代
- C. 装但默认不强制——env var（如 `HANA_BWRAP_REQUIRED=0`）让 image 用户选 fail-closed 还是无 sandbox