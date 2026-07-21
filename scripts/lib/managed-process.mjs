// Shared child-process management for the desktop smoke scripts.
//
// These scripts launch Electron through /usr/bin/xvfb-run, which is a shell
// wrapper: it starts an Xvfb server, execs the real command underneath, and
// tears the server down when that command exits. Sending SIGTERM to the spawned
// child therefore kills only the wrapper, orphaning both the Xvfb server and
// the Electron/Chromium tree it started. Those orphans keep running until the
// machine is rebooted -- a single interrupted run can leave dozens of processes
// and several GB of RSS behind.
//
// Two changes prevent that:
//
//   1. Children are spawned with detached:true so each becomes a process-group
//      leader, and stop() signals the whole group via process.kill(-pid).
//   2. Every live child is tracked, and SIGINT/SIGTERM/SIGHUP/exit handlers
//      kill the survivors. Without these a Ctrl-C or a harness timeout skips
//      the script's own finally blocks entirely and cleans up nothing.

import { spawn } from 'node:child_process';

const liveProcesses = new Set();
let signalHandlersInstalled = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function killProcessTree(child, signal) {
  if (hasExited(child) || typeof child.pid !== 'number') {
    return;
  }

  try {
    // Negative PID targets the process group, which detached:true established.
    process.kill(-child.pid, signal);
  } catch {
    // The group may already be gone, or the spawn may not have been detached
    // (some platforms ignore the flag). Fall back to the single process.
    try {
      child.kill(signal);
    } catch {
      // Already reaped; nothing to do.
    }
  }
}

function installSignalHandlers() {
  if (signalHandlersInstalled) {
    return;
  }

  signalHandlersInstalled = true;

  // Synchronous, because an 'exit' handler cannot await anything.
  const killAll = () => {
    for (const child of liveProcesses) {
      killProcessTree(child, 'SIGKILL');
    }
    liveProcesses.clear();
  };

  process.on('exit', killAll);

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      killAll();
      process.exit(1);
    });
  }
}

export function createManagedProcess(command, args, options = {}) {
  installSignalHandlers();

  const output = [];
  let stopped = false;
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  liveProcesses.add(child);

  child.stdout?.on('data', (chunk) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk) => output.push(String(chunk)));

  child.once('exit', (code, signal) => {
    liveProcesses.delete(child);

    if (!options.allowExit && !stopped) {
      output.push(`\nProcess exited with code=${code} signal=${signal}\n`);
    }
  });

  return {
    child,
    output,
    stop: async () => {
      if (hasExited(child)) {
        liveProcesses.delete(child);
        return;
      }

      stopped = true;
      killProcessTree(child, 'SIGTERM');
      await delay(500);

      if (!hasExited(child)) {
        killProcessTree(child, 'SIGKILL');
      }

      liveProcesses.delete(child);
    },
    wasStopped: () => stopped,
  };
}
