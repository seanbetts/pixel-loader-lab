import './styles.css';
import loaderUrl from './assets/loader.gif?url';

const setLoaderSources = (url) => {
  const cacheBusted = `${url}?t=${Date.now()}`;
  document.querySelectorAll('img.loader').forEach((img) => {
    img.src = cacheBusted;
  });
};

setLoaderSources(loaderUrl);

if (import.meta.hot) {
  import.meta.hot.accept('./assets/loader.gif?url', (mod) => {
    if (mod?.default) {
      setLoaderSources(mod.default);
    }
  });
}
