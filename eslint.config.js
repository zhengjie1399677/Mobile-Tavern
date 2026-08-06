/**
 * ESLint 配置（flat config，ESLint 9 + typescript-eslint 8）
 *
 * 注意：曾尝试 ESLint 10，但 eslint-plugin-react@7.37.5（最新）peer 仅支持至 ^9.7，
 * React 插件生态尚未跟上 ESLint 10，故固定 ESLint 9.x 以保持插件兼容。
 *
 * 设计意图（对应 AGENTS.md `QUALITY-TYPES` 与 docs/agents/typescript_discipline.md）：
 * - `no-explicit-any` 保持 warning：呈现历史债务，不阻断全仓库门禁（文档既定决策）；
 *   新增/改动文件的零警告约束由 scripts/lint-changed.cjs 执行（git diff 范围 + --max-warnings 0）。
 * - 正确性类规则（eqeqeq / prefer-const / no-var 等）优先 error；若历史违规过多再按文件降级。
 * - tsc 已负责类型检查（noImplicitAny、strictNullChecks），eslint 不重复 no-undef。
 * - 测试代码允许 Mock 边界的动态断言（typescript_discipline.md 第二条），不做额外收紧。
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "target/**",
      "src-tauri/**",
      "cloud/**",
      "playwright-report/**",
      "test-results/**",
      ".workbuddy/**",
      "scratch/**",
      "examples/**/build/**",
      "examples/**/game.js",
      "src/utils/mvu*.js",
      "**/*.mtplugin",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // ---- 全局规则：ts/js/cjs 一致，避免降级只对 ts 生效导致 js 文件回落到 recommended error ----
    rules: {
      // tsc 管类型与未定义符号，eslint 侧关闭避免与 TS 语法冲突（cjs 的 Node 全局也不误报）
      "no-undef": "off",

      // 未使用变量：tsconfig 未开 noUnusedLocals/Parameters，由 eslint 补位
      // 历史存量先按 warning 呈现，改动文件由 lint-changed.cjs 强制归零
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-unused-vars": "warn",

      // ---- 历史存量过大、先以 warning 呈现的 recommended 规则 ----
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-unused-expressions": "warn",
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "preserve-caught-error": "warn",

      // ---- 基础一致性：低风险、高价值，历史违规少则保持 error ----
      "eqeqeq": ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-unreachable": "error",
      "no-cond-assign": ["error", "except-parens"],

      // 调试代码禁止混入主线；如需保留必须显式 eslint-disable 并注明原因
      "no-debugger": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      react,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // 历史 any 债务呈现为 warning（typescript_discipline.md 第三条/第四条既定决策）
      "@typescript-eslint/no-explicit-any": "warn",

      // React Hooks 依赖完整性：项目中既有 eslint-disable 注释依赖此插件
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "warn",

      // react-hooks 7.x 新增的激进正确性规则：首次引入时对历史代码误报多
      // （渲染期调用 setState、Date.now() 等初始化模式），强行达标需大范围重构，
      // 违背"不借机扩大重构"原则；待规则稳定后再评估开启。
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // CommonJS 脚本（scripts/、tests/ 下的 .cjs/.js、构建工具）：允许 Node 全局
    files: ["**/*.{cjs,js,mjs}"],
    languageOptions: {
      sourceType: "commonjs",
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  }
);
