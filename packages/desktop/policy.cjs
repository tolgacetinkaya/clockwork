"use strict";

/** Only explicit literal loopback origins are eligible for the privileged host. */
function normalizePanelUrl(raw = "http://127.0.0.1:47831/") {
  if (typeof raw !== "string" || !/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[0-9]+\/?$/i.test(raw)) {
    throw new Error("Panel URL must be HTTP on a literal loopback address with an explicit port and root path.");
  }
  const url = new URL(raw);
  const port = Number(raw.match(/:([0-9]+)\/?$/)[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid local panel URL.");
  }
  return url.href;
}

/** Fixed preferred size, clamped to the selected monitor including negative origins. */
function clampWindowBounds(saved, { workArea }) {
  const { x, y, width, height } = workArea;
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) {
    throw new Error("A finite, positive display work area is required.");
  }
  const windowWidth = Math.min(300, Math.floor(width));
  const windowHeight = Math.min(620, Math.floor(height));
  const right = x + width - windowWidth;
  const bottom = y + height - windowHeight;
  const validSaved = saved && typeof saved === "object" && Number.isFinite(saved.x) && Number.isFinite(saved.y);
  const desiredX = validSaved ? saved.x : right - Math.min(16, (width - windowWidth) / 2);
  const desiredY = validSaved ? saved.y : bottom - Math.min(16, (height - windowHeight) / 2);
  return {
    x: Math.min(Math.max(Math.round(desiredX), x), right),
    y: Math.min(Math.max(Math.round(desiredY), y), bottom),
    width: windowWidth,
    height: windowHeight,
  };
}

module.exports = { normalizePanelUrl, clampWindowBounds };
