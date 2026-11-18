// Avlumi para computador — "casquinha" (Electron) que abre o site hospedado.
// Como carrega o site online, toda atualização publicada no Render aparece na hora,
// sem precisar reinstalar o .exe. Só o app em si atualiza de vez em quando (auto-update).
const { app, BrowserWindow, shell, session, desktopCapturer } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Endereço do site. Se um dia mudar (ex.: avlumi.com), basta trocar aqui e soltar nova versão.
const SITE = 'https://comunidade-online.onrender.com';

// Garante uma única instância aberta (clicar de novo foca a janela existente)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

let win;

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
  win.loadURL(SITE);

  // Links de fora do site abrem no navegador padrão (não dentro do app)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SITE)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Se cair a internet e a página falhar, tenta de novo em 3s
  win.webContents.on('did-fail-load', (_e, code) => {
    if (code !== -3) setTimeout(() => win && win.loadURL(SITE), 3000);
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // Libera microfone, câmera, compartilhar tela e notificações para o site
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
