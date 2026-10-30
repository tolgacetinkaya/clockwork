const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("clockworkDesktop", Object.freeze({ isDesktop: true, onDragging(callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, value) => { if (typeof value === "boolean") callback(value); };
  ipcRenderer.on("companion:drag-state", listener);
  return () => ipcRenderer.removeListener("companion:drag-state", listener);
} }));
const interactive = ".cw-desktop-drag-surface,.cw-pet-play,.cw-pet-bubble,.cw-pet-settings,.cw-pet-panel";
window.addEventListener("DOMContentLoaded", () => {
  let queued = false;
  function report() {
    queued = false;
    const regions = [...document.querySelectorAll(interactive)].map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    ipcRenderer.send("companion:hit-regions", regions);
  }
  function schedule() { if (!queued) { queued = true; requestAnimationFrame(report); } }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  new ResizeObserver(schedule).observe(document.documentElement);
  window.addEventListener("resize", schedule); schedule();
  let dragTarget = null, moved = false, startX = 0, startY = 0;
  document.addEventListener("pointerdown", event => {
    const target = event.target.closest?.(".cw-desktop-drag-surface,.cw-pet-play");
    if (!target || event.button !== 0) return;
    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    dragTarget = target; moved = false; startX = event.screenX; startY = event.screenY;
    ipcRenderer.send("companion:drag-start", { x: event.screenX, y: event.screenY });
  }, true);
  document.addEventListener("pointermove", event => {
    if (!dragTarget) return;
    moved ||= Math.abs(event.screenX - startX) + Math.abs(event.screenY - startY) > 4;
    if (moved) ipcRenderer.send("companion:drag-move", { x: event.screenX, y: event.screenY });
  }, true);
  function endDrag() { if (dragTarget) { dragTarget = null; ipcRenderer.send("companion:drag-end"); } }
  document.addEventListener("pointerup", endDrag, true);
  document.addEventListener("pointercancel", endDrag, true);
  document.addEventListener("lostpointercapture", endDrag, true);
  document.addEventListener("click", event => { if (moved && event.target.closest?.(".cw-desktop-drag-surface,.cw-pet-play")) { event.preventDefault(); event.stopImmediatePropagation(); moved = false; } }, true);
  document.addEventListener("contextmenu", event => { event.preventDefault(); ipcRenderer.send("companion:menu"); });
});
