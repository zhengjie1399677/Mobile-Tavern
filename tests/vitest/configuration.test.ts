import { describe, expect, it } from "vitest";
import {
  createFeaturePolicies,
  parsePublicEnvironment,
} from "../../src/config";
import { parseServerConfig } from "../../server/config";
import { parseViteEnvironment } from "../../build/viteEnvironment";
import { detectRuntimeEnvironment } from "../../src/kernel/runtimeEnvironment";

describe("分层配置体系", () => {
  it("校验并规范化移动端公开环境配置", () => {
    const environment = parsePublicEnvironment({
      MODE: "production",
      PROD: true,
      VITE_COMMUNITY_ORIGIN: "https://community.example.com/",
      VITE_COMMUNITY_ENABLED: "true",
      VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS: "3",
      VITE_COMMUNITY_MIN_CUMULATIVE_USAGE_HOURS: "12",
    });

    expect(environment.isProduction).toBe(true);
    expect(environment.communityOrigin).toBe("https://community.example.com");
    expect(environment.communityEnabled).toBe(true);
    expect(environment.communityMinFirstUseAgeDays).toBe(3);
    expect(environment.communityMinCumulativeUsageHours).toBe(12);
    expect(() => parsePublicEnvironment({
      VITE_COMMUNITY_ORIGIN: "not-a-url",
    })).toThrow();
    expect(() => parsePublicEnvironment({
      VITE_COMMUNITY_MIN_FIRST_USE_AGE_DAYS: "-1",
    })).toThrow();
    expect(parsePublicEnvironment({
      MODE: "production",
      VITE_COMMUNITY_ENABLED: "",
    }).communityEnabled).toBeUndefined();
  });

  it("功能发布策略只消费已经解析的环境信息", () => {
    const policies = createFeaturePolicies({
      mode: "development",
      isDevelopment: true,
      isProduction: false,
      isTest: false,
      communityOrigin: "https://community.example.com",
      communityEnabled: true,
      communityMinFirstUseAgeDays: 3,
      communityMinCumulativeUsageHours: 12,
    });

    expect(policies.communityEntry).toEqual({
      enabled: true,
      minFirstUseAgeDays: 3,
      minCumulativeUsageHours: 12,
    });
  });

  it("社区在未显式配置时保持关闭，开发环境也不自动展示", () => {
    const environment = parsePublicEnvironment({ MODE: "development", DEV: true });
    expect(createFeaturePolicies(environment).communityEntry.enabled).toBe(false);
  });

  it("Node 服务生产环境拒绝开发默认密钥", () => {
    expect(() => parseServerConfig({ NODE_ENV: "production" })).toThrow(
      /HMAC_SIGN_KEY/,
    );

    expect(() => parseServerConfig({
      NODE_ENV: "production",
      HMAC_SIGN_KEY: "default_local_hmac_sign_key_123456",
      AES_ENCRYPT_KEY: "a".repeat(64),
      REAL_API_KEY: "production-key",
    })).toThrow(/HMAC_SIGN_KEY/);

    const config = parseServerConfig({
      NODE_ENV: "production",
      HMAC_SIGN_KEY: "h".repeat(32),
      AES_ENCRYPT_KEY: "a".repeat(64),
      REAL_API_KEY: "production-key",
    });
    expect(config.isProduction).toBe(true);
    expect(config.port).toBe(3000);
    expect(config.host).toBe("127.0.0.1");

    expect(parseServerConfig({
      TAURI_DEV_HOST: "192.168.1.20",
    }).host).toBe("192.168.1.20");
  });

  it("Vite 构建环境统一解析移动端和 HMR 开关", () => {
    expect(parseViteEnvironment({
      TAURI_ENV_PLATFORM: "android",
      DISABLE_HMR: "true",
    })).toEqual({
      isMobileNative: true,
      disableHmr: true,
    });
    expect(detectRuntimeEnvironment({
      mode: "test",
      dev: true,
    })).toMatchObject({
      isDevelopment: false,
      isProduction: false,
      isTest: true,
    });
  });
});
