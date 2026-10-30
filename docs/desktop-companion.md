# Desktop companion (preview)

The desktop host opens the shared pet in a transparent, frameless Electron window, separate from the browser. It connects to the existing local Clockwork panel and consumes the same SSE snapshot stream. It does not launch models or agents.

## Run from source

```sh
npm install
npx install-electron
npm run pet:desktop
```

Start the local panel first (the existing Docker panel uses port47831). The host defaults to `http://127.0.0.1:47831/`. Set `CLOCKWORK_PANEL_URL` to another explicit literal loopback HTTP origin with a port if required. Remote/DNS/file URLs are rejected. If the panel is temporarily unavailable the host retries loading it.

Drag the character itself to move its native window between desktop applications. Use the small settings button to choose a character. The tray icon opens the panel, toggles always-on-top, resets position, or quits the companion. Position is stored in the app's user-data directory and reconciled with current display bounds on restart. No startup registration is installed.

The visible pet and its controls accept input. Transparent space forwards clicks to the underlying application; a native cursor hit-region check handles Windows forwarding behavior. A static transparent grab surface forwards validated pointer coordinates to the native window. Settings remain independently interactive. On Windows a shaped native input region leaves the empty window area click-through. Other platforms use the cursor hit-region policy. The browser no longer mounts a second floating pet; the native host is the single companion.

## Security boundary

The renderer has no Node integration, filesystem bridge, process execution, or arbitrary shell bridge. Context isolation and Chromium sandboxing are enabled. A private session only admits requests to the configured loopback origin; main-frame navigation must match its exact root URL. New windows, webviews, downloads and permission requests are denied. A restrictive CSP is applied. IPC is restricted to the owning main frame and fixed channels for validated hit rectangles and the native menu. Only the trusted configured panel URL is passed to the system browser.

## Validation and distribution

Windows native launch and transparent rendering over desktop wallpaper verified. Server/client type checks and145 panel/desktop tests passed. Native pointer dragging verified on Windows: x2244/y756 moved to x2189/y806 and was persisted. The earlier OS drag-region approach did not move reliably and was replaced by explicit pointer capture and native position updates. macOS source support is implemented with Electron APIs but has not been tested on a Mac. Native packaging, signed installers, notarization and auto-update are not included in this preview.

Electron is a desktop development dependency. Docker explicitly skips its native binary download; it only serves the shared panel assets.
