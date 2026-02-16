import './styles.css';
import loaderBorderLightTransitionUrl from './assets/loader-transition.gif?url';
import loaderBorderDarkTransitionUrl from './assets/loader-transition-dark.gif?url';
import loaderSolidLightTransitionUrl from './assets/loader-solid-transition.gif?url';
import loaderSolidDarkTransitionUrl from './assets/loader-solid-transition-dark.gif?url';
import iconSvgUrl from './assets/logo.svg?url';

const DEFAULTS = {
  grid: '32',
  cell: '8',
  frames: '8',
  ms: '120',
  transition: 6,
};

const withCacheBust = (url) => {
  if (url.startsWith('data:')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}t=${Date.now()}`;
};

const setSources = (selector, url) => {
  const resolved = withCacheBust(url);
  document.querySelectorAll(selector).forEach((img) => {
    img.src = resolved;
  });
};

const setIconSources = (url) => {
  const resolved = withCacheBust(url);
  document.querySelectorAll('img.icon').forEach((img) => {
    img.src = resolved;
  });
};

const getControlValues = () => ({
  grid: document.querySelector('#gridSize')?.value ?? DEFAULTS.grid,
  cell: document.querySelector('#cellSize')?.value ?? DEFAULTS.cell,
  frames: document.querySelector('#frameCount')?.value ?? DEFAULTS.frames,
  ms: document.querySelector('#frameMs')?.value ?? DEFAULTS.ms,
});

const setBuildingState = (state, message) => {
  const statusEl = document.querySelector('#buildStatus');
  const controls = document.querySelectorAll('.control-input, #resetButton');
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

const loadLoopingTransitions = () => {
  setSources('img.loader-border-light', loaderBorderLightTransitionUrl);
  setSources('img.loader-border-dark', loaderBorderDarkTransitionUrl);
  setSources('img.loader-solid-light', loaderSolidLightTransitionUrl);
  setSources('img.loader-solid-dark', loaderSolidDarkTransitionUrl);
};

const buildLoader = async () => {
  const { grid, cell, frames, ms } = getControlValues();
  const params = new URLSearchParams({ grid, cell, frames, ms, transition: DEFAULTS.transition });
  setBuildingState('building');

  try {
    const response = await fetch(`/__build-loader?${params.toString()}`, { method: 'POST' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Build failed');
    }
    setBuildingState('idle');
    loadLoopingTransitions();
  } catch (error) {
    setBuildingState('error', error?.message);
    console.error('Failed to build loader', error);
  }
};

let buildTimer;
const scheduleBuild = () => {
  if (buildTimer) clearTimeout(buildTimer);
  buildTimer = setTimeout(buildLoader, 200);
};

const resetControls = () => {
  const grid = document.querySelector('#gridSize');
  const cell = document.querySelector('#cellSize');
  const frames = document.querySelector('#frameCount');
  const ms = document.querySelector('#frameMs');
  if (grid) grid.value = DEFAULTS.grid;
  if (cell) cell.value = DEFAULTS.cell;
  if (frames) frames.value = DEFAULTS.frames;
  if (ms) ms.value = DEFAULTS.ms;
  scheduleBuild();
};

setIconSources(iconSvgUrl);
loadLoopingTransitions();

['#gridSize', '#cellSize', '#frameCount', '#frameMs'].forEach((selector) => {
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
  import.meta.hot.accept('./assets/loader-transition.gif?url', (mod) => {
    if (mod?.default) {
      setSources('img.loader-border-light', mod.default);
    }
  });
  import.meta.hot.accept('./assets/loader-transition-dark.gif?url', (mod) => {
    if (mod?.default) {
      setSources('img.loader-border-dark', mod.default);
    }
  });
  import.meta.hot.accept('./assets/loader-solid-transition.gif?url', (mod) => {
    if (mod?.default) {
      setSources('img.loader-solid-light', mod.default);
    }
  });
  import.meta.hot.accept('./assets/loader-solid-transition-dark.gif?url', (mod) => {
    if (mod?.default) {
      setSources('img.loader-solid-dark', mod.default);
    }
  });
  import.meta.hot.accept('./assets/logo.svg?url', (mod) => {
    if (mod?.default) {
      setIconSources(mod.default);
    }
  });
}
