import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
const root = fileURLToPath(new URL('../../dist/client/', import.meta.url));
export async function serveClient(path: string, response: ServerResponse): Promise<boolean> {
  if (path !== '/' && path !== '/index.html' && !/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path)) return false;
  try {
    const data = await readFile(join(root, path === '/' ? 'index.html' : path.slice(1)));
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (path.startsWith('/assets/')) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.statusCode = 200; response.end(data); return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (path === '/' || path === '/index.html') {
      response.statusCode = 503; response.end(JSON.stringify({ error: { code: 'client_not_built', message: 'Run npm run build to prepare the React interface.' } })); return true;
    }
    return false;
  }
}
