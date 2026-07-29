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

-- ========== 中文备注（PostgreSQL COMMENT ON 语法） ==========
COMMENT ON TABLE users IS '用户主表 —— 账号体系核心，存储邮箱/密码哈希/显示名等基本信息';
COMMENT ON COLUMN users.id IS '用户唯一标识（UUID，数据库 gen_random_uuid 自动生成）';
COMMENT ON COLUMN users.email IS '登录邮箱（统一小写存储，UNIQUE 约束防重复注册）';
COMMENT ON COLUMN users.password_hash IS '密码哈希（Argon2 格式；纯 OAuth 用户为 NULL）';
COMMENT ON COLUMN users.email_verified IS '邮箱是否已验证（默认 FALSE，需通过验证邮件激活）';
COMMENT ON COLUMN users.display_name IS '显示名称（可选，用户可自定义昵称）';
COMMENT ON COLUMN users.created_at IS '账号创建时间';
COMMENT ON COLUMN users.updated_at IS '记录最后更新时间（由触发器 trg_users_set_updated_at 自动维护）';
