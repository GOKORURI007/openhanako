# 18 — Provider Catalog env-injection

Type: grilling
Status: open
Blocked by: (none)

## Question

R3 发现：当前要进 image 的 Provider Catalog 条目（model metadata，非 secret）需要使用者手动填 `provider-catalog.json` 或依赖 first-run defaults。无 `HANA_PROVIDER_CATALOG` env-injection story → image 不可 reproducible。

要怎么做？

## 候选方案

- A. 引入 `HANA_PROVIDER_CATALOG` env var（路径或 inline JSON）——entrypoint 渲染到 `/hana/home/provider-catalog.json`
- B. 引入 `HANA_PROVIDER_CATALOG_URL` env var——entrypoint 从 URL 拉取
- C. image build 时 `ARG PROVIDER_CATALOG_JSON` baked-in
- D. 不做——保留 first-run defaults + 用户手填

## 关联

- API keys 走 `/run/secrets/<name>`（R3 answer §6）
- Provider Catalog 是 model metadata（含 baseUrl、model id、capability flags），**不含** secret