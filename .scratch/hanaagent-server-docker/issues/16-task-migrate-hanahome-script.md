# 16 — 是否写 `scripts/migrate-hanahome.mjs`

Type: task
Status: open
Blocked by: (none)

## Question

R2 结论：现有 desktop HANA_HOME 与 Docker Linux volume byte-compatible，迁移只需 `tar` + exclude 列表。但**没有**现成的一键脚本。

是否要写一个 `scripts/migrate-hanahome.mjs`？

## 候选功能

- 接受 `--src <desktop-home>` `--dst <docker-volume-path>` 两个必填参数
- 默认 exclude 列表（per R2 §7）：`artifacts/.installing`、`artifacts/staging`、`diagnostics/`、`runtime/pi-sdk/`（Linux 容器会 reseed）、`.pi/`（legacy）、`user/win32-install-acl-heal.json`（Windows ACL state）
- `--include-all` 反向开关（不做 exclude）
- `--dry-run` 只 print 文件 list
- 操作后写一份 manifest 到 `dst/.migration-manifest.json`（src path、date、file count、excluded list）以便 audit
- 失败时回滚（tar 没 copy 部分 + 已经 copy 的删掉）

## 决策点（待 follow-up grilling）

- 是否值得做（operator 一次性的事 vs 长期产品）
- 与现有 `core/migrations.ts` 的 in-process migrations 关系
- 是否要 UI（desktop / CLI flag）