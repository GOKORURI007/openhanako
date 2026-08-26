# 10 — image tag: semver + git-sha + latest

Type: grilling
Status: resolved
Blocked by: (none)

## Question

镜像 tag 命名规则？

## Answer

CI 产出三类 tag：

1. `<git-sha>` —— push 到 main 时产出，**只**留在 GHA cache 与本地，不推 ghcr.io
2. `v<semver>`（如 `v0.451.0`）—— 手动发布时由 maintainer 触发 workflow re-tag
3. `latest` —— 同次手动发布中 re-tag，指向 `v<semver>`

**完整发布步骤**：

```bash
# CI 自动做：
docker buildx build --tag ghcr.io/gokoruri007/openhanako:<git-sha> --load .

# Maintainer 手动做：
docker tag ghcr.io/gokoruri007/openhanako:<git-sha> ghcr.io/gokoruri007/openhanako:v0.451.0
docker tag ghcr.io/gokoruri007/openhanako:<git-sha> ghcr.io/gokoruri007/openhanako:latest
docker push ghcr.io/gokoruri007/openhanako:v0.451.0
docker push ghcr.io/gokoruri007/openhanako:latest
```

实际由 `workflow_dispatch` workflow 包成一条命令。Maintainer 不直接敲 docker 命令。