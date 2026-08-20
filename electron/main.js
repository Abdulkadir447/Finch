const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// ---------------------------------------------------------------------------
// Content Security Policy for the Finch desktop app.
//
// Applied to navigation responses via session.webRequest.onHeadersReceived.
// Sources follow Clerk's official manual CSP configuration
// (https://clerk.com/docs/security/clerk-csp), adapted for Electron:
//
//   * script-src  — Finch's Clerk DEVELOPMENT Frontend API host serves
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
// When Finch moves to a production Clerk instance, replace the
// bursting-swan-43.clerk.accounts.dev host with the production Frontend API
// hostname (e.g. https://clerk.finch.example).
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
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });
  
  // Use absolute path to be safe
  const indexPath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
  console.log('Loading:', indexPath);
  win.loadFile(indexPath);
  
  // Open DevTools to debug
  win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});