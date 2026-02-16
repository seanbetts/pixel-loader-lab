import './styles.css';
import iconSvgUrl from './assets/logo.svg?url';

const DEFAULTS = {
  transition: 10,
};

const withCacheBust = (url) => {
  if (url.startsWith('data:')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
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
  const url = withCacheBust(`/assets/frames/${variant}/manifest.json`);
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
  const frameUrl = withCacheBust(`/assets/frames/${variant}/${frameName}`);
  const image = new Image();
  image.src = frameUrl;
  await image.decode();
  return image;
};

const renderAll = async (canvases, manifests, frame) => {
  const cache = {};
  for (const canvas of canvases) {
    const variant = canvas.dataset.variant;
    const manifest = manifests[variant];
    const imageKey = `${variant}:${frame}`;
    if (!cache[imageKey]) {
      cache[imageKey] = await loadFrameImage(variant, frame);
    }
    const image = cache[imageKey];
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

let autoTimer;
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
  autoTimer = setInterval(async () => {
    currentFrame = (currentFrame + 1) % totalFrames;
    await renderAll(cachedCanvases, manifests, currentFrame);
    updateReadout();
  }, ms);
};

const stopAuto = () => {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = undefined;
  }
};

const stepFrame = async (direction) => {
  stopAuto();
  const delta = direction === 'prev' ? -1 : 1;
  currentFrame = (currentFrame + delta + totalFrames) % totalFrames;
  await renderAll(cachedCanvases, cachedManifests, currentFrame);
  updateReadout();
};

const setFrameFromSlider = async (value) => {
  stopAuto();
  currentFrame = Math.min(Math.max(0, Number(value)), totalFrames - 1);
  await renderAll(cachedCanvases, cachedManifests, currentFrame);
  updateReadout();
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
    cachedManifests = await loadManifests();
    totalFrames = cachedManifests[Object.keys(cachedManifests)[0]].frames;
    currentFrame = 0;
    cachedCanvases = getCanvases();
    await renderAll(cachedCanvases, cachedManifests, currentFrame);
    updateReadout();
    startAuto(cachedManifests);
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
    const optimizeResponse = await fetch('/__optimize-loader', { method: 'POST' });
    if (!optimizeResponse.ok) {
      const payload = await optimizeResponse.json().catch(() => ({}));
      throw new Error(payload.error || 'Optimize failed');
    }
    const optimized = await optimizeResponse.json();
    const base = window.location.origin;
    const cacheBust = Date.now();
    const lightName = optimized.light || 'loader-transition.gif';
    const darkName = optimized.dark || 'loader-transition-dark.gif';
    const lightUrl = `${base}/assets/${lightName}?t=${cacheBust}`;
    const darkUrl = `${base}/assets/${darkName}?t=${cacheBust}`;
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
        width: 100%;
        max-width: 532px;
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
        width: 256px;
        height: 256px;
        image-rendering: pixelated;
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
      .actions {
        margin-top: 12px;
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
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
        <img src="${lightUrl}" alt="Pixel loader light" />
      </div>
      <div class="panel dark">
        <div class="title">Dark background</div>
        <img src="${darkUrl}" alt="Pixel loader dark" />
      </div>
    </div>
    <div class="page-actions">
      <a class="download-all" href="${lightUrl}" download="pixel-loader-light.gif">Download both GIFs</a>
    </div>
    <script>
      document.querySelector('.download-all')?.addEventListener('click', (event) => {
        event.preventDefault();
        const click = (href, name) => {
          const link = document.createElement('a');
          link.href = href;
          link.download = name;
          document.body.appendChild(link);
          link.click();
          link.remove();
        };
        click('${lightUrl}', 'pixel-loader-light.gif');
        click('${darkUrl}', 'pixel-loader-dark.gif');
      });
    </script>
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
  cachedManifests = await loadManifests();
  totalFrames = cachedManifests[Object.keys(cachedManifests)[0]].frames;
  cachedCanvases = getCanvases();
  await renderAll(cachedCanvases, cachedManifests, currentFrame);
  updateReadout();
  startAuto(cachedManifests);

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
