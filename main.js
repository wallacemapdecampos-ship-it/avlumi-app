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
let urlLocal = null;

function enderecoDeCarga() {
  if (TEM_LOCAL && urlLocal) return urlLocal;
  return SITE;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0b12',
    title: 'Avlumi',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(enderecoDeCarga());

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

  // Auto-atualização: checa o GitHub Releases, baixa e instala ao reiniciar (igual Discord)
  try {
    autoUpdater.checkForUpdatesAndNotify();
    setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 1000 * 60 * 60); // a cada 1 hora
  } catch (_e) { /* sem rede / em desenvolvimento: ignora */ }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
