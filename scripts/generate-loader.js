import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const defaults = {
  grid: 32,
  frames: 8,
  ms: 120,
  palette: 32,
};

const args = parseArgs(process.argv.slice(2));
const options = {
  grid: toInt(args.grid, defaults.grid),
  frames: toInt(args.frames, defaults.frames),
  ms: toInt(args.ms, defaults.ms),
  palette: args.palette === undefined ? defaults.palette : toInt(args.palette, defaults.palette),
};

const pngInputPath = path.join(rootDir, 'src', 'assets', 'icon-source.png');
const svgInputPath = path.join(rootDir, 'src', 'assets', 'logo.svg');
const inputPath = fs.existsSync(pngInputPath) ? pngInputPath : svgInputPath;
const outputPath = path.join(rootDir, 'src', 'assets', 'loader.gif');
const tmpDir = path.join(rootDir, '.tmp', 'frames');
const palettePath = path.join(rootDir, '.tmp', 'palette.png');

if (!fs.existsSync(inputPath)) {
  console.error('Missing input icon. Copy your source icon to src/assets/icon-source.png or src/assets/logo.svg');
  process.exit(1);
}

ensureFfmpeg();

fs.mkdirSync(tmpDir, { recursive: true });

const offsets = [0, 1, 2, 2, 1, 0, -1, -1];

const baseBuffer = await sharp(inputPath)
  .resize(options.grid, options.grid, {
    kernel: 'nearest',
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

for (let i = 0; i < options.frames; i += 1) {
  const offset = offsets[i % offsets.length];
  const framePath = path.join(tmpDir, `frame-${String(i).padStart(3, '0')}.png`);
  const canvas = sharp({
    create: {
      width: options.grid,
      height: options.grid,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  const top = Math.max(0, offset);
  const left = 0;

  await canvas
    .composite([{ input: baseBuffer, top, left }])
    .png()
    .toFile(framePath);
}

const frameRate = 1000 / options.ms;
const frameInput = path.join(tmpDir, 'frame-%03d.png');

if (options.palette && options.palette > 0) {
  runCommand('ffmpeg', [
    '-y',
    '-framerate',
    `${frameRate}`,
    '-i',
    frameInput,
    '-vf',
    `palettegen=max_colors=${options.palette}`,
    '-frames:v',
    '1',
    palettePath,
  ]);

  runCommand('ffmpeg', [
    '-y',
    '-framerate',
    `${frameRate}`,
    '-i',
    frameInput,
    '-i',
    palettePath,
    '-lavfi',
    'paletteuse=dither=none',
    '-loop',
    '0',
    outputPath,
  ]);
} else {
  runCommand('ffmpeg', [
    '-y',
    '-framerate',
    `${frameRate}`,
    '-i',
    frameInput,
    '-loop',
    '0',
    outputPath,
  ]);
}

console.log(`Generated ${path.relative(rootDir, outputPath)} (${options.frames} frames @ ${options.ms}ms)`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureFfmpeg() {
  const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    console.error('ffmpeg is required to build the GIF. Install it on macOS with:');
    console.error('  brew install ffmpeg');
    process.exit(1);
  }
}

function runCommand(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to run ${cmd}:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
