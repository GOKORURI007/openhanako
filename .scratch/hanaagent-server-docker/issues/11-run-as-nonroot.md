# 11 — 容器内以 non-root (uid 1000) 运行

Type: grilling
Status: resolved
Blocked by: (none)

## Question

容器内运行身份？

## Answer

使用 `node:24-bookworm-slim` 内置的 `node` user（uid 1000, gid 1000）。

Dockerfile 末尾：

```dockerfile
USER node
```

entrypoint 在启动前：

```sh
chown -R 1000:1000 /hana/home
```

理由：

- 减少容器逃逸后的 blast radius
- 与 PathGuard 的 user-based 访问控制契合
- 不需要在镜像里额外创建 user（官方镜像已提供）

**不切 root**：bind-mount 调试场景下，使用者从 host 进容器 `docker exec -u 0 ...` 临时提权即可。