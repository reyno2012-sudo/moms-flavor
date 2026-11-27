import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createApi } from './server/api.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, 'src') + path.sep;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg'
};

export function createServer(options) {
  const api = createApi({ filename: process.env.MF_DB_PATH || path.join(root, '.data', 'moms-flavor.sqlite'), ...options });
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await api.handle(request, response, url);
      const relative = decodeURIComponent(url.pathname).slice(1) || 'index.html';
      const file = path.resolve(root, relative);
      const type = mime[path.extname(file)];
      if (!['GET', 'HEAD'].includes(request.method) || !type || (file !== path.join(root, 'index.html') && !file.startsWith(source))) {
        throw new Error('Missing file');
      }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end('Not found');
    }
  });
  server.once('close', api.close);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.listen(Number(process.env.PORT || 5173), '127.0.0.1', () => {
    console.log(`Mom's Flavor: http://127.0.0.1:${server.address().port}`);
  });
}
