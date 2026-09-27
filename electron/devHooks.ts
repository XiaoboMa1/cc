/**
 * Test / visual-QA hooks run on the overlay after each load. Every hook is
 * OFF unless its environment variable is set:
 *   MC_AUTOSTART=1      start capture as if ▶ was clicked (E2E smoke)
 *   MC_E2E_LLM=<q>      ask <q> as a typed question through the FULL
 *                       renderer -> IPC -> main -> LLM -> stream -> renderer path
 *   MC_E2E_SHOT=<q>     the same through the screenshot -> vision path
 *   MC_MAIN_SHOT=<dir>  open the settings panel and save PNGs of it (visual QA,
 *                       same spirit as MC_SETUP_SHOT for the wizard)
 * executeJavaScript(code, true) supplies the user gesture that getDisplayMedia
 * needs.
 */
import type { BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export function runMainWindowDevHooks(win: BrowserWindow): void {
  if (process.env.MC_AUTOSTART === '1') {
    void win.webContents.executeJavaScript('window.__mcAutoStart && window.__mcAutoStart()', true);
  }

  // each E2E ask resolves with the first done/error LlmEvent and logs it as
  // `[<tag>] {"ok":…}` — tools/e2e-llm.mjs and tools/packaged-smoke.mjs read that line
  const e2eAsks: [string | undefined, string, string][] = [
    [process.env.MC_E2E_LLM, 'e2e-llm', `window.mc.llmAsk({requestId:'e2e-llm',mode:'free',freeQuestion:Q,transcript:[]})`],
    [process.env.MC_E2E_SHOT, 'e2e-shot', `window.mc.shotAsk({requestId:'e2e-shot',question:Q})`],
  ];
  for (const [question, tag, ask] of e2eAsks) {
    if (!question) continue;
    const js = `(async()=>{const Q=${JSON.stringify(question)};const d=[];const done=new Promise(r=>{const off=window.mc.onLlmEvent(e=>{if(e.kind==='delta')d.push(e.text);else if(e.kind==='done'){off();r({ok:true,text:e.text||d.join('')});}else if(e.kind==='error'){off();r({ok:false,error:e.message});}});});${ask};return await done;})()`;
    void win.webContents
      .executeJavaScript(js, true)
      .then((r) => console.log(`[${tag}]`, JSON.stringify(r)))
      .catch((e) => console.log(`[${tag}] threw`, (e as Error).message));
  }

  const shotDir = process.env.MC_MAIN_SHOT;
  if (shotDir) {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const shoot = async (name: string): Promise<void> => {
      const image = await win.webContents.capturePage();
      mkdirSync(shotDir, { recursive: true });
      const file = join(shotDir, `${name}.png`);
      writeFileSync(file, image.toPNG());
      console.log(`[main] screenshot ${file}`);
    };
    void (async () => {
      try {
        await win.webContents.executeJavaScript('window.__mcOpenSettings && window.__mcOpenSettings()', true);
        await wait(1200);
        await shoot('main-settings-common');
        // expand 高级 and scroll to it, so the collapsed half is reviewable too
        await win.webContents.executeJavaScript(
          `(()=>{const p=document.querySelector('.settings');if(!p)return 0;p.querySelectorAll('details').forEach(d=>d.open=true);p.scrollTop=p.scrollHeight;return p.scrollHeight;})()`,
        );
        await wait(600);
        await shoot('main-settings-advanced');
      } catch (e) {
        console.warn('[main] screenshot failed:', (e as Error).message);
      }
    })();
  }
}
