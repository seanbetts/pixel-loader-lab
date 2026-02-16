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
  frames: 16,
  ms: 80,
  palette: 32,
  cell: 8,
  transition: 10,
  clearFrames: 8,
  rebuildFrames: 12,
  barDelay: 0.55,
};

const args = parseArgs(process.argv.slice(2));
const options = {
  grid: defaults.grid,
  frames: toInt(args.frames, defaults.frames),
  ms: defaults.ms,
  palette: args.palette === undefined ? defaults.palette : toInt(args.palette, defaults.palette),
  cell: defaults.cell,
  transition: toInt(args.transition, defaults.transition),
  clearFrames: defaults.clearFrames,
  rebuildFrames: defaults.rebuildFrames,
  barDelay: defaults.barDelay,
};

const pngInputPath = path.join(rootDir, 'src', 'assets', 'icon-source.png');
const svgInputPath = path.join(rootDir, 'src', 'assets', 'logo.svg');
const inputPath = fs.existsSync(pngInputPath) ? pngInputPath : svgInputPath;
const outputBorderLight = path.join(rootDir, 'src', 'assets', 'loader.gif');
const outputBorderDark = path.join(rootDir, 'src', 'assets', 'loader-dark.gif');
const outputSolidLight = path.join(rootDir, 'src', 'assets', 'loader-solid.gif');
const outputSolidDark = path.join(rootDir, 'src', 'assets', 'loader-solid-dark.gif');
const outputBorderLightTransition = path.join(rootDir, 'src', 'assets', 'loader-transition.gif');
const outputBorderDarkTransition = path.join(rootDir, 'src', 'assets', 'loader-transition-dark.gif');
const outputSolidLightTransition = path.join(rootDir, 'src', 'assets', 'loader-solid-transition.gif');
const outputSolidDarkTransition = path.join(rootDir, 'src', 'assets', 'loader-solid-transition-dark.gif');
const framesRoot = path.join(rootDir, 'src', 'assets', 'frames');
const tmpDir = path.join(rootDir, '.tmp', 'frames');
const palettePath = path.join(rootDir, '.tmp', 'palette.png');

if (!fs.existsSync(inputPath)) {
  console.error('Missing input icon. Copy your source icon to src/assets/icon-source.png or src/assets/logo.svg');
  process.exit(1);
}

ensureFfmpeg();

const offsets = [0];

const baseBuffer = await sharp(inputPath)
  .resize(options.grid, options.grid, {
    kernel: 'nearest',
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();

const outputSize = options.grid * options.cell;
const originalBuffer = await sharp(inputPath)
  .resize(outputSize, outputSize, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer();
const originalDarkBuffer = await sharp(originalBuffer).negate({ alpha: false }).png().toBuffer();

const borderLight = await renderBordered(baseBuffer, options.grid, options.cell, false);
const borderDark = await renderBordered(baseBuffer, options.grid, options.cell, true);
const solidLight = await renderSolid(baseBuffer, options.grid, options.cell, false);
const solidDark = await renderSolid(baseBuffer, options.grid, options.cell, true);

await prepareFramesDir(tmpDir);
await writeFrames(borderLight, options, offsets, tmpDir);
await buildGif(options, tmpDir, palettePath, outputBorderLight);

await prepareFramesDir(tmpDir);
await writeFrames(borderDark, options, offsets, tmpDir);
await buildGif(options, tmpDir, palettePath, outputBorderDark);

await prepareFramesDir(tmpDir);
await writeFrames(solidLight, options, offsets, tmpDir);
await buildGif(options, tmpDir, palettePath, outputSolidLight);

await prepareFramesDir(tmpDir);
await writeFrames(solidDark, options, offsets, tmpDir);
await buildGif(options, tmpDir, palettePath, outputSolidDark);

if (options.transition > 0) {
  const totalFrames = totalLoopFrames(options);

  await prepareFramesDir(tmpDir);
  await writeBreakingTransitionFrames(originalBuffer, borderLight, baseBuffer, options, tmpDir);
  await buildGif({ ...options, frames: totalFrames }, tmpDir, palettePath, outputBorderLightTransition);
  await exportFrames(tmpDir, path.join(framesRoot, 'border-light'), totalFrames, options);

  await prepareFramesDir(tmpDir);
  await writeBreakingTransitionFrames(originalDarkBuffer, borderDark, baseBuffer, options, tmpDir);
  await buildGif({ ...options, frames: totalFrames }, tmpDir, palettePath, outputBorderDarkTransition);
  await exportFrames(tmpDir, path.join(framesRoot, 'border-dark'), totalFrames, options);

  await prepareFramesDir(tmpDir);
  await writeBreakingTransitionFrames(originalBuffer, solidLight, baseBuffer, options, tmpDir);
  await buildGif({ ...options, frames: totalFrames }, tmpDir, palettePath, outputSolidLightTransition);
  await exportFrames(tmpDir, path.join(framesRoot, 'solid-light'), totalFrames, options);

  await prepareFramesDir(tmpDir);
  await writeBreakingTransitionFrames(originalDarkBuffer, solidDark, baseBuffer, options, tmpDir);
  await buildGif({ ...options, frames: totalFrames }, tmpDir, palettePath, outputSolidDarkTransition);
  await exportFrames(tmpDir, path.join(framesRoot, 'solid-dark'), totalFrames, options);
}

console.log(
  `Generated loader variants (${options.frames} frames @ ${options.ms}ms):\n` +
    `- ${path.relative(rootDir, outputBorderLight)}\n` +
    `- ${path.relative(rootDir, outputBorderDark)}\n` +
    `- ${path.relative(rootDir, outputSolidLight)}\n` +
    `- ${path.relative(rootDir, outputSolidDark)}\n` +
    `Transition frames: ${options.transition}`
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

function totalLoopFrames(opts) {
  const originalHoldFrames = 10;
  return (
    originalHoldFrames +
    opts.transition +
    opts.clearFrames +
    opts.rebuildFrames +
    opts.frames
  );
}

async function prepareFramesDir(framesDir) {
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
}

async function exportFrames(framesDir, outDir, frameCount, options) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (let i = 0; i < frameCount; i += 1) {
    const name = `frame-${String(i).padStart(3, '0')}.png`;
    fs.copyFileSync(path.join(framesDir, name), path.join(outDir, name));
  }

  const manifest = {
    frames: frameCount,
    ms: options.ms,
    width: options.grid * options.cell,
    height: options.grid * options.cell,
  };

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
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

async function writeBreakingTransitionFrames(originalBuffer, pixelBuffer, baseBuffer, options, framesDir) {
  const outputSize = options.grid * options.cell;
  const originalHoldFrames = 10;
  const overlapFrames = 2;
  const transitionFrames = Math.max(1, options.transition);
  const clearFrames = Math.max(1, options.clearFrames);
  const rebuildFrames = Math.max(1, options.rebuildFrames);
  const totalFrames = totalLoopFrames(options);

  const pixelData = await sharp(pixelBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const maskData = await sharp(baseBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = buildMask(maskData, options.grid);
  const angleMap = buildAngleMap(options.grid);
  const barColumns = detectBarColumns(mask, options.grid);

  for (let i = 0; i < totalFrames; i += 1) {
    const framePath = path.join(framesDir, `frame-${String(i).padStart(3, '0')}.png`);

    const breakStart = Math.max(0, originalHoldFrames - overlapFrames);
    const breakEnd = breakStart + transitionFrames;
    const clearStart = breakEnd;
    const clearEnd = clearStart + clearFrames;
    const rebuildStart = clearEnd;
    const rebuildEnd = rebuildStart + rebuildFrames;
    const step = 3 / options.grid;

    if (i < breakStart) {
      await sharp(originalBuffer).png().toFile(framePath);
      continue;
    }

    if (i < breakEnd) {
      const progress = (i - breakStart) / Math.max(1, transitionFrames - 1);
      const breakingFrame = await buildBreakingFrame(pixelData, options, progress);
      if (i < originalHoldFrames) {
        await sharp({
          create: {
            width: outputSize,
            height: outputSize,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .composite([
            { input: originalBuffer, blend: 'over', opacity: 1 },
            { input: breakingFrame, blend: 'over', opacity: 1 },
          ])
          .png()
          .toFile(framePath);
      } else {
        await sharp(breakingFrame).png().toFile(framePath);
      }
      continue;
    }

    if (i < clearEnd) {
      const progress = Math.min(1, (i - clearStart + 1) * step);
      const frame = await renderLoadingFrame(pixelData, mask, angleMap, barColumns, options, {
        phase: 'clear',
        progress,
      });
      await sharp(frame).png().toFile(framePath);
      continue;
    }

    if (i < rebuildEnd) {
      const progress = Math.min(1, (i - rebuildStart + 1) * step);
      const frame = await renderLoadingFrame(pixelData, mask, angleMap, barColumns, options, {
        phase: 'rebuild',
        progress,
      });
      await sharp(frame).png().toFile(framePath);
      continue;
    }

    await sharp(pixelBuffer).png().toFile(framePath);
  }
}

function buildMask(maskData, gridSize) {
  const { data, info } = maskData;
  const mask = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const idx = (y * info.width + x) * 4;
      const a = data[idx + 3];
      mask[y][x] = a > 0;
    }
  }
  return mask;
}

function buildAngleMap(gridSize) {
  const cx = (gridSize - 1) / 2;
  const cy = (gridSize - 1) / 2;
  const startAngle = (-3 * Math.PI) / 4; // top-left
  const map = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const angle = Math.atan2(dy, dx);
      let delta = angle - startAngle;
      if (delta < 0) delta += Math.PI * 2;
      map[y][x] = delta / (Math.PI * 2);
    }
  }

  return map;
}

function detectBarColumns(mask, gridSize) {
  const start = Math.floor(gridSize * 0.35);
  const end = Math.ceil(gridSize * 0.65);
  let bestCol = Math.floor(gridSize / 2);
  let bestCount = -1;

  for (let x = start; x <= end; x += 1) {
    let count = 0;
    for (let y = 0; y < gridSize; y += 1) {
      if (mask[y][x]) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      bestCol = x;
    }
  }

  const columns = new Set([bestCol, bestCol - 1, bestCol + 1].filter((x) => x >= 0 && x < gridSize));
  return columns;
}

async function renderLoadingFrame(pixelData, mask, angleMap, barColumns, options, { phase, progress }) {
  const { data, info } = pixelData;
  const out = new Uint8ClampedArray(info.width * info.height * 4);
  const gridSize = options.grid;
  const cell = options.cell;

  const barDelay = options.barDelay;
  const barProgress = clamp((progress - barDelay) / (1 - barDelay), 0, 1);
  const barThreshold = gridSize - 1 - Math.floor(barProgress * (gridSize - 1));

  for (let y = 0; y < gridSize; y += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      if (!mask[y][x]) continue;

      const angle = angleMap[y][x];
      let visible = false;

      if (phase === 'clear') {
        visible = angle >= progress;
      } else {
        visible = angle <= progress;
      }

      if (phase === 'rebuild' && barColumns.has(x)) {
        visible = barProgress > 0 && y >= barThreshold;
      }

      if (!visible) continue;

      const srcX = x * cell;
      const srcY = y * cell;

      for (let cy = 0; cy < cell; cy += 1) {
        for (let cx = 0; cx < cell; cx += 1) {
          const sx = srcX + cx;
          const sy = srcY + cy;
          const sIdx = (sy * info.width + sx) * 4;
          const dIdx = sIdx;

          if (data[sIdx + 3] === 0) continue;

          out[dIdx] = data[sIdx];
          out[dIdx + 1] = data[sIdx + 1];
          out[dIdx + 2] = data[sIdx + 2];
          out[dIdx + 3] = data[sIdx + 3];
        }
      }
    }
  }

  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function buildBreakingFrame(pixelData, options, progress) {
  const { data, info } = pixelData;
  const outSize = options.grid * options.cell;
  const out = new Uint8ClampedArray(outSize * outSize * 4);
  const jitterScale = (1 - progress) * options.cell * 1.4;
  const reveal = progress;

  for (let y = 0; y < options.grid; y += 1) {
    for (let x = 0; x < options.grid; x += 1) {
      const threshold = hash01(x, y);
      if (reveal < threshold) continue;

      const jitterX = Math.round((hash01(x + 17, y + 29) * 2 - 1) * jitterScale);
      const jitterY = Math.round((hash01(x + 41, y + 11) * 2 - 1) * jitterScale);

      const srcX = x * options.cell;
      const srcY = y * options.cell;
      const destX = clamp(srcX + jitterX, 0, outSize - options.cell);
      const destY = clamp(srcY + jitterY, 0, outSize - options.cell);

      for (let cy = 0; cy < options.cell; cy += 1) {
        for (let cx = 0; cx < options.cell; cx += 1) {
          const sx = srcX + cx;
          const sy = srcY + cy;
          const dx = destX + cx;
          const dy = destY + cy;

          const sIdx = (sy * info.width + sx) * 4;
          const dIdx = (dy * outSize + dx) * 4;

          const alpha = data[sIdx + 3];
          if (alpha === 0) continue;

          out[dIdx] = data[sIdx];
          out[dIdx + 1] = data[sIdx + 1];
          out[dIdx + 2] = data[sIdx + 2];
          out[dIdx + 3] = alpha;
        }
      }
    }
  }

  return sharp(out, { raw: { width: outSize, height: outSize, channels: 4 } })
    .png()
    .toBuffer();
}

function hash01(x, y) {
  const seed = (x + 1) * 374761393 + (y + 1) * 668265263;
  const mangled = (seed ^ (seed >> 13)) * 1274126177;
  return ((mangled ^ (mangled >> 16)) >>> 0) / 4294967295;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

async function renderBordered(buffer, gridSize, cellSize, invertFill) {
  return renderPixels(buffer, gridSize, cellSize, { invertFill, borderAlpha: 0, binary: true });
}

async function renderSolid(buffer, gridSize, cellSize, invertFill) {
  return renderPixels(buffer, gridSize, cellSize, { invertFill, borderAlpha: null, binary: true });
}

async function renderPixels(buffer, gridSize, cellSize, options) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const outSize = gridSize * cellSize;
  const out = new Uint8ClampedArray(outSize * outSize * 4);
  const alphaThreshold = 128;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const idx = (y * info.width + x) * 4;
      let r = data[idx];
      let g = data[idx + 1];
      let b = data[idx + 2];
      const a = data[idx + 3];
      if (a < alphaThreshold) continue;

      if (options.binary) {
        const v = options.invertFill ? 255 : 0;
        r = v;
        g = v;
        b = v;
      } else if (options.invertFill) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      const alphaOut = 255;

      for (let cy = 0; cy < cellSize; cy += 1) {
        for (let cx = 0; cx < cellSize; cx += 1) {
          const isBorder = cx === 0 || cy === 0 || cx === cellSize - 1 || cy === cellSize - 1;
          const or = r;
          const og = g;
          const ob = b;
          const oa = options.borderAlpha === null || !isBorder ? alphaOut : options.borderAlpha;

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

  return sharp(out, { raw: { width: outSize, height: outSize, channels: 4 } })
    .png()
    .toBuffer();
}
