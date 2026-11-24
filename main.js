// Avlumi para computador — TELA EMBUTIDA servida por um mini-servidor local.
// A tela (React) é compilada no GitHub e vai DENTRO do .exe, na pasta "app/".
// Em vez de abrir o arquivo solto (file://), um servidorzinho local serve a tela
// em http://127.0.0.1:PORTA. Isso:
//   1) continua abrindo instantâneo (arquivos já estão no PC), e
//   2) dá um "endereço de verdade", então a verificação "não sou robô"
//      (Cloudflare Turnstile) funciona — ela sempre libera localhost/127.0.0.1.
// O conteúdo (mensagens, servidores etc.) continua vindo do banco online em tempo real.
// O app se atualiza sozinho de vez em quando (auto-update via GitHub Releases).
const { app, BrowserWindow, shell, session, desktopCapturer, Tray, Menu, nativeImage, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');

const APP_DIR = path.join(__dirname, 'app');
const LOCAL_INDEX = path.join(APP_DIR, 'index.html');
const TEM_LOCAL = fs.existsSync(LOCAL_INDEX);
const SITE = 'https://comunidade-online.onrender.com'; // reserva, se não houver tela embutida
const PORTA_FIXA = 47821; // porta fixa = mesmo "endereço" sempre, então o login fica salvo entre aberturas

// ===== Diário (log) — ajuda a descobrir o que deu errado se a tela ficar preta =====
// Fica em %APPDATA%\Avlumi\avlumi-log.txt
let LOG_FILE = null;
try { LOG_FILE = path.join(app.getPath('userData'), 'avlumi-log.txt'); } catch (_e) {}
function log(...partes) {
  const linha = new Date().toISOString() + ' ' + partes.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ') + '\n';
  try {
    if (!LOG_FILE) return;
    // mantém o arquivo pequeno
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 512 * 1024) fs.writeFileSync(LOG_FILE, '');
    fs.appendFileSync(LOG_FILE, linha);
  } catch (_e) {}
}
const errosDaTela = []; // últimos erros que a tela mostrou no console
function guardarErro(txt) {
  errosDaTela.push(String(txt).slice(0, 600));
  if (errosDaTela.length > 15) errosDaTela.shift();
  log('[tela]', txt);
}

// ===== Placa de vídeo: se ela travar (causa clássica de janela preta no Windows), =====
// a próxima abertura usa o modo sem aceleração de vídeo.
const FLAG_SEM_GPU = LOG_FILE ? path.join(path.dirname(LOG_FILE), 'sem-gpu.flag') : null;

// ===== Preferências (perto do relógio / iniciar com o Windows) =====
const PREFS_FILE = LOG_FILE ? path.join(path.dirname(LOG_FILE), 'preferencias.json') : null;
function lerPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch (_e) { return {}; }
}
function salvarPrefs(p) {
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2)); } catch (_e) {}
}
let prefs = lerPrefs();
if (prefs.fecharParaBandeja === undefined) prefs.fecharParaBandeja = true; // igual Discord
// aberto pelo Windows ao ligar o PC -> começa escondido perto do relógio
const ABRIU_OCULTO = process.argv.includes('--oculto');
let saindoDeVerdade = false; // true = o usuário escolheu "Sair" (ou o app vai reiniciar para atualizar)
let tray = null;
if (FLAG_SEM_GPU && fs.existsSync(FLAG_SEM_GPU)) {
  app.disableHardwareAcceleration();
  log('abrindo sem aceleração de vídeo (placa de vídeo travou antes)');
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Sobe o mini-servidor local e devolve a URL (ex.: http://127.0.0.1:53421/)
function iniciarServidorLocal() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
        if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
        // segurança: impede sair da pasta app/
        let destino = path.join(APP_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
        if (!destino.startsWith(APP_DIR)) destino = LOCAL_INDEX;
        if (!fs.existsSync(destino) || fs.statSync(destino).isDirectory()) {
          // Arquivo (com extensão, ex.: .js/.css) que não existe -> 404 de verdade.
          // Antes devolvia o index.html no lugar do .js, o que quebrava a tela em silêncio (tela preta).
          if (path.extname(urlPath)) {
            log('arquivo não encontrado', urlPath);
            res.statusCode = 404;
            res.end('Não encontrado');
            return;
          }
          // rota desconhecida (sem extensão) -> entrega o index (app de página única)
          destino = LOCAL_INDEX;
        }
        const ext = path.extname(destino).toLowerCase();
        res.setHeader('Content-Type', TIPOS[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(destino).pipe(res);
      } catch (e) {
        res.statusCode = 500;
        res.end('Erro interno');
      }
    });
    // Tenta a porta fixa (o login fica salvo). Se estiver ocupada, usa qualquer uma livre.
    let tentouLivre = false;
    server.on('listening', () => {
      const porta = server.address().port;
      log('servidor local na porta', porta);
      resolve('http://127.0.0.1:' + porta + '/');
    });
    server.on('error', (err) => {
      if (!tentouLivre) {
        tentouLivre = true;
        log('porta fixa ocupada, usando outra', err && err.code);
        try { server.listen(0, '127.0.0.1'); return; } catch (_e) {}
      }
      log('servidor local falhou', err && err.message);
      resolve(null);
    });
    server.listen(PORTA_FIXA, '127.0.0.1');
  });
}

// Garante uma única instância aberta (clicar de novo foca a janela existente)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win;
let splash;
let urlLocal = null;
let telaPronta = false;
let winPronta = false;    // a tela principal terminou de carregar
let liberadoAbrir = false; // a verificação de atualização já decidiu que pode abrir
let atualizando = false;   // há uma atualização sendo baixada/instalada agora
const SPLASH_FILE = path.join(__dirname, 'splash.html');
const TEM_SPLASH = fs.existsSync(SPLASH_FILE);
const INICIO = Date.now();

// Escreve um aviso na tela de abertura (ex.: "Baixando atualização… 42%")
function splashStatus(txt) {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(txt)})`).catch(() => {});
  }
}
function splashProgress(pct) {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.executeJavaScript(`window.setProgress && window.setProgress(${Number(pct) || 0})`).catch(() => {});
  }
}

// Abre a tela principal só quando ela estiver pronta E a verificação de atualização liberar
function tentarAbrir() {
  if (atualizando) return;           // tem atualização em andamento: segura na splash
  if (winPronta && liberadoAbrir) mostrarTela();
}

let usarOnline = false; // vira true se a tela embutida ficar preta mesmo após limpar o cache
function enderecoDeCarga() {
  if (!usarOnline && TEM_LOCAL && urlLocal) return urlLocal;
  return SITE;
}

// ===== Detector de tela preta =====
// Se a tela (React) quebrar, ela some inteira e só sobra o fundo escuro.
// Depois que a página carrega, conferimos se apareceu algo. Se não apareceu:
//   1ª vez: limpa o cache/service worker e recarrega
//   2ª vez: abre a versão online do site
//   3ª vez: mostra uma tela de ajuda com o erro e botões (em vez de ficar preto)
let tentativasTelaVazia = 0;
let mostrandoAjuda = false;
let timerConferir = null;

function conferirTela() {
  clearTimeout(timerConferir);
  timerConferir = setTimeout(async () => {
    if (!win || win.isDestroyed() || mostrandoAjuda) return;
    let filhos = -1;
    try {
      filhos = await win.webContents.executeJavaScript(
        "(function(){var r=document.getElementById('root');return r?r.childElementCount:0})()", true);
    } catch (_e) { filhos = 0; }
    if (filhos > 0) {
      if (tentativasTelaVazia) log('tela apareceu depois de', tentativasTelaVazia, 'tentativa(s)');
      tentativasTelaVazia = 0;
      return;
    }
    tentativasTelaVazia++;
    log('TELA VAZIA detectada (tentativa ' + tentativasTelaVazia + ') em', win.webContents.getURL(), errosDaTela.slice(-3));
    winPronta = true; liberadoAbrir = true; tentarAbrir(); // nunca deixa preso na splash
    if (tentativasTelaVazia === 1) {
      try { await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }); } catch (_e) {}
      win.loadURL(enderecoDeCarga());
    } else if (tentativasTelaVazia === 2 && !usarOnline) {
      usarOnline = true;
      win.loadURL(SITE);
    } else {
      mostrarAjuda();
    }
  }, 8000);
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Tela de ajuda (aparece no lugar da tela preta)
function mostrarAjuda() {
  if (!win || win.isDestroyed()) return;
  mostrandoAjuda = true;
  const erros = errosDaTela.length ? errosDaTela.slice(-5).map(esc).join('<br><br>') : 'Nenhum erro registrado.';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Avlumi</title>
<style>body{margin:0;background:#0a0b12;color:#e8e6f5;font-family:Segoe UI,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.c{max-width:560px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#a9a6c4;line-height:1.5}
a.b{display:inline-block;margin:6px;padding:11px 18px;border-radius:10px;background:#7c5cff;color:#fff;text-decoration:none;font-weight:600}
a.s{background:#23243a}details{margin-top:22px;text-align:left;color:#8d8aa8;font-size:12px}code{display:block;white-space:pre-wrap;word-break:break-word;margin-top:8px}</style></head>
<body><div class="c"><h1>A tela da Avlumi não carregou</h1>
<p>Algo deu errado ao abrir. Tente uma das opções abaixo.</p>
<a class="b" target="_blank" href="avlumi://tentar">Tentar de novo</a>
<a class="b s" target="_blank" href="avlumi://online">Abrir versão online</a>
<a class="b s" target="_blank" href="avlumi://limpar">Limpar dados e tentar (vai pedir login)</a>
<details><summary>Detalhes do erro (para o suporte)</summary><code>${erros}</code>
<code>Arquivo de diário: ${esc(LOG_FILE || '')}</code></details></div></body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

async function acaoDaAjuda(acao) {
  log('ajuda: usuário escolheu', acao);
  mostrandoAjuda = false;
  tentativasTelaVazia = 0;
  if (acao === 'online') usarOnline = true;
  if (acao === 'tentar') usarOnline = false;
  if (acao === 'limpar') {
    usarOnline = false;
    try { await session.defaultSession.clearStorageData(); } catch (_e) {}
    try { await session.defaultSession.clearCache(); } catch (_e) {}
  }
  if (win && !win.isDestroyed()) win.loadURL(enderecoDeCarga());
}

// Tela de abertura (igual Discord): aparece instantânea com a logo enquanto a tela principal carrega
function criarSplash() {
  if (!TEM_SPLASH || ABRIU_OCULTO) return;
  splash = new BrowserWindow({
    width: 380,
    height: 300,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    backgroundColor: '#0c0d1a',
    title: 'Avlumi',
    icon: path.join(__dirname, 'build', 'icon.png'),
    skipTaskbar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splash.loadFile(SPLASH_FILE);
  splash.once('ready-to-show', () => splash && splash.show());
}

// Fecha a splash e mostra a tela principal (com um tempo mínimo pra não "piscar")
function mostrarTela() {
  if (telaPronta || atualizando) return;
  telaPronta = true;
  const minimo = 900; // ms — garante que a logo apareça por um instante
  const espera = Math.max(0, minimo - (Date.now() - INICIO));
  setTimeout(() => {
    if (win && !ABRIU_OCULTO) { win.show(); win.focus(); }
    if (splash) { try { splash.destroy(); } catch (_e) {} splash = null; }
  }, espera);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false, // só aparece quando a tela terminar de carregar (a splash cobre esse tempo)
    backgroundColor: '#0a0b12',
    title: 'Avlumi',
    icon: caminhoIcone(),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(enderecoDeCarga());

  // Quando a tela principal pintar, marca como pronta e tenta abrir (se a atualização liberar)
  const marcarPronta = () => { winPronta = true; tentarAbrir(); };
  win.once('ready-to-show', marcarPronta);
  win.webContents.once('did-finish-load', marcarPronta);
  // Rede de segurança: se algo travar, abre a tela de qualquer jeito em 20s (a não ser que esteja atualizando)
  setTimeout(() => { winPronta = true; liberadoAbrir = true; tentarAbrir(); }, 20000);

  // Links que não são da própria tela abrem no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('avlumi://mostrar')) { mostrarJanela(); return { action: 'deny' }; }
    if (url.startsWith('avlumi://icone/')) { trocarIcone(url.slice('avlumi://icone/'.length).replace(/[^a-z]/g, '')); return { action: 'deny' }; }
    if (url.startsWith('avlumi://')) { acaoDaAjuda(url.slice('avlumi://'.length).replace(/\/+$/, '')); return { action: 'deny' }; }
    if (url.startsWith('http://127.0.0.1')) return { action: 'allow' };
    if (url.startsWith(SITE)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  let falhas = 0;
  // Fechar a janela = esconder perto do relógio (igual Discord). Continua recebendo mensagens.
  win.on('close', (e) => {
    if (saindoDeVerdade || !prefs.fecharParaBandeja || !tray) return;
    e.preventDefault();
    win.hide();
    if (!prefs.avisouBandeja) {
      prefs.avisouBandeja = true; salvarPrefs(prefs);
      try {
        if (Notification.isSupported()) new Notification({ title: 'A Avlumi continua aberta', body: 'Ela fica aqui perto do relógio para você receber as mensagens. Para fechar de vez: clique com o botão direito no ícone → Sair.', icon: path.join(__dirname, 'build', 'icon.png') }).show();
      } catch (_e) {}
    }
  });

  // Cada vez que a tela termina de carregar, confere se ela apareceu de verdade
  win.webContents.on('did-finish-load', () => {
    const url = win.webContents.getURL();
    if (!url.startsWith('data:')) { falhas = 0; conferirTela(); }
  });

  // Guarda os erros da tela (aparecem na tela de ajuda e no diário)
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) guardarErro(message + (sourceId ? ' (' + String(sourceId).split('/').pop() + ':' + line + ')' : ''));
  });
  win.webContents.on('preload-error', (_e, _p, err) => guardarErro('preload: ' + (err && err.message)));

  // Se a tela travar ou fechar sozinha, recarrega
  win.webContents.on('render-process-gone', (_e, details) => {
    log('tela fechou sozinha', details);
    if (details.reason !== 'clean-exit') setTimeout(() => win && !win.isDestroyed() && win.loadURL(enderecoDeCarga()), 1000);
  });
  win.webContents.on('unresponsive', () => log('tela não responde'));

  // Atalhos: F5 / Ctrl+R recarrega, Ctrl+Shift+I abre as ferramentas (para diagnóstico)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    if (k === 'f5' || (input.control && k === 'r')) { event.preventDefault(); mostrandoAjuda = false; win.loadURL(enderecoDeCarga()); }
    if (input.control && input.shift && k === 'i') { event.preventDefault(); win.webContents.toggleDevTools(); }
  });

  // Se a página falhar ao carregar, tenta de novo em 3s (até 5 vezes; depois mostra a ajuda)
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (code === -3 || isMainFrame === false) return; // -3 = carga cancelada (normal)
    falhas++;
    log('falha ao carregar', code, desc, url);
    if (falhas > 5) { guardarErro('Não conseguiu carregar: ' + desc + ' (' + code + ')'); mostrarAjuda(); return; }
    setTimeout(() => win && !win.isDestroyed() && win.loadURL(enderecoDeCarga()), 3000);
  });
}

app.on('second-instance', () => mostrarJanela());

function mostrarJanela() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ===== Ícone perto do relógio (bandeja do Windows) =====
function iniciarComWindows() {
  try { return app.getLoginItemSettings({ args: ['--oculto'] }).openAtLogin; } catch (_e) { return false; }
}
function definirIniciarComWindows(ligar) {
  try { app.setLoginItemSettings({ openAtLogin: !!ligar, args: ['--oculto'] }); } catch (_e) {}
  prefs.iniciarComWindows = !!ligar; salvarPrefs(prefs);
  log('iniciar com o Windows:', !!ligar);
}
function montarMenuBandeja() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir a Avlumi', click: mostrarJanela },
    { type: 'separator' },
    { label: 'Iniciar junto com o Windows', type: 'checkbox', checked: iniciarComWindows(), click: (it) => { definirIniciarComWindows(it.checked); montarMenuBandeja(); } },
    { label: 'Fechar a janela deixa a Avlumi aqui', type: 'checkbox', checked: !!prefs.fecharParaBandeja, click: (it) => { prefs.fecharParaBandeja = it.checked; salvarPrefs(prefs); } },
    { type: 'separator' },
    { label: 'Sair da Avlumi', click: () => { saindoDeVerdade = true; app.quit(); } },
  ]));
}
// ===== Ícone alternativo (Lumen) =====
function caminhoIcone() {
  const n = prefs.icone;
  if (n && /^[a-z]+$/.test(n) && n !== 'roxo') {
    const p = path.join(__dirname, 'build', 'icones', n + '.png');
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'build', 'icon.png');
}
function trocarIcone(nome) {
  if (!nome) return;
  prefs.icone = nome; salvarPrefs(prefs);
  const p = caminhoIcone();
  try { if (win && !win.isDestroyed()) win.setIcon(p); } catch (_e) {}
  try { if (tray) { let img = nativeImage.createFromPath(p); if (!img.isEmpty()) img = img.resize({ width: 16, height: 16, quality: 'best' }); tray.setImage(img); } } catch (_e) {}
  log('ícone trocado para', nome);
}

function criarBandeja() {
  try {
    let img = nativeImage.createFromPath(caminhoIcone());
    if (!img.isEmpty()) img = img.resize({ width: 16, height: 16, quality: 'best' });
    tray = new Tray(img);
    tray.setToolTip('Avlumi');
    tray.on('click', mostrarJanela);
    tray.on('double-click', mostrarJanela);
    montarMenuBandeja();
  } catch (e) { log('bandeja falhou', e && e.message); tray = null; }
}

// Placa de vídeo travou → marca para a próxima abertura usar o modo sem aceleração e reinicia
app.on('child-process-gone', (_e, details) => {
  log('processo fechou', details);
  if (details && details.type === 'GPU' && details.reason !== 'clean-exit' && FLAG_SEM_GPU && !fs.existsSync(FLAG_SEM_GPU)) {
    try { fs.writeFileSync(FLAG_SEM_GPU, new Date().toISOString()); } catch (_e) {}
    app.relaunch();
    app.exit(0);
  }
});

app.whenReady().then(async () => {
  log('---- abrindo Avlumi', app.getVersion(), '| tela embutida:', TEM_LOCAL, '| windows', process.getSystemVersion ? process.getSystemVersion() : '');
  // Mostra a tela de abertura IMEDIATAMENTE (igual Discord), antes de qualquer coisa
  criarSplash();
  criarBandeja();
  // 1ª vez: já deixa "iniciar junto com o Windows" ligado (igual Discord). Dá pra desligar no ícone.
  if (prefs.iniciarComWindows === undefined && app.isPackaged) { definirIniciarComWindows(true); montarMenuBandeja(); }

  // Libera microfone, câmera, compartilhar tela e notificações para a tela
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'audioCapture', 'videoCapture', 'display-capture', 'notifications',
        'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });

  // Compartilhar tela (getDisplayMedia) — compartilha a tela principal
  session.defaultSession.setDisplayMediaRequestHandler((_request, cb) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      cb(sources && sources.length ? { video: sources[0], audio: 'loopback' } : {});
    }).catch(() => cb({}));
  });

  // Sobe o servidor local (se a tela estiver embutida) antes de abrir a janela
  if (TEM_LOCAL) {
    try { urlLocal = await iniciarServidorLocal(); } catch (_e) { urlLocal = null; }
  }

  createWindow();

  // ===== Atualização ao abrir (igual Discord) =====
  // Ao abrir, checa o GitHub Releases. Se tiver versão nova: baixa na própria tela de
  // abertura (mostrando o progresso) e aplica NA HORA, reiniciando já atualizado.
  // Se não tiver (ou der erro/sem internet), abre o app normalmente.
  function liberar() { liberadoAbrir = true; tentarAbrir(); }

  try {
    autoUpdater.autoDownload = true;          // baixa sozinho quando acha atualização
    autoUpdater.autoInstallOnAppQuit = true;  // reserva: se abrir sem atualizar, instala ao fechar

    autoUpdater.on('update-available', () => {
      atualizando = true;                     // segura na splash até terminar
      splashStatus('Atualização disponível, baixando…');
      splashProgress(0);
    });
    autoUpdater.on('download-progress', (p) => {
      atualizando = true;
      splashStatus('Baixando atualização… ' + Math.round(p.percent || 0) + '%');
      splashProgress(p.percent || 0);
    });
    autoUpdater.on('update-downloaded', () => {
      splashStatus('Instalando atualização…');
      splashProgress(100);
      // aplica e reinicia já na versão nova
      setTimeout(() => { try { autoUpdater.quitAndInstall(true, true); } catch (_e) { atualizando = false; liberar(); } }, 900);
    });
    autoUpdater.on('update-not-available', liberar); // já está na versão mais nova → abre
    autoUpdater.on('error', () => { atualizando = false; liberar(); }); // sem internet/erro → abre mesmo assim

    autoUpdater.checkForUpdates();

    // Se a checagem demorar demais sem achar nada, abre o app (não trava esperando)
    setTimeout(() => { if (!atualizando) liberar(); }, 9000);
    // Rede de segurança: se uma atualização travar no meio, desiste e abre em 90s
    setTimeout(() => { if (atualizando && !telaPronta) { atualizando = false; liberar(); } }, 90000);

    // Enquanto o app estiver aberto, continua checando de hora em hora (instala ao fechar)
    setInterval(() => { try { autoUpdater.checkForUpdates(); } catch (_e) {} }, 1000 * 60 * 60);
  } catch (_e) {
    // em desenvolvimento ou sem configuração de update: só abre o app
    liberar();
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ===== Login salvo (igual Discord) =====
// O login fica guardado no armazenamento da tela (endereço fixo 127.0.0.1:47821).
// Antes de fechar — inclusive quando o app reinicia para atualizar — força gravar
// tudo no disco, para o Windows não fechar o app antes de o login ser salvo.
let gravouAoSair = false;
app.on('before-quit', (e) => {
  saindoDeVerdade = true; // deixa a janela fechar de verdade (Sair, ou reiniciar para atualizar)
  if (gravouAoSair) return;
  e.preventDefault();
  gravouAoSair = true;
  const sair = () => { log('login gravado, fechando'); app.quit(); };
  try {
    Promise.resolve(session.defaultSession.flushStorageData())
      .catch(() => {})
      .then(() => setTimeout(sair, 150));
    setTimeout(sair, 2000); // nunca trava o fechamento
  } catch (_e) { sair(); }
});
// e também grava de tempos em tempos (caso o PC desligue de repente)
app.whenReady().then(() => {
  setInterval(() => { try { session.defaultSession.flushStorageData(); } catch (_e) {} }, 60 * 1000);
});

