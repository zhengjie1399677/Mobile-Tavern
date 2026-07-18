-- 用户主表
-- 设计要点：
--   1. password_hash 允许 NULL —— 纯 OAuth（如 Google 一键登录）用户无密码
--   2. email_verified 默认 FALSE —— 邮箱注册用户需通过验证邮件激活
--   3. updated_at 由触发器自动维护，应用层无需手动更新
--   4. email 统一存储为小写，避免大小写歧义导致重复注册

CREATE TABLE users (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email          VARCHAR(255) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NULL,
    email_verified BOOLEAN      NOT NULL DEFAULT FALSE,
    display_name   VARCHAR(100) NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 触发器：updated_at 自动更新
CREATE OR REPLACE FUNCTION trg_users_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION trg_users_set_updated_at();

-- 索引：email 已通过 UNIQUE 约束自动建立 B-tree 索引
-- 邮箱统一小写写入约束（应用层确保，DB 层不强制 CHECK 以保留灵活性）
