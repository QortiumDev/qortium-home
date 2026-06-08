import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceIcon = path.join(repoRoot, 'build/icon-source.png');
const resRoot = path.join(repoRoot, 'android/app/src/main/res');

const densities = [
  { name: 'mdpi', legacySize: 48, foregroundSize: 108 },
  { name: 'hdpi', legacySize: 72, foregroundSize: 162 },
  { name: 'xhdpi', legacySize: 96, foregroundSize: 216 },
  { name: 'xxhdpi', legacySize: 144, foregroundSize: 324 },
  { name: 'xxxhdpi', legacySize: 192, foregroundSize: 432 },
];

// Keep the artwork inside Android's adaptive-icon safe zone with extra room for OEM launcher masks.
const safeZoneScale = 0.56;

function generatePaddedIcon(outputPath, canvasSize) {
  const artworkSize = Math.round(canvasSize * safeZoneScale);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  execFileSync(
    'magick',
    [
      sourceIcon,
      '-background',
      'none',
      '-alpha',
      'on',
      '-trim',
      '+repage',
      '-resize',
      `${artworkSize}x${artworkSize}`,
      '-gravity',
      'center',
      '-background',
      'none',
      '-extent',
      `${canvasSize}x${canvasSize}`,
      outputPath,
    ],
    { stdio: 'inherit' },
  );
}

for (const density of densities) {
  const directory = path.join(resRoot, `mipmap-${density.name}`);

  generatePaddedIcon(path.join(directory, 'ic_launcher_foreground.png'), density.foregroundSize);
  generatePaddedIcon(path.join(directory, 'ic_launcher.png'), density.legacySize);
  generatePaddedIcon(path.join(directory, 'ic_launcher_round.png'), density.legacySize);
}
