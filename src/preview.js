import './styles.css';
import iconSvgUrl from './assets/logo.svg?url';

const DEFAULTS = {
  transition: 10,
};

let activeAssetVersion = Date.now();

const withCacheBust = (url) => {
  if (url.startsWith('data:')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
};

const withAssetVersion = (url) => {
  if (url.startsWith('data:')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${activeAssetVersion}`;
};

const setIconSources = (url) => {
  const resolved = withCacheBust(url);
  document.querySelectorAll('img.icon').forEach((img) => {
    img.src = resolved;
  });
};

const setBuildingState = (state, message) => {
  const statusEl = document.querySelector('#buildStatus');
  const controls = document.querySelectorAll(
    '.control-input, #resetButton, #stepButton, #prevButton, #exportButton'
  );
  controls.forEach((el) => {
    el.disabled = state === 'building';
  });

  if (!statusEl) return;
  statusEl.classList.remove('building', 'error');

  if (state === 'building') {
    statusEl.textContent = 'Building...';
    statusEl.classList.add('building');
  } else if (state === 'error') {
    statusEl.textContent = message || 'Build failed';
    statusEl.classList.add('error');
  } else {
    statusEl.textContent = 'Idle';
  }
};

const getManifest = async (variant) => {
  const url = withAssetVersion(`/assets/frames/${variant}/manifest.json`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing manifest for ${variant}`);
  return response.json();
};

const loadManifests = async () => {
  const variants = new Set();
  document.querySelectorAll('[data-variant]').forEach((node) => {
    variants.add(node.dataset.variant);
  });

  const manifests = {};
  await Promise.all(
    Array.from(variants).map(async (variant) => {
      manifests[variant] = await getManifest(variant);
    })
  );

  return manifests;
};

const replaceWithCanvas = (img) => {
  const size = Number(img.dataset.size || 0);
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size * dpr));
  canvas.height = Math.max(1, Math.round(size * dpr));
  canvas.className = img.className;
  canvas.dataset.variant = img.dataset.variant;
  canvas.dataset.size = img.dataset.size;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  img.replaceWith(canvas);
  return canvas;
};

const getCanvases = () => {
  const canvases = [];
  document.querySelectorAll('img.loader').forEach((img) => {
    canvases.push(replaceWithCanvas(img));
  });
  document.querySelectorAll('canvas.loader').forEach((canvas) => {
    canvases.push(canvas);
  });
  return canvases;
};

const loadFrameImage = async (variant, frame) => {
  const frameName = `frame-${String(frame).padStart(3, '0')}.png`;
  const frameUrl = withAssetVersion(`/assets/frames/${variant}/${frameName}`);
  const image = new Image();
  image.src = frameUrl;
  await image.decode();
  return image;
};

const frameCache = new Map();

const frameCacheKey = (variant, frame) => `${variant}:${frame}`;

const preloadFrames = async (manifests) => {
  const tasks = [];
  Object.entries(manifests).forEach(([variant, manifest]) => {
    for (let frame = 0; frame < manifest.frames; frame += 1) {
      const key = frameCacheKey(variant, frame);
      tasks.push(
        loadFrameImage(variant, frame).then((image) => {
          frameCache.set(key, image);
        })
      );
    }
  });
  await Promise.all(tasks);
};

const renderAll = (canvases, manifests, frame) => {
  for (const canvas of canvases) {
    const variant = canvas.dataset.variant;
    const manifest = manifests[variant];
    if (!manifest) continue;
    const image = frameCache.get(frameCacheKey(variant, frame));
    if (!image) throw new Error(`Missing frame in cache: ${variant}#${frame}`);
    const ctx = canvas.getContext('2d');
    const size = Number(canvas.dataset.size || 0);
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.round(size * dpr));
    const targetH = Math.max(1, Math.round(size * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, size, size);
  }
};

let autoRaf;
let autoRunToken = 0;
let currentFrame = 0;
let totalFrames = 0;
let cachedManifests = null;
let cachedCanvases = null;

const updateReadout = () => {
  const readout = document.querySelector('#frameReadout');
  const slider = document.querySelector('#frameSlider');
  if (slider) {
    slider.max = String(Math.max(0, totalFrames - 1));
    slider.value = String(currentFrame);
  }
  if (readout) {
    readout.textContent = `Frame ${currentFrame + 1} / ${Math.max(1, totalFrames)}`;
  }
};

const startAuto = (manifests) => {
  stopAuto();
  const ms = manifests[Object.keys(manifests)[0]].ms;
  const runToken = ++autoRunToken;
  let lastTs = 0;
  let accumulator = 0;

  const tick = (ts) => {
    if (runToken !== autoRunToken || totalFrames <= 0) return;
    if (!lastTs) lastTs = ts;
    accumulator += ts - lastTs;
    lastTs = ts;
    let changed = false;
    while (accumulator >= ms) {
      currentFrame = (currentFrame + 1) % totalFrames;
      accumulator -= ms;
      changed = true;
    }
    if (!changed) {
      autoRaf = requestAnimationFrame(tick);
      return;
    }
    try {
      renderAll(cachedCanvases, manifests, currentFrame);
      updateReadout();
    } catch (error) {
      console.error('Failed to render frame', error);
      stopAuto();
      setBuildingState('error', 'Render failed');
      return;
    }

    if (runToken === autoRunToken) {
      autoRaf = requestAnimationFrame(tick);
    }
  };

  autoRaf = requestAnimationFrame(tick);
};

const stopAuto = () => {
  autoRunToken += 1;
  if (autoRaf) {
    cancelAnimationFrame(autoRaf);
    autoRaf = undefined;
  }
};

const stepFrame = (direction) => {
  stopAuto();
  const delta = direction === 'prev' ? -1 : 1;
  currentFrame = (currentFrame + delta + totalFrames) % totalFrames;
  renderAll(cachedCanvases, cachedManifests, currentFrame);
  updateReadout();
};

const setFrameFromSlider = (value) => {
  stopAuto();
  currentFrame = Math.min(Math.max(0, Number(value)), totalFrames - 1);
  renderAll(cachedCanvases, cachedManifests, currentFrame);
  updateReadout();
};

const refreshPreview = async () => {
  cachedManifests = await loadManifests();
  totalFrames = cachedManifests[Object.keys(cachedManifests)[0]].frames;
  frameCache.clear();
  await preloadFrames(cachedManifests);
  currentFrame = 0;
  cachedCanvases = getCanvases();
  renderAll(cachedCanvases, cachedManifests, currentFrame);
  updateReadout();
  startAuto(cachedManifests);
};

const buildLoader = async () => {
  const params = new URLSearchParams({ transition: DEFAULTS.transition });
  setBuildingState('building');

  try {
    const response = await fetch(`/__build-loader?${params.toString()}`, { method: 'POST' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Build failed');
    }
    setBuildingState('idle');
    activeAssetVersion = Date.now();
    await refreshPreview();
  } catch (error) {
    setBuildingState('error', error?.message);
    console.error('Failed to build loader', error);
  }
};

const scheduleBuild = () => {
  clearTimeout(scheduleBuild.timer);
  scheduleBuild.timer = setTimeout(buildLoader, 200);
};

const resetControls = () => {
  scheduleBuild();
};

const exportGif = async () => {
  setBuildingState('building');
  try {
    const exportResponse = await fetch('/__export-loader-zip', { method: 'POST' });
    if (!exportResponse.ok) {
      const payload = await exportResponse.json().catch(() => ({}));
      throw new Error(payload.error || 'Export failed');
    }
    const optimized = await exportResponse.json();
    const base = window.location.origin;
    const cacheBust = Date.now();
    const solidLightName = optimized.solidLight || 'loader-solid-transition.gif';
    const borderedLightName = optimized.borderedLight || 'loader-transition.gif';
    const solidDarkName = optimized.solidDark || 'loader-solid-transition-dark.gif';
    const borderedDarkName = optimized.borderedDark || 'loader-transition-dark.gif';
    const solidLightUrl = `${base}/assets/${solidLightName}?t=${cacheBust}`;
    const borderedLightUrl = `${base}/assets/${borderedLightName}?t=${cacheBust}`;
    const solidDarkUrl = `${base}/assets/${solidDarkName}?t=${cacheBust}`;
    const borderedDarkUrl = `${base}/assets/${borderedDarkName}?t=${cacheBust}`;
    const zipName = optimized.zip || 'loading-icons.zip';
    const zipUrl = `${base}/assets/${zipName}?t=${cacheBust}`;
    const exportHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pixel Loader Export</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Space Grotesk", system-ui, sans-serif;
      }
      body {
        margin: 24px;
        background: #f6f6f3;
        color: #121212;
      }
      .wrap {
        display: flex;
        gap: 20px;
        justify-content: center;
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .page-actions {
        display: flex;
        justify-content: center;
        margin-top: 16px;
      }
      .page-actions .download-all {
        width: auto;
        justify-content: center;
      }
      .panel {
        border-radius: 16px;
        padding: 16px;
        border: 1px solid rgba(0,0,0,0.08);
        background: #fff;
      }
      .panel.dark {
        background: #141414;
        color: #f2f2f2;
        border-color: rgba(255,255,255,0.08);
      }
      .title {
        font-weight: 600;
        margin-bottom: 12px;
      }
      img {
        image-rendering: pixelated;
      }
      .size-44 {
        width: 44px;
        height: 44px;
      }
      .size-128 {
        width: 128px;
        height: 128px;
      }
      .samples {
        display: flex;
        align-items: flex-end;
        gap: 20px;
      }
      .sample {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }
      .size-label {
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        opacity: 0.7;
      }
      .download-all {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 8px 14px;
        border-radius: 999px;
        border: 1px solid rgba(0,0,0,0.2);
        text-decoration: none;
        color: inherit;
        font-size: 12px;
        background: #fff;
      }
      .note {
        font-size: 12px;
        opacity: 0.7;
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <div class="title">Light background</div>
        <div class="samples">
          <div class="sample" data-name="loading-44-light.gif">
            <img class="size-44" src="${solidLightUrl}" alt="Loading 44 light" />
            <div class="size-label">44px</div>
          </div>
          <div class="sample" data-name="loading-128-light.gif">
            <img class="size-128" src="${borderedLightUrl}" alt="Loading 128 light" />
            <div class="size-label">128px</div>
          </div>
        </div>
      </div>
      <div class="panel dark">
        <div class="title">Dark background</div>
        <div class="samples">
          <div class="sample" data-name="loading-44-dark.gif">
            <img class="size-44" src="${solidDarkUrl}" alt="Loading 44 dark" />
            <div class="size-label">44px</div>
          </div>
          <div class="sample" data-name="loading-128-dark.gif">
            <img class="size-128" src="${borderedDarkUrl}" alt="Loading 128 dark" />
            <div class="size-label">128px</div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-actions">
      <a class="download-all" href="${zipUrl}" download="loading-icons.zip">Download GIFs</a>
    </div>
  </body>
</html>`;
    const exportBlob = new Blob([exportHtml], { type: 'text/html' });
    const exportUrl = URL.createObjectURL(exportBlob);
    const opened = window.open(exportUrl, '_blank');
    if (!opened) {
      window.location.href = exportUrl;
    }
    setTimeout(() => URL.revokeObjectURL(exportUrl), 60_000);
    setBuildingState('idle');
  } catch (error) {
    setBuildingState('error', error?.message);
    console.error('Failed to export GIF', error);
  }
};

const boot = async () => {
  setIconSources(iconSvgUrl);
  try {
    await refreshPreview();
  } catch (error) {
    setBuildingState('error', error?.message || 'Failed to load loader frames');
    console.error('Failed to initialize preview', error);
    return;
  }

  const stepButton = document.querySelector('#stepButton');
  if (stepButton) {
    stepButton.addEventListener('click', () => stepFrame('next'));
  }

  const prevButton = document.querySelector('#prevButton');
  if (prevButton) {
    prevButton.addEventListener('click', () => stepFrame('prev'));
  }

  const slider = document.querySelector('#frameSlider');
  if (slider) {
    slider.addEventListener('input', (event) => {
      setFrameFromSlider(event.target.value);
    });
  }

  const exportButton = document.querySelector('#exportButton');
  if (exportButton) {
    exportButton.addEventListener('click', exportGif);
  }
};

const resetButton = document.querySelector('#resetButton');
if (resetButton) {
  resetButton.addEventListener('click', resetControls);
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    scheduleBuild();
  });
}

boot();
