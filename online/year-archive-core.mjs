export const YEAR_ARCHIVE_FORMAT = 'daragat-year-archives-v1';

function fail(code) { throw new Error(code); }
function recordId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Keep the original archive snapshot exactly as stored. Its original
// application controls any later "restore the whole school year" action.
export function validateYearArchivePackage(input) {
  if (!plain(input) || input.format !== YEAR_ARCHIVE_FORMAT || input.version !== 1 ||
      !Array.isArray(input.records) || input.records.length > 1000) fail('invalid-archive');
  const ids = new Set();
  const records = input.records.map((record) => {
    if (!plain(record) || !recordId(record.id) || ids.has(record.id) ||
        !plain(record.meta) || record.meta.id !== record.id ||
        typeof record.snapshot !== 'string') fail('invalid-archive');
    ids.add(record.id);
    let parsed;
    try { parsed = JSON.parse(record.snapshot); } catch { fail('invalid-archive-snapshot'); }
    if (!plain(parsed) || parsed.v !== 1 || !plain(parsed.store) ||
        Object.keys(parsed.store).some(key => !key.startsWith('schoolResults') ||
          typeof parsed.store[key] !== 'string')) fail('invalid-archive-snapshot');
    return { id: record.id, meta: record.meta, snapshot: record.snapshot };
  });
  const suppliedIndex = Array.isArray(input.index) ? input.index : [];
  const recordById = new Map(records.map(record => [record.id, record]));
  const index = [];
  const indexedIds = new Set();
  for (const meta of suppliedIndex) {
    if (!plain(meta) || !recordId(meta.id)) fail('invalid-archive');
    if (!recordById.has(meta.id) || indexedIds.has(meta.id)) continue;
    index.push({ ...meta, stored: true });
    indexedIds.add(meta.id);
  }
  for (const record of records) {
    if (!indexedIds.has(record.id)) index.push({ ...record.meta, stored: true });
  }
  return { format: YEAR_ARCHIVE_FORMAT, version: 1, records, index };
}

export function planYearArchiveImport(existingRecords, existingIndex, packageData) {
  const incoming = validateYearArchivePackage(packageData);
  if (!Array.isArray(existingRecords) || !Array.isArray(existingIndex)) fail('invalid-local-archive');
  const current = new Map(existingRecords.map(record => [record.id, record]));
  const additions = [];
  for (const record of incoming.records) {
    const saved = current.get(record.id);
    if (saved && saved.snapshot !== record.snapshot) fail('archive-conflict');
    if (!saved) additions.push(record);
  }
  const mergedIndex = [...existingIndex];
  const seen = new Set(existingIndex.map(meta => meta.id));
  for (const meta of incoming.index) {
    if (!seen.has(meta.id)) { mergedIndex.push(meta); seen.add(meta.id); }
  }
  return { additions, mergedIndex, skipped: incoming.records.length - additions.length };
}
