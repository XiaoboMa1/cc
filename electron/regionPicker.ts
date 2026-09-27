/**
 * Region screenshot: capture the full screen, let the user drag a region on a
 * STEALTH overlay that shows the capture as its (opaque) background — avoids
 * the transparent-window black-screen bug and is excluded from recording via
 * content protection. regionPick resolves with the cropped image dataURL.
 */
import { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen } from 'electron';
import { join } from 'path';
import { IPC } from '../shared/protocol';
import { T, type AppContext } from './appContext';
import { deferred } from './mainWindow';

/** marks a region corner at the mouse position while the region overlay is
 * up (press at corner 1, move, press at corner 2) — selection without a click */
const REGION_CORNER_KEY = 'CommandOrControl+Shift+A';

/** The overlay page: the captured screen as an opaque bg (so a
 * content-protected window never renders black locally) plus a drag
 * rectangle. Uses window.mc from the shared preload. */
const regionOverlayHtml = (tip: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;cursor:crosshair;user-select:none}
#img{position:fixed;inset:0;width:100vw;height:100vh;object-fit:fill}
#dim{position:fixed;inset:0;background:rgba(0,0,0,0.35)}
#sel{position:fixed;display:none;border:2px solid #2a6df4;box-shadow:0 0 0 9999px rgba(0,0,0,0.35)}
#tip{position:fixed;top:14px;left:50%;transform:translateX(-50%);color:#fff;background:rgba(0,0,0,0.65);padding:6px 14px;border-radius:8px;font:13px 'Microsoft YaHei',sans-serif;z-index:9}
</style></head><body>
<img id="img"/><div id="dim"></div><div id="sel"></div>
<div id="tip">${tip}</div>
<script>
(async()=>{try{const u=await window.mc.regionImage();if(u){document.getElementById('img').src=u;}}catch(e){}})();
let sx,sy,drag=false;const sel=document.getElementById('sel'),dim=document.getElementById('dim');
function rect(e){return{x:Math.min(sx,e.clientX),y:Math.min(sy,e.clientY),width:Math.abs(e.clientX-sx),height:Math.abs(e.clientY-sy)};}
function upd(e){const r=rect(e);sel.style.left=r.x+'px';sel.style.top=r.y+'px';sel.style.width=r.width+'px';sel.style.height=r.height+'px';}
function anchor(x,y){drag=true;sx=x;sy=y;dim.style.display='none';sel.style.display='block';upd({clientX:x,clientY:y});}
addEventListener('mousedown',e=>anchor(e.clientX,e.clientY));
addEventListener('mousemove',e=>{if(drag)upd(e);});
addEventListener('mouseup',e=>{if(!drag)return;drag=false;const r=rect(e);if(r.width>4&&r.height>4)window.mc.regionRect(r);else window.mc.regionCancel();});
addEventListener('keydown',e=>{if(e.key==='Escape')window.mc.regionCancel();});
</script></body></html>`;

type RegionRect = { x: number; y: number; width: number; height: number };

export function registerRegionPicker(ctx: AppContext): void {
  let regionResolve: ((r: RegionRect | null) => void) | null = null;
  let pendingRegionImage: string | null = null;
  let regionWin: BrowserWindow | null = null;
  let regionBusy = false;

  /** end the selection — overlay drag, overlay/global Esc, or the corner key */
  const finishRegion = (r: RegionRect | null) => {
    const f = regionResolve;
    regionResolve = null;
    regionWin?.close();
    f?.(r);
  };
  ipcMain.handle(IPC.regionImage, () => pendingRegionImage);
  ipcMain.on(IPC.regionRect, (_e, r: RegionRect) => finishRegion(r));
  ipcMain.on(IPC.regionCancel, () => finishRegion(null));

  ipcMain.handle(IPC.regionPick, async () => {
    // one selection at a time: a second screenshot-hotkey press mid-selection
    // would stack a second overlay and leave the first one on screen with
    // nothing able to close it
    if (regionBusy) return null;
    regionBusy = true;
    try {
      const disp = screen.getPrimaryDisplay();
      const sf = disp.scaleFactor;
      const w = Math.round(disp.size.width * sf);
      const h = Math.round(disp.size.height * sf);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
      const src = sources.find((s) => s.display_id === String(disp.id)) ?? sources[0];
      if (!src) return null;
      const full = src.thumbnail;
      pendingRegionImage = full.toDataURL();

      const rect = await new Promise<RegionRect | null>((resolve) => {
        regionResolve = resolve;
        const b = disp.bounds;
        const ov = new BrowserWindow({
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          frame: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          hasShadow: false,
          resizable: false,
          movable: false,
          fullscreenable: false,
          enableLargerThanScreen: true,
          webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true },
        });
        regionWin = ov;
        ov.setContentProtection(true); // selection overlay invisible to recording
        ov.setAlwaysOnTop(true, 'screen-saver');
        // global only while selecting, so both work whichever window holds
        // keyboard focus; corner 1 = cursor at the first press, corner 2 =
        // cursor at the second (overlay coords = screen DIP - display origin,
        // the same space as the drag's clientX/clientY)
        let corner: { x: number; y: number } | null = null;
        globalShortcut.register('Escape', deferred(() => finishRegion(null)));
        globalShortcut.register(
          REGION_CORNER_KEY,
          deferred(() => {
            const p = screen.getCursorScreenPoint();
            const x = p.x - b.x;
            const y = p.y - b.y;
            if (!corner) {
              corner = { x, y };
              // the overlay draws the rectangle from here to the cursor
              void ov.webContents.executeJavaScript(`anchor(${x},${y})`).catch(() => undefined);
              return;
            }
            finishRegion({
              x: Math.min(corner.x, x),
              y: Math.min(corner.y, y),
              width: Math.abs(x - corner.x),
              height: Math.abs(y - corner.y),
            });
          }),
        );
        ov.on('closed', () => {
          globalShortcut.unregister('Escape');
          globalShortcut.unregister(REGION_CORNER_KEY);
          if (regionResolve) {
            const f = regionResolve;
            regionResolve = null;
            f(null);
          }
          regionWin = null;
        });
        void ov.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(regionOverlayHtml(T(ctx).regionTip)));
      });

      const img = pendingRegionImage;
      pendingRegionImage = null;
      if (!rect || rect.width < 4 || rect.height < 4 || !img) return null;
      try {
        return full
          .crop({
            x: Math.round(rect.x * sf),
            y: Math.round(rect.y * sf),
            width: Math.round(rect.width * sf),
            height: Math.round(rect.height * sf),
          })
          .toDataURL();
      } catch (e) {
        console.error('[region] crop failed:', (e as Error).message);
        return null;
      }
    } finally {
      regionBusy = false;
    }
  });
}
