/* Link Google/Apple/Facebook/Microsoft to the SAME Firebase administrator UID.
 * This keeps existing school membership and backup permissions unchanged.
 */
import { getApps } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, linkWithPopup, GoogleAuthProvider, FacebookAuthProvider, OAuthProvider } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';

const options = [
  ['google.com','Google','G'],
  ['apple.com','Apple','●'],
  ['facebook.com','Facebook','f'],
  ['microsoft.com','Microsoft','▦']
];
let auth = null, user = null, busy = false;

function provider(id) {
  if (id === 'google.com') return new GoogleAuthProvider();
  if (id === 'facebook.com') return new FacebookAuthProvider();
  const next = new OAuthProvider(id);
  if (id === 'apple.com') { next.addScope('email'); next.addScope('name'); }
  return next;
}
function message(error) {
  const code = error?.code || String(error?.message || '');
  if (code === 'auth/operation-not-allowed') return 'ئەم دابینکەرە لە Firebase Authentication هێشتا چالاک نییە.';
  if (code === 'auth/unauthorized-domain') return 'ناونیشانی GitHub Pages لە Firebase Authorized domains زیاد بکە.';
  if (code === 'auth/credential-already-in-use' || code === 'auth/account-exists-with-different-credential') return 'ئەم هەژمارە پێشتر بە هەژمارێکی دیکەی Firebase بەستراوە. ڕێنمایی یەکخستنی هەژمارەکان پێویستە.';
  if (code === 'auth/provider-already-linked') return 'ئەم دابینکەرە پێشتر بە هەژمارەکەت بەستراوە.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'کارەکە هەڵوەشێنرایەوە.';
  return 'بەستن سەرکەوتوو نەبوو: ' + String(code).slice(0, 100);
}

const style = document.createElement('style');
style.textContent = `
#dg-provider-link-card {margin-top:16px;border:1px solid #bfd9cb;background:#f8fef9;border-radius:15px;padding:17px;}
#dg-provider-link-card h3 {margin:0 0 6px;font-size:17px;color:#17483c;}
#dg-provider-link-card p {font-size:12px;line-height:1.8;color:#557168;}
#dg-provider-link-card .dg-links {display:flex;flex-wrap:wrap;gap:8px;margin-top:13px;}
#dg-provider-link-card .dg-link {display:flex;align-items:center;gap:9px;background:#fff;border:1px solid #bed8ca;border-radius:10px;padding:10px 13px;color:#1a5b48;cursor:pointer;font-weight:800;}
#dg-provider-link-card .dg-link:disabled {opacity:.58;cursor:default;}
#dg-provider-link-card .dg-link.linked {background:#e4f7eb;}
#dg-provider-link-card .dg-link-icon {font-size:19px;font-weight:900;}
#dg-provider-link-card .dg-link-status {font-size:12px;line-height:1.9;margin-top:9px;color:#8b5c31;}
`;
document.head.append(style);

function canShow() {
  const signed = document.getElementById('signed-in');
  const panel = document.getElementById('sync-panel');
  return !!user && !!panel && !panel.hidden && !!signed && !signed.hidden;
}

function renderButtons() {
  const root = document.getElementById('dg-provider-link-card');
  if (!root || !user) return;
  const wrap = root.querySelector('.dg-links');
  wrap.replaceChildren();
  const linkedIds = new Set(user.providerData.map((item) => item.providerId));
  options.forEach(([id,name,icon]) => {
    const linked = linkedIds.has(id);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'dg-link' + (linked ? ' linked' : '');
    btn.disabled = busy || linked;
    const mark = document.createElement('span');mark.className = 'dg-link-icon';mark.textContent = icon;
    btn.append(mark,document.createTextNode(name + (linked ? ' ✓ بەستراوە' : ' + بەستن')));
    btn.addEventListener('click', () => link(id));
    wrap.append(btn);
  });
}

async function link(id) {
  if (busy || !auth?.currentUser || auth.currentUser.uid !== user?.uid) return;
  busy = true;
  renderButtons();
  const status = document.querySelector('#dg-provider-link-card .dg-link-status');
  status.textContent = 'پەیوەندیی ئەکاونتەکەت دەکرێتەوە…';
  try {
    const result = await linkWithPopup(auth.currentUser,provider(id));
    user = result.user;
    status.textContent = '✅ بە سەرکەوتوویی بەسترا. ئێستا دەتوانیت بە هەمان دابینکەرە بچیتە ژوورەوە.';
  } catch (error) { status.textContent = message(error); }
  finally { busy = false;renderButtons(); }
}

function mount() {
  const panel = document.getElementById('sync-panel');
  if (!panel || !canShow()) return;
  if (panel.querySelector('#dg-provider-link-card')) return;
  const root = document.createElement('section'); root.id = 'dg-provider-link-card';
  const h = document.createElement('h3'); h.textContent = '🔗 بەستنی Google، Apple، Facebook و Microsoft';
  const p = document.createElement('p');
  p.textContent = 'سەرەتا بە هەژماری بەڕێوەبەری Firebase چوویتەتە ژوورەوە. لێرە هەژمارە کۆمەڵایەتییەکان بە هەمان UID دەبەستیت؛ دەسەڵات و پاشەکەوتەکان هەر وەک خۆیان دەمێننەوە. دابینکەرەکان دەبێت لە Firebase Console چالاک کرابن.';
  const row = document.createElement('div');row.className = 'dg-links';
  const status = document.createElement('div');status.className = 'dg-link-status';status.setAttribute('role','status');
  root.append(h,p,row,status);
  panel.append(root);
  renderButtons();
}

function init() {
  const app = getApps().find((item) => item.name === '[DEFAULT]');
  if (!app) return;
  auth = getAuth(app);
  onAuthStateChanged(auth,(next) => { user = next; mount(); renderButtons(); });
  let pending = false;
  new MutationObserver((items) => {
    if (!items.some((item) => item.addedNodes.length || item.attributeName === 'hidden')) return;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; mount(); },150);
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
