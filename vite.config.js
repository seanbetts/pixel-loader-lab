import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const scriptPath = path.join(projectRoot, 'scripts', 'generate-loader.js');
const borderGif = path.join(projectRoot, 'src', 'assets', 'loader-transition.gif');
const solidGif = path.join(projectRoot, 'src', 'assets', 'loader-solid-transition.gif');
const borderDarkGif = path.join(projectRoot, 'src', 'assets', 'loader-transition-dark.gif');
const solidDarkGif = path.join(projectRoot, 'src', 'assets', 'loader-solid-transition-dark.gif');
const borderOptGif = path.join(projectRoot, 'src', 'assets', 'loader-transition-opt.gif');
const solidOptGif = path.join(projectRoot, 'src', 'assets', 'loader-solid-transition-opt.gif');
const borderDarkOptGif = path.join(projectRoot, 'src', 'assets', 'loader-transition-dark-opt.gif');
const solidDarkOptGif = path.join(projectRoot, 'src', 'assets', 'loader-solid-transition-dark-opt.gif');
const zipOutputName = 'loading-icons.zip';
const zipOutputPath = path.join(projectRoot, 'src', 'assets', zipOutputName);
const zipStagingDir = path.join(projectRoot, '.tmp', 'zip-export');

const buildLoaderPlugin = () => {
  let queue = Promise.resolve();

  const runBuild = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn('node', [scriptPath, ...args], {
        stdio: 'inherit',
        cwd: projectRoot,
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`build failed: ${code}`));
      });
    });

  const optimizeGif = (input, output) =>
    new Promise((resolve, reject) => {
      const child = spawn('gifsicle', ['-O3', '--careful', '-o', output, input], {
        stdio: 'inherit',
        cwd: projectRoot,
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`optimize failed: ${code}`));
      });
    });

  const runOptimize = () =>
    optimizeGif(solidGif, solidOptGif)
      .then(() => optimizeGif(borderGif, borderOptGif))
      .then(() => optimizeGif(solidDarkGif, solidDarkOptGif))
      .then(() => optimizeGif(borderDarkGif, borderDarkOptGif));

  const runZipExport = () =>
    new Promise((resolve, reject) => {
      fs.rmSync(zipStagingDir, { recursive: true, force: true });
      fs.mkdirSync(zipStagingDir, { recursive: true });
      fs.rmSync(zipOutputPath, { force: true });
      fs.copyFileSync(solidOptGif, path.join(zipStagingDir, 'loading-light-44.gif'));
      fs.copyFileSync(borderOptGif, path.join(zipStagingDir, 'loading-light-128.gif'));
      fs.copyFileSync(solidDarkOptGif, path.join(zipStagingDir, 'loading-dark-44.gif'));
      fs.copyFileSync(borderDarkOptGif, path.join(zipStagingDir, 'loading-dark-128.gif'));

      const child = spawn(
        'zip',
        [
          '-j',
          '-q',
          zipOutputPath,
          path.join(zipStagingDir, 'loading-light-44.gif'),
          path.join(zipStagingDir, 'loading-light-128.gif'),
          path.join(zipStagingDir, 'loading-dark-44.gif'),
          path.join(zipStagingDir, 'loading-dark-128.gif'),
        ],
        {
          stdio: 'inherit',
          cwd: projectRoot,
        }
      );
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`zip export failed: ${code}`));
      });
    });

  const enqueue = (task) => {
    const run = queue.catch(() => {}).then(task);
    queue = run.catch(() => {});
    return run;
  };

  return {
    name: 'pixel-loader-build',
    configureServer(server) {
      server.middlewares.use('/__build-loader', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const params = url.searchParams;
        const args = [];
        const frames = params.get('frames');
        const transition = params.get('transition');

        if (frames) args.push('--frames', frames);
        if (transition) args.push('--transition', transition);

        enqueue(() => runBuild(args))
          .then(() => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          })
          .catch((err) => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: err.message }));
          });
      });

      server.middlewares.use('/__optimize-loader', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        enqueue(() => runOptimize())
          .then(() => {
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ok: true,
                solidLight: 'loader-solid-transition-opt.gif',
                borderedLight: 'loader-transition-opt.gif',
                solidDark: 'loader-solid-transition-dark-opt.gif',
                borderedDark: 'loader-transition-dark-opt.gif',
              })
            );
          })
          .catch((err) => {
            const message = err?.message?.includes('ENOENT')
              ? 'gifsicle not found. Install with: brew install gifsicle'
              : err.message;
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: message }));
          });
      });

      server.middlewares.use('/__export-loader-zip', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        enqueue(() => runOptimize().then(() => runZipExport()))
          .then(() => {
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ok: true,
                zip: zipOutputName,
                solidLight: 'loader-solid-transition-opt.gif',
                borderedLight: 'loader-transition-opt.gif',
                solidDark: 'loader-solid-transition-dark-opt.gif',
                borderedDark: 'loader-transition-dark-opt.gif',
              })
            );
          })
          .catch((err) => {
            const message =
              err?.message?.includes('ENOENT') || err?.message?.includes('zip')
                ? 'zip utility not found. Install zip and try again.'
                : err.message;
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: message }));
          });
      });
    },
  };
};

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  plugins: [buildLoaderPlugin()],
});
