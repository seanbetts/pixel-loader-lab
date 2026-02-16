import './styles.css';
import iconSvgUrl from './assets/logo.svg?url';

const DEFAULTS = {
  frames: '16',
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

const getControlValues = () => ({
  frames: document.querySelector('#frameCount')?.value ?? DEFAULTS.frames,
});

const setBuildingState = (state, message) => {
  const statusEl = document.querySelector('#buildStatus');
  const controls = document.querySelectorAll('.control-input, #resetButton, #stepButton');
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

const startAuto = (manifests) => {
  stopAuto();
  const ms = manifests[Object.keys(manifests)[0]].ms;
  autoTimer = setInterval(async () => {
    currentFrame = (currentFrame + 1) % totalFrames;
    await renderAll(cachedCanvases, manifests, currentFrame);
  }, ms);
};

const stopAuto = () => {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = undefined;
  }
};

const stepFrame = async () => {
  stopAuto();
  currentFrame = (currentFrame + 1) % totalFrames;
  await renderAll(cachedCanvases, cachedManifests, currentFrame);
};

const buildLoader = async () => {
  const { frames } = getControlValues();
  const params = new URLSearchParams({ frames, transition: DEFAULTS.transition });
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
  const frames = document.querySelector('#frameCount');
  if (frames) frames.value = DEFAULTS.frames;
  scheduleBuild();
};

const boot = async () => {
  setIconSources(iconSvgUrl);
  cachedManifests = await loadManifests();
  totalFrames = cachedManifests[Object.keys(cachedManifests)[0]].frames;
  cachedCanvases = getCanvases();
  await renderAll(cachedCanvases, cachedManifests, currentFrame);
  startAuto(cachedManifests);

  const stepButton = document.querySelector('#stepButton');
  if (stepButton) {
    stepButton.addEventListener('click', stepFrame);
  }
};

['#frameCount'].forEach((selector) => {
  const el = document.querySelector(selector);
  if (el) {
    el.addEventListener('change', scheduleBuild);
  }
});

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
