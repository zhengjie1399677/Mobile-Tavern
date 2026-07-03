import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import packageJson from './package.json';

export default defineConfig(() => {
  return {
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      IS_MOBILE_NATIVE: process.env.NODE_ENV === 'production' || !!(process.env.TAURI_ENV_PLATFORM || process.env.TAURI_PLATFORM),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          // 统一使用函数形式 manualChunks，避免对象与函数形式冲突
          // 符合 AGENTS.md 准则一第 2 条「物理层数据严格解耦与隔离」
          manualChunks(id) {
            // MVU 运行时依赖分离 — 仅在使用 MVU 脚本角色卡时才需要加载
            if (id.includes('node_modules/vue') || id.includes('node_modules/pinia') || id.includes('node_modules/jquery') || id.includes('node_modules/mathjs')) {
              return 'mvu-vendor';
            }
            // lodash 全量导入分离，避免污染主 bundle
            if (id.includes('node_modules/lodash')) {
              return 'lodash-vendor';
            }
            // React 核心
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor';
            }
            // 将内置角色卡图片数据模块分离到独立 chunk
            if (id.includes('builtInCharactersImages')) {
              return 'builtin-characters-images';
            }
          },
        },
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
