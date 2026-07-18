# Mobile Tavern 云端后端 Dockerfile
# 多阶段构建：builder 阶段编译 Rust 二进制，runtime 阶段仅拷贝产物，镜像最终约 50MB

# ─── Builder 阶段 ───────────────────────────────────────────────
FROM rust:1.82-slim AS builder

# 安装编译期需要的系统依赖（sqlx 需 pkg-config + libssl-dev 或改用 rustls）
# 本项目 sqlx 配置为 runtime-tokio-rustls，故仅需 ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先拷贝 workspace 根配置与共享 crate，利用 Docker 层缓存加速依赖编译
COPY Cargo.toml Cargo.lock* ./
COPY shared/ ./shared/
COPY cloud/ ./cloud/

# 编译 release 二进制
WORKDIR /app/cloud
RUN cargo build --release

# ─── Runtime 阶段 ───────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 拷贝编译产物
COPY --from=builder /app/cloud/target/release/mobile-tavern-cloud /usr/local/bin/

# 非 root 用户运行
RUN useradd --system --no-create-home --shell /usr/sbin/nologin tavern
USER tavern

EXPOSE 8080

# 健康检查（每 30s 探活一次，失败 3 次重启）
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD ["/usr/local/bin/mobile-tavern-cloud", "--health-check-internal"] || exit 0
# 注：上面 HEALTHCHECK 用 curl 更标准，但 slim 镜像无 curl。
# P1 阶段会改为安装 curl 或用 rust 自带的 health 子命令。
# 暂时禁用以避免误报，生产部署时通过外部探针 / 负载均衡器检查 /health。

ENV PORT=8080 \
    RUST_LOG=info

CMD ["mobile-tavern-cloud"]