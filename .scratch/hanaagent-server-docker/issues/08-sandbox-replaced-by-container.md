# 08 — 沙盒由 Docker 隔离替代 Linux Bubblewrap

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Linux 容器场景下，是否需要在 server 镜像内再起一层 Bubblewrap？

## Answer

**不**。Docker 容器自身提供 OS-level 隔离 + Linux user namespaces。

理由：

- HanaAgent 在 desktop 上的三层 sandbox 是为了 desktop user 跑 agent 时防止误删 home dir / 越权网络——多用户共享主机的场景
- Docker 部署里 server 是单一服务，由 docker daemon + Linux kernel 隔离，威胁模型不同
- 容器内 `non-root` (uid 1000) + read-only root filesystem + tmpfs / write layer 是足够的安全姿态
- PathGuard（四级访问控制，应用层）继续生效，与容器隔离正交

**desktop 上的 Bubblewrap / Windows restricted token / macOS Seatbelt 保持不动**。Docker 与 desktop 是两个独立部署面。