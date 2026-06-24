import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    define: {
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
          manualChunks: {
            // MVU 运行时依赖分离 — 仅在使用 MVU 脚本角色卡时才需要加载
            'mvu-vendor': ['vue', 'pinia', 'jquery', 'mathjs'],
            // lodash 全量导入分离，避免污染主 bundle
            'lodash-vendor': ['lodash'],
            // React 核心
            'react-vendor': ['react', 'react-dom'],
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
