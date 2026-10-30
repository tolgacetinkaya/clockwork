const { app, BrowserWindow, Menu, Tray, nativeImage, shell, screen, ipcMain, session } = require("electron");
const { join } = require("node:path");
const { readFileSync, writeFileSync } = require("node:fs");
const { normalizePanelUrl, clampWindowBounds } = require("./policy.cjs");
const panelUrl = normalizePanelUrl(process.env.CLOCKWORK_PANEL_URL);
const panelOrigin = new URL(panelUrl).origin;
let win, tray, saveTimer, retryTimer, hitTimer;
let hitRegions = [], ignoredMouse = true, interactiveUntil = 0, dragStart = null;
app.setName("Clockwork companion");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => win?.show());
  app.whenReady().then(createCompanion).catch(error => { console.error(error); app.quit(); });
}
function statePath() { return join(app.getPath("userData"), "companion-window.json"); }
function savedBounds() { try { return JSON.parse(readFileSync(statePath(), "utf8")); } catch { return null; } }
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try { writeFileSync(statePath(), JSON.stringify(win.getBounds()), "utf8"); } catch { /* Window remains usable without persistence. */ }
}
function resetPosition() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win.setBounds(clampWindowBounds(null, display)); saveBounds();
}
function menu() {
  return Menu.buildFromTemplate([
    { label: "Open Clockwork panel", click: () => shell.openExternal(panelUrl) },
    { label: "Always on top", type: "checkbox", checked: win.isAlwaysOnTop(), click: item => win.setAlwaysOnTop(item.checked, "floating") },
    { label: "Reset pet position", click: resetPosition },
    { type: "separator" },
    { label: "Quit companion", click: () => app.quit() },
  ]);
}
async function createCompanion() {
  const stored = savedBounds();
  const display = stored && Number.isSafeInteger(stored.x) && Number.isSafeInteger(stored.y) && Math.abs(stored.x) < 2147483647 && Math.abs(stored.y) < 2147483647
    ? screen.getDisplayNearestPoint({ x: stored.x, y: stored.y }) : screen.getPrimaryDisplay();
  const bounds = clampWindowBounds(stored, display);
  const isolatedSession = session.fromPartition("persist:clockwork-companion");
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.on("will-download", event => event.preventDefault());
  isolatedSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: {
    ...details.responseHeaders,
    "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"],
  } }));
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try { allowed = new URL(details.url).origin === panelOrigin && (details.resourceType !== "mainFrame" || details.url === panelUrl); } catch { /* Deny malformed URLs. */ }
    callback({ cancel: !allowed });
  });
  win = new BrowserWindow({ ...bounds, title: "Clockwork companion", transparent: true, frame: false,
    hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: "#00000000",
    webPreferences: { preload: join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, session: isolatedSession },
  });
  win.setMenu(null);
  win.on("page-title-updated", event => event.preventDefault());
  win.setIgnoreMouseEvents(process.platform !== "win32", { forward: true });
  win.on("focus", () => { interactiveUntil = Date.now() + 2500; win.setIgnoreMouseEvents(false); ignoredMouse = false; });
  if (process.platform !== "win32") hitTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint(), bounds = win.getContentBounds();
    const cx = cursor.x - bounds.x, cy = cursor.y - bounds.y;
    const hit = hitRegions.some(rect => cx >= rect.x && cy >= rect.y && cx <= rect.x + rect.width && cy <= rect.y + rect.height);
    if (hit) interactiveUntil = Math.max(interactiveUntil, Date.now() + 250);
    const ignore = !dragStart && !hit && Date.now() > interactiveUntil;
    if (ignore !== ignoredMouse) { ignoredMouse = ignore; win.setIgnoreMouseEvents(ignore, { forward: true }); }
  }, 60);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => { if (url !== panelUrl) event.preventDefault(); });
  win.webContents.on("will-redirect", (event, url) => { if (url !== panelUrl) event.preventDefault(); });
  win.webContents.on("will-attach-webview", event => event.preventDefault());
  win.webContents.on("context-menu", () => menu().popup({ window: win }));
  win.webContents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (!win.isDestroyed()) win.loadURL(panelUrl).catch(() => {}); }, 5000);
    }
  });
  win.webContents.on("did-finish-load", () => { clearTimeout(retryTimer); win.show(); });
  win.on("moved", () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveBounds, 250); });
  const reconcile = () => { if (!win.isDestroyed()) win.setBounds(clampWindowBounds(win.getBounds(), screen.getDisplayMatching(win.getBounds()))); };
  screen.on("display-removed", reconcile); screen.on("display-metrics-changed", reconcile);
  win.on("close", saveBounds);
  const icon = nativeImage.createFromPath(join(__dirname, "../panel/client/public/assets/arcade/puffin.png")).resize({ width: 20, height: 20 });
  tray = new Tray(icon); tray.setToolTip("Clockwork companion");
  tray.on("click", () => menu().popup()); tray.on("right-click", () => menu().popup());
  await win.loadURL(panelUrl).catch(() => {});
}
function trusted(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).href === panelUrl; } catch { return false; }
}
ipcMain.on("companion:hit-regions", (event, regions) => {
  if (!trusted(event) || !Array.isArray(regions) || regions.length > 32) return;
  const bounds = win.getContentBounds();
  hitRegions = regions.filter(rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= bounds.width + 1 && rect.y + rect.height <= bounds.height + 1)
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
  if (process.platform === "win32" && hitRegions.length) {
    const shaped = hitRegions.map(rect => {
      const x = Math.max(0, Math.floor(rect.x) - 8), y = Math.max(0, Math.floor(rect.y) - 8);
      return { x, y, width: Math.min(bounds.width - x, Math.ceil(rect.width) + 16), height: Math.min(bounds.height - y, Math.ceil(rect.height) + 16) };
    });
    win.setShape(shaped);
    win.setIgnoreMouseEvents(false);
  }
});
function validPointer(point) { return point && [point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) < 10000000); }
ipcMain.on("companion:drag-start", (event, point) => {
  if (!trusted(event) || !validPointer(point)) return;
  dragStart = { cursor: { x: point.x, y: point.y }, bounds: win.getBounds() };
  win.webContents.send("companion:drag-state", true);
  win.setIgnoreMouseEvents(false);
});
ipcMain.on("companion:drag-move", (event, point) => {
  if (!trusted(event) || !dragStart || !validPointer(point)) return;
  win.setPosition(Math.round(dragStart.bounds.x + point.x - dragStart.cursor.x), Math.round(dragStart.bounds.y + point.y - dragStart.cursor.y));
});
ipcMain.on("companion:drag-end", event => {
  if (!trusted(event)) return;
  dragStart = null; win.webContents.send("companion:drag-state", false); saveBounds();
});
ipcMain.on("companion:menu", event => { if (trusted(event)) menu().popup({ window: win }); });
app.on("before-quit", () => { clearTimeout(saveTimer); clearTimeout(retryTimer); clearInterval(hitTimer); saveBounds(); tray?.destroy(); });
app.on("window-all-closed", () => app.quit());
