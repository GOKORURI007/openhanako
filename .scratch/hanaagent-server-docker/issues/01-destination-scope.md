# 01 — destination 范围

Type: grilling
Status: resolved
Blocked by: (none)

## Question

「独立部署 hanaagent server，最好以 docker 形式」这一 effort 的 destination 究竟交付什么？

## Answer

交付**一条独立的 Docker 交付线**，最终产物是：

1. repo 根目录的 `Dockerfile`（多阶段 build，base `node:24-bookworm-slim`）
2. `docker-compose.yml`（含 named volume `hana-data`、port 7777 mapping、env / mount config 说明）
4. `scripts/build-server-docker-image.mjs`（本地手动 build，与 CI 共用 buildx 配置）
5. README 一节说明如何在 Linux 服务器上启动 + 反代 + 备份 volume
6. CI workflow（仅 build + smoke；**不自动 push**）

**不在交付范围**：

- K8s / Helm / terraform
- 镜像内打包反代（Caddy / nginx）
- Windows 容器镜像
- `/mobile/` PWA
- 重构 Windows HanaCore artifact