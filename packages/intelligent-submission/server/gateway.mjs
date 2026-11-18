import { withPlatformModel } from './lib/platform-model.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import express from 'express';
import httpProxy from 'http-proxy';
import dotenv from 'dotenv';
import { withAccount } from './lib/store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

// Shared authenticated app for the in-process host and the legacy gateway.
export async function createSubmissionApp({ upstream }) {
  const { app: submission } = await import('./index.mjs');
  const app = express();
  app.disable('x-powered-by');
  if (process.env.ONECODE_TRUST_PROXY === 'loopback') app.set('trust proxy', 'loopback');
  app.use((_request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff');
    response.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use('/intelligent-submission/api', async (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    const basic = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(request.headers.authorization || '');
    const decoded = basic ? Buffer.from(basic[1], 'base64').toString('utf8') : '';
    const token = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : '';
    if (!token) return response.status(401).json({ error: '请先登录 OneCode，再使用智能投稿。' });
    // Block cross-origin writes even if a browser has cached Basic credentials.
    const origin = request.headers.origin;
    if (origin && origin !== `${request.protocol}://${request.headers.host}`) {
      return response.status(403).json({ error: '请求来源与平台不一致。' });
    }
    const url = new URL('/platform/auth/session', upstream);
    url.searchParams.set('token', token);
    const verified = await fetch(url, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!verified) return response.status(503).json({ error: 'OneCode 登录服务暂时不可用。' });
    if ([400, 401, 403].includes(verified.status)) return response.status(401).json({ error: '登录已过期，请重新登录 OneCode。' });
    if (!verified.ok) return response.status(503).json({ error: 'OneCode 登录服务暂时不可用。' });
    const session = await verified.json().catch(() => null);
    if (!session?.account?.id || !Number.isFinite(session.expiresAt)) return response.status(503).json({ error: 'OneCode 登录服务响应异常。' });
    if (!session?.account?.id || !session?.expiresAt || (session.expiresAt < 10_000_000_000 ? session.expiresAt * 1000 : session.expiresAt) <= Date.now()) {
      return response.status(401).json({ error: '登录已过期，请重新登录 OneCode。' });
    }
    // Never accept a tenant/account selector supplied by the browser.
    let model;
    try {
      const raw = request.headers['x-submission-model'];
      if (raw && raw.length <= 8000) model = JSON.parse(decodeURIComponent(raw));
      if (model && (typeof model.providerID !== 'string' || typeof model.modelID !== 'string' || (model.directory && typeof model.directory !== 'string'))) model = undefined;
    } catch { model = undefined; }
    withAccount(session.account.id, () => withPlatformModel({ model, upstream, authorization: request.headers.authorization }, next));
  });
  app.use('/intelligent-submission', submission);
  // Serve the built submission UI in both source and compiled OneCode modes.
  // Do not change NODE_ENV for the host process.
  app.use('/intelligent-submission', express.static(path.join(root, 'dist')));
  app.get(['/intelligent-submission', '/intelligent-submission/*splat'], (_request, response) => {
    response.sendFile(path.join(root, 'dist/index.html'));
  });
  return app;

}

export async function createSubmissionServer({ upstream }) {
  const server = createServer(await createSubmissionApp({ upstream }));
  server.requestTimeout = 0;
  return server;
}

// One origin for the existing OneCode APIs, the built platform UI and the full submission app.
// The upstream remains responsible for account authentication and all existing capabilities.
export async function createGateway({ upstream = process.env.ONECODE_UPSTREAM || 'http://127.0.0.1:8008', appDir = path.resolve(root, '../app/dist') } = {}) {
  const app = await createSubmissionApp({ upstream });

  const proxy = httpProxy.createProxyServer({ target: upstream, ws: true, changeOrigin: false, proxyTimeout: 0 });
  proxy.on('error', (_error, _request, response) => {
    if ('writeHead' in response && !response.headersSent) {
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'OneCode 服务暂时不可用。' }));
      return;
    }
    response.destroy();
  });
  const upstreamHtml = await fetch(new URL('/', upstream), { signal: AbortSignal.timeout(10000) }).then((r) => r.text()).catch(() => '');
  const runtimeMeta = (upstreamHtml.match(/<meta\s+name="onescience-[^"]+"\s+content="[^"]*"\s*\/?\s*>/g) || []).join('');
  app.use(express.static(appDir, { index: false, setHeaders: (response, file) => {
    if (file.endsWith('.html')) response.set('Cache-Control', 'no-store');
  } }));
  app.use(async (request, response, next) => {
    if (!['GET', 'HEAD'].includes(request.method) || !/^\/(?:$|workspace(?:\/|$)|code(?:\/|$)|login$|register$|forgot-password$|auth$)/.test(request.path)) return next();
    const html = await readFile(path.join(appDir, 'index.html'), 'utf8');
    response.set('Cache-Control', 'no-store').type('html').send(html.replace('</head>', `${runtimeMeta}</head>`));
  });
  app.use((request, response) => proxy.web(request, response));
  const server = createServer(app);
  server.on('upgrade', (request, socket, head) => proxy.ws(request, socket, head));
  server.requestTimeout = 0; // Per-journal model inference may take several minutes.
  server.on('close', () => proxy.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.NODE_ENV = 'production';
  const server = await createGateway();
  const port = Number(process.env.ONECODE_SUBMISSION_PORT || 8010);
  server.listen(port, process.env.ONECODE_SUBMISSION_HOST || '127.0.0.1', () => console.log(`OneCode with intelligent submission listening on port ${port}`));
}
