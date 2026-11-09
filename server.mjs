import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  const envText = await readFile(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const port = Number(process.env.PORT || 4173);
const pluggyBase = 'https://api.pluggy.ai';
const clientId = process.env.PLUGGY_CLIENT_ID || '';
const clientSecret = process.env.PLUGGY_CLIENT_SECRET || '';
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const allowedGoogleEmail = (process.env.GESTORPRO_ALLOWED_GOOGLE_EMAIL || '').trim().toLowerCase();
const productionMode = process.env.NODE_ENV === 'production';
const includeSandbox = process.env.PLUGGY_INCLUDE_SANDBOX !== 'false';
let apiKey = '';
let apiKeyExpiresAt = 0;

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
async function requireAllowedGoogleUser(request) {
  if (!supabaseUrl || !supabasePublishableKey || !allowedGoogleEmail) {
    const error = new Error('A autenticação Google do GestorPro ainda não está configurada no servidor.');
    error.statusCode = 503;
    throw error;
  }
  const authorization = request.headers.authorization || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    const error = new Error('Entre com sua conta Google para continuar.');
    error.statusCode = 401;
    throw error;
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabasePublishableKey, Authorization: `Bearer ${token}` } });
  const user = await response.json().catch(() => ({}));
  const signedInWithGoogle = user.app_metadata?.provider === 'google';
  if (!response.ok || String(user.email || '').trim().toLowerCase() !== allowedGoogleEmail || !signedInWithGoogle) {
    const error = new Error('Esta conta Google não está autorizada a acessar o GestorPro.');
    error.statusCode = 403;
    throw error;
  }
  return user;
}
async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_000) throw new Error('Requisição muito grande.');
  }
  return body ? JSON.parse(body) : {};
}
async function getApiKey() {
  if (!clientId || !clientSecret) throw new Error('Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no arquivo .env local.');
  if (apiKey && Date.now() < apiKeyExpiresAt) return apiKey;
  const response = await fetch(`${pluggyBase}/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.apiKey) throw new Error('A Pluggy não aceitou as credenciais. Confira o Client ID e o Client Secret da aplicação.');
  apiKey = data.apiKey;
  apiKeyExpiresAt = Date.now() + 110 * 60 * 1000;
  return apiKey;
}
async function pluggy(path, options = {}) {
  const key = await getApiKey();
  const response = await fetch(`${pluggyBase}${path}`, { ...options, headers: { 'X-API-KEY': key, ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = [data.codeDescription, data.message].filter(value => typeof value === 'string' && value.trim()).join(': ');
    throw new Error(`A Pluggy retornou erro ${response.status}${detail ? ` — ${detail}` : ''}.`);
  }
  return data;
}
async function listTransactions(accountId) {
  const transactions = [];
  let path = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;
  const visited = new Set();
  for (let page = 0; path && page < 100; page += 1) {
    if (visited.has(path)) throw new Error('A Pluggy repetiu o cursor de paginação. Tente atualizar novamente.');
    visited.add(path);
    const data = await pluggy(path);
    if (Array.isArray(data.results)) transactions.push(...data.results);
    if (!data.next) break;
    const nextUrl = new URL(data.next, `${pluggyBase}/v2/transactions`);
    if (nextUrl.origin !== pluggyBase || nextUrl.pathname !== '/v2/transactions') {
      throw new Error('A Pluggy retornou um cursor de paginação inválido.');
    }
    path = `${nextUrl.pathname}${nextUrl.search}`;
  }
  return { results: transactions };
}
async function listInvestments(itemId) {
  const investments = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 100) {
    const data = await pluggy(`/investments?itemId=${encodeURIComponent(itemId)}&page=${page}&pageSize=500`);
    if (Array.isArray(data.results)) investments.push(...data.results);
    totalPages = Number(data.totalPages) || 1;
    page += 1;
  }
  return { results: investments };
}
async function serveStatic(pathname, response) {
  const requested = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const publicFiles = new Set(['/index.html', '/app.js', '/styles.css', '/personal.css', '/supabase-config.js']);
  if (!publicFiles.has(requested)) return json(response, 404, { error: 'Arquivo não encontrado.' });
  if (requested === '/supabase-config.js' && (supabaseUrl || supabasePublishableKey || productionMode)) {
    const config = { supabaseUrl, supabasePublishableKey, allowedGoogleEmail, requireAuth: productionMode };
    response.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    response.end(`window.GESTORPRO_CONFIG = ${JSON.stringify(config)};`);
    return;
  }
  const file = resolve(root, `.${requested}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) return json(response, 403, { error: 'Acesso negado.' });
  try {
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    response.end(content);
  } catch {
    json(response, 404, { error: 'Arquivo não encontrado.' });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${host}:${port}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { ok: true });
    if (request.method === 'GET' && url.pathname === '/api/openfinance/status') {
      return json(response, 200, { configured: Boolean(clientId && clientSecret), includeSandbox, mode: includeSandbox ? 'sandbox' : 'production' });
    }
    const user = productionMode && url.pathname.startsWith('/api/openfinance/') ? await requireAllowedGoogleUser(request) : null;
    if (request.method === 'POST' && url.pathname === '/api/openfinance/connect-token') {
      await readBody(request);
      const options = { clientUserId: user?.id || 'gestorpro-local-user', avoidDuplicates: true };
      const token = await pluggy('/connect_token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ options }) });
      return json(response, 200, { accessToken: token.accessToken, includeSandbox });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/openfinance/items/')) {
      const id = url.pathname.split('/').at(-1);
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) return json(response, 400, { error: 'Identificador de conexão inválido.' });
      return json(response, 200, await pluggy(`/items/${encodeURIComponent(id)}`));
    }
    if (request.method === 'GET' && url.pathname === '/api/openfinance/accounts') {
      const itemId = url.searchParams.get('itemId') || '';
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(itemId)) return json(response, 400, { error: 'Identificador de conexão inválido.' });
      return json(response, 200, await pluggy(`/accounts?itemId=${encodeURIComponent(itemId)}`));
    }
    if (request.method === 'GET' && url.pathname === '/api/openfinance/investments') {
      const itemId = url.searchParams.get('itemId') || '';
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(itemId)) return json(response, 400, { error: 'Identificador de conexão inválido.' });
      return json(response, 200, await listInvestments(itemId));
    }
    if (request.method === 'GET' && url.pathname === '/api/openfinance/transactions') {
      const accountId = url.searchParams.get('accountId') || '';
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(accountId)) return json(response, 400, { error: 'Identificador de conta inválido.' });
      return json(response, 200, await listTransactions(accountId));
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Rota não encontrada.' });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Método não permitido.' });
    return await serveStatic(url.pathname, response);
  } catch (error) {
    return json(response, error.statusCode || 502, { error: error.message || 'Não foi possível conectar à Pluggy.' });
  }
});

server.listen(port, host, () => {
  console.log(`GestorPro: http://${host}:${port}`);
  console.log(`Open Finance: ${includeSandbox ? 'sandbox' : 'produção'}${clientId && clientSecret ? ' (credenciais configuradas)' : ' (configure o arquivo .env)'}`);
});
