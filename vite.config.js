import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;
const scriptPath = path.join(projectRoot, 'scripts', 'generate-loader.js');

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
        const grid = params.get('grid');
        const cell = params.get('cell');
        const frames = params.get('frames');
        const ms = params.get('ms');

        if (grid) args.push('--grid', grid);
        if (cell) args.push('--cell', cell);
        if (frames) args.push('--frames', frames);
        if (ms) args.push('--ms', ms);

        queue = queue.then(() => runBuild(args));

        queue
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
