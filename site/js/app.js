/* ═══════════════════════════════════════════════════════════
   ELEMENT CONCEPT — интерфейс сайта
   анимация · каталог · корзина · модальные окна · формы
   ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

var SITE   = window.SITE || {products: [], cases: [], services: []};
var docEl  = document.documentElement;
var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
var coarse = matchMedia('(pointer: coarse)').matches;

var $  = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
var lerp  = function (a, b, t) { return a + (b - a) * t; };
var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
var money = function (n) { return n.toLocaleString('ru-RU') + ' ₽'; };
var esc = function (s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
  });
};

var bySlug = {}, caseBySlug = {}, svcById = {};
SITE.products.forEach(function (p) { bySlug[p.slug] = p; });
SITE.cases.forEach(function (c) { caseBySlug[c.slug] = c; });
(SITE.services || []).forEach(function (s) { svcById[s.id] = s; });

/* адаптивная картинка из дескриптора сборщика */
function pic(d, alt, sizes, cls) {
  if (!d) return '';
  if (d.ext === 'svg') return '<img src="' + d.b + '.svg" alt="' + esc(alt) + '">';
  var ss = d.ws.map(function (w) { return d.b + '-' + w + '.webp ' + w + 'w'; }).join(', ');
  return '<picture><source type="image/webp" srcset="' + ss + '" sizes="' + sizes + '">' +
         '<img src="' + d.b + '.jpg" alt="' + esc(alt) + '" width="' + d.w + '" height="' + d.h +
         '" loading="lazy" decoding="async"' + (cls ? ' class="' + cls + '"' : '') + '></picture>';
}


/* ─────────────────────────────────────────────────────────
   1. Каталог ваз
   ───────────────────────────────────────────────────────── */
var catEl = $('#cat');
if (catEl) {
  catEl.innerHTML = SITE.products.map(function (p, i) {
    return '' +
      '<li class="cat__item rv" data-i="' + i + '">' +
        pic(p.gallery[0], p.title, '(max-width:900px) 64px, 88px', 'cat__img') +
        '<span class="cat__name">' + esc(p.title) + '</span>' +
        '<span class="cat__descr">' + esc(p.descr) + '</span>' +
        '<span class="cat__price">' + money(p.price) + '</span>' +
        '<button class="cat__add" type="button" data-add="' + p.slug + '">В корзину</button>' +
        '<button class="cat__open" type="button" data-product="' + p.slug + '" data-view ' +
                'aria-label="Подробнее: ' + esc(p.title) + '"></button>' +
      '</li>';
  }).join('') +
  '<li class="cat__foot mono"><span>Керамика · ручная работа</span><span>Доставка по Москве</span></li>';
}


/* ─────────────────────────────────────────────────────────
   2. Развёртка заголовков по словам
   ───────────────────────────────────────────────────────── */
$$('[data-words]').forEach(function (el) {
  var words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  words.forEach(function (w, i) {
    var outer = document.createElement('span');
    outer.className = 'wd';
    outer.style.setProperty('--i', i);
    var inner = document.createElement('i');
    inner.textContent = w;
    outer.appendChild(inner);
    el.appendChild(outer);
  });
});


/* ─────────────────────────────────────────────────────────
   3. Появление при входе в кадр
   ───────────────────────────────────────────────────────── */
var REVEAL = '.rv, .imgrv, .hair, [data-lines], [data-words]';
if (reduce || !('IntersectionObserver' in window)) {
  $$(REVEAL).forEach(function (el) { el.classList.add('is-in'); });
} else {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, {rootMargin: '0px 0px -8% 0px', threshold: 0.04});
  $$(REVEAL).forEach(function (el) { io.observe(el); });
}


/* ─────────────────────────────────────────────────────────
   4. Счётчики
   ───────────────────────────────────────────────────────── */
$$('[data-count]').forEach(function (el) {
  var to = parseFloat(el.getAttribute('data-count'));
  var sfx = el.getAttribute('data-suffix') || '';
  if (reduce) { el.textContent = to + sfx; return; }
  el.textContent = '0' + sfx;

  var started = false, done = false;
  function run() {
    if (started) return;
    started = true;
    var t0 = performance.now();
    (function step(now) {
      var p = clamp((now - t0) / 1400, 0, 1);
      if (done) return;
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + sfx;
      if (p < 1) requestAnimationFrame(step);
      else done = true;
    })(t0);
    /* в фоновой вкладке requestAnimationFrame не вызывается — досчитываем сами */
    setTimeout(function () {
      if (done) return;
      done = true;
      el.textContent = to + sfx;
    }, 2200);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en, obs) {
      if (en[0].isIntersecting) { run(); obs.disconnect(); }
    }, {threshold: 0.6}).observe(el);
  } else { run(); }
});


/* ─────────────────────────────────────────────────────────
   5. Вкладки услуг
   ───────────────────────────────────────────────────────── */
var tabs = $$('.tabs button');
tabs.forEach(function (btn) {
  btn.addEventListener('click', function () {
    tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b === btn)); });
    $$('[data-tabpanel]').forEach(function (p) {
      var on = p.getAttribute('data-tabpanel') === btn.getAttribute('data-panel');
      p.hidden = !on;
      if (!on) return;
      $$('.rv, .imgrv', p).forEach(function (el) { el.classList.add('is-in'); });
      if (reduce) return;
      p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap');
    });
  });
});


/* ─────────────────────────────────────────────────────────
   6. Блокировка прокрутки под оверлеями
   ───────────────────────────────────────────────────────── */
var locked = false, lockY = 0;

function lockScroll() {
  if (locked) return;
  locked = true;
  lockY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.width = '100%';
  document.body.style.top = -lockY + 'px';
}

function unlockScroll() {
  if (!locked) return;
  locked = false;
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.top = '';
  /* возвращаемся мгновенно: плавность здесь выглядела бы рывком */
  var prev = docEl.style.scrollBehavior;
  docEl.style.scrollBehavior = 'auto';
  window.scrollTo(0, lockY);
  docEl.style.scrollBehavior = prev;
}


/* ─────────────────────────────────────────────────────────
   7. Корзина
   ───────────────────────────────────────────────────────── */
var STORE_KEY = 'ebm-cart-v1';
var cart = {};
try { cart = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { cart = {}; }

var cartEl = $('#cart'), cartBody = $('#cartBody'), cartFoot = $('#cartFoot');
var cartTotal = $('#cartTotal'), cartBtn = $('#cartBtn'), cartCount = $('#cartCount');
var cartStep1 = $('#cartStep1'), orderForm = $('#orderForm');
var scrim = $('#scrim');

/** Корзина показывается в два шага: сначала состав, потом форма заявки. */
function cartStep(n) {
  cartStep1.hidden = n !== 1;
  orderForm.hidden = n !== 2;
  if (n === 2) {
    orderForm.classList.remove('swap');
    void orderForm.offsetWidth;
    var first = $('input', orderForm);
    if (first) first.focus({preventScroll: true});
  }
}

function saveCart() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cart)); } catch (e) {}
}

function cartTotals() {
  var n = 0, sum = 0;
  Object.keys(cart).forEach(function (slug) {
    var p = bySlug[slug];
    if (!p) return;
    n += cart[slug];
    sum += cart[slug] * p.price;
  });
  return {count: n, sum: sum};
}

function renderCart() {
  var t = cartTotals();
  cartCount.textContent = t.count;
  cartBtn.classList.toggle('has-items', t.count > 0);
  cartBtn.setAttribute('aria-label', 'Корзина, товаров: ' + t.count);

  var slugs = Object.keys(cart).filter(function (s) { return bySlug[s]; });
  if (!slugs.length) {
    cartBody.innerHTML = '<p class="cempty">Корзина пуста.<br>Выберите вазу из коллекции.</p>';
    cartFoot.hidden = true;
    cartStep(1);
    return;
  }

  cartFoot.hidden = false;
  cartBody.innerHTML = slugs.map(function (slug) {
    var p = bySlug[slug], q = cart[slug];
    return '' +
      '<div class="citem" data-slug="' + slug + '">' +
        pic(p.gallery[0], p.title, '64px') +
        '<div>' +
          '<div class="citem__n">' + esc(p.title) + '</div>' +
          '<div class="citem__p">' + money(p.price) + ' × ' + q + ' = ' + money(p.price * q) + '</div>' +
          '<div class="qty">' +
            '<button type="button" data-q="-1" aria-label="Убрать одну">−</button>' +
            '<span>' + q + '</span>' +
            '<button type="button" data-q="1" aria-label="Добавить одну">+</button>' +
          '</div>' +
        '</div>' +
        '<button class="citem__del" type="button" data-del aria-label="Удалить ' + esc(p.title) + '">Удалить</button>' +
      '</div>';
  }).join('');

  cartTotal.textContent = money(t.sum);
}

function addToCart(slug, qty) {
  if (!bySlug[slug]) return;
  cart[slug] = (cart[slug] || 0) + (qty || 1);
  saveCart();
  renderCart();
}

cartBody.addEventListener('click', function (e) {
  var row = e.target.closest('.citem');
  if (!row) return;
  var slug = row.getAttribute('data-slug');
  if (e.target.closest('[data-del]')) {
    delete cart[slug];
  } else {
    var q = e.target.closest('[data-q]');
    if (!q) return;
    cart[slug] = (cart[slug] || 0) + parseInt(q.getAttribute('data-q'), 10);
    if (cart[slug] < 1) delete cart[slug];
  }
  saveCart();
  renderCart();
});

function openCart() {
  cartStep(1);
  cartEl.classList.add('on');
  cartEl.removeAttribute('inert');
  cartEl.setAttribute('aria-hidden', 'false');
  scrim.classList.add('on');
  lockScroll();
}

function closeCart() {
  if (!cartEl.classList.contains('on')) return;
  cartEl.classList.remove('on');
  cartEl.setAttribute('inert', '');
  cartEl.setAttribute('aria-hidden', 'true');
  scrim.classList.remove('on');
  unlockScroll();
}

cartBtn.addEventListener('click', openCart);
$('#toCheckout').addEventListener('click', function () { cartStep(2); });
$('#backToCart').addEventListener('click', function () { cartStep(1); });
renderCart();


/* ─────────────────────────────────────────────────────────
   8. Модальные окна
   ───────────────────────────────────────────────────────── */
var prodModal = $('#prodModal'), caseModal = $('#caseModal');
var lastFocus = null, openM = null;

function showModal(m) {
  lastFocus = document.activeElement;
  openM = m;
  m.classList.add('on');
  m.removeAttribute('inert');
  m.setAttribute('aria-hidden', 'false');
  scrim.classList.add('on');
  lockScroll();
  var c = $('[data-close]', m);
  if (c) c.focus({preventScroll: true});
}

function hideModal() {
  if (!openM) return;
  openM.classList.remove('on');
  openM.setAttribute('inert', '');
  openM.setAttribute('aria-hidden', 'true');
  openM = null;
  scrim.classList.remove('on');
  unlockScroll();
  if (lastFocus) lastFocus.focus({preventScroll: true});
}

/* — товар — */
var pdImg = $('#pdImg'), pdThumbs = $('#pdThumbs'), pdName = $('#pdName');
var pdDescr = $('#pdDescr'), pdPrice = $('#pdPrice'), pdAdd = $('#pdAdd');
var pdCurrent = null;

function openProduct(slug) {
  var p = bySlug[slug];
  if (!p) return;
  pdCurrent = slug;
  pdName.textContent  = p.title;
  pdDescr.textContent = p.descr;
  pdPrice.textContent = money(p.price);
  pdImg.innerHTML = pic(p.gallery[0], p.title, '(max-width:860px) 92vw, 46vw');

  pdThumbs.innerHTML = p.gallery.length > 1
    ? p.gallery.map(function (g, i) {
        return '<button type="button" aria-current="' + (i === 0) + '" data-idx="' + i + '" ' +
               'aria-label="Фото ' + (i + 1) + '">' + pic(g, '', '62px') + '</button>';
      }).join('')
    : '';

  pdAdd.textContent = 'В корзину';
  showModal(prodModal);
}

pdThumbs.addEventListener('click', function (e) {
  var b = e.target.closest('button');
  if (!b || !pdCurrent) return;
  var p = bySlug[pdCurrent];
  $$('button', pdThumbs).forEach(function (x) { x.setAttribute('aria-current', String(x === b)); });
  pdImg.innerHTML = pic(p.gallery[+b.getAttribute('data-idx')], p.title, '(max-width:860px) 92vw, 46vw');
});

pdAdd.addEventListener('click', function () {
  if (!pdCurrent) return;
  addToCart(pdCurrent, 1);
  pdAdd.textContent = 'Добавлено ✓';
  setTimeout(function () { hideModal(); openCart(); }, 420);
});

/* — кейс и галерея услуги — */
var csTitle = $('#csTitle'), csMeta = $('#csMeta'), csText = $('#csText'), csGal = $('#csGal');

function openGallery(o) {
  csTitle.textContent = o.title;
  csMeta.innerHTML = (o.meta || []).map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('');
  csText.innerHTML = (o.text || []).map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('');
  csGal.innerHTML = (o.gallery || []).map(function (g, i) {
    return pic(g, o.title + ' — фото ' + (i + 1), '(max-width:600px) 92vw, (max-width:1100px) 46vw, 260px');
  }).join('');
  showModal(caseModal);
}

document.addEventListener('click', function (e) {
  var add = e.target.closest('[data-add]');
  if (add) {
    addToCart(add.getAttribute('data-add'), 1);
    add.classList.add('is-added');
    add.textContent = 'Добавлено';
    setTimeout(function () { add.classList.remove('is-added'); add.textContent = 'В корзину'; }, 1600);
    return;
  }

  var prod = e.target.closest('[data-product]');
  if (prod) { openProduct(prod.getAttribute('data-product')); return; }

  var cs = e.target.closest('[data-case]');
  if (cs) {
    var c = caseBySlug[cs.getAttribute('data-case')];
    if (c) openGallery({title: c.popupTitle, meta: c.meta, text: c.text, gallery: c.gallery});
    return;
  }

  var svc = e.target.closest('[data-service]');
  if (svc) {
    var s = svcById[svc.getAttribute('data-service')];
    if (s) openGallery({title: s.name, meta: [s.no + ' · ' + s.audienceLabel], text: [s.descr], gallery: s.gallery});
    return;
  }

  if (e.target.closest('[data-close]')) { hideModal(); closeCart(); return; }

  var goto = e.target.closest('[data-goto]');
  if (goto) {
    var href = goto.getAttribute('data-goto');
    hideModal(); closeCart();
    setTimeout(function () {
      var t = $(href);
      if (t) window.scrollTo({top: t.offsetTop - 64, behavior: reduce ? 'auto' : 'smooth'});
    }, 260);
  }
});

scrim.addEventListener('click', function () { hideModal(); closeCart(); });

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { hideModal(); closeCart(); closeNav(); return; }
  if (e.key !== 'Tab' || !openM) return;
  var f = $$('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])', openM)
          .filter(function (el) { return el.offsetParent !== null; });
  if (!f.length) return;
  var first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});


/* ─────────────────────────────────────────────────────────
   9. Мобильное меню
   ───────────────────────────────────────────────────────── */
var burger = $('#burger'), mnav = $('#mnav');

function closeNav() {
  if (!mnav.classList.contains('on')) return;
  mnav.classList.remove('on');
  mnav.setAttribute('inert', '');
  burger.setAttribute('aria-expanded', 'false');
  burger.setAttribute('aria-label', 'Открыть меню');
  unlockScroll();
}

burger.addEventListener('click', function () {
  var on = mnav.classList.toggle('on');
  if (on) mnav.removeAttribute('inert'); else mnav.setAttribute('inert', '');
  burger.setAttribute('aria-expanded', String(on));
  burger.setAttribute('aria-label', on ? 'Закрыть меню' : 'Открыть меню');
  if (on) lockScroll(); else unlockScroll();
});
$$('a', mnav).forEach(function (a) { a.addEventListener('click', closeNav); });


/* ─────────────────────────────────────────────────────────
   10. Маска телефона, проверка и отправка форм
   ───────────────────────────────────────────────────────── */
function maskPhone(value) {
  var d = value.replace(/\D/g, '');
  if (d[0] === '8') d = '7' + d.slice(1);
  if (d[0] !== '7') d = '7' + d;
  d = d.slice(0, 11);
  var out = '+7';
  if (d.length > 1) out += ' (' + d.slice(1, 4);
  if (d.length >= 4) out += ')';
  if (d.length > 4) out += ' ' + d.slice(4, 7);
  if (d.length > 7) out += '-' + d.slice(7, 9);
  if (d.length > 9) out += '-' + d.slice(9, 11);
  return out;
}

/* Почту «маской» не разметить, но мусорный ввод убрать можно:
   пробелы, кириллицу и верхний регистр адрес не переживёт. */
$$('[data-mask="email"]').forEach(function (input) {
  input.addEventListener('input', function () {
    var clean = input.value.replace(/[^\x21-\x7E]/g, '').replace(/[^A-Za-z0-9@._+\-]/g, '').toLowerCase();
    if (clean !== input.value) {
      var pos = input.selectionStart - (input.value.length - clean.length);
      input.value = clean;
      try { input.setSelectionRange(pos, pos); } catch (e) {}
    }
  });
  input.addEventListener('blur', function () { input.value = input.value.trim(); });
});

$$('[data-mask="phone"]').forEach(function (input) {
  input.addEventListener('focus', function () { if (!input.value) input.value = '+7 ('; });
  input.addEventListener('input', function () { input.value = maskPhone(input.value); });
  input.addEventListener('blur', function () {
    if (input.value.replace(/\D/g, '').length <= 1) input.value = '';
  });
});

function fieldError(input, msg) {
  var box = input.closest('.fld, .agree');
  box = box ? box.querySelector('[data-err]') : input.parentElement.querySelector('[data-err]');
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (!box) return;
  box.textContent = msg || '';
  box.classList.toggle('on', !!msg);
}

function validate(form) {
  var ok = true;
  $$('input[required]', form).forEach(function (input) {
    if (input.type === 'checkbox') {
      var need = input.checked ? '' : 'Без согласия отправить не получится';
      fieldError(input, need);
      if (need && ok) { ok = false; input.focus(); }
      return;
    }
    var v = input.value.trim(), msg = '';
    if (!v) msg = 'Заполните поле';
    else if (input.type === 'tel' && v.replace(/\D/g, '').length !== 11) msg = 'Введите номер полностью';
    else if (input.type === 'email' && !/^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(v.toLowerCase()))
      msg = v.indexOf('@') < 0 ? 'В адресе нет знака @' : 'Проверьте адрес почты';
    fieldError(input, msg);
    if (msg && ok) { ok = false; input.focus(); }
  });
  return ok;
}

/* На статичном хостинге (GitHub Pages, открытый файл) бэкенда нет —
   показываем это честно, а не молчаливую ошибку сети. */
var DEMO = location.protocol === 'file:' || /\.github\.io$/.test(location.hostname);

function send(url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function wireForm(formSel, okSel, url, label, extra, after) {
  var form = $(formSel), ok = $(okSel);
  if (!form) return;

  $$('input', form).forEach(function (i) {
    i.addEventListener('input', function () { fieldError(i, ''); });
    if (i.type === 'checkbox') i.addEventListener('change', function () { fieldError(i, ''); });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate(form)) return;

    var btn = $('button[type="submit"]', form);
    var data = {};
    $$('input', form).forEach(function (i) {
      data[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim();
    });
    if (extra) Object.assign(data, extra());

    btn.disabled = true;
    btn.textContent = 'Отправляем…';

    var request = DEMO
      ? new Promise(function (resolve, reject) {
          setTimeout(function () { reject(new Error('demo')); }, 500);
        })
      : send(url, data);

    request.then(function () {
      form.reset();
      ok.textContent = ok.getAttribute('data-ok') || ok.textContent;
      ok.classList.remove('formok--err');
      ok.classList.add('on');
      if (after) after();
    }).catch(function () {
      ok.textContent = DEMO
        ? 'Демонстрация: заявка никуда не уходит. На рабочем сервере она попадёт менеджеру.'
        : 'Не удалось отправить. Напишите нам в WhatsApp: +7 916 746 86 68';
      ok.classList.add('formok--err', 'on');
      if (DEMO) form.reset();
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
      setTimeout(function () { ok.classList.remove('on'); }, 7000);
    });
  });
}

$$('.formok').forEach(function (el) { el.setAttribute('data-ok', el.textContent.trim()); });

wireForm('#leadForm', '#leadOk', '/api/lead', 'Отправить');
wireForm('#orderForm', '#orderOk', '/api/order', 'Оставить заявку', function () {
  var items = Object.keys(cart).filter(function (s) { return bySlug[s]; }).map(function (s) {
    return {slug: s, title: bySlug[s].title, price: bySlug[s].price, qty: cart[s]};
  });
  return {items: items, total: cartTotals().sum};
}, function () {
  cart = {};
  saveCart();
  renderCart();
  cartStep(1);
});


/* ─────────────────────────────────────────────────────────
   11. Магнитные кнопки
   ───────────────────────────────────────────────────────── */
if (!coarse && !reduce) {
  $$('[data-magnet]').forEach(function (el) {
    var mx = 0, my = 0, tx = 0, ty = 0, raf = null;
    function loop() {
      mx = lerp(mx, tx, 0.18); my = lerp(my, ty, 0.18);
      el.style.transform = 'translate3d(' + mx.toFixed(2) + 'px,' + my.toFixed(2) + 'px,0)';
      if (Math.abs(mx - tx) > 0.1 || Math.abs(my - ty) > 0.1) raf = requestAnimationFrame(loop);
      else raf = null;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    el.addEventListener('mousemove', function (e) {
      var r = el.getBoundingClientRect();
      tx = (e.clientX - (r.left + r.width / 2)) * 0.3;
      ty = (e.clientY - (r.top + r.height / 2)) * 0.4;
      kick();
    });
    el.addEventListener('mouseleave', function () { tx = 0; ty = 0; kick(); });
  });
}


/* ─────────────────────────────────────────────────────────
   12. Прогресс чтения, параллакс, бегущая строка
   Прокрутка нативная: так работают якоря, тачпад и колесо мыши
   ровно так, как ожидает система.
   ───────────────────────────────────────────────────────── */
var bar = $('#progBar'), tick = $('#tick');
var lastY = 0, vel = 0, tickX = 0, tickW = 0;

var parEls = $$('[data-par]').map(function (el) {
  return {el: el, k: parseFloat(el.getAttribute('data-par')) || 0};
});
var innerEls = $$('[data-inner]').map(function (el) {
  return {el: el, k: parseFloat(el.getAttribute('data-inner')) || 0};
});

function sizeBody() {
  if (tick) tickW = tick.scrollWidth / 2;
}

function frame() {
  var y = window.scrollY || window.pageYOffset;
  vel = y - lastY;
  lastY = y;

  var h = docEl.scrollHeight - innerHeight;
  bar.style.transform = 'scaleX(' + (h > 0 ? clamp(y / h, 0, 1) : 0) + ')';

  if (tick && tickW && !reduce) {
    tickX -= 0.35 + clamp(vel, -60, 60) * 0.35;
    if (tickX <= -tickW) tickX += tickW;
    if (tickX > 0) tickX -= tickW;
    tick.style.transform = 'translate3d(' + tickX.toFixed(2) + 'px,0,0)';
  }

  if (!reduce) {
    var mid = innerHeight / 2;
    parEls.forEach(function (p) {
      var r = p.el.getBoundingClientRect();
      if (r.bottom < -300 || r.top > innerHeight + 300) return;
      p.el.style.transform = 'translate3d(0,' + ((r.top + r.height / 2 - mid) * p.k).toFixed(2) + 'px,0)';
    });
    innerEls.forEach(function (p) {
      var box = p.el.closest('.imgrv') || p.el.parentElement;
      var r = box.getBoundingClientRect();
      if (r.bottom < -300 || r.top > innerHeight + 300) return;
      var prog = (r.top + r.height / 2 - mid) / (innerHeight / 2 + r.height / 2);
      p.el.style.translate = '0 ' + (clamp(prog, -1, 1) * p.k * 100).toFixed(2) + '%';
    });
  }

  requestAnimationFrame(frame);
}


/* ─────────────────────────────────────────────────────────
   13. Подсветка активного пункта меню
   ───────────────────────────────────────────────────────── */
if ('IntersectionObserver' in window) {
  var links = {};
  $$('.top__nav a').forEach(function (a) { links[a.getAttribute('href')] = a; });
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var a = links['#' + e.target.id];
      if (a && e.isIntersecting) {
        $$('.top__nav a').forEach(function (x) { x.removeAttribute('aria-current'); });
        a.setAttribute('aria-current', 'true');
      }
    });
  }, {rootMargin: '-45% 0px -50% 0px'});
  $$('main section[id]').forEach(function (s) { spy.observe(s); });
}


/* ─────────────────────────────────────────────────────────
   14. Запуск
   ───────────────────────────────────────────────────────── */
function boot() {
  sizeBody();
  requestAnimationFrame(frame);
  addEventListener('resize', sizeBody);
  addEventListener('load', sizeBody);
  setTimeout(sizeBody, 400);
  setTimeout(sizeBody, 1600);
}

var loader = $('#loader'), loadBar = $('#loadBar'), loadNum = $('#loadNum');

/* На мобильных прелоадер не показываем: он отодвигает первую отрисовку. */
var skipLoader = reduce || coarse || innerWidth <= 900;

if (skipLoader) {
  loader.style.display = 'none';
  document.body.classList.add('is-live');
  boot();
} else {
  document.body.classList.add('is-boot');
  var finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    loader.classList.add('is-done');
    setTimeout(function () {
      document.body.classList.add('is-live');
      $$('#hero .rv, #hero .imgrv, #hero .hair, #hero [data-lines]')
        .forEach(function (el) { el.classList.add('is-in'); });
      setTimeout(function () { loader.style.display = 'none'; }, 900);
    }, 260);
  }

  var t0 = performance.now();
  (function count(now) {
    var p = clamp((now - t0) / 1250, 0, 1);
    var pct = Math.round(100 * (1 - Math.pow(1 - p, 2)));
    loadNum.textContent = pct;
    loadBar.style.transform = 'scaleX(' + (pct / 100) + ')';
    if (p < 1) requestAnimationFrame(count); else finish();
  })(t0);

  /* Подстраховка: в фоновой вкладке rAF не вызывается, и без неё
     страница осталась бы навсегда под заставкой. */
  setTimeout(finish, 1800);
  addEventListener('pageshow', finish);

  boot();
}

})();
