/* Safe browser verification: only synthetic values in memory. No IndexedDB,
 * localStorage or Firebase reads/writes and no credentials.
 */
import { encodeSnapshot, decodeSnapshot } from './legacy-sync-core.mjs';
import { planYearArchiveImport } from './year-archive-core.mjs';
import {
  yearPackage, checkEncodedYear, validateDownloadedYear, uploadDecision,
  isActiveYearAdmin
} from './cloud-year-archive-core.mjs?v=p0-20261109-2';

function expect(condition, message) {
  if (!condition) throw new Error('selftest-failed:' + message);
}

export async function runYearArchiveSelftest() {
  const fakeId = 'test_2024_2025';
  const record = {
    id: fakeId,
    meta: { id: fakeId, academicYear: '2024 / 2025', stored: true },
    snapshot: JSON.stringify({
      v: 1, academicYear: '2024 / 2025', store: {
        schoolResultsGradebook_v1: JSON.stringify({ fictitiousStudent: 'TEST ONLY', score: 82 })
      }
    })
  };
  let passed = 0;
  const archive = yearPackage(record);
  expect(archive.records.length === 1 && archive.records[0].id === fakeId, 'archive-structure');
  passed++;

  const encoded = checkEncodedYear(await encodeSnapshot(JSON.stringify(archive)));
  const roundtrip = await decodeSnapshot(encoded);
  expect(JSON.stringify(archive) === roundtrip, 'checksum-roundtrip');
  expect(validateDownloadedYear(roundtrip, fakeId).records[0].snapshot === record.snapshot, 'year-id');
  passed++;

  let rejected = false;
  try { await decodeSnapshot({ ...encoded, sha256: '0'.repeat(64) }); }
  catch { rejected = true; }
  expect(rejected, 'tamper-check');
  passed++;

  const plan = planYearArchiveImport([], [], archive);
  expect(plan.additions.length === 1 && plan.mergedIndex.length === 1, 'add-only');
  const repeat = planYearArchiveImport([record], [record.meta], archive);
  expect(repeat.additions.length === 0, 'repeat-safe');
  passed++;

  rejected = false;
  try {
    planYearArchiveImport([{ ...record, snapshot: '{"different":true}' }], [record.meta], archive);
  } catch { rejected = true; }
  expect(rejected, 'conflict-safe');
  passed++;

  const manifest = {
    version: '123e4567-e89b-42d3-a456-426614174000', chunks: encoded.chunks.length,
    encoding: encoded.encoding, byteLength: encoded.byteLength,
    sha256: encoded.sha256, label: '2024 / 2025'
  };
  expect(uploadDecision(null, encoded, fakeId) === 'create' &&
    uploadDecision(manifest, encoded, fakeId) === 'skip', 'no-reupload');
  passed++;

  expect(isActiveYearAdmin({active: true, role: 'admin'}, 'uid', 'uid') &&
    !isActiveYearAdmin({active: true, role: 'staff'}, 'uid', 'uid') &&
    !isActiveYearAdmin({active: false, role: 'admin'}, 'uid', 'uid') &&
    !isActiveYearAdmin({active: true, role: 'admin'}, 'uid', 'different'), 'role-gate');
  passed++;

  return { passed, total: 7, fakeId, remoteWrites: 0, localWrites: 0 };
}

function start() {
  const button = document.getElementById('year-archive-selftest');
  const result = document.getElementById('year-archive-selftest-result');
  if (!button || !result) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    result.textContent = 'تاقیکردنەوەی داتای ساختە لە بیرگەدا دەکرێت…';
    result.className = '';
    try {
      const outcome = await runYearArchiveSelftest();
      result.className = 'ok';
      result.textContent = '✅ ' + outcome.passed + '/' + outcome.total +
        ' پشکنین سەرکەوتوون. هیچ داتای ڕاستەقینە نەخوێندراوەتەوە و هیچ نووسینێک لە Firebase یان ئەرشیفی ئامێر نەکرا. ئەمە تاقی Firebase ـی ڕاستەقینە نییە.';
    } catch (error) {
      result.className = 'error';
      result.textContent = '❌ پشکنینی ناوخۆیی سەرکەوتوو نەبوو: ' + String(error?.message || error).slice(0, 120);
    } finally { button.disabled = false; }
  });
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
