# 03 — `/mobile/` PWA 不进镜像

Type: grilling
Status: resolved
Blocked by: (none)

## Question

`/mobile/` PWA 资产是否打进 Docker 镜像？

## Answer

**不进**。镜像只起 server 进程。

理由：

- destination 是「独立部署 server」；mobile / PWA 是 client，独立分发
- mobile PWA 通过反向代理指向 `/mobile/` 路径或在 web client 之外另起静态服务，是后续单独 effort 的工作
- 把 mobile 资产塞进镜像会拉大 base image 体积，引入 nginx / Caddy 之类的反代依赖，违反 destination 的极简原则

如果在后续 prototype 中发现 mobile 与 server 数据结构耦合到必须共部署，再单独决定。