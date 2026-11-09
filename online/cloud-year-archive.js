/* Manual, immutable, administrator-only cloud copies of sealed academic years.
 * No automatic uploads; no writes to the currently open academic year.
 */
import { initializeApp, getApp, getApps } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, query, limit, runTransaction, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, schoolId } from './config.js';
import { encodeSnapshot, decodeSnapshot } from './legacy-sync-core.mjs';
import { source, readRecords, readIndex, addRecords } from './year-archive-ui.mjs?v=p0-20261109-2';
import { planYearArchiveImport } from './year-archive-core.mjs';
import {
  yearPackage, checkEncodedYear, validateCloudYearManifest,
  uploadDecision, validateDownloadedYear, isActiveYearAdmin,
  makeYearVerificationReceipt, parseYearVerificationReceipt, matchesYearVerificationReceipt,
  CLOUD_YEAR_MAX_BYTES,
  CLOUD_YEAR_LIST_LIMIT
} from './cloud-year-archive-core.mjs?v=p0-20261109-3';

const $ = id => document.getElementById(id);
const ROOT = ['schools', schoolId, 'yearArchives'];
const state = { user: null, authorized: false, auth: null, db: null, busy: false, records: [], cloud: new Map() };

function status(message, error = false) {
  const el = $('cloud-year-status');
  el.textContent = message;
  el.className = error ? 'error' : 'ok';
}

function errorText(error) {
  if (error?.message === 'open-original-menu') return 'سەرەتا لە مێنیوی بەرنامەی ئەسڵی دارەجات ئەم پەڕەیە بکەرەوە.';
  if (error?.message === 'admin-required') return 'تەنها هەژماری بەڕێوەبەری چالاک دەستڕاگەیشتنی هەیە.';
  if (error?.message === 'cloud-year-not-selected') return 'سەرەتا ساڵێکی سەحابی هەڵبژێرە.';
  if (error?.message === 'cloud-year-receipt-invalid') return 'کۆدی بەراورد نادروستە. دەقی تەواوی کۆدی ئامێری یەکەم دابنێ.';
  if (error?.message === 'cloud-year-too-large' || error?.message === 'too-large') return 'ئەم ساڵە بۆ پاشەکەوتی سەحابی زۆر گەورەیە (سنووری ٦ MB). لە سەرەوە یەدەکی JSON دابگرە.';
  if (error?.message === 'cloud-year-private-key') return 'ئەم ئەرشیفە داتای هەژمار/دانیشتن لەخۆ دەگرێت و بۆ سەحابی نانێردرێت.';
  if (error?.message === 'cloud-year-conflict' || error?.message === 'archive-conflict') return 'ئەرشیفێکی جیاواز بە هەمان ناسنامە هەیە؛ هیچ داتایەکی هەبوو نەگۆڕدرا.';
  if (error?.message === 'cloud-year-corrupt' || error?.message === 'snapshot-corrupted' || error?.message === 'invalid-snapshot' || error?.message === 'invalid-archive' || error?.message === 'invalid-archive-snapshot') return 'ئەرشیفی سەحابی ناتەواوە یان پشکنینی دروستی تێناپەڕێنێت؛ هیچ داتایەک نەهێنرایەوە.';
  if (error?.code === 'permission-denied') return 'دەسەڵات ڕەتکرایەوە؛ Firestore Rules ـی yearArchives لە Firebase Console بڵاو بکەرەوە و ڕۆڵی بەڕێوەبەر بپشکنە.';
  return 'هەڵە: ' + String(error?.message || error?.code || 'نەناسراو').slice(0, 150);
}

function setBusy(value) {
  state.busy = value;
  const blocked = value || !state.authorized;
  $('cloud-year-upload').disabled = blocked || state.records.length === 0;
  $('cloud-year-download').disabled = blocked || state.cloud.size === 0;
  $('cloud-year-save').disabled = blocked || state.cloud.size === 0;
  $('cloud-year-refresh').disabled = blocked;
  $('cloud-year-proof-create').disabled = blocked || state.cloud.size === 0;
  $('cloud-year-proof-check').disabled = blocked || state.cloud.size === 0;
  $('cloud-year-local').disabled = blocked || state.records.length === 0;
  $('cloud-year-remote').disabled = blocked || state.cloud.size === 0;
}

function assertAdmin() {
  if (!state.user || !state.authorized || state.auth.currentUser?.uid !== state.user.uid) throw new Error('admin-required');
}

function labelFor(record) {
  return String(record.meta?.academicYear || record.meta?.year || record.meta?.title || record.id).slice(0, 100);
}

function fillSelect(element, entries, emptyLabel) {
  const previous = element.value;
  element.replaceChildren();
  for (const [id, label] of entries) {
    const option = new Option(label, id);
    element.add(option);
  }
  if (!entries.length) element.add(new Option(emptyLabel, ''));
  else if (entries.some(([id]) => id === previous)) element.value = previous;
}

async function refresh() {
  assertAdmin();
  await source(); // Parent app storage must have finished flushing.
  state.records = await readRecords();
  fillSelect($('cloud-year-local'), state.records.map(record => [record.id, labelFor(record)]), 'ئەرشیفی ناوخۆیی نییە');
  const result = await getDocs(query(collection(state.db, ...ROOT), limit(CLOUD_YEAR_LIST_LIMIT)));
  const cloud = new Map();
  result.forEach(snap => cloud.set(snap.id, validateCloudYearManifest(snap.data(), snap.id)));
  state.cloud = cloud;
  fillSelect($('cloud-year-remote'), [...cloud].map(([id, meta]) => [id, meta.label || id]), 'ئەرشیفی سەحابی نییە');
  setBusy(state.busy);
  status('ئەرشیفی ناوخۆیی: ' + state.records.length + ' ساڵ؛ سەحابی: ' + cloud.size + ' ساڵ. ' +
    (cloud.size === CLOUD_YEAR_LIST_LIMIT ? 'تەنها ١٠٠ ئەرشیفی یەکەم پیشان دەدرێن.' : 'هیچ شتێک بەخۆکار نانێردرێت.'));
}

async function withBusy(action) {
  if (state.busy) return;
  setBusy(true);
  try { assertAdmin(); await action(); }
  catch (error) { status(errorText(error), true); }
  finally { setBusy(false); }
}

async function upload() {
  await withBusy(async () => {
    await source();
    const id = $('cloud-year-local').value;
    const record = (await readRecords()).find(row => row.id === id);
    if (!record) return status('سەرەتا ساڵێکی داخراو هەڵبژێرە.', true);
    const raw = JSON.stringify(yearPackage(record));
    const byteLength = new TextEncoder().encode(raw).byteLength;
    if (byteLength > CLOUD_YEAR_MAX_BYTES) throw new Error('cloud-year-too-large');
    const encoded = checkEncodedYear(await encodeSnapshot(raw));
    const base = doc(state.db, ...ROOT, id);
    const current = await getDoc(base);
    const decision = uploadDecision(current.exists() ? current.data() : null, encoded, id);
    if (decision === 'skip') return status('ئەم ساڵە پێشتر بە هەمان ناوەڕۆک لە Firebase پارێزراوە؛ هیچ نووسینێکی دووبارە نەکرا.');
    const count = encoded.chunks.length + 1;
    const sizeMb = (byteLength / 1024 / 1024).toFixed(2);
    if (!confirm('ئەرشیفی «' + labelFor(record) + '» بۆ Firebase بنێردرێت؟\nقەبارەی خام: ' + sizeMb + ' MB\nزۆرترین نووسینی ئەم کردارە: ' + count + ' سند.\nئەم وەشانە دوای ناردن ناگۆڕدرێت.')) return status('ناردن هەڵوەشێنرایەوە.');
    const version = crypto.randomUUID();
    status('ناردنی ' + encoded.chunks.length + ' پارچە؛ تکایە پەڕەکە مەداخە…');
    for (let start = 0; start < encoded.chunks.length; start += 8) {
      assertAdmin();
      const batch = writeBatch(state.db);
      encoded.chunks.slice(start, start + 8).forEach((data, index) => {
        batch.set(doc(state.db, ...ROOT, id, 'versions', version, 'chunks', String(start + index).padStart(4, '0')), {
          data, createdAt: serverTimestamp(), createdBy: state.user.uid
        });
      });
      await batch.commit();
    }
    // Publish a manifest last, and only if another device has not published
    // this immutable archive ID in the meantime.
    await runTransaction(state.db, async transaction => {
      const latest = await transaction.get(base);
      if (latest.exists()) throw new Error('cloud-year-conflict');
      transaction.set(base, {
        version, chunks: encoded.chunks.length,
        encoding: encoded.encoding, sha256: encoded.sha256,
        byteLength: encoded.byteLength, label: labelFor(record),
        createdAt: serverTimestamp(), createdBy: state.user.uid
      });
    });
    await refresh();
    status('ئەرشیفی «' + labelFor(record) + '» پارێزرا. ' + count + ' سند نووسران؛ ئەم کارە خۆکارانە دووبارە نابێتەوە.');
  });
}

async function fetchVerifiedCloudYear(id) {
    if (!id) throw new Error('cloud-year-not-selected');
    const base = await getDoc(doc(state.db, ...ROOT, id));
    if (!base.exists()) throw new Error('cloud-year-corrupt');
    const meta = validateCloudYearManifest(base.data(), id);
    const result = await getDocs(collection(state.db, ...ROOT, id, 'versions', meta.version, 'chunks'));
    if (result.size !== meta.chunks) throw new Error('cloud-year-corrupt');
    const chunks = Array(meta.chunks);
    result.forEach(snap => {
      const index = Number(snap.id);
      if (!/^\d{4}$/.test(snap.id) || !Number.isInteger(index) || index >= meta.chunks || chunks[index] !== undefined) throw new Error('cloud-year-corrupt');
      chunks[index] = snap.data().data;
    });
    if (chunks.some(chunk => typeof chunk !== 'string')) throw new Error('cloud-year-corrupt');
    const raw = await decodeSnapshot({ ...meta, chunks });
    const archive = validateDownloadedYear(raw, id);
    return { meta, archive };
}

async function saveCloudYear() {
  await withBusy(async () => {
    await source();
    const id = $('cloud-year-remote').value;
    const { meta, archive } = await fetchVerifiedCloudYear(id);
    // A verified JSON copy can be saved without any local archive mutation.
    const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], {type: 'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'daragat-cloud-year-' + id + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status('یەدەکی JSON بۆ «' + meta.label + '» داواکرا. پێش داگرتن پشکنینی SHA-256 کرا؛ ئەرشیفی ناوخۆیی نەگۆڕدرا. فایلەکە زانیاریی تایبەتییە.');
  });
}

// Read and verify the complete remote archive before producing or comparing
// a receipt. Neither action changes IndexedDB, localStorage, or Firestore.
async function createVerificationReceipt() {
  await withBusy(async () => {
    const id = $('cloud-year-remote').value;
    const { meta } = await fetchVerifiedCloudYear(id);
    assertAdmin();
    const proof = makeYearVerificationReceipt(meta, id, schoolId);
    const field = $('cloud-year-proof-code');
    field.value = proof;
    field.focus();
    field.select();
    status('کۆدی بەراورد ئامادەیە. لە ئامێری دووەم دایبنێ و «بەراوردکردن» بکە. تەنها خوێندنەوەی Firebase کرا؛ هیچ داتایەک نەگۆڕدرا.');
  });
}

async function compareVerificationReceipt() {
  await withBusy(async () => {
    const code = $('cloud-year-proof-code').value;
    const id = $('cloud-year-remote').value;
    if (!id) throw new Error('cloud-year-not-selected');
    const receipt = parseYearVerificationReceipt(code);
    if (receipt.schoolId !== schoolId || receipt.archiveId !== id) {
      return status('⚠️ کۆدی ئامێری یەکەم بۆ قوتابخانە یان ساڵێکی جیاوازە. هیچ خوێندنەوەی سەحابی نەکرا.', true);
    }
    const { meta } = await fetchVerifiedCloudYear(id);
    assertAdmin();
    const same = matchesYearVerificationReceipt(code, meta, id, schoolId);
    status(same
      ? '✅ هەمان ئەرشیفی سەحابی لەم ئامێرەش بە SHA-256 پشتڕاست کرایەوە. ئەمە بەراوردی خوێندنەوەیە؛ ساڵی کارا نەگۆڕدرا.'
      : '⚠️ کۆدی ئامێری یەکەم لەگەڵ ئەم ئەرشیفە ناگونجێت. قوتابخانە، ساڵ و وەشانی هەڵبژێردراو بپشکنە؛ هیچ داتایەک نەگۆڕدرا.', !same);
  });
}

async function download() {
  await withBusy(async () => {
    await source();
    const id = $('cloud-year-remote').value;
    const { meta, archive } = await fetchVerifiedCloudYear(id);
    const main = await source();
    const [existing, index] = await Promise.all([readRecords(), Promise.resolve(readIndex(main))]);
    const plan = planYearArchiveImport(existing, index, archive);
    if (!plan.additions.length) return status('ئەم ئەرشیفە پێشتر لەم ئامێرە هەیە؛ هیچ شتێک نەگۆڕدرا.');
    if (!confirm('ئەرشیفی «' + meta.label + '» دوای پشکنینی دروستی بۆ ئەم ئامێرە زیاد بکرێت؟ ساڵی کارا ناگۆڕدرێت.')) return status('هێنانەوە هەڵوەشێنرایەوە.');
    // Same add-only + rollback behavior as the local JSON archive importer.
    const oldIndex = main.localStorage.getItem('schoolResultsYearArchiveIndex_v1');
    main.localStorage.setItem('schoolResultsYearArchiveIndex_v1', JSON.stringify(plan.mergedIndex));
    try { await addRecords(plan.additions); }
    catch (error) {
      try {
        if (oldIndex === null) main.localStorage.removeItem('schoolResultsYearArchiveIndex_v1');
        else main.localStorage.setItem('schoolResultsYearArchiveIndex_v1', oldIndex);
        await main.__dgStore.flush();
      } catch (_) {}
      throw error;
    }
    await main.__dgStore.flush();
    status('ئەرشیفی «' + meta.label + '» زیاد کرا. ئەرشیفەکانی پێشوو و ساڵی کارا نەگۆڕدران؛ بەشی ئەرشیف دووبارە بکەرەوە.');
  });
}

function start() {
  for (const id of ['cloud-year-upload','cloud-year-download','cloud-year-save','cloud-year-refresh','cloud-year-proof-create','cloud-year-proof-check']) {
    $(id).disabled = true;
  }
  $('cloud-year-upload').addEventListener('click', upload);
  $('cloud-year-download').addEventListener('click', download);
  $('cloud-year-save').addEventListener('click', saveCloudYear);
  $('cloud-year-refresh').addEventListener('click', () => withBusy(refresh));
  $('cloud-year-proof-create').addEventListener('click', createVerificationReceipt);
  $('cloud-year-proof-check').addEventListener('click', compareVerificationReceipt);
  try {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    state.auth = getAuth(app);
    state.db = getFirestore(app);
    onAuthStateChanged(state.auth, async user => {
      state.authorized = false;
      state.user = null;
      setBusy(state.busy);
      if (!user) return status('بۆ ئەرشیفی سەحابی بە هەژماری Firebase ـی بەڕێوەبەر بچۆ ژوورەوە.');
      try {
        const member = await getDoc(doc(state.db, 'schools', schoolId, 'members', user.uid));
        if (state.auth.currentUser?.uid !== user.uid) return;
        if (!member.exists() || !isActiveYearAdmin(member.data(), user.uid, state.auth.currentUser?.uid)) throw new Error('admin-required');
        state.user = user;
        state.authorized = true;
        setBusy(state.busy);
        await withBusy(refresh);
      } catch (error) { status(errorText(error), true); }
    }, error => status(errorText(error), true));
  } catch (error) { status(errorText(error), true); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
