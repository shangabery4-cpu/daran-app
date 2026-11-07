/* Daragat — Firebase-backed federated sign-in.
 * Social accounts MUST have an active administrator membership in Firestore.
 * This does not weaken Firestore rules or replace the existing local login.
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider, FacebookAuthProvider, OAuthProvider } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, getDoc, doc } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, schoolId } from './config.js';

const SESSION = 'daragat.ckb.social-session-intent.v1';
const PROVIDERS = [
  { key:'google', icon:'G', label:'Google' },
  { key:'apple', icon:'●', label:'Apple' },
  { key:'facebook', icon:'f', label:'Facebook' },
  { key:'microsoft', icon:'▦', label:'Microsoft' }
];
let auth, db, current = null, busy = false, restoring = false;

const style = document.createElement('style');
style.textContent = `
#dg-personal-gate .dg-social-auth {display:grid;gap:8px;margin:2px 0 6px;}
#dg-personal-gate .dg-social-title {display:flex;gap:8px;align-items:center;color:#d1e1fa;font-size:11px;font-weight:800;}
#dg-personal-gate .dg-social-title:after {content:'';height:1px;background:#b5d1f644;flex:1;}
#dg-personal-gate .dg-social-grid {display:grid;grid-template-columns:1fr 1fr;gap:9px;}
#dg-personal-gate.dg-auth-modern .dg-social-btn {display:flex;align-items:center;justify-content:center;gap:10px;min-height:43px;background:#edf5ff;color:#153a63;border:1px solid #c2d5e9;font-weight:900;border-radius:11px;font-size:12.5px;}
#dg-personal-gate.dg-auth-modern .dg-social-btn:hover:not(:disabled) {background:#fff;transform:translateY(-1px);}
#dg-personal-gate.dg-auth-modern .dg-social-btn .dg-provider-icon {font-family:Arial,sans-serif!important;font-weight:900;font-size:19px;display:grid;place-items:center;width:25px;height:25px;}
#dg-personal-gate .dg-social-btn[data-provider="google"] .dg-provider-icon {color:#4285f4;}
#dg-personal-gate .dg-social-btn[data-provider="facebook"] .dg-provider-icon {color:#1877f2;}
#dg-personal-gate .dg-social-btn[data-provider="apple"] .dg-provider-icon {color:#0b1b2d;}
#dg-personal-gate .dg-social-btn:disabled {opacity:.5;cursor:wait;}
#dg-personal-gate .dg-social-msg {min-height:18px;font-size:11px;line-height:1.8;color:#ffe3a9;}
#dg-personal-gate .dg-cloud-profile {margin:auto;max-width:450px;padding:25px;background:white;border-radius:20px;color:#1d3d36;box-shadow:0 22px 60px #001a3160;text-align:center;}
#dg-personal-gate .dg-cloud-profile h2 {font-size:23px;color:#153d32;}
#dg-personal-gate .dg-cloud-profile p {line-height:1.8;font-size:13px;color:#45675f;}
#dg-personal-gate .dg-cloud-profile button {background:#0c876b;color:#fff;border:0;border-radius:10px;padding:11px 18px;cursor:pointer;font-weight:800;}
@media(max-width:420px){#dg-personal-gate .dg-social-grid{grid-template-columns:1fr 1fr;gap:6px;}#dg-personal-gate.dg-auth-modern .dg-social-btn{font-size:11px;gap:5px;}}
`;
document.head.append(style);

const app = getApps().find((item) => item.name === 'daragat-social') || initializeApp(firebaseConfig, 'daragat-social');
auth = getAuth(app);
db = getFirestore(app);

function provider(name) {
  if (name === 'google') return new GoogleAuthProvider();
  if (name === 'facebook') return new FacebookAuthProvider();
  if (name === 'apple') {
    const result = new OAuthProvider('apple.com');
    result.addScope('email');
    result.addScope('name');
    return result;
  }
  if (name === 'microsoft') return new OAuthProvider('microsoft.com');
  throw new Error('invalid-provider');
}

function errorMessage(error) {
  const code = error?.code || error?.message || '';
  if (code === 'not-member' || code === 'permission-denied') return 'ئەم هەژمارە دەسەڵاتی بەڕێوەبەری چالاکی ئەم قوتابخانەیەی نییە. پێویستە بەڕێوەبەر لە Firebase ڕێگەی پێ بدات.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/invalid-oauth-provider') return 'ئەم ڕێگەی چوونەژوورەوەیە هێشتا لە Firebase Console چالاک نەکراوە. لە Authentication > Sign-in method چالاکی بکە.';
  if (code === 'auth/unauthorized-domain') return 'ناونیشانی ئەم وێبسایتە لە Firebase Authentication > Authorized domains زیاد بکە.';
  if (code === 'auth/popup-blocked') return 'وێبگەڕەکەت پەنجەرەی چوونەژوورەوەی داخستووە. ڕێگە بە Pop-up بدە.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'چوونەژوورەوە هەڵوەشێنرایەوە.';
  if (code === 'auth/account-exists-with-different-credential' || code === 'auth/credential-already-in-use') return 'ئەم ئیمەیڵە پێشتر بە ڕێگەیەکی تر تۆمار کراوە. سەرەتا بە هەژماری پێشووت بچۆ ژوورەوە و دواتر بەستەری ئەم ڕێگەیە زیاد بکە.';
  if (code === 'auth/network-request-failed') return 'پەیوەندیی ئینتەرنێت بپشکنە.';
  return 'چوونەژوورەوە سەرکەوتوو نەبوو. ' + String(code).slice(0, 90);
}

function feedback(text) {
  const node = document.querySelector('#dg-social-msg');
  if (node) node.textContent = text;
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('.dg-social-btn').forEach((button) => { button.disabled = value; });
}
async function allowedAdmin(user) {
  if (!user) throw new Error('not-member');
  const snap = await getDoc(doc(db,'schools',schoolId,'members',user.uid));
  if (!snap.exists() || snap.data().active !== true || snap.data().role !== 'admin') throw new Error('not-member');
  return { uid:user.uid,email:user.email || '',name:user.displayName || '',role:'admin' };
}

function showCloudProfile() {
  const gate = document.getElementById('dg-personal-gate');
  if (!gate || !current) return;
  gate.classList.remove('dg-auth-modern');
  gate.hidden = false;
  gate.replaceChildren();
  const box = document.createElement('section');
  box.className = 'dg-cloud-profile';
  const icon = document.createElement('div'); icon.textContent = '☁️'; icon.style.fontSize = '42px';
  const title = document.createElement('h2'); title.textContent = 'هەژماری سەحابیی دارەجات';
  const email = document.createElement('p'); email.textContent = current.email || current.name || 'بەڕێوەبەر';
  const note = document.createElement('p'); note.textContent = 'بەڕێوەبەر — پەیوەندیی پارێزراو بە Firebase';
  const back = document.createElement('button'); back.type = 'button'; back.textContent = 'گەڕانەوە بۆ بەرنامە';
  back.addEventListener('click', () => { gate.hidden = true; gate.replaceChildren(); });
  const logout = document.createElement('button'); logout.type = 'button'; logout.textContent = 'دەرچوون لە هەژماری سەحابی';
  logout.style.margin = '9px'; logout.addEventListener('click', leave);
  box.append(icon,title,email,note,back,logout);
  gate.append(box);
}

function wrapAccountOpen() {
  const old = window.nbAccountOpen;
  if (typeof old !== 'function' || old.__daragatSocialWrapped) return;
  const wrapped = function () { return current ? showCloudProfile() : old.apply(this,arguments); };
  wrapped.__daragatSocialWrapped = true;
  window.nbAccountOpen = wrapped;
}

function enter(profile) {
  current = profile;
  try { sessionStorage.setItem(SESSION,'1'); } catch (_) {}
  wrapAccountOpen();
  const gate = document.getElementById('dg-personal-gate');
  if (gate) { gate.hidden = true; gate.replaceChildren(); }
  window.dispatchEvent(new Event('dg-sorani-login'));
}

async function leave() {
  current = null;
  try { sessionStorage.removeItem(SESSION); } catch (_) {}
  try { await signOut(auth); } catch (_) {}
  const gate = document.getElementById('dg-personal-gate');
  if (gate) { gate.hidden = true; gate.replaceChildren(); }
  const original = window.nbAccountOpen;
  if (typeof original === 'function') original();
  else window.location.reload();
}

async function signIn(name) {
  if (busy) return;
  setBusy(true);
  feedback('چوونەژوورەوەی ' + name + ' دەکرێتەوە…');
  try {
    try { sessionStorage.setItem(SESSION,'1'); } catch (_) {}
    const result = await signInWithPopup(auth,provider(name));
    const profile = await allowedAdmin(result.user);
    enter(profile);
  } catch (error) {
    try { sessionStorage.removeItem(SESSION); } catch (_) {}
    feedback(errorMessage(error));
    try { await signOut(auth); } catch (_) {}
  } finally { setBusy(false); }
}

function mountButtons() {
  const gate = document.getElementById('dg-personal-gate');
  if (!gate || gate.hidden) return;
  const form = gate.querySelector('#dg-login-form, #dg-register-form');
  if (!form || form.parentNode.querySelector('.dg-social-auth')) return;
  const group = document.createElement('section'); group.className = 'dg-social-auth';
  const label = document.createElement('div'); label.className = 'dg-social-title';
  label.textContent = 'یان بە هەژماری سەحابی بچۆ ژوورەوە';
  const grid = document.createElement('div'); grid.className = 'dg-social-grid';
  PROVIDERS.forEach((item) => {
    const button = document.createElement('button'); button.className = 'dg-social-btn';
    button.type = 'button'; button.dataset.provider = item.key;
    const icon = document.createElement('span'); icon.className = 'dg-provider-icon'; icon.textContent = item.icon;
    const name = document.createElement('span'); name.textContent = item.label;
    button.append(icon,name);
    button.addEventListener('click', () => signIn(item.key));
    grid.append(button);
  });
  const status = document.createElement('div'); status.className = 'dg-social-msg';
  status.id = 'dg-social-msg'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  group.append(label,grid,status);
  form.insertAdjacentElement('beforebegin',group);
}

function init() {
  mountButtons(); wrapAccountOpen();
  let queued = false;
  new MutationObserver((changes) => {
    if (!changes.some((change) => change.addedNodes.length > 0)) return;
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; mountButtons(); wrapAccountOpen(); }, 120);
  }).observe(document.body,{childList:true,subtree:true});

  onAuthStateChanged(auth, async (user) => {
    if (!user || restoring || current) return;
    if (sessionStorage.getItem(SESSION) !== '1') return;
    restoring = true;
    try { enter(await allowedAdmin(user)); }
    catch (_) { try { sessionStorage.removeItem(SESSION); } catch (_) {} }
    finally { restoring = false; }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
