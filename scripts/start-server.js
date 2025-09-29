#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const isTestEnv = process.env.NODE_ENV === 'test';
const serverEntry = path.join(__dirname, '..', 'src', 'server.ts');
const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
if (isTestEnv) {
  const fs = require('node:fs');
  const esbuild = require('esbuild');
  const outFile = path.join(__dirname, '..', 'dist', 'server.bundle.cjs');

  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  esbuild.buildSync({
    entryPoints: [serverEntry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: outFile,
    sourcemap: false,
    tsconfig: path.join(__dirname, '..', 'tsconfig.json'),
    logLevel: 'error',
    external: ['node-fetch'],
  });

  const runtime = spawn(process.execPath, [outFile], {
    stdio: 'inherit',
    env: process.env,
  });

  runtime.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  runtime.on('error', (error) => {
    console.error('[server:start] Failed to launch compiled server:', error);
    process.exit(1);
  });
} else {
  const child = spawn(executable, ['tsx', 'watch', serverEntry], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('[server:start] Failed to launch dev server:', error);
    process.exit(1);
  });
}
