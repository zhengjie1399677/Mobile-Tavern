# Mobile Tavern v1.7.7 更新日志

发布日期：2026-08-03

## 新功能

- 社区封面缩略图支持：社区服务为上传的 PNG 角色卡自动生成最长边 256px 的 JPEG 缩略图，列表接口返回 `thumbnailUrl`；App 端封面优先加载缩略图，加载失败时自动回退完整原图，减少国内线路下的图片加载流量与等待时间。

## 问题修复

- 修复社区图片无法加载：服务器 nginx 补充 MIME 类型声明并清除 Cloudflare 边缘缓存的错误 `text/plain` 响应，PNG/JPEG 现在可以正常渲染。
- 修复前端若干问题（社区模块相关）。

## 验证

- TypeScript 严格检查、全量测试（Vitest + Playwright E2E）、Web/Node 构建全部通过。
