import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const [testPath] = process.argv.slice(2)
if (!testPath) throw new Error('Usage: node scripts/run-electron-test.mjs <test.js>')

const repoRoot = path.resolve(import.meta.dirname, '..')
const distribution = path.join(repoRoot, 'node_modules', 'electron', 'dist')
const binary = process.platform === 'win32'
  ? path.join(distribution, 'electron.exe')
  : process.platform === 'darwin'
    ? path.join(distribution, 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(distribution, 'electron')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
environment.QORTIUM_HOME_ELECTRON_TEST_ENTRY = path.resolve(repoRoot, testPath)
const useXvfb = process.platform === 'linux' && !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
const main = path.join(repoRoot, 'scripts', 'run-electron-test-main.cjs')
const result = spawnSync(
  useXvfb ? '/usr/bin/xvfb-run' : binary,
  useXvfb ? ['-a', binary, main] : [main],
  { cwd: repoRoot, env: environment, stdio: 'inherit', timeout: 120_000 },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
