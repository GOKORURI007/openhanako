# 17 — `HANA_DEFAULT_WORKSPACE` env var

Type: grilling
Status: open
Blocked by: (none)

## Question

`shared/default-workspace.ts:14–22` hardcode `<os.homedir()>/Desktop/OH-WorkSpace`。R3 发现：

- 容器内 uid 1000 + `HOME` 不设时，`os.homedir()` 返回 `/root`（或 `/home/node`，取决于 base image）；workspace 落到 `/root/Desktop/OH-WorkSpace`，**不在 persistent volume 上**
- 容器 image 要么 `HOME=/hana/home`（让 default workspace 进 volume），要么 pre-create workspace at custom path

是否引入 `HANA_DEFAULT_WORKSPACE` env var，让 Dockerfile / compose 直接指定 workspace 路径？

## 候选方案

- A. 加 env var：`HANA_DEFAULT_WORKSPACE=/hana/home/workspace`，`resolveDefaultWorkspacePath()` 优先读 env，fallback 到 `<HOME>/Desktop/OH-WorkSpace`
- B. 不加 env var，Dockerfile 强制 `HOME=/hana/home` 让 default workspace 自然落到 volume
- C. 加 env var + 在 compose `.env.example` 默认值 `/hana/home/workspace`