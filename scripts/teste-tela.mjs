// Teste automático da tela embutida (roda no GitHub antes de publicar o app).
// Abre a pasta "app/" num Chrome invisível, duas vezes:
//   1) sem login  -> precisa aparecer a tela de entrar
//   2) com um usuário logado de mentira (o banco é simulado, nada vai pro Supabase de verdade)
// Se a tela quebrar (ficar preta / erro de JavaScript), o build FALHA e o app NÃO é publicado.
//
// Uso: node scripts/teste-tela.mjs [pasta-da-tela]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const PASTA = path.resolve(process.argv[2] || 'app');
const SUPA = process.env.VITE_SUPABASE_URL || 'https://satrygmogomtdvrrtapy.supabase.co';
const REF = new URL(SUPA).hostname.split('.')[0];

function acharChrome() {
  const opcoes = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const achado = opcoes.find((p) => fs.existsSync(p));
  if (!achado) throw new Error('Chrome não encontrado. Defina CHROME_PATH.');
  return achado;
}

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function servidor() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      let f = path.join(PASTA, path.normalize(p));
      if (!f.startsWith(PASTA) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        if (path.extname(p)) { res.statusCode = 404; return res.end(); }
        f = path.join(PASTA, 'index.html');
      }
      res.setHeader('Content-Type', TIPOS[path.extname(f)] || 'application/octet-stream');
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

const UID = '11111111-2222-3333-4444-555555555555';
const usuario = {
  id: UID, aud: 'authenticated', role: 'authenticated', email: 'teste@exemplo.com',
  app_metadata: { provider: 'email' }, user_metadata: { name: 'Teste' },
  created_at: '2026-01-01T00:00:00Z', is_anonymous: false,
};
const sessao = {
  access_token: 'x.eyJzdWIiOiIxIn0.x', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 36000, refresh_token: 'r', user: usuario,
};

async function rodar(browser, base, logado) {
  const nome = logado ? 'COM login' : 'SEM login';
  const page = await browser.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e && e.message || e)));
  // a proteção de erro da tela avisa no console quando algo quebra
  page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('a tela quebrou')) erros.push(m.text().slice(0, 300)); });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(base)) return r.continue();
    const json = (status, corpo) => r.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(corpo) });
    if (r.method() === 'OPTIONS') return json(200, {});
    if (u.includes('.supabase.co')) {
      if (u.includes('/auth/v1/user')) return json(200, usuario);
      if (u.includes('/rest/v1/rpc/')) return json(200, null);
      if (u.includes('/functions/')) return json(200, {});
      if (u.includes('/rest/v1/')) {
        const accept = r.headers()['accept'] || '';
        if (accept.includes('vnd.pgrst.object')) return json(406, { code: 'PGRST116', message: 'no rows' });
        return json(200, []);
      }
      return json(200, {});
    }
    // qualquer outra coisa de fora (fontes, captcha...) -> vazio
    return r.respond({ status: 200, body: '' });
  });
  if (logado) {
    await page.evaluateOnNewDocument((k, v) => { localStorage.setItem(k, v); }, `sb-${REF}-auth-token`, JSON.stringify(sessao));
  }
  await page.goto(base, { waitUntil: 'load', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 6000));
  const filhos = await page.evaluate(() => { const r = document.getElementById('root'); return r ? r.childElementCount : 0; });
  const texto = (await page.evaluate(() => document.body.innerText || '')).slice(0, 160).replace(/\s+/g, ' ');
  await page.close();
  const ok = filhos > 0 && erros.length === 0 && !texto.includes('Ops, algo deu errado');
  console.log(`${ok ? '✅' : '❌'} Tela ${nome}: ${filhos} elemento(s) | "${texto}"`);
  erros.forEach((e) => console.log('   erro:', e));
  return ok;
}

const srv = await servidor();
const base = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: acharChrome(), headless: true, args: ['--no-sandbox'] });
let tudoOk = false;
try {
  const a = await rodar(browser, base, false);
  const b = await rodar(browser, base, true);
  tudoOk = a && b;
} finally {
  await browser.close();
  srv.close();
}
if (!tudoOk) {
  console.log('\n❌ A tela quebrou no teste. O app NÃO será publicado (evita a tela preta para os usuários).');
  process.exit(1);
}
console.log('\n✅ Tela OK — pode publicar.');
