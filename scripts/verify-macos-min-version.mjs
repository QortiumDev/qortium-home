#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_MAGIC = 0xfeedface;
const MH_CIGAM = 0xcefaedfe;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const LC_VERSION_MIN_MACOSX = 0x24;
const LC_BUILD_VERSION = 0x32;
const CPU_TYPES = new Map([
  [0x01000007, 'x86_64'],
  [0x0100000c, 'arm64'],
]);

function printHelp() {
  console.log(`Usage: node scripts/verify-macos-min-version.mjs <app-or-binary-path> <max-version>

Examples:
  node scripts/verify-macos-min-version.mjs "dist-release/mac-universal/Qortium Home.app" 11.0.0
  node scripts/verify-macos-min-version.mjs "Qortium Home.app/Contents/MacOS/Qortium Home" 11.0.0`);
}

function readUInt32(buffer, offset, littleEndian) {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function versionNumberToParts(version) {
  const parts = String(version)
    .split('.')
    .map((part) => Number.parseInt(part, 10));

  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid macOS version '${version}'. Use a numeric version like 11.0.0.`);
  }

  while (parts.length < 3) {
    parts.push(0);
  }

  return parts;
}

function encodedVersionToParts(version) {
  return [(version >>> 16) & 0xffff, (version >>> 8) & 0xff, version & 0xff];
}

function formatVersion(parts) {
  const trimmed = [...parts];

  while (trimmed.length > 1 && trimmed.at(-1) === 0) {
    trimmed.pop();
  }

  return trimmed.join('.');
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

function cpuTypeName(cpuType) {
  return CPU_TYPES.get(cpuType) ?? `cpu-${cpuType.toString(16)}`;
}

function parseMachO(buffer, offset, file, arch) {
  const magicLe = buffer.readUInt32LE(offset);
  const magicBe = buffer.readUInt32BE(offset);
  const is64 = magicLe === MH_MAGIC_64 || magicLe === MH_CIGAM_64 || magicBe === MH_MAGIC_64 || magicBe === MH_CIGAM_64;
  const is32 = magicLe === MH_MAGIC || magicLe === MH_CIGAM || magicBe === MH_MAGIC || magicBe === MH_CIGAM;

  if (!is64 && !is32) {
    return [];
  }

  const littleEndian = magicLe === MH_MAGIC || magicLe === MH_MAGIC_64;
  const headerSize = is64 ? 32 : 28;
  const ncmds = readUInt32(buffer, offset + 16, littleEndian);
  let commandOffset = offset + headerSize;
  const results = [];

  for (let index = 0; index < ncmds; index += 1) {
    if (commandOffset + 8 > buffer.length) {
      throw new Error(`${file} (${arch}) has a truncated Mach-O load command table.`);
    }

    const command = readUInt32(buffer, commandOffset, littleEndian);
    const commandSize = readUInt32(buffer, commandOffset + 4, littleEndian);

    if (commandSize < 8 || commandOffset + commandSize > buffer.length) {
      throw new Error(`${file} (${arch}) has an invalid Mach-O load command size.`);
    }

    if (command === LC_BUILD_VERSION && commandSize >= 24) {
      results.push({
        arch,
        file,
        source: 'LC_BUILD_VERSION',
        version: encodedVersionToParts(readUInt32(buffer, commandOffset + 12, littleEndian)),
      });
    } else if (command === LC_VERSION_MIN_MACOSX && commandSize >= 16) {
      results.push({
        arch,
        file,
        source: 'LC_VERSION_MIN_MACOSX',
        version: encodedVersionToParts(readUInt32(buffer, commandOffset + 8, littleEndian)),
      });
    }

    commandOffset += commandSize;
  }

  return results;
}

function parseFile(file) {
  const buffer = readFileSync(file);

  if (buffer.length < 4) {
    return [];
  }

  const fatMagic = buffer.readUInt32BE(0);

  if (fatMagic === FAT_MAGIC || fatMagic === FAT_MAGIC_64) {
    const isFat64 = fatMagic === FAT_MAGIC_64;
    const architectureCount = buffer.readUInt32BE(4);
    const stride = isFat64 ? 32 : 20;

    if (architectureCount < 1 || architectureCount > 32 || 8 + architectureCount * stride > buffer.length) {
      return [];
    }

    const results = [];

    for (let index = 0; index < architectureCount; index += 1) {
      const archOffset = 8 + index * stride;
      const cpuType = buffer.readUInt32BE(archOffset);
      const sliceOffset = isFat64 ? Number(buffer.readBigUInt64BE(archOffset + 8)) : buffer.readUInt32BE(archOffset + 8);

      if (sliceOffset < 0 || sliceOffset >= buffer.length) {
        return [];
      }

      results.push(...parseMachO(buffer, sliceOffset, file, cpuTypeName(cpuType)));
    }

    return results;
  }

  return parseMachO(buffer, 0, file, 'thin');
}

function collectFiles(entry) {
  const stats = statSync(entry);

  if (stats.isFile()) {
    return [entry];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const files = [];
  const pending = [entry];

  while (pending.length > 0) {
    const current = pending.pop();

    for (const child of readdirSync(current, { withFileTypes: true })) {
      const childPath = path.join(current, child.name);

      if (child.isDirectory()) {
        pending.push(childPath);
      } else if (child.isFile()) {
        files.push(childPath);
      }
    }
  }

  return files;
}

function main() {
  const [inputPath, maxVersion] = process.argv.slice(2);

  if (!inputPath || !maxVersion || inputPath === '--help' || inputPath === '-h') {
    printHelp();
    process.exit(inputPath ? 0 : 1);
  }

  const maxParts = versionNumberToParts(maxVersion);
  const files = collectFiles(path.resolve(inputPath));
  const machVersions = files.flatMap((file) => parseFile(file));

  if (machVersions.length === 0) {
    throw new Error(`No Mach-O minimum-version load commands found under ${inputPath}.`);
  }

  const violations = machVersions.filter((entry) => compareVersions(entry.version, maxParts) > 0);

  if (violations.length > 0) {
    const details = violations
      .map(
        (entry) =>
          `- ${path.relative(process.cwd(), entry.file)} [${entry.arch}] ${entry.source} requires macOS ${formatVersion(entry.version)}`,
      )
      .join('\n');

    throw new Error(`Found Mach-O binaries newer than macOS ${formatVersion(maxParts)}:\n${details}`);
  }

  console.log(`Verified ${machVersions.length} Mach-O minimum-version load commands at macOS ${formatVersion(maxParts)} or older.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
