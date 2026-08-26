# 13 — research: HANA_HOME 数据结构 + 与 desktop 互通

Type: research
Status: open
Blocked by: (none)

## Question

1. 现有 desktop 部署下 `HANA_HOME` 目录内容结构（sessions / memory / agents / skills / config / workspaces 等）
2. 这些目录在 Linux 文件系统上路径是否硬编码到 Windows 风格？
3. Docker 部署产出的 volume 能否**直接**被 desktop 客户端挂载消费？反过来，desktop 现成的 HANA_HOME 能否被 `docker run -v` 挂到容器内？两者是否要求路径完全一致？
4. 数据迁移 / 升级路径：desktop 数据 → Docker volume 的迁移步骤是什么？是否需要 `scripts/migrate-hanahome.mjs`？
5. desktop 与 Docker 是否会共享同一份数据（即"一台机器多人用 HanaAgent" 场景）——若是，需要考虑并发写入的 lock 策略

## Findings

(subagent 写入此处)

## Answer

(subagent 写入此处)