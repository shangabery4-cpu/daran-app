/* Daragat — system-wide Sorani typography and responsive reading controls.
 * Stored per-browser. Works with the original app's existing size selector.
 */
(function () {
  'use strict';
  if (window.__daragatFonts) return;
  window.__daragatFonts = true;

  const FAMILY_KEY = 'daragat.ckb.font.family.v1';
  const FIELD_KEY = 'daragat.ckb.font.fieldSize.v1';
  const APP_SIZE_KEY = 'schoolResultsFontSize_v1';
  const FONTS = [
    ['vazirmatn','Vazirmatn','وەزیرمەتن — مۆدێرن و ڕوون'],
    ['notokufi','Noto Kufi Arabic','نۆتۆ کوفی — ئەندازەیی و فەرمی'],
    ['notosans','Noto Sans Arabic','نۆتۆ سانس — سادە و ڕوون'],
    ['plex','IBM Plex Sans Arabic','پڵێکس — پێشکەوتوو'],
    ['cairo','Cairo','قاهیرە — تۆخ و مۆدێرن'],
    ['tajawal','Tajawal','تەجاوەل — پاک و نەرم'],
    ['readex','Readex Pro','ریدێکس — خوێندنەوەی ئاسان'],
    ['system','Tahoma','سیستەم — بێ ئینتەرنێت']
  ];
  const SIZES = ['small','normal','large','xlarge','huge','xhuge','xxhuge'];
  const SIZE_LABELS = ['زۆر بچووک','ئاسایی','گەورە','گەورەتر','زۆر گەورە','زۆر گەورەتر','گەورەترین'];
  const file = document.createElement('link');
  file.rel = 'stylesheet';
  file.href = 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;500;600;700;800&family=Noto+Sans+Arabic:wght@400;500;600;700;800&family=Readex+Pro:wght@400;500;600;700&family=Tajawal:wght@400;500;600;700;800&family=Vazirmatn:wght@400;500;600;700;800&display=swap';
  document.head.append(file);

  const css = document.createElement('style');
  css.id = 'dg-global-font-style';
  css.textContent = `
  html.dg-kurdish-font :is(body,button,input,select,textarea,option,label,summary,p,small,strong,b,h1,h2,h3,h4,h5,h6,th,td,caption,legend,.view,.module-shell,.dashboard-sidebar,.global-nav-drawer,.nbset,.dg-card) {
    font-family:var(--dg-kurdish-family,'Vazirmatn',Tahoma,sans-serif)!important;
  }
  html.dg-kurdish-font :is(input,select,textarea,option,th,td) {
    font-size:var(--dg-field-font-size,15px)!important;
    line-height:1.65!important;
  }
  html.dg-kurdish-font :is(input,select,textarea) {
    min-height:36px;
  }
  #dg-font-settings {border:1px solid #b9dacf!important;background:linear-gradient(145deg,#f1fcf6,#fff)!important;direction:rtl;}
  #dg-font-settings * {box-sizing:border-box;}
  #dg-font-settings h4 {color:#154d44;margin:0 0 5px;}
  #dg-font-settings .dg-font-intro {font-size:13px;line-height:1.8;color:#536d66;margin:0 0 15px;}
  #dg-font-settings .dg-font-grid {display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  #dg-font-settings .dg-font-control {display:grid;gap:7px;align-content:start;}
  #dg-font-settings label {font-weight:900;font-size:13px;color:#244e49;}
  #dg-font-settings select,#dg-font-settings input[type=range] {width:100%;max-width:100%;min-width:0;}
  #dg-font-settings select {border:1px solid #b9d0c8!important;border-radius:10px;background:white!important;color:#214640!important;padding:9px!important;min-height:43px;}
  #dg-font-settings input[type=range] {accent-color:#10896b;}
  #dg-font-settings .dg-font-scale {display:flex;align-items:center;gap:9px;justify-content:space-between;color:#3c655c;font-size:11px;}
  #dg-font-settings .dg-font-demo {border-radius:15px;border:1px solid #bbddd0;background:#fff;padding:15px;margin:15px 0 10px;}
  #dg-font-settings .dg-font-demo .demo-title {font-size:17px;font-weight:900;color:#134d40;}
  #dg-font-settings .dg-font-demo .demo-text {line-height:2;color:#365b54;}
  #dg-font-settings .dg-font-note {font-size:11px;color:#667c72;line-height:1.9;}
  #dg-font-settings .dg-font-reset {border:1px solid #b7d3c6;border-radius:9px;background:#e7f8ef;color:#12634c;font-weight:900;padding:9px 13px;cursor:pointer;}
  @media(max-width:700px){#dg-font-settings .dg-font-grid{grid-template-columns:1fr;}}
  @media print{#dg-font-settings{display:none!important;}}
  `;
  document.head.append(css);

  function get(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function persist(key, value) { try { localStorage.setItem(key, String(value)); } catch (_) {} }
  function family(id) {
    return (FONTS.find(function (row) { return row[0] === id; }) || FONTS[0])[1];
  }
  function applyFamily(id) {
    const selected = FONTS.some(function (row) { return row[0] === id; }) ? id : 'vazirmatn';
    document.documentElement.classList.add('dg-kurdish-font');
    document.documentElement.style.setProperty('--dg-kurdish-family', '\'' + family(selected).replace(/'/g, '') + '\',Tahoma,sans-serif');
    persist(FAMILY_KEY, selected);
    const demo = document.querySelector('#dg-font-settings .dg-font-demo');
    if (demo) demo.style.fontFamily = family(selected) + ',Tahoma,sans-serif';
    return selected;
  }
  function applyFieldSize(px) {
    const chosen = Math.max(13, Math.min(21, Math.round(Number(px) || 15)));
    document.documentElement.style.setProperty('--dg-field-font-size', chosen + 'px');
    persist(FIELD_KEY, chosen);
    return chosen;
  }
  function applyAppScale(size) {
    const chosen = SIZES.includes(size) ? size : 'normal';
    if (typeof window.applyAppFontSize === 'function') window.applyAppFontSize(chosen);
    else {
      document.documentElement.setAttribute('data-app-font', chosen);
      persist(APP_SIZE_KEY, chosen);
    }
    const legacy = document.getElementById('setAppFont');
    if (legacy) legacy.value = chosen;
    return chosen;
  }

  applyFamily(get(FAMILY_KEY, 'vazirmatn'));
  applyFieldSize(get(FIELD_KEY, 15));
  window.addEventListener('storage', function (event) {
    if (event.key === FAMILY_KEY) applyFamily(event.newValue);
    if (event.key === FIELD_KEY) applyFieldSize(event.newValue);
  });

  function control(labelText, input) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dg-font-control';
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = labelText;
    wrapper.append(label, input);
    return wrapper;
  }
  function option(select, val, text) {
    const item = document.createElement('option');
    item.value = val; item.textContent = text;
    select.append(item);
  }
  function mountSettings() {
    const look = document.querySelector('#view-settings .nbset-pane[data-p="look"]');
    const original = document.querySelector('#view-settings #stp-app');
    const host = look || original;
    if (!host || host.querySelector('#dg-font-settings')) return;
    const panel = document.createElement('section');
    panel.className = 'nbset-card';
    panel.id = 'dg-font-settings';

    const head = document.createElement('h4');
    head.textContent = '🔤 فۆنتی گشتگیری کوردی و قەبارەی نووسین';
    const intro = document.createElement('p');
    intro.className = 'dg-font-intro';
    intro.textContent = 'فۆنتێکی مۆدێرن بۆ هەموو بەشەکانی سیستەم و خانە و خشتەکان دیاری بکە. گۆڕانکاری دەستبەجێ جێبەجێ دەبێت.';
    const grid = document.createElement('div');
    grid.className = 'dg-font-grid';

    const fontSelect = document.createElement('select');
    fontSelect.id = 'dg-font-family';
    FONTS.forEach(function (row) { option(fontSelect, row[0], row[2]); });
    fontSelect.value = get(FAMILY_KEY, 'vazirmatn');
    fontSelect.addEventListener('change', function () { applyFamily(fontSelect.value); });
    grid.append(control('شێوازی فۆنت', fontSelect));

    const fieldRange = document.createElement('input');
    fieldRange.id = 'dg-font-fields'; fieldRange.type = 'range';
    fieldRange.min = '13'; fieldRange.max = '21'; fieldRange.step = '1';
    fieldRange.value = String(applyFieldSize(get(FIELD_KEY, 15)));
    const fieldBox = control('قەبارەی خانە و خشتەکان', fieldRange);
    const fieldLabel = document.createElement('span');
    fieldLabel.className = 'dg-font-scale';
    fieldLabel.textContent = fieldRange.value + ' px';
    fieldBox.append(fieldLabel);
    fieldRange.addEventListener('input', function () {
      fieldLabel.textContent = String(applyFieldSize(fieldRange.value)) + ' px';
    });
    grid.append(fieldBox);

    const scaleRange = document.createElement('input');
    scaleRange.id = 'dg-font-app-size'; scaleRange.type = 'range';
    scaleRange.min = '0'; scaleRange.max = String(SIZES.length - 1);
    scaleRange.step = '1';
    const current = get(APP_SIZE_KEY, 'normal');
    scaleRange.value = String(Math.max(0, SIZES.indexOf(current)));
    const scaleBox = control('قەبارەی گشتیی ڕووکار', scaleRange);
    const scaleLabel = document.createElement('span');
    scaleLabel.className = 'dg-font-scale';
    scaleLabel.textContent = SIZE_LABELS[Number(scaleRange.value)];
    scaleBox.append(scaleLabel);
    scaleRange.addEventListener('input', function () {
      const index = Number(scaleRange.value);
      applyAppScale(SIZES[index]);
      scaleLabel.textContent = SIZE_LABELS[index];
    });
    grid.append(scaleBox);

    const demo = document.createElement('div');
    demo.className = 'dg-font-demo';
    const demoTitle = document.createElement('div');
    demoTitle.className = 'demo-title'; demoTitle.textContent = 'پێشبینینی فۆنتی دارەجات';
    const demoText = document.createElement('div');
    demoText.className = 'demo-text';
    demoText.textContent = 'قوتابخانە • قوتابیان • مامۆستایان • تاقیکردنەوە • ١٢٣٤٥٦٧٨٩٠';
    demo.append(demoTitle, demoText);

    const reset = document.createElement('button');
    reset.className = 'dg-font-reset'; reset.type = 'button';
    reset.textContent = '↺ گەڕاندنەوە بۆ قەبارەی ئاسایی';
    reset.addEventListener('click', function () {
      fontSelect.value = applyFamily('vazirmatn');
      fieldRange.value = String(applyFieldSize(15));
      fieldLabel.textContent = '15 px';
      scaleRange.value = '1';
      scaleLabel.textContent = SIZE_LABELS[1];
      applyAppScale('normal');
    });
    const note = document.createElement('p');
    note.className = 'dg-font-note';
    note.textContent = 'فۆنتەکان لە ئینتەرنێتەوە دادەبەزن؛ ئەگەر پەیوەندی نەبوو، فۆنتی ئامێر بەکار دەهێنرێت. هەڵبژاردنەکان لەم وێبگەڕەدا دەمێننەوە.';

    panel.append(head,intro,grid,demo,reset,note);
    host.append(panel);
    applyFamily(fontSelect.value);
  }

  function init() {
    mountSettings();
    let pending = false;
    const mo = new MutationObserver(function (changes) {
      if (!changes.some(function (item) { return item.addedNodes.length > 0; })) return;
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; mountSettings(); }, 140);
    });
    mo.observe(document.body, { childList:true, subtree:true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
