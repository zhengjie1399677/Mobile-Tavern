# 最小角色卡社区

这是面向五十人以内社区的单机服务，仅依赖一个 Rust 二进制、SQLite 和服务器本地文件目录，不使用 Docker、PostgreSQL 或 Redis。

## 已实现范围

- 搜索与分页列出角色卡。
- 上传 PNG 或 JSON 角色卡，单文件上限为 20 MB。
- 上传 PNG 角色卡时自动生成最长边 256px 的 JPEG 封面缩略图（`/thumbnails/`），
  列表封面只下载几十 KB 的缩略图，不再拉取完整角色卡。
- 下载前记录下载者当前名称和本机 UUID，并累计下载次数。
- 上传记录分享者当前名称和本机 UUID。
- SQLite 使用 WAL 模式；角色卡文件与数据库均保存在 `DATA_DIR`。
- 对外列表只展示名称，不返回任何 UUID。
- 默认每个来源 IP 十分钟最多上传三次。
- 默认角色卡总容量上限为 8 GiB。
- 管理员删除接口仅在配置至少 32 字符的 `ADMIN_TOKEN` 后启用。

名称和 UUID 只用于轻量贡献署名，不属于账号或可信身份。使用者可以修改本机数据，因此不能用它处理权限、付款或处罚。

## 当前成熟度

当前实现定位为“可上线灰度的最小 MVP”，高于一次性技术 Demo，但尚未达到成熟公共社区平台的水平。

已经超过普通 Demo 的部分：

- 前端具备角色卡选择、上传、搜索、下载和导入本地角色库的完整闭环。
- 服务端具备数据持久化、文件校验、错误清理、健康检查、systemd 守护和 Nginx/Cloudflare 部署链路。
- 已有来源 IP 上传限频、总容量限制、管理员删除能力和独立系统用户权限隔离。
- SQLite 使用 WAL，服务重启后数据、下载统计和署名记录不会丢失。
- Rust 单元测试、Linux amd64 Release 交叉编译和公网真实上传下载已经验证。

仍属于 MVP 的部分：

- 名称和本机 UUID 只是署名，不能证明真实身份，也不能阻止使用者伪造名称。
- 上传限频保存在单进程内，服务重启后会清空；尚无 Cloudflare WAF 规则和持久化封禁名单。
- 没有内容审核队列、举报、管理员后台、敏感内容分级和批量管理。
- 没有自动异地备份、磁盘告警、结构化指标、错误告警和完整压力测试。
- 当前为单机 SQLite 与本地文件存储，不提供多机高可用和自动故障转移。

在五十人以内、邀请制或小范围灰度场景中，当前架构与资源消耗是合适的。若开放给不可控公网用户，至少应先补充自动备份、磁盘告警、Cloudflare 限流及基本内容管理；若增长到数百名活跃用户，再评估对象存储、持久化限流和数据库升级。

## 本地验证

```bash
cargo test -p mobile-tavern-community
cargo run -p mobile-tavern-community
```

默认监听 `127.0.0.1:8080`。可复制 `.env.example` 为 `.env` 后修改配置。

## 接口

- `GET /`：服务状态。
- `GET /health`：进程健康检查。
- `GET /health/deep`：SQLite 深度健康检查。
- `GET /api/cards?q=&limit=&offset=`：角色卡列表。
- `POST /api/cards`：上传角色卡，使用 `multipart/form-data`。
- `POST /api/cards/:id/download`：登记下载者并返回文件地址。
- `GET /api/cards/:id/comments?limit=&offset=`：分页读取角色卡评论。
- `POST /api/cards/:id/comments`：发表纯文字评论。
- `DELETE /api/comments/:id`：管理员删除评论。
- `POST /api/admin/verify`：验证管理员密码。
- `DELETE /api/cards/:id`：使用 `X-Admin-Token` 请求头删除角色卡。

列表项额外返回 `thumbnailUrl`（PNG 卡为 `/thumbnails/<id>.jpg`，JSON 卡或缩略图
生成失败时为 `null`）。缩略图功能上线前上传的旧 PNG 卡没有缩略图，客户端
应回退使用 `downloadUrl` 显示封面。

上传字段为 `title`、`description`、`uploaderName`、`uploaderUuid` 和 `card`。下载登记请求为：

```json
{
  "actorName": "当前用户名称",
  "actorUuid": "本机 UUID"
}
```

评论字段为 `authorName`、`authorUuid` 与 `content`。评论最多 100 个 Unicode
字符；同一匿名 UUID 每小时最多发表 6 条、两条至少间隔 20 秒，同一卡片下
10 分钟内不得重复提交相同内容。

上传时服务端计算原始文件与规范化角色内容的 SHA-256，并分别建立唯一索引。
字节完全相同或仅头像、文件名、导出时间等易变字段不同的重复角色卡会返回
`409 Conflict`，响应中的 `existingCardId` 指向已存在的卡片。

## VPS 部署

建议目录：

- 二进制：`/opt/mobile-tavern-community/mobile-tavern-community`
- 环境配置：`/opt/mobile-tavern-community/.env`
- 数据：`/var/lib/mobile-tavern`
- 角色卡：`/var/lib/mobile-tavern/uploads/cards`
- SQLite：`/var/lib/mobile-tavern/database/community.sqlite3`

创建专用系统用户并授予数据目录写权限后，可参考 `deploy/mobile-tavern-community.service` 注册为 systemd 服务。Nginx 将 `/api/` 代理到 `127.0.0.1:8080`，并将 `/cards/` 映射到角色卡目录，站点配置示例见 `deploy/nginx.conf.example`。

`/cards/` 与 `/thumbnails/` 静态文件不经过 Rust 服务，必须在 Nginx 为其配置 `Access-Control-Allow-Origin` 响应头（示例配置已包含）；否则 App WebView 内 `fetch()` 下载会被浏览器拦截，表现为"封面能显示但下载失败"。PC 脚本不强制 CORS，无法暴露此问题。更新 nginx 配置后执行 `sudo nginx -t && sudo systemctl reload nginx`。

SQLite 数据库、`cards/` 与 `thumbnails/` 目录必须一起备份。更新程序前无需迁移独立数据库服务，但仍应先保留这些部分的快照。数据库首次启动会自动为 `cards` 表补充 `thumbnail_file_name` 列，旧数据无需手工迁移。

## 防滥用配置

```env
MAX_STORAGE_BYTES=8589934592
MAX_UPLOADS_PER_WINDOW=3
UPLOAD_WINDOW_SECONDS=600
ADMIN_TOKEN=
```

上传限频保存在进程内，重启服务后重新计数；它用于阻挡普通脚本滥用，不替代 Cloudflare 防火墙。总容量在服务启动时根据角色卡目录重新计算，并在每次上传和管理员删除时同步更新。

`ADMIN_TOKEN` 不得写入 App 或仓库。建议在服务器上使用 `openssl rand -hex 32` 生成，并只保存在 `/opt/mobile-tavern-community/.env`。

## 本地直连测速

Windows 测速脚本位于项目根目录的 `scripts/community-speed-test.ps1`。它会依次检查 DNS、健康接口延迟、上传速度、下载速度和 SHA-256 完整性。

断开 VPN 后，在 PowerShell 中执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\community-speed-test.ps1 -TestSizeMB 5 -AdminToken "服务器管理员令牌"
```

测试文件大小可设置为 1 至 19 MB。提供 `AdminToken` 时，脚本会在测速完成后调用管理员删除接口清理临时角色卡；未提供时会输出需要手动删除的角色卡 ID。

## 更新单二进制服务

更新前先备份当前二进制和 SQLite 数据，再停止服务。将新的 Linux amd64 二进制解压到 `/opt/mobile-tavern-community` 后恢复执行权限并重启：

```bash
sudo systemctl stop mobile-tavern-community
sudo cp /opt/mobile-tavern-community/mobile-tavern-community /opt/mobile-tavern-community/mobile-tavern-community.bak
sudo tar -xzf /root/mobile-tavern-community-linux-x86_64.tar.gz -C /opt/mobile-tavern-community
sudo chmod 755 /opt/mobile-tavern-community/mobile-tavern-community
sudo systemctl start mobile-tavern-community
sudo systemctl status mobile-tavern-community --no-pager
```

更新完成后使用以下接口验证：

```bash
curl https://community.neural-node.xyz/health/deep
curl https://community.neural-node.xyz/api/cards
```
