# 02 — Docker 与 Windows HanaCore 解耦

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Docker 部署是否复用 `scripts/build-standalone-server-artifact.mjs` 产出的 `HanaCore-<v>-Windows-x64.tar.gz`？

## Answer

不复用。Docker 是**独立交付线**，从 source 重新 build Linux server runtime（或直接消费现有 `dist-server/linux-x64/` tree，如果 R1 验证可用）。

理由：

- `HanaCore` artifact 是 Windows-only 的（hardcoded `STANDALONE_PLATFORM = "win32"`、`STANDALONE_ARCH = "x64"`），重构成跨平台不是本 effort 的工作
- HanaCore 内嵌 MinGit + Windows sandbox helper + `.cmd` 包装器，全部 Windows 专属，与 Linux 容器无关
- 两条线各自走 CI，互不阻塞

**对现有代码的约束**：本 effort **不动** `scripts/build-standalone-server-artifact.mjs`，不改 `STANDALONE_PLATFORM` / `STANDALONE_ARCH` 常量。