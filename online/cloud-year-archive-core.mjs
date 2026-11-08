import { validateYearArchivePackage, YEAR_ARCHIVE_FORMAT } from './year-archive-core.mjs';

// Deliberately conservative on Spark: a year needs at most 73 document writes.
export const CLOUD_YEAR_MAX_BYTES = 6 * 1024 * 1024;
export const CLOUD_YEAR_MAX_CHUNKS = 72;
export const CLOUD_YEAR_LIST_LIMIT = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PRIVATE_KEYS = new Set(['schoolResultsSession_v1', 'schoolResultsCloud_v1', 'schoolResultsWifiSync_v1']);

function ensureNoPrivateKeys(packageData) {
  for (const record of packageData.records) {
    const stored = JSON.parse(record.snapshot).store;
    if (Object.keys(stored).some(key => PRIVATE_KEYS.has(key))) throw new Error('cloud-year-private-key');
  }
  return packageData;
}

export function yearPackage(record) {
  const packageData = {
    format: YEAR_ARCHIVE_FORMAT,
    version: 1,
    records: [record],
    index: [record?.meta]
  };
  return ensureNoPrivateKeys(validateYearArchivePackage(packageData));
}

export function checkEncodedYear(encoded) {
  if (!encoded || !Number.isInteger(encoded.byteLength) ||
    encoded.byteLength < 1 || encoded.byteLength > CLOUD_YEAR_MAX_BYTES ||
    !Array.isArray(encoded.chunks) || encoded.chunks.length < 1 ||
    encoded.chunks.length > CLOUD_YEAR_MAX_CHUNKS ||
    !encoded.chunks.every(chunk => typeof chunk === 'string' && chunk.length <= 120000) ||
    !DIGEST.test(encoded.sha256) || !['gzip-b64', 'utf8-b64'].includes(encoded.encoding)) {
    throw new Error('cloud-year-too-large');
  }
  return encoded;
}

export function validateCloudYearManifest(meta, id) {
  if (!ID.test(id) || !meta || typeof meta !== 'object' ||
    !UUID.test(meta.version || '') || !DIGEST.test(meta.sha256 || '') ||
    !Number.isInteger(meta.chunks) || meta.chunks < 1 || meta.chunks > CLOUD_YEAR_MAX_CHUNKS ||
    !Number.isInteger(meta.byteLength) || meta.byteLength < 1 || meta.byteLength > CLOUD_YEAR_MAX_BYTES ||
    !['gzip-b64', 'utf8-b64'].includes(meta.encoding) ||
    typeof meta.label !== 'string' || meta.label.length > 100) {
    throw new Error('cloud-year-corrupt');
  }
  return meta;
}

export function uploadDecision(remote, encoded, id) {
  if (!remote) return 'create';
  validateCloudYearManifest(remote, id);
  if (remote.sha256 === encoded.sha256 && remote.byteLength === encoded.byteLength) return 'skip';
  throw new Error('cloud-year-conflict');
}

export function validateDownloadedYear(raw, id) {
  let input;
  try { input = JSON.parse(raw); } catch { throw new Error('cloud-year-corrupt'); }
  const archive = validateYearArchivePackage(input);
  if (archive.records.length !== 1 || archive.records[0].id !== id) {
    throw new Error('cloud-year-corrupt');
  }
  return ensureNoPrivateKeys(archive);
}
