#!/usr/bin/env python3
"""Скачивает woff2 c Google Fonts и делает локальный site/css/fonts.css.
Оставляет только нужные подмножества: cyrillic + latin."""

import os, re, subprocess, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, 'site', 'fonts')
CSS_OUT = os.path.join(ROOT, 'site', 'css', 'fonts.css')
os.makedirs(FONT_DIR, exist_ok=True)

URL = ('https://fonts.googleapis.com/css2'
       '?family=Literata:opsz,wght@7..72,200..500'
       '&family=Manrope:wght@400..600'
       '&family=IBM+Plex+Mono:wght@400;500'
       '&display=swap')

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')

req = urllib.request.Request(URL, headers={'User-Agent': UA})
css = urllib.request.urlopen(req, timeout=40).read().decode('utf-8')

KEEP = {'cyrillic', 'latin'}
blocks = re.findall(r'/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{[^}]+\})', css)

out, seen = [], {}
for subset, block in blocks:
    if subset not in KEEP:
        continue
    m = re.search(r'url\((https://[^)]+\.woff2)\)', block)
    fam = re.search(r"font-family:\s*'([^']+)'", block).group(1)
    wght = re.search(r'font-weight:\s*([^;]+);', block).group(1).strip()
    if not m:
        continue
    url = m.group(1)
    name = f"{fam.lower().replace(' ', '-')}-{wght.replace(' ', '-')}-{subset}.woff2"
    path = os.path.join(FONT_DIR, name)
    if url not in seen:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
            data = r.read()
        with open(path, 'wb') as f:
            f.write(data)
        seen[url] = (name, len(data))
        print(f'{name:<48} {len(data)/1024:6.1f} КБ')
    block = block.replace(m.group(0), f"url('../fonts/{seen[url][0]}')")
    out.append('/* ' + subset + ' */\n' + block)

with open(CSS_OUT, 'w', encoding='utf-8') as f:
    f.write('/* Локальные шрифты. Сгенерировано tools/fetch-fonts.py */\n\n')
    f.write('\n\n'.join(out) + '\n')

total = sum(v[1] for v in seen.values())
print(f'\nскачано: {len(seen)} файлов, {total/1024:.0f} КБ')

# ── подрезаем до символов, которые реально встречаются ──
# кириллица целиком + латиница + цифры + типографика, которую использует вёрстка
UNICODES = ','.join([
    'U+0020-007E',            # латиница, цифры, базовая пунктуация
    'U+00A0',                 # неразрывный пробел
    'U+00B0',                 # градус
    'U+00B7',                 # средняя точка
    'U+00AB,U+00BB',          # «ёлочки»
    'U+0400-045F,U+0490-0491',# кириллица
    'U+2013,U+2014',          # тире
    'U+2018-201D',            # кавычки
    'U+2026',                 # многоточие
    'U+2192',                 # стрелка вправо
    'U+2212',                 # минус
    'U+20BD',                 # рубль
    'U+2713',                 # галочка
])

# pyftsubset умеет woff2 только с модулем brotli — держим его в отдельном venv
PYFTSUBSET = os.path.join(ROOT, 'tools', '.venv', 'bin', 'pyftsubset')
if not os.path.exists(PYFTSUBSET):
    PYFTSUBSET = 'pyftsubset'

subset_total = 0
for name, _size in seen.values():
    path = os.path.join(FONT_DIR, name)
    before = os.path.getsize(path)
    subprocess.run([
        PYFTSUBSET, path,
        f'--unicodes={UNICODES}',
        '--layout-features=kern,liga,calt,tnum,onum',
        '--flavor=woff2',
        '--output-file=' + path + '.tmp',
    ], check=True)
    os.replace(path + '.tmp', path)
    after = os.path.getsize(path)
    subset_total += after
    print(f'{name:<48} {before/1024:6.1f} → {after/1024:5.1f} КБ')

print(f'\nитого после подрезки: {subset_total/1024:.0f} КБ '
      f'(было {total/1024:.0f})')
