/**
 * ELEMENT CONCEPT — раздача сайта и приём заявок.
 *
 *   bun run start          прод
 *   bun run dev            с автоперезапуском
 *
 * Заявки пишутся в data/leads.txt и data/orders.txt.
 */

import { file, serve } from 'bun';
import { appendFile, mkdir } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const ROOT = import.meta.dir;
const PUBLIC_DIR = join(ROOT, 'site');
const DATA_DIR = join(ROOT, 'data');
const PORT = Number(Bun.env.PORT ?? 3000);
const YOOKASSA_SHOP_ID = Bun.env.YOOKASSA_SHOP_ID ?? '';
const YOOKASSA_SECRET_KEY = Bun.env.YOOKASSA_SECRET_KEY ?? '';
const YOOKASSA_READY = Boolean(YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY);
const SITE_URL = (Bun.env.SITE_URL ?? 'https://elementconcept.ru').replace(/\/$/, '');

/* Цена никогда не принимается из браузера: это серверный источник истины. */
const PRODUCT_PRICES: Record<string, { title: string; price: number }> = {
  'stone-bowl': { title: 'Stone Bowl', price: 28000 },
  'linen-trace': { title: 'Linen Trace', price: 28000 },
  'clay-ember': { title: 'Clay Ember', price: 28000 },
  'shadow-clay': { title: 'Shadow Clay', price: 28000 },
  'frost-vessel': { title: 'Frost Vessel', price: 28000 },
  'sand-form': { title: 'Sand Form', price: 28000 },
};

await mkdir(DATA_DIR, { recursive: true });

/* ─── типы и утилиты ─────────────────────────────────── */

type Item = { slug: string; title: string; price: number; qty: number };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/** Долгий кэш для того, что переживает деплой без изменений. */
const IMMUTABLE = /^\/(img|fonts)\//;

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
};

/**
 * CSP без unsafe-inline. Встроенный <style> разрешаем по хэшу его содержимого,
 * а инлайновые style="" в разметке запрещены совсем — их там и нет.
 */
function buildCsp(styleHash: string) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "script-src 'self'",
    styleHash ? `style-src 'self' '${styleHash}'` : "style-src 'self'",
    "style-src-attr 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/* ─── сжатие текстовых ответов ───────────────────────── */

/** Эти типы жмём: текст хорошо сжимается, картинки и шрифты — уже нет. */
const COMPRESSIBLE = /\.(html|css|js|json|webmanifest|svg|xml|txt)$/;
const cache = new Map<string, Uint8Array>();

function compress(bytes: Uint8Array, key: string, br: boolean) {
  const cacheKey = key + (br ? '|br' : '|gz');
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const out = br
    ? brotliCompressSync(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
      })
    : gzipSync(bytes, { level: 6 });
  cache.set(cacheKey, out);
  return out;
}

function withHeaders(res: Response, extra: Record<string, string> = {}) {
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, 'Content-Security-Policy': csp, ...extra })) {
    res.headers.set(k, v);
  }
  return res;
}

function json(data: unknown, status = 200) {
  return withHeaders(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
  );
}

function ext(path: string) {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i).toLowerCase();
}

/* ─── защита от спама: не больше 5 отправок с адреса за 10 минут ─── */

const hits = new Map<string, number[]>();
const WINDOW = 10 * 60_000;
const LIMIT = 5;

function rateLimited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW);
  list.push(now);
  hits.set(ip, list);
  return list.length > LIMIT;
}

/* ─── нормализация полей ─────────────────────────────── */

/** Убирает управляющие символы, чтобы записи в файле не ломались. */
const clean = (v: unknown, max = 200) =>
  typeof v === 'string'
    ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

/** Приводит номер к виду +7 (900) 000-00-00. Возвращает null, если номер неполный. */
function normalizePhone(raw: string) {
  let d = raw.replace(/\D/g, '');
  if (d[0] === '8') d = '7' + d.slice(1);
  if (d.length !== 11 || d[0] !== '7') return null;
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

function validName(name: string) {
  return name.length < 2 ? 'Укажите имя' : null;
}

/** Без согласия по 152-ФЗ заявку принимать нельзя. */
function validConsent(v: unknown) {
  return v === true || v === '1' || v === 'on' ? null : 'Нужно согласие на обработку данных';
}

function validEmail(mail: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) ? null : 'Проверьте адрес почты';
}

function stamp() {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function record(fileName: string, block: string) {
  await appendFile(join(DATA_DIR, fileName), block, 'utf-8');
}

/* ─── уведомления в Telegram ─────────────────────────── */

const TG_TOKEN = Bun.env.TELEGRAM_BOT_TOKEN ?? '';
const TG_CHAT = Bun.env.TELEGRAM_CHAT_ID ?? '';
const TG_READY = Boolean(TG_TOKEN && TG_CHAT);

/**
 * Шлёт сообщение боту. Отправляем простым текстом, без разметки:
 * тогда имя или город с любыми символами ничего не сломают.
 * Если токен не задан — молча пропускаем, заявка всё равно уже в файле.
 */
async function notify(text: string) {
  if (!TG_READY) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error('Telegram ответил', r.status, await r.text());
  } catch (e) {
    console.error('Не удалось отправить в Telegram:', e);
  }
}

/* ─── обработчики заявок ─────────────────────────────── */

async function handleLead(req: Request, ip: string) {
  const body: any = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'Некорректный запрос' }, 400);

  const name = clean(body.name, 120);
  const raw = clean(body.phone, 40);
  const err = validName(name) ?? (normalizePhone(raw) ? null : 'Укажите телефон полностью') ??
    validConsent(body.consent);
  if (err) return json({ ok: false, error: err }, 422);
  if (rateLimited(ip)) return json({ ok: false, error: 'Слишком много заявок. Попробуйте позже.' }, 429);
  const phone = normalizePhone(raw)!;

  const block =
    `\n──────────────────────────────────────────\n` +
    `ЗАЯВКА  ${stamp()}\n` +
    `Имя:      ${name}\n` +
    `Телефон:  ${phone}\n` +
    `Источник: форма «Контакты»\n` +
    `Согласие: получено, ${stamp()}\n`;

  await record('leads.txt', block);
  await notify(
    `САЙТ · НОВАЯ ЗАЯВКА\n` +
    `${stamp()}\n\n` +
    `Имя: ${name}\n` +
    `Телефон: ${phone}\n\n` +
    `Форма «Контакты»`,
  );
  console.log(`[заявка] ${name} · ${phone}`);
  return json({ ok: true });
}

async function handleOrder(req: Request, ip: string) {
  const body: any = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: 'Некорректный запрос' }, 400);

  const name = clean(body.name, 120);
  const email = clean(body.email, 160).toLowerCase();
  const city = clean(body.city, 80);
  const err = validName(name) ?? validEmail(email) ??
    (city.length < 2 ? 'Укажите город доставки' : null) ?? validConsent(body.consent);
  if (err) return json({ ok: false, error: err }, 422);

  const rawItems: Item[] = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const items = rawItems.flatMap((it) => {
    const product = PRODUCT_PRICES[clean(it.slug, 80)];
    if (!product) return [];
    return [{
      slug: clean(it.slug, 80),
      title: product.title,
      price: product.price,
      qty: Math.max(1, Math.min(99, Math.floor(Number(it.qty) || 1))),
    }];
  });
  if (!items.length || items.length !== rawItems.length) {
    return json({ ok: false, error: 'Состав корзины изменился. Обновите страницу.' }, 422);
  }
  if (rateLimited(ip)) return json({ ok: false, error: 'Слишком много заявок. Попробуйте позже.' }, 429);

  const lines = items.map((it) => {
    const title = clean(it.title, 80);
    const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    const price = Math.max(0, Number(it.price) || 0);
    return `  · ${title} — ${qty} шт. × ${price.toLocaleString('ru-RU')} ₽ = ${(qty * price).toLocaleString('ru-RU')} ₽`;
  });
  const total = items.reduce(
    (s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1),
    0,
  );

  let payment: { id?: string; confirmation?: { confirmation_url?: string } } | null = null;
  if (YOOKASSA_READY) {
    const paymentResponse = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`)}`,
        'Idempotence-Key': crypto.randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: { value: total.toFixed(2), currency: 'RUB' },
        capture: true,
        confirmation: { type: 'redirect', return_url: `${SITE_URL}/?payment=return` },
        description: `ELEMENT CONCEPT · ${items.reduce((n, it) => n + it.qty, 0)} шт.`,
        metadata: { customer_email: email },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!paymentResponse.ok) {
      console.error('ЮKassa ответила', paymentResponse.status, await paymentResponse.text());
      return json({ ok: false, error: 'Не удалось создать платёж. Попробуйте ещё раз.' }, 502);
    }
    payment = await paymentResponse.json() as { id?: string; confirmation?: { confirmation_url?: string } };
    if (!payment?.confirmation?.confirmation_url) {
      return json({ ok: false, error: 'ЮKassa не вернула ссылку на оплату.' }, 502);
    }
  }

  const block =
    `\n──────────────────────────────────────────\n` +
    `ЗАКАЗ  ${stamp()}\n` +
    `Имя:      ${name}\n` +
    `Email:    ${email}\n` +
    `Город:    ${city}\n` +
    `Состав:\n${lines.join('\n')}\n` +
    `Итого:    ${total.toLocaleString('ru-RU')} ₽\n` +
    `Оплата:   ${payment?.id ? `ЮKassa, ожидается · ${payment.id}` : 'не проводилась — связаться и согласовать'}\n` +
    `Согласие: получено, ${stamp()}\n`;

  await record('orders.txt', block);
  await notify(
    `САЙТ · НОВЫЙ ЗАКАЗ\n` +
    `${stamp()}\n\n` +
    `Имя: ${name}\n` +
    `Email: ${email}\n` +
    `Город: ${city}\n\n` +
    `Состав:\n${lines.join('\n')}\n\n` +
    `Итого: ${total.toLocaleString('ru-RU')} ₽\n` +
    (payment?.id ? `Платёж ЮKassa создан: ${payment.id}` : `Оплата на сайте не проводилась`),
  );
  console.log(`[заказ] ${name} · ${email} · ${city} · ${total.toLocaleString('ru-RU')} ₽`);
  return json({ ok: true, confirmationUrl: payment?.confirmation?.confirmation_url ?? null });
}

/** Уведомление не считаем доказательством оплаты: повторно читаем платёж из ЮKassa. */
async function handleYookassaWebhook(req: Request) {
  if (!YOOKASSA_READY) return json({ ok: false }, 503);
  const notice: any = await req.json().catch(() => null);
  const paymentId = clean(notice?.object?.id, 80);
  if (!paymentId) return json({ ok: false }, 400);

  const check = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Basic ${btoa(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`)}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!check.ok) return json({ ok: false }, 502);
  const verified: any = await check.json();
  if (verified.id !== paymentId) return json({ ok: false }, 400);

  if (verified.status === 'succeeded' && verified.paid === true) {
    await record('payments.txt',
      `\n──────────────────────────────────────────\n` +
      `ОПЛАТА  ${stamp()}\n` +
      `ЮKassa ID: ${paymentId}\n` +
      `Сумма:     ${clean(verified.amount?.value, 30)} RUB\n` +
      `Статус:    succeeded\n`,
    );
    await notify(`САЙТ · ОПЛАТА ПОЛУЧЕНА\n${stamp()}\n\nЮKassa ID: ${paymentId}\nСумма: ${clean(verified.amount?.value, 30)} ₽`);
  }
  return json({ ok: true });
}

/* ─── критические стили встраиваем в <head> ──────────── */

/**
 * Сайт одностраничный, поэтому весь CSS встраиваем в разметку:
 * это убирает блокирующий запрос и обходится без инлайновых обработчиков,
 * запрещённых нашей CSP. В файле остаются обычные <link>, чтобы
 * site/index.html открывался и просто с диска.
 */
const CSS_BLOCK = /<!--CSS-->[\s\S]*?<!--\/CSS-->/;

/** Бережная чистка: убираем комментарии и лишние пробелы, синтаксис не трогаем. */
function tidyCss(css: string) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

let inlineCss = '';
try {
  const parts = await Promise.all(
    ['fonts.css', 'style.css'].map((n) => file(join(PUBLIC_DIR, 'css', n)).text()),
  );
  inlineCss = tidyCss(parts.join('\n'));
} catch {
  console.warn('CSS не найден — стили останутся отдельными файлами');
}

/* Разрешаем встроенный <style> по хэшу его содержимого — так CSP
   обходится без unsafe-inline, а ответы остаются кэшируемыми. */
const csp = buildCsp(
  inlineCss ? 'sha256-' + createHash('sha256').update(inlineCss).digest('base64') : '',
);

const htmlCache = new Map<string, Uint8Array>();

async function renderHtml(path: string) {
  const hit = htmlCache.get(path);
  if (hit) return hit;
  let html = await file(path).text();
  if (inlineCss) html = html.replace(CSS_BLOCK, '<style>' + inlineCss + '</style>');
  const bytes = new TextEncoder().encode(html);
  htmlCache.set(path, bytes);
  return bytes;
}

/* ─── статика ────────────────────────────────────────── */

async function serveStatic(pathname: string, accept = '') {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  // защита от выхода за пределы каталога
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const full = join(PUBLIC_DIR, safe);
  if (!full.startsWith(PUBLIC_DIR)) return null;

  const f = file(full);
  if (!(await f.exists())) return null;

  const e = ext(safe);
  const cacheControl = IMMUTABLE.test(safe)
    ? 'public, max-age=31536000, immutable'
    : e === '.html'
      ? 'no-cache'
      : 'public, max-age=86400';

  const headers: Record<string, string> = {
    'Content-Type': MIME[e] ?? 'application/octet-stream',
    'Cache-Control': cacheControl,
  };

  if (COMPRESSIBLE.test(safe)) {
    const source = e === '.html'
      ? await renderHtml(full)
      : new Uint8Array(await f.arrayBuffer());

    const br = accept.includes('br');
    const gz = accept.includes('gzip');
    if (br || gz) {
      headers['Content-Encoding'] = br ? 'br' : 'gzip';
      headers.Vary = 'Accept-Encoding';
      return withHeaders(new Response(compress(source, safe, br), { headers }));
    }
    return withHeaders(new Response(source, { headers }));
  }

  return withHeaders(new Response(f, { headers }));
}

/* ─── сервер ─────────────────────────────────────────── */

const server = serve({
  port: PORT,
  idleTimeout: 30,

  async fetch(req, srv) {
    const url = new URL(req.url);
    const ip = srv.requestIP(req)?.address ?? 'unknown';

    if (url.pathname === '/api/yookassa/webhook') {
      if (req.method !== 'POST') return json({ ok: false, error: 'Только POST' }, 405);
      return handleYookassaWebhook(req);
    }

    if (url.pathname === '/api/lead' || url.pathname === '/api/order') {
      if (req.method !== 'POST') return json({ ok: false, error: 'Только POST' }, 405);
      try {
        return url.pathname === '/api/lead'
          ? await handleLead(req, ip)
          : await handleOrder(req, ip);
      } catch (e) {
        console.error('Ошибка обработки заявки:', e);
        return json({ ok: false, error: 'Внутренняя ошибка' }, 500);
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json({ ok: false, error: 'Метод не поддерживается' }, 405);
    }

    const accept = req.headers.get('accept-encoding') ?? '';
    const res = await serveStatic(url.pathname, accept);
    if (res) return res;

    const notFound = await serveStatic('/404.html', accept);
    if (notFound) return new Response(notFound.body, { status: 404, headers: notFound.headers });
    return withHeaders(new Response('Не найдено', { status: 404 }));
  },
});

console.log(`ELEMENT CONCEPT → http://localhost:${server.port}`);
console.log(
  TG_READY
    ? 'Telegram: уведомления включены'
    : 'Telegram: выключен — задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в .env',
);
console.log(YOOKASSA_READY ? 'ЮKassa: включена' : 'ЮKassa: выключена — заказ сохраняется как заявка');
console.log(`Заявки: ${join(DATA_DIR, 'leads.txt')}`);
console.log(`Заказы: ${join(DATA_DIR, 'orders.txt')}`);
