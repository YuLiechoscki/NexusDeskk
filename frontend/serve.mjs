import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const types = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', svg: 'image/svg+xml', ico: 'image/x-icon' };
const base = new URL('./', import.meta.url);
const api = new URL(process.env.API_URL ?? 'http://localhost:4000/api');
if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password) throw new Error('API_URL deve apontar para o endereço HTTP da API.');
const allowedPath = /^\/(?:index\.html|login\.html|(?:css|js|assets)\/(?:[\w-]+\/)*[\w-]+\.(?:css|js|svg|ico))$/;
const csp = `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${api.origin}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;

createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-cache');
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  if (pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': types.js }).end(req.method === 'HEAD' ? undefined : `export const apiBase = ${JSON.stringify(api.href.replace(/\/$/, ''))};`);
    return;
  }
  const file = pathname === '/' ? '/index.html' : pathname;
  if (!allowedPath.test(file)) { res.writeHead(404).end('Página não encontrada.'); return; }
  try {
    const contents = await readFile(new URL(`.${file}`, base));
    res.writeHead(200, { 'Content-Type': types[file.split('.').pop()] }).end(req.method === 'HEAD' ? undefined : contents);
  } catch {
    res.writeHead(404).end('Página não encontrada.');
  }
}).listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1', () => console.log(`Nexus Desk Web em http://localhost:${process.env.PORT ?? 3000}`));
