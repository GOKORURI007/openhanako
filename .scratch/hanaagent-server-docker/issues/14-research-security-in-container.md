# 14 — research: 容器内安全机制有效性

Type: research
Status: open
Blocked by: (none)

## Question

`hanaagent server` 现有安全姿态在容器化后哪些仍生效、哪些失效：

1. **PathGuard**（四级访问控制，应用层）—— 在容器内是否需要调整配置（路径前缀、工作目录）？当 `HANA_HOME=/hana/home` 时，PathGuard 默认白名单是否要修改？
2. **沙盒**：desktop 上的 Bubblewrap（Linux）/ Seatbelt（macOS）/ restricted token（Windows）—— Docker 容器场景下 server 进程是否仍尝试调起这些？需要跳过吗？
3. **non-root user 1000**：server bundle 启动时是否会要求某些文件由特定 uid 拥有（pidfile / socket / log）？与官方 `node:24-bookworm-slim` 默认 uid 是否冲突？
4. **capabilities**：container 默认 capability 是否足够？是否需要 `--cap-drop=ALL` + 显式 `--cap-add`？agent runtime 是否调 `ptrace` / `setuid` 等？
5. **网络**：server 是否对外主动发起（LLM API 调用），容器内 outbound 网络限制的影响
6. **secrets**：API key 现在存在哪里？容器场景下推荐挂载 `/run/secrets/<name>` 还是写入 env？

## Findings

(subagent 写入此处)

## Answer

(subagent 写入此处)