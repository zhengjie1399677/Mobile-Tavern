-- Mobile Tavern 云端数据库初始化脚本
-- 由 docker-entrypoint-initdb.d 在首次启动 PG 容器时自动执行

-- pgvector 扩展：P3 社区分享阶段用于角色卡 / 世界书语义检索
CREATE EXTENSION IF NOT EXISTS vector;

-- uuid-ossp：生成 UUID v4（sqlx 侧已用 uuid crate 生成，此扩展作为兜底）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";