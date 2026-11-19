// Avlumi para computador — TELA EMBUTIDA servida por um mini-servidor local.
// A tela (React) é compilada no GitHub e vai DENTRO do .exe, na pasta "app/".
// Em vez de abrir o arquivo solto (file://), um servidorzinho local serve a tela
// em http://127.0.0.1:PORTA. Isso:
//   1) continua abrindo instantâneo (arquivos já estão no PC), e
//   2) dá um "endereço de verdade", então a verificação "não sou robô"
//      (Cloudflare Turnstile) funciona — ela sempre libera localhost/127.0.0.1.
// O conteúdo (mensagens, servidores etc.) continua vindo do banco online em tempo real.
// O app se atualiza sozinho de vez em quando (auto-update via GitHub Releases).
const { app, BrowserWindow, shell, session, desktopCapturer } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');

const APP_DIR = path.join(__dirname, 'app');
const LOCAL_INDEX = path.join(APP_DIR, 'index.html');
const TEM_LOCAL = fs.existsSync(LOCAL_INDEX);
const SITE = 'https://comunidade-online.onrender.com'; // reserva, se não houver tela embutida

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
          // rota desconhecida -> entrega o index (app de página única)
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
    // porta 0 = o sistema escolhe uma livre (evita conflito)
    server.listen(0, '127.0.0.1', () => {
      const porta = server.address().port;
      resolve('http://127.0.0.1:' + porta + '/');
    });
    server.on('error', () => resolve(null));
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

function enderecoDeCarga() {
  if (TEM_LOCAL && urlLocal) return urlLocal;
  return SITE;
}

// Tela de abertura (igual Discord): aparece instantânea com a logo enquanto a tela principal carrega
function criarSplash() {
  if (!TEM_SPLASH) return;
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
    if (win) { win.show(); win.focus(); }
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
    icon: path.join(__dirname, 'build', 'icon.png'),
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
    if (url.startsWith('http://127.0.0.1')) return { action: 'allow' };
    if (url.startsWith(SITE)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Se a página falhar ao carregar, tenta de novo em 3s
  win.webContents.on('did-fail-load', (_e, code) => {
    if (code !== -3) setTimeout(() => win && win.loadURL(enderecoDeCarga()), 3000);
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(async () => {
  // Mostra a tela de abertura IMEDIATAMENTE (igual Discord), antes de qualquer coisa
  criarSplash();

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
