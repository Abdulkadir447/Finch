const { app, BrowserWindow, session, ipcMain, net } = require('electron');
const path = require('path');
const { createDataLayer, defaultDbPath } = require('./db');
const { createDataLayerApp } = require('./dataLayerApp');

// ---------------------------------------------------------------------------
// Content Security Policy for the Co-op desktop app.
//
// Applied to navigation responses via session.webRequest.onHeadersReceived.
// Sources follow Clerk's official manual CSP configuration
// (https://clerk.com/docs/security/clerk-csp), adapted for Electron:
//
//   * script-src  — Co-op's Clerk DEVELOPMENT Frontend API host serves
//                   clerk.browser.js; challenges.cloudflare.com (Clerk bot
//                   protection) and *.protect.clerk.com (Clerk abuse/fraud
//                   protection) are required by Clerk docs. 'unsafe-eval' is
//                   kept for the Vite/React dev runtime; 'unsafe-inline' is
//                   required by Clerk JS script injection.
//   * connect-src — Clerk JS API calls to the Frontend API, plus
//                   *.accounts.dev (development hosted auth flows) and
//                   *.protect.clerk.com.
//   * img-src     — img.clerk.com hosts Clerk avatars/images; data: covers
//                   Ant Design inline SVG/data-URI assets.
//   * worker-src  — Clerk uses Web Workers (blob: workers).
//   * frame-src   — development hosted pages and Clerk challenge frames.
//   * form-action / base-uri / object-src — hardening, per CSP best practice.
//
// When Co-op moves to a production Clerk instance, replace the
// bursting-swan-43.clerk.accounts.dev host with the production Frontend API
// hostname (e.g. https://clerk.coop.example).
// ---------------------------------------------------------------------------
// The Clerk Frontend API host is parameterised (Task 11 / audit H5): production
// builds set CLERK_FRONTEND_API in the environment; otherwise the development
// instance is used. Keeping it a single variable keeps the CSP self-consistent.
const CLERK_FAPI_DEV = 'https://bursting-swan-43.clerk.accounts.dev';
const CLERK_FAPI = process.env.CLERK_FRONTEND_API
  ? `https://${process.env.CLERK_FRONTEND_API}`
  : CLERK_FAPI_DEV;
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CLERK_FAPI} https://challenges.cloudflare.com https://*.protect.clerk.com`,
  `connect-src 'self' ${CLERK_FAPI} https://*.accounts.dev https://*.protect.clerk.com`,
  "img-src 'self' data: https://img.clerk.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `frame-src 'self' https://*.accounts.dev https://challenges.cloudflare.com https://*.protect.clerk.com`,
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

function createWindow () {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  const win = new BrowserWindow({
    // Sane default for a dashboard app (Stage 2.4 QA).
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    // Match the design canvas to avoid a white flash before React paints.
    backgroundColor: '#fcf8ff',
    title: 'Co-op',
    icon: path.join(__dirname, 'coop-icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Show only once the first paint is ready (no blank-frame flicker).
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Use an absolute path relative to this script (frontend/dist/index.html).
  const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  win.loadFile(indexPath);
  return win;
}

// ---------------------------------------------------------------------------
// Local data layer (offline-first, ADR-002).
//
// Electron owns SQLite. The renderer reaches it ONLY through the allow-listed
// IPC methods below — there is no generic "call any method" channel.
// ---------------------------------------------------------------------------
let dataLayer = null;
let dataLayerApp = null; // createDataLayerApp(dataLayer) — shared handler surface

let mainWindow = null;

function broadcastSync(win) {
  if (dataLayerApp && win && !win.isDestroyed()) {
    win.webContents.send('coop:sync', dataLayerApp.status());
  }
}

function registerDataLayerIpc() {
  const handlers = dataLayerApp.handlers;
  handlers._onStatusChange(() => {
    if (mainWindow && !mainWindow.isDestroyed()) broadcastSync(mainWindow);
  });
  ipcMain.handle('coop:db', (event, { method, arg }) => {
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, method)) {
      throw new Error(`Blocked non-allow-listed data-layer method: ${method}`);
    }
    return handlers[method](arg);
  });
}

// Connectivity detection; the renderer's sync engine (OFFLINE 3) reacts to
// these events, and the status broadcast keeps the visible pill fresh.
function watchConnectivity(win) {
  const update = () => {
    const online = dataLayerApp.handlers.setOnline(net.isOnline());
    if (win && !win.isDestroyed()) {
      win.webContents.send('coop:net', { online });
    }
  };
  net.on('online', update);
  net.on('offline', update);
  update();
}

app.whenReady().then(() => {
  dataLayer = createDataLayer(defaultDbPath(app.getPath('userData')));
  dataLayerApp = createDataLayerApp(dataLayer); // cold start: trust an existing mirror
  registerDataLayerIpc();
  const win = createWindow();
  mainWindow = win;
  watchConnectivity(win);
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      mainWindow = w;
      watchConnectivity(w);
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});