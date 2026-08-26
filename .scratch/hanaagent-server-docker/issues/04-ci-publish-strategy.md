# 04 — CI 做 build + smoke，发布人工触发

Type: grilling
Status: resolved
Blocked by: (none)

## Question

GitHub Actions 在 release/PR 上做什么？

## Answer

**CI 范围**：

- push 到 main 时 build 镜像（只产出 git-sha tag，留作 cache 与本地调试）
- 跑 smoke（容器内启动 server 进程，`curl localhost:7777/<health>` 应返回 200）
- push 到的 tag 仓库**仅限内部缓存**，PR build 用 GHA ephemeral registry 不保留
- 跑完把 image size / CVE summary 写到 PR comment（如果接了 CVE scan）

**手动发布流程**（**不在 CI 自动做**）：

- 维护者本地 checkout release tag
- 在 repo 触发 `workflow_dispatch` 输入 `version`（v<semver>）+ `git-sha`
- workflow：pull 旧 image → re-tag → push 到 ghcr.io as `<semver>` + `latest`

理由：

- 避免每次 PR 合并都向公开 registry 推 image
- 发布是个产品决策（什么时候发、发哪个版本），不该让 CI 自动决定
- 手动 workflow 仍可审计、可复用 build cache