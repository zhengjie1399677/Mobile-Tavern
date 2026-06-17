#!/usr/bin/env node
// Shim: redirect `node tauri` calls from Gradle BuildTask to the actual Tauri CLI
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tauriCliJs = resolve(__dirname, '..', 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const args = process.argv.slice(2);

const result = spawnSync(process.execPath, [tauriCliJs, ...args], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
