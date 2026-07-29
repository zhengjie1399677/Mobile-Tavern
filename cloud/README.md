# Mobile Tavern 云端后端索引

当前云端实现采用面向五十人以内社区的最小验证方案。

## 当前实现

- 路径：`minimal-community/`
- 数据库：SQLite
- 部署方式：宿主机直接运行单个 Rust 二进制
- 文件存储：VPS 本地目录
- 当前验证范围：配置读取、目录初始化、SQLite 建表、健康检查

根工作区只构建当前实现，不会编译归档代码。

## 历史归档

原 PostgreSQL、Redis 与 Docker 原型已移动至：

`archive/postgres-redis-prototype/`

封存原因：

1. 当前社区预计不超过五十人，原方案的常驻内存与运维成本不符合最小验证目标。
2. 用户明确选择无 Docker、无 PostgreSQL、无 Redis 的单机部署方式。
3. 旧实现仍保留完整源码、迁移与部署文件，用于未来扩容时参考，不直接删除历史成果。

归档目录不参与当前 Cargo workspace 构建。若未来恢复，应重新评估数据迁移、账号兼容和部署资源，不能直接与 SQLite 数据目录混用。
