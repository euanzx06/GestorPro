const pluggyBase = 'https://api.pluggy.ai';

function send(response, status, body) {
  response.status(status).setHeader('Cache-Control', 'no-store').json(body);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Serviço externo respondeu ${response.status}.`);
  return data;
}

function supabaseHeaders(key) {
  return key.startsWith('sb_secret_')
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
}

async function findAllowedGoogleUser(url, key, email) {
  for (let page = 1; page <= 20; page += 1) {
    const result = await requestJson(`${url}/auth/v1/admin/users?page=${page}&per_page=100`, {
      headers: supabaseHeaders(key)
    });
    const users = Array.isArray(result.users) ? result.users : [];
    const user = users.find(candidate => String(candidate.email || '').toLowerCase() === email);
    if (user) {
      if (user.app_metadata?.provider !== 'google') throw new Error('A conta autorizada precisa usar Google.');
      return user;
    }
    if (users.length < 100) break;
  }
  throw new Error('A conta Google autorizada não foi encontrada.');
}

async function getPluggyKey() {
  const response = await requestJson(`${pluggyBase}/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET })
  });
  if (!response.apiKey) throw new Error('Não foi possível autenticar com a Pluggy.');
  return response.apiKey;
}

async function pluggy(path, key) {
  return requestJson(`${pluggyBase}${path}`, { headers: { 'X-API-KEY': key } });
}

async function collectTransactions(itemIds, key, dateFrom, dateTo) {
  const all = [];
  const seenAccounts = new Set();
  for (const itemId of itemIds.slice(0, 10)) {
    const accounts = await pluggy(`/accounts?itemId=${encodeURIComponent(itemId)}`, key);
    for (const account of (accounts.results || []).slice(0, 20)) {
      if (!account.id || seenAccounts.has(account.id)) continue;
      seenAccounts.add(account.id);
      let path = `/v2/transactions?accountId=${encodeURIComponent(account.id)}&dateFrom=${dateFrom}&dateTo=${dateTo}`;
      const visited = new Set();
      for (let page = 0; path && page < 20; page += 1) {
        if (visited.has(path)) break;
        visited.add(path);
        const data = await pluggy(path, key);
        all.push(...(Array.isArray(data.results) ? data.results : []));
        if (!data.next) break;
        const next = new URL(data.next, `${pluggyBase}/v2/transactions`);
        if (next.origin !== pluggyBase || next.pathname !== '/v2/transactions') break;
        path = `${next.pathname}${next.search}`;
      }
    }
  }
  return all;
}

function brazilDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function analyze(transactions, today, savingsPots = []) {
  const end = new Date(`${today}T12:00:00-03:00`);
  const start = new Date(end); start.setDate(start.getDate() - 30);
  const previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - 30);
  const iso = date => date.toISOString().slice(0, 10);
  const categoryOf = tx => String(tx._categoryOverride || tx.category || tx.categoryDescription || 'Sem categoria').slice(0, 60);
  const isInternal = tx => /transfer[eê]ncia entre contas|entre minhas contas|conta pr[oó]pria|transfer[êe]ncia interna|internal transfer|own account|fixed income investment|investment|aplica[cç][aã]o|caixinha|rdb/i.test(`${tx.description || ''} ${categoryOf(tx)} ${tx.operationType || ''}`);
  const expenses = transactions.filter(tx => (Number(tx.amount) < 0 || tx.type === 'DEBIT') && !isInternal(tx));
  const current = expenses.filter(tx => String(tx.date || '').slice(0, 10) >= iso(start) && String(tx.date || '').slice(0, 10) <= today);
  const previous = expenses.filter(tx => String(tx.date || '').slice(0, 10) >= iso(previousStart) && String(tx.date || '').slice(0, 10) < iso(start));
  const sums = list => list.reduce((acc, tx) => { const key = categoryOf(tx); acc[key] = (acc[key] || 0) + Math.abs(Number(tx.amount)); return acc; }, {});
  const currentByCategory = sums(current), previousByCategory = sums(previous);
  const alerts = Object.entries(currentByCategory).map(([category, amount]) => {
    const baseline = previousByCategory[category] || 0;
    return { category, amount: Math.round(amount * 100) / 100, previousAmount: Math.round(baseline * 100) / 100, increase: Math.round((amount - baseline) * 100) / 100 };
  }).filter(row => row.increase >= 100 && row.amount > row.previousAmount * 1.5).sort((a, b) => b.increase - a.increase).slice(0, 5);
  const total = current.reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0);
  const outstandingGoal = savingsPots.find(pot => Number(pot.goal) > Number(pot.balance));
  const goalProgressTip = outstandingGoal
    ? `Na meta “${String(outstandingGoal.name || 'Minha meta').slice(0, 60)}”, faltam ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(outstandingGoal.goal) - Number(outstandingGoal.balance))}. Escolha um aporte que caiba no seu orçamento.`
    : 'Defina uma meta com nome, valor e prazo que caibam na sua renda disponível.';
  const goalTips = alerts.length
    ? ['Confira se os gastos destacados estão categorizados corretamente.', 'Escolha uma pequena redução possível nesta semana e direcione a diferença para uma meta.', goalProgressTip]
    : [goalProgressTip, 'Separe primeiro um valor sustentável para a meta; ajuste-o depois de observar seus gastos por algumas semanas.'];
  return { period_start: iso(start), period_end: today, expense_total: Math.round(total * 100) / 100, transaction_count: current.length, category_totals: currentByCategory, alerts, coaching: goalTips, previous_period_total: Math.round(previous.reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0) * 100) / 100 };
}

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') return send(response, 405, { error: 'Método não permitido.' });
  const cronSecret = process.env.CRON_SECRET || '';
  const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!cronSecret || supplied.length !== cronSecret.length || supplied !== cronSecret) return send(response, 401, { error: 'Não autorizado.' });
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const email = String(process.env.GESTORPRO_ALLOWED_GOOGLE_EMAIL || '').trim().toLowerCase();
  if (!supabaseUrl || !supabaseKey || !email || !process.env.PLUGGY_CLIENT_ID || !process.env.PLUGGY_CLIENT_SECRET) return send(response, 503, { error: 'Faltam configurações privadas necessárias para a revisão diária.' });
  try {
    const user = await findAllowedGoogleUser(supabaseUrl, supabaseKey, email);
    const stored = await requestJson(`${supabaseUrl}/rest/v1/personal_finance_data?user_id=eq.${encodeURIComponent(user.id)}&select=payload`, { headers: supabaseHeaders(supabaseKey) });
    const itemIds = (stored[0]?.payload?.openFinanceItems || []).map(item => item?.id).filter(id => typeof id === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(id));
    if (!itemIds.length) return send(response, 200, { ok: true, skipped: 'Nenhuma conexão Open Finance autorizada.' });
    const today = brazilDate();
    const from = new Date(`${today}T12:00:00-03:00`); from.setDate(from.getDate() - 60);
    const transactions = await collectTransactions(itemIds, await getPluggyKey(), from.toISOString().slice(0, 10), today);
    const payload = stored[0]?.payload || {};
    const overrides = payload.transactionCategoryOverrides || {};
    const categorized = transactions.map(tx => ({ ...tx, _categoryOverride: overrides[`pluggy-${tx.id}`] || '' }));
    const review = analyze(categorized, today, Array.isArray(payload.savingsPots) ? payload.savingsPots : []);
    const saved = await requestJson(`${supabaseUrl}/rest/v1/daily_financial_reviews`, {
      method: 'POST', headers: { ...supabaseHeaders(supabaseKey), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: user.id, review_date: today, ...review })
    });
    return send(response, 200, { ok: true, reviewDate: today, transactionCount: transactions.length, ...saved });
  } catch (error) {
    console.error('Falha na revisão financeira diária:', error.message);
    return send(response, 502, { error: 'Não foi possível concluir a revisão diária. Confira a conexão no GestorPro e tente novamente.' });
  }
}
