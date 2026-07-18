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