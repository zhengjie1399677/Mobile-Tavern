-- Refresh Token 表
-- 设计要点：
--   1. jti (JWT ID) 作主键 —— 与 JWT 中的 jti claim 一一对应
--   2. revoked_at NULL 表示未撤销；非 NULL 表示已撤销（含撤销时间）
--   3. user_agent / ip_address 用于设备识别（可选，便于"踢出其他设备"功能）
--   4. expires_at 索引用于定期清理过期 token 的定时任务
--   5. ON DELETE CASCADE: 删 user 时同步删其所有 refresh token
--   6. 不存 access_token —— access_token 是无状态的，只靠 Redis 黑名单撤销

CREATE TABLE refresh_tokens (
    jti         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ  NOT NULL,
    revoked_at  TIMESTAMPTZ  NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    user_agent  TEXT         NULL,
    ip_address  INET         NULL
);

-- 索引：按 user_id 查询其所有 refresh token（验证 / 列出设备）
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- 索引：按 expires_at 清理过期 token（定时任务扫描）
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- 索引：按 revoked_at 过滤活跃 token
CREATE INDEX idx_refresh_tokens_revoked_at ON refresh_tokens(revoked_at) WHERE revoked_at IS NULL;