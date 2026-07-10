---
alwaysApply: true
scene: git_message
---

# Git Commit Message 规范

## 基本原则
- 简洁明了，避免冗长描述
- 具体修复或实现内容必须明确提及，不得省略

## 格式
```
<类型>: <简明摘要>

<变更内容清单>
```

## 类型
- `feat`: 新增功能
- `fix`: 修复缺陷
- `refactor`: 重构优化
- `docs`: 文档变更
- `test`: 测试相关
- `chore`: 构建/工具/配置

## 摘要要求
- 一句话概括本次提交的核心目的
- 长度控制在 50 字以内
- 使用中文描述

## 变更内容清单要求
- 列出本次提交涉及的关键修改点
- 每项一行，使用 `-` 引导
- 必须涵盖所有实质性变更，不得遗漏
- 纯格式化、空行调整等非实质变更可省略

## 示例
```
feat: 新增角色卡与世界书微内核服务

- 新增 CharacterService 封装角色卡 CRUD
- 新增 WorldbookService 封装世界书 CRUD
- types.ts 扩展 KernelServices 枚举与接口契约
- index.ts 注册两服务到拓扑排序批量装配
- 收口 CharacterContext 与 useWorldbookActions 直连 localDB
```

```
fix: 修复 DictTab upsertDictEntry 签名适配

- 适配 MemoryStorage.upsertDictEntry(sessionId, entity, patch) 三参签名
- DictTab 改走 MemoryService.getStorage() 调用链
```
