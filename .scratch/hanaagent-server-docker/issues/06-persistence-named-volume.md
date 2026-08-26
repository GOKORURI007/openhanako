# 06 — 数据持久化默认走 named volume

Type: grilling
Status: resolved
Blocked by: (none)

## Question

`HANA_HOME` 用 named volume 还是 bind mount？

## Answer

**默认 named volume**，compose 里命名为 `hana-data`。

```yaml
volumes:
  hana-data:
```

理由：

- 适合"只想跑起来"的使用者，零路径规划
- docker engine 自动管理路径，备份时 `docker run --rm -v hana-data:/data -v $PWD:/backup busybox tar czf /backup/hana-data.tgz /data`

**支持 bind mount 切换**：compose 里用注释告知使用者如何改成 `./hana-data:/hana/home`；不需要额外 profile。

entrypoint 在启动前 `chown -R 1000:1000 /hana/home`，确保 named volume 首次挂载时所有权正确。