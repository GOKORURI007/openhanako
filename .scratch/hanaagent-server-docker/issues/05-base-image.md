# 05 — base image 选 `node:24-bookworm-slim`

Type: grilling
Status: resolved
Blocked by: (none)

## Question

镜像 base 选哪个？

## Answer

`node:24-bookworm-slim`。

理由：

- native modules（如 `better-sqlite3`）在 glibc 上有 wheel，**避免 Alpine musl libc 兼容问题**
- Debian security update 渠道成熟
- 体积可控（~250MB base + runtime + server bundle），不追求极致 size

不选 Alpine——除非 R1 显示 server bundle 中所有 native modules 都提供 musl prebuilt；不为 size 切 distroless（初期调试代价大）。