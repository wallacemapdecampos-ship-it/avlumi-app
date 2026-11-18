// Avlumi para computador — agora com a TELA EMBUTIDA (abre instantâneo, igual Discord).
// A tela (React) é compilada no GitHub e vai DENTRO do .exe, na pasta "app/".
// Por isso abre na hora, sem esperar a internet carregar a página.
// O conteúdo (mensagens, servidores etc.) continua vindo do banco online em tempo real.
// O app em si se atualiza sozinho de vez em quando (auto-update via GitHub Releases).
const { app, BrowserWindow, shell, session, desktopCapturer } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Tela embutida (arquivo local). Se um dia faltar (build sem embutir), cai pro site online.
const LOCAL_INDEX = path.join(__dirname, 'app', 'index.html');
const SITE = 'https://comunidade-online.onrender.com';
const fs = require('fs');
const TEM_LOCAL = fs.existsSync(LOCAL_INDEX);

// Garante uma única instância aberta (clicar de novo foca a janela existente)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win;

function carregarTela() {
  if (TEM_LOCAL) {
    win.loadFile(LOCAL_INDEX);
  } else {
    win.loadURL(SITE);
  }
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
  carregarTela();

  // Links externos (que não são a própria tela) abrem no navegador padrão
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('file://')) return { action: 'allow' };
    if (url.startsWith(SITE)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Se a tela online falhar (só acontece no modo sem embutir), tenta de novo em 3s
  win.webContents.on('did-fail-load', (_e, code) => {
    if (!TEM_LOCAL && code !== -3) setTimeout(() => win && win.loadURL(SITE), 3000);
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
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

  createWindow();

  // Auto-atualização: checa o GitHub Releases, baixa e instala ao reiniciar (igual Discord)
  try {
    autoUpdater.checkForUpdatesAndNotify();
    setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 1000 * 60 * 60); // a cada 1 hora
  } catch (_e) { /* sem rede / em desenvolvimento: ignora */ }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
