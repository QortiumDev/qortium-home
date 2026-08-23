#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'electron.cmd' : 'electron';
const result = spawnSync(command, ['.'], {
  env: {
    ...process.env,
    QORTIUM_HOME_LOAD_DIST: '1',
  },
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
