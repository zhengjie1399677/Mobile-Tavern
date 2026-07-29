-- 身份关联表
-- 设计要点：
--   1. 一个 user 可绑定多个 identity（如同时绑定 email + google）
--   2. (provider, provider_user_id) 全局唯一 —— 一个第三方身份只能绑一个 user
--   3. provider_user_id 含义因 provider 而异：
--      - 'email': 即邮箱地址本身
--      - 'google': Google sub claim（Google 用户唯一 ID，永不复用）
--   4. metadata JSONB 存储 OAuth 返回的原始信息（头像、locale 等）
--   5. ON DELETE CASCADE: 删 user 时同步删 identity

CREATE TABLE identities (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider         VARCHAR(50)  NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    metadata         JSONB        NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);

-- 索引：按 user_id 查询其所有身份（高频查询）
CREATE INDEX idx_identities_user_id ON identities(user_id);

-- 约束：provider 只能是已支持的值
-- 注意：新增 provider 时需同步更新此 CHECK
ALTER TABLE identities
    ADD CONSTRAINT chk_identities_provider
    CHECK (provider IN ('email', 'google'));

-- ========== 中文备注（PostgreSQL COMMENT ON 语法） ==========
COMMENT ON TABLE identities IS '身份关联表 —— 一个用户可绑定多个身份（邮箱/Google 等），支持多方式登录与第三方 OAuth 绑定';
COMMENT ON COLUMN identities.id IS '身份记录唯一标识（UUID，数据库自动生成）';
COMMENT ON COLUMN identities.user_id IS '关联的用户 ID（外键 users.id，删 user 时级联删除 ON DELETE CASCADE）';
COMMENT ON COLUMN identities.provider IS '身份提供方（email / google，CHECK 约束 chk_identities_provider 限制取值）';
COMMENT ON COLUMN identities.provider_user_id IS '提供方内的用户唯一 ID（email 时为邮箱地址；google 时为 Google sub claim，永不复用）';
COMMENT ON COLUMN identities.metadata IS 'OAuth 返回的原始信息（头像、locale 等，JSONB 格式存储）';
COMMENT ON COLUMN identities.created_at IS '身份绑定时间';