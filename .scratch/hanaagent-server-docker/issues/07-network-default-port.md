# 07 — 默认监听 `0.0.0.0:7777`

Type: grilling
Status: resolved
Blocked by: (none)

## Question

容器对外暴露什么端口？是否要在镜像内打包反代？

## Answer

**只暴露 7777 TCP**（`docker run -p 7777:7777` 或 compose ports mapping）。

**不在镜像中打包 nginx / Caddy / 任何反代**。README 明确：

  > 生产部署应在容器外（或单独 sidecar）跑反代处理 TLS 终止 / 路径分流。Docker 镜像只暴露裸 HTTP server，使用者自接 nginx / Caddy / Cloudflare Tunnel。

理由：

- 极简：镜像只负责一件事（跑 server）
- 不绑死 ACME provider / DNS 凭据管理
- 不引入额外 systemd / s6 进程

容器内部默认 `HOST=0.0.0.0` `PORT=7777`；这两个 env 可被使用者覆盖。