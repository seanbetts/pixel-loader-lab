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
  ms: 40,
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

const iconMask24 = [
  '..####################..',
  '.######################.',
  '########################',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '###....##............###',
  '########################',
  '.######################.',
  '..####################..',
];

const useIconMask = true;

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
const SPEED_MULT = 2;
const SLOW_LOADING_FRAMES = 0;
const TRANSITION_HOLD_FRAMES = 22;

const customLoadingFrames24 = buildCustomLoadingFrames24();
const expandedLoadingFrames24 = expandLoadingFrames(customLoadingFrames24, SLOW_LOADING_FRAMES, SPEED_MULT);

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

const borderLight = useIconMask
  ? await renderMaskBuffer(iconMask24, options.grid, options.cell, false, 0)
  : await renderBordered(baseBuffer, options.grid, options.cell, false);
const borderDark = useIconMask
  ? await renderMaskBuffer(iconMask24, options.grid, options.cell, true, 0)
  : await renderBordered(baseBuffer, options.grid, options.cell, true);
const solidLight = useIconMask
  ? await renderMaskBuffer(iconMask24, options.grid, options.cell, false, null)
  : await renderSolid(baseBuffer, options.grid, options.cell, false);
const solidDark = useIconMask
  ? await renderMaskBuffer(iconMask24, options.grid, options.cell, true, null)
  : await renderSolid(baseBuffer, options.grid, options.cell, true);

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
  const totalFrames = totalLoopFrames(options, expandedLoadingFrames24.length, SPEED_MULT);

  await prepareFramesDir(tmpDir);
  await writeBreakingTransitionFrames(
    originalBuffer,
    borderLight,
    baseBuffer,
    options,
    tmpDir,
    expandedLoadingFrames24,
    SPEED_MULT
  );
  await buildGif({ ...options, frames: totalFrames }, tmpDir, palettePath, outputBorderLightTransition);
  await exportFrames(tmpDir, path.join(framesRoot, 'border-light'), totalFrames, options);

  await prepareFramesDir(tmpDir);
  await writeBreakingTransitionFrames(
    originalDarkBuffer,
    borderDark,
    baseBuffer,
    options,
    tmpDir,
    expandedLoadingFrames24,
    SPEED_MULT
  );
  await buildGif({ ...options, frames: totalFrames }, tmpDir, palettePath, outputBorderDarkTransition);
  await exportFrames(tmpDir, path.join(framesRoot, 'border-dark'), totalFrames, options);

  await prepareFramesDir(tmpDir);
  await writeBreakingTransitionFrames(
    originalBuffer,
    solidLight,
    baseBuffer,
    options,
    tmpDir,
    expandedLoadingFrames24,
    SPEED_MULT
  );
  await buildGif({ ...options, frames: totalFrames }, tmpDir, palettePath, outputSolidLightTransition);
  await exportFrames(tmpDir, path.join(framesRoot, 'solid-light'), totalFrames, options);

  await prepareFramesDir(tmpDir);
  await writeBreakingTransitionFrames(
    originalDarkBuffer,
    solidDark,
    baseBuffer,
    options,
    tmpDir,
    expandedLoadingFrames24,
    SPEED_MULT
  );
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

function expandLoadingFrames(frames, slowCount, multiplier) {
  if (multiplier <= 1) return frames;
  const out = [];
  const cutoff = Math.min(slowCount, frames.length);
  for (let i = 0; i < frames.length; i += 1) {
    const repeat = i < cutoff ? multiplier : 1;
    for (let r = 0; r < repeat; r += 1) {
      out.push(frames[i]);
    }
  }
  return out;
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

function totalLoopFrames(opts, loadingFrames, speedMult = 1) {
  const originalHoldFrames = 10 * speedMult;
  const transitionFrames = Math.max(1, opts.transition) * speedMult;
  return originalHoldFrames + transitionFrames + TRANSITION_HOLD_FRAMES + loadingFrames + opts.frames;
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

async function writeBreakingTransitionFrames(
  originalBuffer,
  pixelBuffer,
  baseBuffer,
  options,
  framesDir,
  customFrames24,
  speedMult = 1
) {
  const outputSize = options.grid * options.cell;
  const originalHoldFrames = 10 * speedMult;
  const overlapFrames = 2 * speedMult;
  const transitionFrames = Math.max(1, options.transition) * speedMult;
  const idleFrames = Math.max(1, options.frames);
  const totalFrames = totalLoopFrames(options, customFrames24.length, speedMult);
  const transitionHoldFrames = TRANSITION_HOLD_FRAMES;

  const pixelData = await sharp(pixelBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const finalBreakingFrame =
    transitionHoldFrames > 0 ? await buildBreakingFrame(pixelData, options, 1) : null;

  for (let i = 0; i < totalFrames; i += 1) {
    const framePath = path.join(framesDir, `frame-${String(i).padStart(3, '0')}.png`);

    const breakStart = Math.max(0, originalHoldFrames - overlapFrames);
    const breakEnd = breakStart + transitionFrames;
    const holdEnd = breakEnd + transitionHoldFrames;
    const loadingStart = holdEnd;
    const loadingEnd = loadingStart + customFrames24.length;

    if (i < breakStart) {
      await sharp(originalBuffer).png().toFile(framePath);
      continue;
    }

    if (i < breakEnd) {
      const baseIndex = Math.floor((i - breakStart) / Math.max(1, speedMult));
      const progress = baseIndex / Math.max(1, Math.max(1, options.transition) - 1);
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

    if (i < holdEnd) {
      if (finalBreakingFrame) {
        await sharp(finalBreakingFrame).png().toFile(framePath);
      } else {
        await sharp(pixelBuffer).png().toFile(framePath);
      }
      continue;
    }

    if (i < loadingEnd) {
      const frameIndex = i - loadingStart;
      const mask24 = customFrames24[frameIndex];
      const frame = await renderCustomMaskFrame(pixelData, mask24, options);
      await sharp(frame).png().toFile(framePath);
      continue;
    }

    await sharp(pixelBuffer).png().toFile(framePath);
  }
}

function buildCustomLoadingFrames24() {
  const buildFrames = [];
  const size = 24;
  const visibilityMask = iconMask24;

  for (let k = 1; k <= 20; k += 1) {
    const row1 = '..' + '#'.repeat(k) + '.'.repeat(size - 2 - k);
    const row2 = '.' + '#'.repeat(k) + '.'.repeat(size - 1 - k);
    const row3 = '#'.repeat(k) + '.'.repeat(size - k);
    const rest = Array.from({ length: size - 3 }, () => '.'.repeat(size));
    buildFrames.push([row1, row2, row3, ...rest]);
  }

  const grid = gridFromMask(buildFrames[buildFrames.length - 1]);

  // Complete the top edge with the same 3-pixel diagonal head.
  for (const x of [22, 23]) {
    setIfInBounds(grid, x, 0, '#');
    setIfInBounds(grid, x - 1, 1, '#');
    setIfInBounds(grid, x - 2, 2, '#');
    // Keep the 3px diagonal thickness at the top-right corner.
    if (x === 23) {
      setIfInBounds(grid, x - 1, 2, '#');
    }
    pushIfChanged(buildFrames, maskFromGrid(grid), visibilityMask);
  }

  // Turn the diagonal down the right edge (first steps).
  for (const y of [1, 2, 3]) {
    setIfInBounds(grid, size - 1, y, '#');
    setIfInBounds(grid, size - 2, y - 1, '#');
    setIfInBounds(grid, size - 3, y - 2, '#');
    pushIfChanged(buildFrames, maskFromGrid(grid), visibilityMask);
  }

  // Continue 3-pixel diagonal down the right edge.
  for (let y = 0; y < size; y += 1) {
    setIfInBounds(grid, size - 1, y, '#');
    setIfInBounds(grid, size - 2, y - 1, '#');
    setIfInBounds(grid, size - 3, y - 2, '#');
    pushIfChanged(buildFrames, maskFromGrid(grid), visibilityMask);
  }

  // Continue 3-pixel diagonal across the bottom edge, right to left.
  let startX = size - 1;
  for (let x = size - 1; x >= 0; x -= 1) {
    if (grid[size - 1][x] === '#') {
      startX = x - 1;
    } else {
      break;
    }
  }
  for (let x = startX; x >= 0; x -= 1) {
    setIfInBounds(grid, x, size - 1, '#');
    setIfInBounds(grid, x + 1, size - 2, '#');
    setIfInBounds(grid, x + 2, size - 3, '#');

    // Seed the inner diagonal pixels at the bottom-right corner.
    if (x === startX - 1) {
      setIfInBounds(grid, x - 1, size - 1, '#');
      setIfInBounds(grid, x, size - 2, '#');
    }

    pushIfChanged(buildFrames, maskFromGrid(grid), visibilityMask);
  }

  // Sweep up the left edge and build the center bar bottom-up.
  const centerSegment = findCenterSegment(visibilityMask);
  const centerCols = centerSegment
    ? Array.from({ length: centerSegment.end - centerSegment.start + 1 }, (_, i) => centerSegment.start + i)
    : [];
  let centerBottomRow = -1;
  if (centerCols.length) {
    for (let y = size - 1; y >= 0; y -= 1) {
      const segments = getSegments(visibilityMask[y]);
      if (segments.length < 3) continue;
      const middle = segments[Math.floor(segments.length / 2)];
      if (centerCols[0] >= middle.start && centerCols[0] <= middle.end) {
        centerBottomRow = y;
        break;
      }
    }
  }

  for (let y = size - 1; y >= 0; y -= 1) {
    setIfInBounds(grid, 0, y, '#');
    setIfInBounds(grid, 1, y + 1, '#');
    setIfInBounds(grid, 2, y + 2, '#');

    // Seed the inner diagonal pixels at the bottom-left corner.
    if (y === size - 3) {
      setIfInBounds(grid, 0, y - 1, '#');
      setIfInBounds(grid, 1, y, '#');
    }

    // Start the center bar on the first left-edge frame.
    if (y === centerBottomRow + 1 && centerBottomRow >= 0 && centerCols.length) {
      setIfInBounds(grid, centerCols[0], centerBottomRow, '#');
    }

    // Build the center bar diagonally without adding extra frames.
    for (let i = 0; i < centerCols.length; i += 1) {
      const col = centerCols[i];
      const row = y + i;
      if (row < 0 || row >= size) continue;
      if (visibilityMask[row][col] === '#') {
        setIfInBounds(grid, col, row, '#');
      }
    }

    pushIfChanged(buildFrames, maskFromGrid(grid), visibilityMask);
  }

  // Fill any remaining pixels (safety).
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (visibilityMask[y][x] !== '#') continue;
      if (grid[y][x] === '#') continue;
      grid[y][x] = '#';
      pushIfChanged(buildFrames, maskFromGrid(grid), visibilityMask);
    }
  }

  const targetLength = 73;
  while (buildFrames.length < targetLength) {
    buildFrames.push(buildFrames[buildFrames.length - 1]);
  }

  const clearFrames = buildFrames.map((frame) => {
    const cleared = [];
    for (let y = 0; y < size; y += 1) {
      let row = '';
      for (let x = 0; x < size; x += 1) {
        if (visibilityMask[y][x] !== '#') {
          row += '.';
        } else {
          row += frame[y][x] === '#' ? '.' : '#';
        }
      }
      cleared.push(row);
    }
    return cleared;
  });

  return clearFrames.concat(buildFrames);
}

function padFrame(lines) {
  const size = 24;
  const rows = lines.map((line) => line.padEnd(size, '.').slice(0, size));
  while (rows.length < size) {
    rows.push('.'.repeat(size));
  }
  return rows;
}

function gridFromMask(mask) {
  return mask.map((row) => row.split(''));
}

function maskFromGrid(grid) {
  return grid.map((row) => row.join(''));
}

function pushIfChanged(frames, frame, visibilityMask) {
  const last = frames[frames.length - 1];
  if (!last || hasVisibleDiff(last, frame, visibilityMask)) {
    frames.push(frame);
  }
}

function hasVisibleDiff(a, b, visibilityMask) {
  if (!visibilityMask) return !framesEqual(a, b);
  for (let y = 0; y < visibilityMask.length; y += 1) {
    const maskRow = visibilityMask[y];
    const rowA = a[y];
    const rowB = b[y];
    for (let x = 0; x < maskRow.length; x += 1) {
      if (maskRow[x] !== '#') continue;
      if (rowA[x] !== rowB[x]) return true;
    }
  }
  return false;
}

function framesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function setIfInBounds(grid, x, y, value) {
  if (y < 0 || y >= grid.length) return;
  if (x < 0 || x >= grid[y].length) return;
  grid[y][x] = value;
}

function getSegments(row) {
  const segments = [];
  let inSegment = false;
  let start = 0;
  for (let x = 0; x < row.length; x += 1) {
    const on = row[x] === '#';
    if (on && !inSegment) {
      inSegment = true;
      start = x;
    } else if (!on && inSegment) {
      segments.push({ start, end: x - 1 });
      inSegment = false;
    }
  }
  if (inSegment) segments.push({ start, end: row.length - 1 });
  return segments;
}

function findCenterSegment(mask) {
  for (const row of mask) {
    const segments = getSegments(row);
    if (segments.length >= 3) {
      return segments[Math.floor(segments.length / 2)];
    }
  }
  return null;
}

async function renderCustomMaskFrame(pixelData, mask24, options) {
  const { data, info } = pixelData;
  const out = new Uint8ClampedArray(info.width * info.height * 4);
  const offset = (options.grid - 24) / 2;

  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      if (mask24[y][x] !== '#') continue;
      const gx = x + offset;
      const gy = y + offset;
      const srcX = gx * options.cell;
      const srcY = gy * options.cell;

      for (let cy = 0; cy < options.cell; cy += 1) {
        for (let cx = 0; cx < options.cell; cx += 1) {
          const sx = srcX + cx;
          const sy = srcY + cy;
          const sIdx = (sy * info.width + sx) * 4;
          if (data[sIdx + 3] === 0) continue;
          out[sIdx] = data[sIdx];
          out[sIdx + 1] = data[sIdx + 1];
          out[sIdx + 2] = data[sIdx + 2];
          out[sIdx + 3] = data[sIdx + 3];
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

async function renderMaskBuffer(mask24, gridSize, cellSize, invertFill, borderAlpha) {
  const outSize = gridSize * cellSize;
  const out = new Uint8ClampedArray(outSize * outSize * 4);
  const fill = invertFill ? 255 : 0;
  const offset = Math.floor((gridSize - mask24.length) / 2);

  for (let y = 0; y < mask24.length; y += 1) {
    for (let x = 0; x < mask24[y].length; x += 1) {
      if (mask24[y][x] !== '#') continue;
      const gx = x + offset;
      const gy = y + offset;
      const baseX = gx * cellSize;
      const baseY = gy * cellSize;

      for (let cy = 0; cy < cellSize; cy += 1) {
        for (let cx = 0; cx < cellSize; cx += 1) {
          const isBorder = cx === 0 || cy === 0 || cx === cellSize - 1 || cy === cellSize - 1;
          const alphaOut = borderAlpha === null || !isBorder ? 255 : borderAlpha;
          const ox = baseX + cx;
          const oy = baseY + cy;
          const oidx = (oy * outSize + ox) * 4;
          out[oidx] = fill;
          out[oidx + 1] = fill;
          out[oidx + 2] = fill;
          out[oidx + 3] = alphaOut;
        }
      }
    }
  }

  return sharp(out, { raw: { width: outSize, height: outSize, channels: 4 } })
    .png()
    .toBuffer();
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
