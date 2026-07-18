//! Mobile Tavern 前后端共享类型
//!
//! 通过 ts-rs 自动导出 TypeScript 定义到 `shared/bindings/`，
//! 前端通过 tsconfig path alias `@cloud-types/*` 导入（详见 docs/agents/cloud_strategy.md）。
//!
//! 修改类型后运行 `cargo build -p shared` 自动重新生成 .ts 定义文件。

pub mod account;
pub mod api;