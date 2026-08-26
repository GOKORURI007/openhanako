# 09 — env vars 与 mount config 都支持

Type: grilling
Status: resolved
Blocked by: (none)

## Question

运行时配置怎么传递？env 还是 mount config？

## Answer

**两者都支持，env 优先于 mount config**。

理由：

- env vars 是 container 原生约定；HANA_HOME / HANA_ROOT / HANA_SERVER_ENTRY 现有脚本已大量用 env
- mount config 提供结构化（YAML / JSON）配置，便于 ops 团队以 gitops 方式管理
- 优先级明确：env wins，避免"我设了环境变量为什么没生效"的支持工单

**secrets 走 docker secrets 或挂载只读文件**（`/run/secrets/<name>`），不写进 compose 文件。

compose 示例（README 里给出）：

```yaml
services:
  hanaagent:
    image: ghcr.io/gokoruri007/openhanako:<tag>
    environment:
      HANA_HOME: /hana/home
      HOST: 0.0.0.0
      PORT: 7777
      LOG_LEVEL: info
    secrets:
      - llm_api_key
    volumes:
      - hana-data:/hana/home
      - ./hana-config.yaml:/etc/hanaagent/config.yaml:ro

secrets:
  llm_api_key:
    file: ./secrets/llm_api_key.txt

volumes:
  hana-data:
```

具体 env 全清单由 R1 + 后续 implementation ticket 决定。