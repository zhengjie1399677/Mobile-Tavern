-- 回滚 users 表
-- 顺序：先删触发器 -> 再删函数 -> 最后删表
DROP TRIGGER IF EXISTS users_set_updated_at ON users;
DROP FUNCTION IF EXISTS trg_users_set_updated_at();
DROP TABLE IF EXISTS users;
