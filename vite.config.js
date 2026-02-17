import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const scriptPath = path.join(projectRoot, 'scripts', 'generate-loader.js');
const lightGif = path.join(projectRoot, 'src', 'assets', 'loader-transition.gif');
const darkGif = path.join(projectRoot, 'src', 'assets', 'loader-transition-dark.gif');
const lightOptGif = path.join(projectRoot, 'src', 'assets', 'loader-transition-opt.gif');
const darkOptGif = path.join(projectRoot, 'src', 'assets', 'loader-transition-dark-opt.gif');

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

  const runOptimize = () =>
    new Promise((resolve, reject) => {
      const child = spawn('gifsicle', ['-O3', '--careful', '-o', lightOptGif, lightGif], {
        stdio: 'inherit',
        cwd: projectRoot,
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`optimize failed: ${code}`));
      });
    }).then(
      () =>
        new Promise((resolve, reject) => {
          const child = spawn('gifsicle', ['-O3', '--careful', '-o', darkOptGif, darkGif], {
            stdio: 'inherit',
            cwd: projectRoot,
          });
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`optimize failed: ${code}`));
          });
        })
    );

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
                light: 'loader-transition-opt.gif',
                dark: 'loader-transition-dark-opt.gif',
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
