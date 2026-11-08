import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, runTransaction, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, schoolId } from './config.js';
import { MODULE_KEYS, collectLocal, encodeSnapshot, decodeSnapshot, verifiedSnapshotKeys } from './legacy-sync-core.mjs';
import { assertExpectedVersion, sameContent } from './backup-version.mjs';

const $ = (id) => document.getElementById(id);
const numbers = '٠١٢٣٤٥٦٧٨٩';
const num = (number) => String(number).replace(/\d/g, (digit) => numbers[Number(digit)]);
const state = { auth: null, db: null, user: null, busy: false, latest: new Map() };
const rootPath = ['schools', schoolId, 'legacySnapshots'];

// The original Daragat page patches Storage to transparently recover compressed
// records and attachments from IndexedDB. An iframe has a different JS realm;
// reading its own localStorage object would silently back up physical "dga:"
// placeholders rather than the school's real data.
const originalWindow = (() => {
  try {
    if (window.parent !== window && window.parent.location.origin === window.location.origin && window.parent.__dgStore) {
      return window.parent;
    }
  } catch {}
  return null;
})();
const schoolStorage = originalWindow?.localStorage || window.localStorage;

async function prepareOriginalStore() {
  if (!originalWindow?.__dgStore) throw new Error('open-original-menu');
  await originalWindow.__dgStore.ready();
  await originalWindow.__dgStore.flush();
}

function notice(message, error = false) {
  $('feedback').textContent = message;
  $('feedback').className = error ? 'error' : 'ok';
}

function errorText(error) {
  if (error?.message === 'open-original-menu') return 'بۆ پاراستنی دروستی وێنە و بەڵگەکان، ئەم بەشە لە مێنیوی بەرنامەی ئەسڵی دارەجات بکەرەوە، نەک بە لینکێکی جیاواز.';
  if (error?.code === 'permission-denied') return 'Firestore Rules مۆڵەتی ئەم کارەت نادات. یاساکانی legacySnapshots لە Firebase Console بڵاو بکەرەوە و ڕۆڵەکەت بپشکنە.';
  if (error?.code?.startsWith('auth/')) return 'ئیمەیڵ، وشەی نهێنی یان پەیوەندیی Firebase ڕاست نییە.';
  if (error?.message === 'backup-conflict') return 'ئامێرێکی دیکە لە نێواندا پاشەکەوتی Firebase ـی نوێی ناردووە. هیچ وەشانێکی ئێستا نەگۆڕدرا؛ دۆخ نوێ بکەرەوە و پاشان بڕیار بدە.';
  if (error?.message === 'too-large') return 'یەکێک لە بەشەکان زۆر گەورەیە (زیاتر لە سنووری پاراستن). بڕی وێنە و بەڵگەکان کەم بکەرەوە.';
  if (error?.message === 'snapshot-corrupted' || error?.message === 'invalid-snapshot') return 'پاشەکەوتێکی سەحابی تەواو نییە یان گۆڕاوە؛ هیچ داتایەک نەهێنرایەوە.';
  return 'کارەکە سەرکەوتوو نەبوو: ' + String(error?.message || 'هەڵەی نەناسراو').slice(0, 180);
}

function busy(value) {
  state.busy = value;
  for (const id of ['push', 'pull', 'refresh', 'logout', 'download-local']) $(id).disabled = value;
  $('login-form').querySelectorAll('button,input').forEach((item) => { item.disabled = value; });
  $('progress').hidden = !value;
  if (!value) $('progress').value = 0;
}

function step(current, total) {
  $('progress').value = total ? Math.round(current / total * 100) : 0;
}

function localSummary() {
  const snapshot = collectLocal(schoolStorage);
  const keys = Object.keys(snapshot);
  $('local-count').textContent = num(keys.length);
  const bytes = Object.values(snapshot).reduce((sum, value) => sum + new TextEncoder().encode(value).length, 0);
  $('size-label').textContent = 'قەبارەی نزیکەیی داتای هەڵبژێردراو: ' + num((bytes / 1024 / 1024).toFixed(2)) + ' MB';
  $('key-list').replaceChildren();
  Object.entries(MODULE_KEYS).forEach(([key, label]) => {
    const item = document.createElement('div');
    item.className = 'item';
    const title = document.createElement('strong'); title.textContent = label;
    const status = document.createElement('span'); status.textContent = keys.includes(key) ? '✓' : '—';
    item.append(title, status);
    $('key-list').append(item);
  });
  return snapshot;
}

async function refreshCloud() {
  if (!state.user) return new Map();
  const result = await getDocs(collection(state.db, ...rootPath));
  const latest = new Map();
  result.forEach((snap) => {
    if (Object.prototype.hasOwnProperty.call(MODULE_KEYS, snap.id)) latest.set(snap.id, snap.data());
  });
  state.latest = latest;
  $('cloud-count').textContent = num(latest.size);
  return latest;
}

async function uploadOne(key, raw) {
  const encoded = await encodeSnapshot(raw);
  const prior = state.latest.get(key);
  if (sameContent(prior, encoded.sha256)) return false; // Nothing changed; no writes.
  const version = crypto.randomUUID();
  const base = doc(state.db, ...rootPath, key);
  // Keep batches small: membership lookup in Firestore Rules has a per-batch limit.
  for (let start = 0; start < encoded.chunks.length; start += 10) {
    const batch = writeBatch(state.db);
    encoded.chunks.slice(start, start + 10).forEach((data, index) => {
      const chunkId = String(start + index).padStart(4, '0');
      batch.set(doc(state.db, ...rootPath, key, 'versions', version, 'chunks', chunkId), {
        data,
        createdAt: serverTimestamp(),
        createdBy: state.user.uid
      });
    });
    await batch.commit();
  }
  // Commit the manifest LAST and only if no other device has replaced the
  // version observed when this upload started. Avoids silent lost updates.
  await runTransaction(state.db, async (transaction) => {
    const current = await transaction.get(base);
    assertExpectedVersion(prior, current.exists() ? current.data() : null);
    transaction.set(base, {
      version,
      chunks: encoded.chunks.length,
      encoding: encoded.encoding,
      sha256: encoded.sha256,
      byteLength: encoded.byteLength,
      updatedAt: serverTimestamp(),
      updatedBy: state.user.uid
    });
  });
  state.latest.set(key, { version, sha256: encoded.sha256, chunks: encoded.chunks.length });
  return true;
}

async function downloadLocal() {
  if (state.busy) return;
  busy(true);
  try {
    await prepareOriginalStore();
    const modules = localSummary();
    const count = Object.keys(modules).length;
    if (!count) return notice('هیچ بەشێکی پاشەکەوتکراو لە ئامێرەکەدا نەدۆزرایەوە.', true);
    const payload = JSON.stringify({
      format: 'daragat-selected-local-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      moduleKeys: Object.keys(modules),
      modules
    });
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'daragat-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    notice('داگرتنی یەدەکی ناوخۆیی بۆ ' + num(count) + ' بەش داوا کرا. فایلەکە لە شوێنێکی پارێزراو هەڵبگرە. ئەرشیفی ساڵانی پێشوو و داتاکانی بەشی ئۆنلاینی جیاواز لەم فایلەدا نین.');
  } catch (error) {
    notice(errorText(error), true);
  } finally {
    busy(false);
  }
}

async function push() {
  if (state.busy || !state.user) return;
  try { await prepareOriginalStore(); }
  catch (error) { return notice(errorText(error), true); }
  const data = localSummary();
  const keys = Object.keys(data);
  if (!keys.length) return notice('لە وێبگەڕەکەدا هێشتا هیچ تۆمارێکی دارەجات نییە.', true);
  if (!confirm('ناردنی ' + num(keys.length) + ' بەشی دارەجات بۆ Firebase؟ ئەگەر لە سێرڤەر وەشانێکی پێشوو هەبێت، تەنها بۆ ئەو بەشانەی گۆڕاون وەشانی نوێ دروست دەکرێت.')) return;
  busy(true);
  try {
    await refreshCloud();
    let written = 0;
    for (let index = 0; index < keys.length; index++) {
      notice('ناردنی: ' + MODULE_KEYS[keys[index]] + ' (' + num(index + 1) + '/' + num(keys.length) + ')');
      if (await uploadOne(keys[index], data[keys[index]])) written++;
      step(index + 1, keys.length);
    }
    await refreshCloud();
    notice('ناردن تەواو بوو. ' + num(written) + ' بەش نوێ کرانەوە؛ بەشە بێ‌گۆڕانەکان دووبارە نەنێردران.');
  } catch (error) { notice(errorText(error) + ' ئەگەر لە ناوەڕاستدا وەستا، تەنها بەشە تەواوبووەکان پاشەکەوت بوون.', true); }
  finally { busy(false); }
}

async function fetchOne(key, meta) {
  if (!meta || typeof meta.version !== 'string' || !/^[0-9a-f-]{36}$/.test(meta.version) ||
      !Number.isInteger(meta.chunks) || meta.chunks < 1 || meta.chunks > 200) throw new Error('invalid-snapshot');
  const docs = await getDocs(collection(state.db, ...rootPath, key, 'versions', meta.version, 'chunks'));
  if (docs.size !== meta.chunks) throw new Error('invalid-snapshot');
  const chunks = new Array(meta.chunks);
  docs.forEach((snapshot) => {
    const index = Number(snapshot.id);
    if (!/^\d{4}$/.test(snapshot.id) || !Number.isInteger(index) || index >= meta.chunks || chunks[index] !== undefined) throw new Error('invalid-snapshot');
    chunks[index] = snapshot.data().data;
  });
  if (chunks.some((part) => typeof part !== 'string')) throw new Error('invalid-snapshot');
  return decodeSnapshot({ ...meta, chunks });
}

async function pull() {
  if (state.busy || !state.user) return;
  busy(true);
  try {
    await prepareOriginalStore();
    const latest = await refreshCloud();
    if (!latest.size) return notice('هیچ پاشەکەوتێک لە Firebase نییە. سەرەتا لە ئامێری یەکەم بنێرە.', true);
    const fetched = {};
    const entries = [...latest.entries()];
    for (let index = 0; index < entries.length; index++) {
      const [key, meta] = entries[index];
      notice('پشکنینی پاشەکەوتی: ' + MODULE_KEYS[key] + ' (' + num(index + 1) + '/' + num(entries.length) + ')');
      fetched[key] = await fetchOne(key, meta);
      step(index + 1, entries.length);
    }
    const keys = verifiedSnapshotKeys(fetched);
    if (!confirm('هەموو ' + num(keys.length) + ' بەش بە سەرکەوتوویی پشکنران. هێنانەوە، داتای ناوخۆیی هەمان بەشان دەگۆڕێت و دارەجات دووبارە دادەکاتەوە. بەردەوام دەبیت؟')) {
      return notice('هێنانەوە هەڵوەشێنرایەوە. هیچ داتایەک نەگۆڕدرا.');
    }
    // Validate all remote data before changing a single local key.
    const before = Object.fromEntries(keys.map((key) => [key, schoolStorage.getItem(key)]));
    const changed = [];
    try {
      for (const key of keys) { schoolStorage.setItem(key, fetched[key]); changed.push(key); }
    } catch (writeError) {
      // Best effort rollback if the browser's storage quota blocks a large payload.
      for (const key of changed) {
        try { if (before[key] === null) schoolStorage.removeItem(key); else schoolStorage.setItem(key, before[key]); } catch {}
      }
      throw writeError;
    }
    await originalWindow.__dgStore.flush();
    notice('هێنانەوە سەرکەوتوو بوو. دارەجات نوێ دەکرێتەوە…');
    try { window.top.location.reload(); } catch { window.location.reload(); }
  } catch (error) { notice(errorText(error), true); }
  finally { busy(false); }
}

async function handleAuth(user) {
  state.user = null;
  state.latest.clear();
  $('login-form').hidden = false;
  $('signed-in').hidden = true;
  $('sync-panel').hidden = true;
  $('connection').textContent = 'چوونەژوورەوە پێویستە';
  $('connection').className = 'badge off';
  $('cloud-count').textContent = '—';
  if (!user) { notice('بۆ پاشەکەوتی داتای قوتابخانە بە هەژماری Firebase بچۆ ژوورەوە.'); return; }
  busy(true);
  try {
    const member = await getDoc(doc(state.db, 'schools', schoolId, 'members', user.uid));
    if (state.auth.currentUser?.uid !== user.uid) return;
    if (!member.exists() || member.data().active !== true || member.data().role !== 'admin') {
      throw new Error('admin-required');
    }
    state.user = user;
    $('login-form').hidden = true;
    $('signed-in').hidden = false;
    $('sync-panel').hidden = false;
    $('user-label').textContent = user.email || 'بەڕێوەبەری قوتابخانە';
    $('connection').textContent = 'بەڕێوەبەر — پەیوەندی چالاکە';
    $('connection').className = 'badge';
    await refreshCloud();
    notice('ئامادەیە. داتای ئەم وێبگەڕە بخەرە سەر Firebase یان داتای سەحابی بهێنەرەوە.');
  } catch (error) {
    notice(error?.message === 'admin-required' ? 'ئەم هەژمارە ڕۆڵی بەڕێوەبەری چالاکی نییە؛ بەشی پاشەکەوتی گشتی بۆ بەڕێوەبەرانە.' : errorText(error), true);
  } finally { busy(false); }
}

function start() {
  localSummary();
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    busy(true);
    try { await signInWithEmailAndPassword(state.auth, $('email').value.trim(), $('password').value); $('password').value = ''; }
    catch (error) { notice(errorText(error), true); }
    finally { busy(false); }
  });
  $('logout').addEventListener('click', () => signOut(state.auth).catch((error) => notice(errorText(error), true)));
  $('push').addEventListener('click', push);
  $('download-local').addEventListener('click', downloadLocal);
  $('pull').addEventListener('click', pull);
  $('refresh').addEventListener('click', async () => {
    if (state.busy) return;
    busy(true);
    try { localSummary(); await refreshCloud(); notice('دۆخی داتا نوێ کرایەوە.'); }
    catch (error) { notice(errorText(error), true); }
    finally { busy(false); }
  });
  try {
    const app = initializeApp(firebaseConfig);
    state.auth = getAuth(app);
    state.db = getFirestore(app);
    onAuthStateChanged(state.auth, handleAuth, (error) => notice(errorText(error), true));
  } catch (error) { notice(errorText(error), true); }
}
start();
