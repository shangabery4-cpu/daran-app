/* Daragat legacy-to-online navigation bridge.
 * Preserves the complete original ZIP UI and its local data; never reads or writes records.
 * The cloud modules still use their own Firebase auth and database.
 */
(function () {
  'use strict';
  if (window.__daragatUnifiedNav) return;
  window.__daragatUnifiedNav = true;

  var entries = [
    { id: 'attendance', label: 'تۆماری ئامادەبوونی ئۆنلاین', icon: '☁️', url: './online/' },
    { id: 'parent', label: 'پۆرتاڵی دایک‌وباوکان', icon: '👨‍👩‍👧', url: './online/parent.html' },
    { id: 'display', label: 'شاشەی زیندووی قوتابخانە', icon: '📺', url: './online/display.html' }
  ];
  var popup = null;
  var frame = null;
  var title = null;
  var tabs = new Map();
  var lastFocus = null;

  function create(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function setActive(which) {
    if (!frame || !popup) return;
    var selected = entries.find(function (entry) { return entry.id === which; });
    if (!selected) return;
    var url = new URL(selected.url, window.location.href);
    if (frame.src !== url.href) frame.src = url.href;
    title.textContent = selected.icon + ' ' + selected.label;
    tabs.forEach(function (button, key) {
      button.setAttribute('aria-selected', String(which === key));
    });
    popup.hidden = false;
    document.body.classList.add('dg-unified-open');
    if (typeof window.closeGlobalNav === 'function') window.closeGlobalNav();
    popup.querySelector('.dg-unified-close').focus();
  }

  function close() {
    if (!popup) return;
    popup.hidden = true;
    document.body.classList.remove('dg-unified-open');
    // Stop any kiosk polling or background reads while the original app is in view.
    if (frame) frame.removeAttribute('src');
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }

  function buildPopup() {
    if (popup) return;
    popup = create('section', 'dg-unified-shell');
    popup.id = 'dg-unified-shell';
    popup.hidden = true;
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-label', 'بەشە ئۆنلاینەکانی دارەجات');

    var header = create('div', 'dg-unified-header');
    var brand = create('div', 'dg-unified-brand');
    brand.append(create('strong', '', 'دارەجات'));
    title = create('span', '', 'بەشە ئۆنلاینەکان');
    brand.append(title);
    header.append(brand);

    var closeButton = create('button', 'dg-unified-close', '↩ گەڕانەوە بۆ بەرنامەی سەرەکی');
    closeButton.type = 'button';
    closeButton.addEventListener('click', close);
    header.append(closeButton);
    popup.append(header);

    var nav = create('nav', 'dg-unified-tabs');
    nav.setAttribute('aria-label', 'بەشە ئۆنلاینەکان');
    entries.forEach(function (entry) {
      var button = create('button', '', entry.icon + ' ' + entry.label);
      button.type = 'button';
      button.setAttribute('aria-selected', 'false');
      button.addEventListener('click', function () { setActive(entry.id); });
      nav.append(button);
      tabs.set(entry.id, button);
    });
    popup.append(nav);

    var note = create('p', 'dg-unified-note',
      'بەشی ئۆنلاین بە Firebase کار دەکات. زانیارییە ناوخۆییەکانی وەشانی ئەسڵی هێشتا خۆکارانە لەگەڵ ئەو بەشە هاوکات نابن؛ هیچ داتایەک خۆکارانە ناگوازرێتەوە.');
    popup.append(note);
    frame = create('iframe', 'dg-unified-frame');
    frame.title = 'دارەجات — بەشی پارێزراوی ئۆنلاین';
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    popup.append(frame);
    document.body.append(popup);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !popup.hidden) close();
    });
  }

  function addNavigation() {
    var drawer = document.querySelector('#globalNavDrawer .gnd-links');
    if (!drawer || drawer.querySelector('[data-nav="dg-online-attendance"]')) return false;
    buildPopup();
    var anchor = drawer.querySelector('[data-nav="attendance"]');
    entries.forEach(function (entry, index) {
      var button = create('button', 'dg-unified-action');
      button.type = 'button';
      button.dataset.nav = 'dg-online-' + entry.id;
      var icon = create('span', '', entry.icon);
      button.append(icon, document.createTextNode(entry.label));
      button.addEventListener('click', function () {
        lastFocus = button;
        setActive(entry.id);
      });
      if (anchor && anchor.parentNode) {
        anchor.insertAdjacentElement('afterend', button);
        anchor = button;
      } else drawer.append(button);
    });
    return true;
  }

  function init() {
    var tries = 0;
    (function mount() {
      if (addNavigation()) return;
      if (++tries < 40) window.setTimeout(mount, 250);
    })();
  }

  var css = document.createElement('style');
  css.textContent = [
    'body.dg-unified-open{overflow:hidden!important}',
    'body.auth-screen .dg-unified-action{display:none!important}',
    '.dg-unified-action{font-weight:700!important}',
    '.dg-unified-shell{position:fixed!important;inset:0!important;z-index:2147483000!important;display:flex;flex-direction:column;background:#f2f8f5;color:#173d34;direction:rtl;font-family:inherit}',
    '.dg-unified-shell[hidden]{display:none!important}',
    '.dg-unified-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:10px 18px;background:var(--red-mid,#8a2543);color:white}',
    '.dg-unified-brand{display:flex;align-items:center;gap:16px;font-size:17px}',
    '.dg-unified-brand span{font-size:14px;opacity:.92}',
    '.dg-unified-close{background:rgba(255,255,255,.16);color:white;border:1px solid rgba(255,255,255,.5);border-radius:8px;padding:9px 13px;cursor:pointer;font:inherit}',
    '.dg-unified-tabs{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;background:white;border-bottom:1px solid #cddfd6}',
    '.dg-unified-tabs button{border:1px solid #cadcd2;background:#fff;color:#245b49;border-radius:9px;padding:9px 14px;font:inherit;cursor:pointer}',
    '.dg-unified-tabs button[aria-selected="true"]{background:#e3f6eb;color:#075a45;border-color:#118063;font-weight:800}',
    '.dg-unified-note{margin:0;padding:7px 16px;background:#fff4e6;color:#815b28;font-size:12px;line-height:1.6}',
    '.dg-unified-frame{display:block;flex:1;width:100%;min-height:0;border:0;background:#f3f8f6}',
    '@media(max-width:600px){.dg-unified-header{padding:8px 12px}.dg-unified-brand{font-size:14px;gap:8px}.dg-unified-tabs{padding:8px;gap:5px}.dg-unified-tabs button{font-size:12px;padding:7px}.dg-unified-note{font-size:11px;padding:6px 10px}}'
  ].join('\n');
  document.head.append(css);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
