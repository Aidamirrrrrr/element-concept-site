/**
 * Снимок страницы настоящим Chrome — для проверки вёрстки.
 *
 *   bun run tools/shot.ts <url> <ширина> <файл.png>
 *
 * Грузит страницу, прокручивает её до конца (чтобы отработали появления
 * и подгрузились ленивые картинки), возвращается наверх и снимает целиком.
 */

const [, , url = 'http://localhost:3000/', widthArg = '1440', out = 'shot.png'] = Bun.argv;
const width = Number(widthArg);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9331;

const chrome = Bun.spawn(
  [
    CHROME,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--window-size=${width},1000`,
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ждём, пока поднимется отладочный порт. */
async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = (await r.json()) as Array<{ webSocketDebuggerUrl?: string; type: string }>;
      const page = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('Chrome не поднял отладочный порт');
}

const ws = new WebSocket(await debuggerUrl());
await new Promise((r) => (ws.onopen = r));

let id = 0;
const waiting = new Map<number, (v: any) => void>();
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data));
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)!(msg.result);
    waiting.delete(msg.id);
  }
};

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((r) => waiting.set(n, r));
}

const evaluate = (expression: string) =>
  send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: width < 900,
});

await send('Page.navigate', { url });
await sleep(4000);

// прокручиваем всю страницу, чтобы сработали появления и ленивые картинки
await evaluate(`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const max = () => document.body.scrollHeight - innerHeight;
  for (let y = 0; y <= max(); y += 300) { window.scrollTo(0, y); await wait(60); }
  await wait(1500);
  window.scrollTo(0, 0);
  await wait(1200);
})()`);

const report = await evaluate(`JSON.stringify({
  ширина: innerWidth,
  плавный_скролл: document.documentElement.classList.contains('smooth'),
  imgrv_всего: document.querySelectorAll('.imgrv').length,
  раскрыто: document.querySelectorAll('.imgrv.is-in').length,
  под_маской: [...document.querySelectorAll('.imgrv img')].filter(i => {
    const c = getComputedStyle(i).clipPath;
    return c && c !== 'none' && c.indexOf('100%') >= 0;
  }).map(i => (i.getAttribute('src') || '').split('/').pop()),
  не_загружено: [...document.images].filter(i => !i.complete || i.naturalWidth === 0)
    .map(i => (i.getAttribute('src') || '').split('/').pop()),
  горизонтальное_переполнение: document.documentElement.scrollWidth - document.documentElement.clientWidth
}, null, 1)`);

console.log(report.result.value);

const { result: metrics } = await send('Page.getLayoutMetrics');
const full = metrics?.cssContentSize ?? (await send('Page.getLayoutMetrics')).cssContentSize;
const height = Math.min(Math.ceil(full?.height ?? 4000), 30000);

await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 900,
});
await sleep(800);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
await Bun.write(out, Buffer.from(shot.data, 'base64'));
console.log(`снимок ${width}x${height} -> ${out}`);

ws.close();
chrome.kill();
