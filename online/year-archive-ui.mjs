/* Daragat: non-destructive local export/import of sealed academic years.
 * Does not write Firebase or alter current students/grades.
 */
import {
  YEAR_ARCHIVE_FORMAT,
  validateYearArchivePackage,
  planYearArchiveImport
} from './year-archive-core.mjs';

const DB_NAME = 'nbYearArchiveDB';
const DB_STORE = 'years';
const INDEX_KEY = 'schoolResultsYearArchiveIndex_v1';
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const $ = id => document.getElementById(id);
let busy = false;

function originalWindow() {
  try {
    if (window.parent !== window &&
        window.parent.location.origin === window.location.origin &&
        window.parent.__dgStore) return window.parent;
  } catch (_) {}
  throw new Error('open-original-menu');
}

async function source() {
  const main = originalWindow();
  await main.__dgStore.ready();
  await main.__dgStore.flush();
  return main;
}

function errorText(error) {
  const code = error && error.message;
  if (code === 'open-original-menu') return 'بۆ پاراستنی داتا، لە مێنیوی بەرنامەی سەرەکی دارەجات ئەم بەشە بکەرەوە؛ لینکەکە بە تەنها بەکار مەهێنە.';
  if (code === 'archive-conflict') return 'ئەرشیفێکی بە هەمان ناسنامە بەڵام ناوەڕۆکی جیاواز لەم ئامێرە هەیە؛ بۆ پاراستنی داتای کۆن هیچ شتێک نەگۆڕدرا.';
  if (code === 'invalid-archive' || code === 'invalid-archive-snapshot') return 'فایلەکە ئەرشیفی پشتڕاستکراوی دارەجات نییە یان بەشێکی تێکچووە؛ هیچ داتایەک نەگۆڕدرا.';
  if (code === 'too-large') return 'فایلی هەناردەکراو زۆر گەورەیە. بە تەنها هەر ساڵێک لە مێنیوی ئەرشیف هەناردە بکە.';
  return 'هەڵەیەک ڕوویدا: ' + String(code || 'نەناسراو').slice(0, 150);
}

function status(message, bad = false) {
  const node = $('year-archive-status');
  node.textContent = message;
  node.className = bad ? 'error' : 'ok';
}

function setBusy(value) {
  busy = value;
  $('download-year-archives').disabled = value;
  $('import-year-archives').disabled = value;
}

async function openDb() {
  if (!window.indexedDB) throw new Error('IndexedDB لەم وێبگەڕەدا کار ناکات');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB'));
  });
}

async function readRecords() {
  const db = await openDb();
  try {
    if (!db.objectStoreNames.contains(DB_STORE)) throw new Error('No archive store');
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readonly');
      const request = transaction.objectStore(DB_STORE).getAll();
      let records;
      request.onsuccess = () => { records = request.result; };
      transaction.oncomplete = () => resolve(records || []);
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB'));
    });
  } finally {
    db.close();
  }
}

async function addRecords(records) {
  if (!records.length) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      const store = transaction.objectStore(DB_STORE);
      for (const record of records) store.add(record); // Never overwrite.
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB'));
    });
  } finally {
    db.close();
  }
}

function readIndex(main) {
  const raw = main.localStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('invalid-local-archive');
  return parsed;
}

async function download() {
  if (busy) return;
  setBusy(true);
  try {
    const main = await source();
    const [records, index] = await Promise.all([readRecords(), Promise.resolve(readIndex(main))]);
    if (!records.length) return status('ئەرشیفی هیچ ساڵێک لەم ئامێرە نەدۆزرایەوە.', true);
    const archive = validateYearArchivePackage({
      format: YEAR_ARCHIVE_FORMAT, version: 1, records, index
    });
    const missing = index.filter(meta => !records.some(record => record.id === meta.id)).length;
    const body = JSON.stringify({ ...archive, createdAt: new Date().toISOString() });
    if (new TextEncoder().encode(body).length > MAX_FILE_BYTES) throw new Error('too-large');
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'daragat-year-archives-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status('داگرتنی یەدەکی ' + archive.records.length + ' ساڵ داوا کرا. ' +
      (missing ? missing + ' تۆماری ئیندێکس فایلەکەی لە ئامێرەکەدا نەبوو، بۆیە نەگونجرا.' : 'هەموو ئەرشیفە دۆزراوەکان لە فایلەکەدان.') +
      ' ئەم فایلە تایبەتییە و دەبێت بە پارێزراوی هەڵبگیرێت.');
  } catch (error) { status(errorText(error), true); }
  finally { setBusy(false); }
}

async function importFile(file) {
  if (busy || !file) return;
  setBusy(true);
  try {
    const main = await source();
    if (file.size > MAX_FILE_BYTES) throw new Error('too-large');
    const parsed = validateYearArchivePackage(JSON.parse(await file.text()));
    const [existingRecords, existingIndex] = await Promise.all([readRecords(), Promise.resolve(readIndex(main))]);
    const plan = planYearArchiveImport(existingRecords, existingIndex, parsed);
    if (!plan.additions.length) return status('ئەرشیفەکان پێشتر لەم ئامێرەدا هەن؛ هیچ شتێک نەگۆڕدرا.');
    if (!confirm('هێنانەوەی ' + plan.additions.length + ' ئەرشیفی ساڵی پێشوو؟ تۆمارە هەنووکەییەکان ناگۆڕدرێن.')) {
      return status('هێنانەوە هەڵوەشێنرایەوە؛ هیچ داتایەک نەگۆڕدرا.');
    }
    const oldIndex = main.localStorage.getItem(INDEX_KEY);
    main.localStorage.setItem(INDEX_KEY, JSON.stringify(plan.mergedIndex));
    try {
      await addRecords(plan.additions);
    } catch (error) {
      // The IndexedDB transaction is atomic. Restore the old index if it failed.
      try {
        if (oldIndex == null) main.localStorage.removeItem(INDEX_KEY);
        else main.localStorage.setItem(INDEX_KEY, oldIndex);
        await main.__dgStore.flush();
      } catch (_) {}
      throw error;
    }
    await main.__dgStore.flush();
    status(plan.additions.length + ' ئەرشیفی نوێ بە سەرکەوتوویی زیاد کران. هیچ ئەرشیفێکی پێشووی ئامێرەکە نەسڕایەوە؛ بەشی ئەرشیف دووبارە بکەرەوە.');
  } catch (error) { status(errorText(error), true); }
  finally { setBusy(false); $('year-archive-file').value = ''; }
}

function init() {
  const downloadButton = $('download-year-archives');
  const importButton = $('import-year-archives');
  const fileInput = $('year-archive-file');
  if (!downloadButton || !importButton || !fileInput) return;
  downloadButton.addEventListener('click', download);
  importButton.addEventListener('click', () => { if (!busy) fileInput.click(); });
  fileInput.addEventListener('change', () => importFile(fileInput.files[0]));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
else init();

// Shared, non-mutating archive access for optional manual cloud copies.
export { source, readRecords, readIndex, addRecords };
