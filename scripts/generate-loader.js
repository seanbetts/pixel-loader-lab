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
  cell: 8,
};

const args = parseArgs(process.argv.slice(2));
const options = {
  grid: toInt(args.grid, defaults.grid),
  frames: toInt(args.frames, defaults.frames),
  ms: toInt(args.ms, defaults.ms),
  palette: args.palette === undefined ? defaults.palette : toInt(args.palette, defaults.palette),
  cell: toInt(args.cell, defaults.cell),
};

const pngInputPath = path.join(rootDir, 'src', 'assets', 'icon-source.png');
const svgInputPath = path.join(rootDir, 'src', 'assets', 'logo.svg');
const inputPath = fs.existsSync(pngInputPath) ? pngInputPath : svgInputPath;
const outputPath = path.join(rootDir, 'src', 'assets', 'loader.gif');
const outputDarkPath = path.join(rootDir, 'src', 'assets', 'loader-dark.gif');
const tmpDir = path.join(rootDir, '.tmp', 'frames');
const palettePath = path.join(rootDir, '.tmp', 'palette.png');

if (!fs.existsSync(inputPath)) {
  console.error('Missing input icon. Copy your source icon to src/assets/icon-source.png or src/assets/logo.svg');
  process.exit(1);
}

ensureFfmpeg();

fs.rmSync(tmpDir, { recursive: true, force: true });
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

const pixelatedLight = await renderPixelGrid(baseBuffer, options.grid, options.cell, false);
const pixelatedDark = await renderPixelGrid(baseBuffer, options.grid, options.cell, true);

await writeFrames(pixelatedLight, options, offsets, tmpDir);
await buildGif(options, tmpDir, palettePath, outputPath);

await writeFrames(pixelatedDark, options, offsets, tmpDir);
await buildGif(options, tmpDir, palettePath, outputDarkPath);

console.log(
  `Generated ${path.relative(rootDir, outputPath)} and ${path.relative(rootDir, outputDarkPath)} ` +
    `(${options.frames} frames @ ${options.ms}ms)`
);

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

async function writeFrames(buffer, options, offsets, framesDir) {
  const outputSize = options.grid * options.cell;
  for (let i = 0; i < options.frames; i += 1) {
    const offset = offsets[i % offsets.length];
    const framePath = path.join(framesDir, `frame-${String(i).padStart(3, '0')}.png`);
    const canvas = sharp({
      create: {
        width: outputSize,
        height: outputSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    const top = offset * options.cell;
    const left = 0;

    await canvas
      .composite([{ input: buffer, top, left }])
      .png()
      .toFile(framePath);
  }
}

async function buildGif(options, framesDir, palettePath, outputPath) {
  const frameRate = 1000 / options.ms;
  const frameInput = path.join(framesDir, 'frame-%03d.png');

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
      '-update',
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
}

async function renderPixelGrid(buffer, gridSize, cellSize, invertFill) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const outSize = gridSize * cellSize;
  const out = new Uint8ClampedArray(outSize * outSize * 4);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const idx = (y * info.width + x) * 4;
      let r = data[idx];
      let g = data[idx + 1];
      let b = data[idx + 2];
      const a = data[idx + 3];
      if (a === 0) continue;

      if (invertFill) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      for (let cy = 0; cy < cellSize; cy += 1) {
        for (let cx = 0; cx < cellSize; cx += 1) {
          const isBorder = cx === 0 || cy === 0 || cx === cellSize - 1 || cy === cellSize - 1;
          const or = r;
          const og = g;
          const ob = b;
          const oa = isBorder ? 0 : a;

          const ox = x * cellSize + cx;
          const oy = y * cellSize + cy;
          const oidx = (oy * outSize + ox) * 4;
          out[oidx] = or;
          out[oidx + 1] = og;
          out[oidx + 2] = ob;
          out[oidx + 3] = oa;
        }
      }
    }
  }

  return sharp(out, { raw: { width: outSize, height: outSize, channels: 4 } }).png().toBuffer();
}
