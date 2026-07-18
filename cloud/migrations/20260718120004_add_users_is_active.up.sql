-- 补充 is_active 列，对齐 shared::account::User 类型
-- 设计要点：
--   1. shared::User 类型含 is_active 字段，原 users 表缺失此列
--   2. 默认 TRUE：现有用户与新建用户均视为活跃
--   3. 停用账号时设为 FALSE，登录/刷新将被拒绝（软删除替代硬删除）

ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 部分索引：仅索引停用账号，活跃账号不占索引空间（管理后台/定期清理用）
CREATE INDEX idx_users_is_active ON users(is_active) WHERE is_active = FALSE;
