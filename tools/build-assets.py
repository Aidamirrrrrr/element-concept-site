#!/usr/bin/env python3
"""Сборка медиа и контента сайта.

Из source/media готовит адаптивные картинки в site/img:
  <имя>-480.webp, <имя>-960.webp, <имя>-1440.webp  — основной формат
  <имя>.jpg                                        — запасной для старых браузеров
и генерирует site/js/data.js — единственный источник контента.
"""

import json, os, shutil, subprocess, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_MEDIA = os.path.join(ROOT, 'source', 'media')
OUT_IMG = os.path.join(ROOT, 'site', 'img')
OUT_JS = os.path.join(ROOT, 'site', 'js', 'data.js')

WIDTHS = [480, 960, 1440]
FALLBACK_W = 960
WEBP_Q = 74
JPEG_Q = 82

os.makedirs(OUT_IMG, exist_ok=True)
os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)

made = {}      # исходный url -> дескриптор
missing = []
stats = {'files': 0, 'bytes': 0}


def local_of(url):
    parts = url.split('/')
    return f"{parts[3][:12]}_{parts[4]}"


def img(url, name):
    """Готовит набор размеров. Возвращает дескриптор для data.js."""
    if url in made:
        return made[url]

    src = os.path.join(SRC_MEDIA, local_of(url))
    if not os.path.exists(src):
        missing.append(url)
        return None

    # SVG копируем как есть
    if src.lower().endswith('.svg'):
        dst = os.path.join(OUT_IMG, name + '.svg')
        shutil.copy2(src, dst)
        made[url] = {'b': 'img/' + name, 'ext': 'svg'}
        return made[url]

    im = Image.open(src)
    im = im.convert('RGB')
    ow, oh = im.size
    ratio = oh / ow

    # стандартные ступени + сам оригинал, если он между ступенями
    widths = {w for w in WIDTHS if w <= ow} | {min(ow, WIDTHS[0])}
    if ow < max(WIDTHS):
        widths.add(ow)
    widths = sorted(widths)

    for w in widths:
        h = round(w * ratio)
        rs = im.resize((w, h), Image.LANCZOS)
        p = os.path.join(OUT_IMG, f'{name}-{w}.webp')
        rs.save(p, 'WEBP', quality=WEBP_Q, method=6)
        stats['files'] += 1
        stats['bytes'] += os.path.getsize(p)

    fw = min(ow, FALLBACK_W)
    fb = im.resize((fw, round(fw * ratio)), Image.LANCZOS)
    p = os.path.join(OUT_IMG, name + '.jpg')
    fb.save(p, 'JPEG', quality=JPEG_Q, optimize=True, progressive=True)
    stats['files'] += 1
    stats['bytes'] += os.path.getsize(p)

    made[url] = {'b': 'img/' + name, 'w': ow, 'h': oh, 'ws': widths}
    return made[url]


with open(os.path.join(ROOT, 'source', 'data', 'cases.json'), encoding='utf-8') as f:
    C = json.load(f)
with open(os.path.join(ROOT, 'source', 'data', 'products.json'), encoding='utf-8') as f:
    P = json.load(f)

key = C['key_images']
brand = {
    'logo':      img(key['logo_svg'], 'logo'),
    'heroMain':  img(key['about_photo'], 'hero-main'),
    'heroInset': img(C['cases'][1]['cover'], 'hero-inset'),
    'plate':     img(key['divider_photo'], 'plate-reception'),
}

# ── услуги ───────────────────────────────────────────────
G = C['service_galleries']
SERVICES = [
    {'id': 'interior', 'no': '01', 'audience': 'private', 'audienceLabel': 'частным клиентам',
     'name': 'Флористическое оформление интерьера',
     'descr': 'Индивидуальные декоративные решения, подчеркивающие атмосферу праздника '
              'и стиль вашего дома. От элегантных цветочных акцентов до комплексного '
              'оформления пространства.',
     'src': G['private_1_interior']},
    {'id': 'home-set', 'no': '02', 'audience': 'private', 'audienceLabel': 'частным клиентам',
     'name': 'Сет-дизайн для домашних мероприятий',
     'descr': 'Создаем праздничное оформление для любого повода, наполняя пространство '
              'атмосферой торжества. Индивидуальный подход и работа с концепцией '
              'и форматом вашего праздника.',
     'src': G['private_2_home_set_design']},
    {'id': 'event-decor', 'no': '03', 'audience': 'business', 'audienceLabel': 'для бизнеса',
     'name': 'Декор мероприятий',
     'descr': 'Индивидуально разработанные флористические оформления для ваших событий. '
              'Поддержка 360 — от разработки концепции до реализации.',
     'src': G['business_1_event_decor']},
    {'id': 'concierge', 'no': '04', 'audience': 'business', 'audienceLabel': 'для бизнеса',
     'name': 'Флористический консьерж-сервис',
     'descr': 'Концептуальные цветочные композиции для вашего пространства. Гарантия '
              'наличия свежих цветов и создание нужной атмосферы, в соответствии '
              'с сезоном и визуальным ДНК вашего бренда.',
     'src': G['business_2_concierge']},
]
for s in SERVICES:
    s['gallery'] = [d for d in (img(u, f"svc-{s['id']}-{i+1:02d}")
                                for i, u in enumerate(s['src'])) if d]
    s['cover'] = s['gallery'][0] if s['gallery'] else None
    del s['src']

# ── товары: реальные галереи из store.tildaapi.com ───────
PRODUCTS = []
for p in P['products']:
    gal = [d for d in (img(u, f"vase-{p['slug']}-{i+1:02d}")
                       for i, u in enumerate(p['gallery'])) if d]
    PRODUCTS.append({
        'id': p['uid'], 'slug': p['slug'], 'title': p['title'],
        'descr': p['descr'], 'price': p['price'],
        'sku': p.get('sku') or '',
        'gallery': gal,
    })

# ── кейсы ────────────────────────────────────────────────
META = {
    'chefs-table':     ['Ресторан Chef’s Table', 'Клуб МОСК', 'Проект «Ешь искусство»'],
    'marco-polo':      ['Отель Marco Polo', 'Moss Hospitality', 'Лекторий'],
    'home-set-design': ['Частный дом', 'Для Снежаны Георгиевой'],
    'billie':          ['Бильярдный клуб Billie', 'Клуб МОСК'],
    'dance-xx':        ['Еврейский музей', 'Куратор — Ксения Чилингарова'],
}
CASES = []
for c in C['cases']:
    CASES.append({
        'slug': c['slug'], 'title': c['card_title'], 'subtitle': c['card_descr'],
        'popupTitle': c['popup_title'], 'text': c['text'],
        'cover': img(c['cover'], f"case-{c['slug']}-cover"),
        'gallery': [d for d in (img(u, f"case-{c['slug']}-{i+1:02d}")
                                for i, u in enumerate(c['gallery'])) if d],
        'meta': META[c['slug']],
    })

DATA = {
    'brand': brand,
    'contacts': {
        'phone': '+7 916 746 86 68',
        'phoneRaw': '79167468668',
        'whatsapp': 'https://wa.me/79167468668',
        'instagram': 'https://www.instagram.com/elementbymosk',
        'instagramHandle': 'elementbymosk',
        'disclaimer': '*Instagram (продукт компании Meta, признанной экстремистской '
                      'организацией в России и запрещённой на территории РФ)',
    },
    'services': SERVICES,
    'products': PRODUCTS,
    'cases': CASES,
}

with open(OUT_JS, 'w', encoding='utf-8') as f:
    f.write('/* Сгенерировано tools/build-assets.py — не править вручную. */\n')
    f.write('window.SITE = ')
    json.dump(DATA, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

print(f"исходников обработано: {len(made)}")
print(f"файлов создано: {stats['files']}  ({stats['bytes']/1024/1024:.1f} МБ)")
print(f"услуг: {len(SERVICES)}  товаров: {len(PRODUCTS)}  кейсов: {len(CASES)}")
for p in PRODUCTS:
    print(f"  {p['title']:<14} фото в галерее: {len(p['gallery'])}")
if missing:
    print('НЕ НАЙДЕНЫ:', file=sys.stderr)
    for m in missing:
        print('  ' + m, file=sys.stderr)
