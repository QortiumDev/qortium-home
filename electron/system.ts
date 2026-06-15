import { ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function openPath(value: unknown) {
  const filePath = getString(value);

  if (!filePath) {
    throw new Error('Path is required.');
  }

  if (!existsSync(filePath)) {
    throw new Error('Path was not found.');
  }

  const message = await shell.openPath(filePath);

  if (message) {
    throw new Error(message);
  }
}

function revealPath(value: unknown) {
  const filePath = getString(value);

  if (!filePath) {
    throw new Error('Path is required.');
  }

  if (!existsSync(filePath)) {
    throw new Error('Path was not found.');
  }

  shell.showItemInFolder(filePath);
}

export function registerSystemIpcHandlers() {
  ipcMain.handle('system:openPath', (_event, filePath: unknown) => openPath(filePath));
  ipcMain.handle('system:revealPath', (_event, filePath: unknown) => revealPath(filePath));
}
