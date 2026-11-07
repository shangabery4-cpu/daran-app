/* Daragat — Kurdish Sorani account-screen visual upgrade.
 * Decorates the existing, password-verified local account forms. It does not
 * create an alternative session, read credentials, or change the account store.
 */
(function () {
  'use strict';
  if (window.__daragatAuthUpgrade) return;
  window.__daragatAuthUpgrade = true;

  const CSS = `
  #dg-personal-gate.dg-auth-modern {
    z-index:2147483645; display:block; padding:0; overflow:auto;
    color:#f3f8ff; background:
      radial-gradient(ellipse at 12% 11%,rgba(39,115,231,.40),transparent 33%),
      radial-gradient(ellipse at 92% 92%,rgba(35,202,175,.18),transparent 32%),
      linear-gradient(128deg,#09172e 0%,#123a76 51%,#0a1734 100%);
    font-family:'Noto Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;
  }
  #dg-personal-gate.dg-auth-modern:before {
    content:''; position:fixed; inset:0; pointer-events:none; opacity:.22;
    background-image:radial-gradient(#8fc2ff 1px,transparent 1px);
    background-size:34px 34px; mask-image:linear-gradient(90deg,transparent,#000);
  }
  #dg-personal-gate .dg-auth-layout {
    position:relative; max-width:1180px; min-height:100dvh; margin:auto;
    display:grid; grid-template-columns:minmax(0,540px) minmax(0,440px);
    align-items:center; justify-content:center; gap:clamp(18px,5vw,76px);
    padding:clamp(22px,4vw,52px) 24px;
  }
  #dg-personal-gate .dg-auth-panel {min-width:0; position:relative; z-index:1;}
  #dg-personal-gate .dg-auth-kicker {
    display:flex; align-items:center; justify-content:center; gap:9px;
    color:#cce2ff; font-size:12px; font-weight:800; letter-spacing:.1px;
    margin:0 auto 12px; text-align:center;
  }
  #dg-personal-gate .dg-auth-kicker:before,
  #dg-personal-gate .dg-auth-kicker:after {
    content:''; display:inline-block; width:27px; height:1px;
    background:#7ca8e185;
  }
  #dg-personal-gate.dg-auth-modern .dg-card {
    width:100%; margin:0; padding:clamp(22px,3vw,34px);
    display:flex; flex-direction:column; gap:12px;
    background:linear-gradient(160deg,rgba(44,82,145,.88),rgba(11,31,67,.91));
    border:1px solid rgba(181,211,255,.23); border-radius:24px;
    box-shadow:0 25px 85px rgba(0,10,32,.42),inset 0 1px rgba(255,255,255,.15);
    color:#f0f7ff; backdrop-filter:blur(18px);
  }
  #dg-personal-gate.dg-auth-modern .dg-logo {
    width:77px; height:77px; margin:-67px auto 0; position:relative;
    background:linear-gradient(140deg,#f6e6a0,#f6bb55); color:#173765;
    border:5px solid #204b87; border-radius:21px; font-size:34px;
    box-shadow:0 12px 30px rgba(3,17,40,.55),0 0 0 3px rgba(255,255,255,.14);
  }
  #dg-personal-gate.dg-auth-modern h2 {
    color:#fff; text-align:center; font-size:clamp(21px,2.7vw,27px);
    line-height:1.65; letter-spacing:0; margin:3px 0 0;
  }
  #dg-personal-gate.dg-auth-modern .dg-card > p:first-of-type {
    color:#c7d8f2; text-align:center; font-size:12.5px; line-height:1.85;
    margin:0 0 3px;
  }
  #dg-personal-gate .dg-auth-switch {
    display:grid; grid-template-columns:1fr 1fr; gap:6px;
    background:rgba(2,16,40,.40); padding:5px; border-radius:13px;
    border:1px solid rgba(174,206,252,.15);
  }
  #dg-personal-gate.dg-auth-modern .dg-auth-tab {
    min-height:41px; border:0; background:transparent; color:#c0d0ea;
    font-weight:850; font-size:13px; border-radius:10px;
  }
  #dg-personal-gate.dg-auth-modern .dg-auth-tab[aria-selected="true"] {
    background:linear-gradient(110deg,#4088ef,#2668cc); color:#fff;
    box-shadow:0 5px 15px #0004;
  }
  #dg-personal-gate.dg-auth-modern .dg-auth-tab:disabled {
    cursor:not-allowed; opacity:.44;
  }
  #dg-personal-gate.dg-auth-modern form {display:grid;gap:11px;}
  #dg-personal-gate.dg-auth-modern label {
    position:relative; gap:5px; font-size:12.8px; color:#e2edff;
    font-weight:800; line-height:1.65;
  }
  #dg-personal-gate.dg-auth-modern input {
    color:#fff; min-height:46px; padding:12px 14px;
    background:rgba(3,19,45,.58); border:1px solid rgba(173,208,255,.22);
    border-radius:12px; box-shadow:inset 0 1px 2px rgba(0,0,0,.13);
    transition:border-color .16s,box-shadow .16s,background .16s;
  }
  #dg-personal-gate.dg-auth-modern input::placeholder {color:#a4b9d5;opacity:.8;}
  #dg-personal-gate.dg-auth-modern input:focus {
    border-color:#75baff; background:#0c2a54;
    box-shadow:0 0 0 3px rgba(84,157,255,.22);
  }
  #dg-personal-gate.dg-auth-modern .dg-field-pass input {padding-left:46px;}
  #dg-personal-gate.dg-auth-modern .dg-eye {
    position:absolute; left:8px; top:27px; z-index:1;
    padding:7px 8px; border:0; border-radius:8px;
    background:transparent; color:#b5cced; font-size:15px;
  }
  #dg-personal-gate.dg-auth-modern .dg-eye:hover {color:#fff;background:#ffffff18;}
  #dg-personal-gate.dg-auth-modern button.dg-primary {
    min-height:48px; border:1px solid #36d8a7;
    background:linear-gradient(100deg,#17ac83,#10d59e); color:#073f38;
    font-size:15.5px; font-weight:900; box-shadow:0 10px 25px #002e3238;
  }
  #dg-personal-gate.dg-auth-modern button.dg-primary:hover {filter:brightness(1.08);}
  #dg-personal-gate.dg-auth-modern #dg-msg {color:#ffd1d5;font-size:13px;}
  #dg-personal-gate.dg-auth-modern .dg-foot {
    color:#b9cce6; font-size:11px; text-align:center; line-height:1.8;
  }
  #dg-personal-gate .dg-auth-safe {
    border-radius:12px; padding:9px 12px; font-size:11px;
    color:#cde2fd; text-align:center; background:#09254c88;
    border:1px solid #80afff24; line-height:1.75;
  }
  #dg-personal-gate .dg-strength {display:grid;gap:5px;margin-top:2px;}
  #dg-personal-gate .dg-strength-track {height:4px;background:#ffffff28;overflow:hidden;border-radius:10px;}
  #dg-personal-gate .dg-strength-fill {display:block;height:100%;width:0;background:#e5a342;transition:width .18s;}
  #dg-personal-gate .dg-strength-label {color:#c7d8f2;font-size:10.5px;}
  #dg-personal-gate .dg-auth-showcase {padding:20px 5px;color:#eaf4ff;min-width:0;}
  #dg-personal-gate .dg-auth-showcase .dg-hero-label {
    display:inline-flex; align-items:center; gap:8px; padding:5px 13px;
    color:#a3f4d7; border-radius:100px; background:#1b655d50;
    border:1px solid #80e5c04a; font-weight:800; font-size:12px;
  }
  #dg-personal-gate .dg-auth-showcase h1 {
    font-size:clamp(29px,4vw,47px); line-height:1.5; margin:18px 0 10px;
    font-weight:900; color:#fff;
  }
  #dg-personal-gate .dg-auth-showcase p {
    font-size:14px; line-height:2; color:#c6d9f5; margin:0 0 22px;
  }
  #dg-personal-gate .dg-auth-preview {
    border:1px solid rgba(199,226,255,.25);
    background:linear-gradient(155deg,#eff7ff,#cfe7f5);
    border-radius:20px; padding:13px; box-shadow:0 20px 50px #0005;
    transform:rotate(-2deg); color:#163a55;
  }
  #dg-personal-gate .dg-auth-preview header {
    display:flex; align-items:center; justify-content:space-between;
    font-size:12px; font-weight:900; padding:0 2px 10px;
  }
  #dg-personal-gate .dg-auth-preview .dg-preview-badge {
    background:#14775c; border-radius:15px; padding:3px 9px; color:#fff; font-size:9px;
  }
  #dg-personal-gate .dg-auth-preview .dg-preview-grid {
    display:grid; grid-template-columns:repeat(3,1fr); gap:9px;
  }
  #dg-personal-gate .dg-preview-tile {
    min-height:100px; display:flex; flex-direction:column; justify-content:center;
    align-items:center; gap:7px; text-align:center; background:#fff;
    border:1px solid #d9e9ed; border-radius:13px;
    font-weight:800; font-size:11px; box-shadow:0 4px 10px #082d4014;
  }
  #dg-personal-gate .dg-preview-tile span {font-size:24px;}
  #dg-personal-gate .dg-auth-chips {display:flex;gap:8px;flex-wrap:wrap;margin-top:21px;}
  #dg-personal-gate .dg-auth-chips span {
    padding:6px 11px; background:rgba(255,255,255,.10);
    border:1px solid rgba(255,255,255,.18); border-radius:40px;
    color:#e3f1ff;font-size:11px;font-weight:800;
  }
  #dg-personal-gate.dg-auth-modern :is(button,input):focus-visible {
    outline:3px solid #f6d37b; outline-offset:2px;
  }
  @media(max-width:920px){
    #dg-personal-gate .dg-auth-layout {grid-template-columns:minmax(0,530px);gap:20px;}
    #dg-personal-gate .dg-auth-showcase {display:none;}
  }
  @media(max-width:540px){
    #dg-personal-gate .dg-auth-layout {padding:72px 13px 28px;min-height:100dvh;}
    #dg-personal-gate.dg-auth-modern .dg-card {padding:25px 19px 18px;border-radius:20px;}
    #dg-personal-gate.dg-auth-modern .dg-logo {margin-top:-58px;}
    #dg-personal-gate.dg-auth-modern .dg-twocol {display:grid;grid-template-columns:1fr;gap:10px;}
  }
  @media(prefers-reduced-motion:reduce){
    #dg-personal-gate.dg-auth-modern *,#dg-personal-gate.dg-auth-modern *:before {transition:none!important;animation:none!important;}
  }
  @media print {#dg-personal-gate.dg-auth-modern{display:none!important;}}
  `;

  const style = document.createElement('style');
  style.id = 'dg-auth-upgrade-css';
  style.textContent = CSS;
  document.head.appendChild(style);

  function elem(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }

  function addPasswordToggles(card) {
    card.querySelectorAll('input[type="password"]').forEach(function (input) {
      const label = input.closest('label');
      if (!label || label.querySelector('.dg-eye')) return;
      label.classList.add('dg-field-pass');
      const toggle = elem('button', 'dg-eye', '👁');
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'پیشاندانی وشەی نهێنی');
      toggle.setAttribute('aria-pressed', 'false');
      toggle.addEventListener('click', function () {
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        toggle.textContent = visible ? '◉' : '👁';
        toggle.setAttribute('aria-label', visible ? 'شاردنەوەی وشەی نهێنی' : 'پیشاندانی وشەی نهێنی');
        toggle.setAttribute('aria-pressed', String(visible));
        input.focus();
      });
      label.append(toggle);
    });
  }

  function addStrengthMeter(card) {
    const password = card.querySelector('#dg-register-form #dg-password');
    if (!password) return;
    const holder = elem('div', 'dg-strength');
    const track = elem('div', 'dg-strength-track');
    const fill = elem('span', 'dg-strength-fill');
    const label = elem('span', 'dg-strength-label', 'هێزی وشەی نهێنی');
    track.append(fill);
    holder.append(track, label);
    password.closest('label').append(holder);
    function refresh() {
      const value = password.value;
      const complexity = [/[a-z]/i, /\d/, /[^\da-z]/i].filter(function (re) { return re.test(value); }).length;
      const score = !value ? 0 : value.length < 8 ? 1 : Math.min(4, 1 + complexity);
      fill.style.width = String(score * 25) + '%';
      fill.style.background = ['#e5a342','#f38c72','#e5a342','#81bd83','#22d8a1'][score];
      label.textContent = !value ? 'وشەی نهێنی: لانیکەم ٨ پیت' :
        ['','زۆر لاواز','لاواز','مامناوەند','بەهێز'][score];
    }
    password.addEventListener('input', refresh);
    refresh();
  }

  function decorate() {
    const gate = document.getElementById('dg-personal-gate');
    if (!gate || gate.hidden || gate.querySelector('.dg-auth-layout')) return;
    const card = gate.querySelector('.dg-card');
    if (!card) return;
    const isRegister = !!card.querySelector('#dg-register-form');
    const isLogin = !!card.querySelector('#dg-login-form');
    if (!isLogin && !isRegister) {
      gate.classList.remove('dg-auth-modern');
      return;
    }

    const panel = elem('section', 'dg-auth-panel');
    const kicker = elem('div', 'dg-auth-kicker', 'دارەجات | سیستەمی قوتابخانە');
    const layout = elem('div', 'dg-auth-layout');
    const showcase = elem('aside', 'dg-auth-showcase');
    showcase.setAttribute('aria-label', 'پێشبینینی ڕووکاری دارەجات');
    showcase.innerHTML = '<div class="dg-hero-label">✦ بەڕێوەبردنی قوتابخانە</div>' +
      '<h1>پەروەردە بە شێوازێکی زیرەک و نوێ</h1>' +
      '<p>داتای قوتابیان، نمرەکان و بەڕێوەبردنی ڕۆژانە لە ڕووکارێکی کوردیی سۆرانی و ڕێکوپێکدا.</p>' +
      '<div class="dg-auth-preview" aria-hidden="true"><header>داشبۆردی دارەجات <span class="dg-preview-badge">پێشبینینی ڕووکار</span></header>' +
      '<div class="dg-preview-grid"><div class="dg-preview-tile"><span>🎓</span>قوتابیان</div>' +
      '<div class="dg-preview-tile"><span>📊</span>نمرەکان</div><div class="dg-preview-tile"><span>📝</span>تاقیکردنەوەکان</div>' +
      '<div class="dg-preview-tile"><span>📚</span>بابەتەکان</div><div class="dg-preview-tile"><span>🗓️</span>خشتەکان</div>' +
      '<div class="dg-preview-tile"><span>☁️</span>پاشەکەوت</div></div></div>' +
      '<div class="dg-auth-chips"><span>🌐 کوردیی سۆرانی</span><span>🔐 هەژماری پارێزراو</span><span>📱 مۆبایل و کۆمپیوتەر</span></div>';

    const switcher = elem('div', 'dg-auth-switch');
    switcher.setAttribute('role', 'tablist');
    const tabs = [
      { mode:'login', text:'چوونەژوورەوە', active:isLogin },
      { mode:'register', text:'هەژماری نوێ', active:isRegister }
    ];
    const profileExists = !!window.localStorage.getItem('daragat.ckb.personal-profile.v1');
    tabs.forEach(function (tab) {
      const button = elem('button', 'dg-auth-tab', tab.text);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.active));
      const unavailable = tab.mode === 'register' ? profileExists : !profileExists;
      button.disabled = unavailable && !tab.active;
      if (button.disabled) button.title = profileExists ?
        'ئەم وێبگەڕە پێشتر هەژمارێکی هەیە؛ بۆ پاراستنی هەژمارەکە ناتوانرێت لێرەدا جێگۆڕکێی پێ بکرێت.' :
        'سەرەتا هەژمارێک دروست بکە.';
      button.addEventListener('click', function () {
        if (button.disabled || tab.active) return;
        if (typeof window.dgSoraniAuthShow === 'function') window.dgSoraniAuthShow(tab.mode);
      });
      switcher.append(button);
    });
    const heading = card.querySelector('h2');
    if (heading) heading.insertAdjacentElement('afterend', switcher);
    addPasswordToggles(card);
    addStrengthMeter(card);
    card.append(elem('div', 'dg-auth-safe', '🔒 ئەم هەژمارە ناوخۆییە. پاشەکەوتی سەحابیی Firebase بەشی جیاوازە و بە دەستی تۆ ئەنجام دەدرێت.'));
    panel.append(kicker, card);
    layout.append(panel, showcase);
    gate.replaceChildren(layout);
    gate.classList.add('dg-auth-modern');
  }

  function init() {
    decorate();
    let queued = false;
    const observer = new MutationObserver(function (mutations) {
      if (!mutations.some(function (entry) { return entry.addedNodes.length || entry.removedNodes.length; })) return;
      if (queued) return;
      queued = true;
      setTimeout(function () { queued = false; decorate(); }, 40);
    });
    observer.observe(document.body, { childList:true, subtree:true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
