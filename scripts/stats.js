import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const targets = [
  path.join(rootDir, 'src', 'assets', 'icon-source.png'),
  path.join(rootDir, 'src', 'assets', 'logo.svg'),
  path.join(rootDir, 'src', 'assets', 'loader.gif'),
  path.join(rootDir, 'src', 'assets', 'loader-dark.gif'),
  path.join(rootDir, 'src', 'assets', 'loader-solid.gif'),
  path.join(rootDir, 'src', 'assets', 'loader-solid-dark.gif'),
];

for (const filePath of targets) {
  const relPath = path.relative(rootDir, filePath);
  if (!fs.existsSync(filePath)) {
    console.log(`${relPath}: missing`);
    continue;
  }

  const stats = fs.statSync(filePath);
  const sizeLabel = formatBytes(stats.size);
  const metadata = await sharp(filePath).metadata().catch(() => null);
  const dims = metadata?.width && metadata?.height ? `${metadata.width}x${metadata.height}` : 'unknown';

  console.log(`${relPath}: ${dims}, ${stats.size} bytes (${sizeLabel})`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}
