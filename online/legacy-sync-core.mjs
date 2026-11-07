/* Daragat school-data snapshots. No credentials, login state or licence data. */
export const MODULE_KEYS = Object.freeze({
  schoolResultsApp_v1: 'ڕێکخستن و لیستی قوتابیان',
  schoolResultsGradebook_v1: 'تۆماری نمرەکان',
  schoolResultsLevels_v1: 'ئاست و هەڵسەنگاندن',
  schoolResultsAttendance_v1: 'ئامادەبوونی قوتابیان',
  schoolResultsStaff_v1: 'ستافی قوتابخانە',
  schoolResultsStaffAtt_v1: 'ئامادەبوونی ستاف',
  schoolResultsExams_v1: 'تاقیکردنەوەکان',
  schoolResultsProperties_v1: 'موڵک و کەرەستەکان',
  schoolResultsCare_v1: 'چاودێری و باری قوتابیان',
  schoolResultsRecords_v1: 'تۆمارە فەرمییەکان',
  schoolResultsNotes_v1: 'تێبینییەکان',
  schoolResultsAccounts_v1: 'ژمێریاری',
  schoolResultsHomework_v1: 'ئەرکە ماڵییەکان',
  schoolResultsMail_v1: 'نامە و پەیوەندییەکان',
  schoolResultsNotif_v1: 'ئاگادارییەکان',
  schoolResultsSchoolLogs_v1: 'ڕووداوەکانی قوتابخانە',
  schoolResultsTimetable_v1: 'خشتەی وانەکان',
  schoolResultsExemptions_v1: 'بەخشینی نمرەکان',
  schoolResultsSchoolOrders_v1: 'فەرمانەکانی قوتابخانە',
  school_attendance_warnings_v1: 'ئاگادارکردنەوەی نەهاتن'
});

export const MAX_CHUNK_CHARS = 120000;
export const MAX_CHUNKS = 200;

export function splitChunks(value, maxSize = MAX_CHUNK_CHARS) {
  if (typeof value !== 'string' || !Number.isSafeInteger(maxSize) || maxSize < 1) throw new Error('invalid-input');
  const parts = [];
  for (let i = 0; i < value.length; i += maxSize) parts.push(value.slice(i, i + maxSize));
  if (!parts.length) parts.push('');
  if (parts.length > MAX_CHUNKS) throw new Error('too-large');
  return parts;
}

export function bytesToBase64(bytes) {
  let out = '';
  // Multiple of three: concatenating the base64 pieces does not introduce padding.
  const size = 24576;
  for (let i = 0; i < bytes.length; i += size) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + size)));
  }
  return out;
}

export function base64ToBytes(source) {
  if (typeof source !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source)) {
    throw new Error('invalid-base64');
  }
  const raw = atob(source);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function digestHex(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function encodeSnapshot(textValue, preferGzip = true) {
  if (typeof textValue !== 'string') throw new Error('invalid-input');
  const original = new TextEncoder().encode(textValue);
  if (original.byteLength > MAX_CHUNKS * 90000) throw new Error('too-large');
  const sha256 = await digestHex(original);
  let encoded = original;
  let encoding = 'utf8-b64';
  if (preferGzip && typeof CompressionStream === 'function' && original.byteLength > 1024) {
    const zipped = await new Response(new Blob([original]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    if (zipped.byteLength < original.byteLength) {
      encoded = new Uint8Array(zipped);
      encoding = 'gzip-b64';
    }
  }
  const chunks = splitChunks(bytesToBase64(encoded));
  return { chunks, encoding, sha256, byteLength: original.byteLength };
}

export async function decodeSnapshot({ chunks, encoding, sha256, byteLength }) {
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > MAX_CHUNKS ||
      !chunks.every((chunk) => typeof chunk === 'string' && chunk.length <= MAX_CHUNK_CHARS) ||
      !['utf8-b64', 'gzip-b64'].includes(encoding)) throw new Error('invalid-snapshot');
  const buffer = base64ToBytes(chunks.join(''));
  let original = buffer;
  if (encoding === 'gzip-b64') {
    if (typeof DecompressionStream !== 'function') throw new Error('gzip-unsupported');
    const unzipped = await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    original = new Uint8Array(unzipped);
  }
  if (!Number.isSafeInteger(byteLength) || original.byteLength !== byteLength || sha256 !== await digestHex(original)) {
    throw new Error('snapshot-corrupted');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(original);
}

export function collectLocal(storage) {
  const data = {};
  for (const key of Object.keys(MODULE_KEYS)) {
    const value = storage.getItem(key);
    if (typeof value === 'string') data[key] = value;
  }
  return data;
}

export function verifiedSnapshotKeys(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid-input');
  const keys = Object.keys(data);
  if (!keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(MODULE_KEYS, key) || typeof data[key] !== 'string')) {
    throw new Error('invalid-keys');
  }
  return keys;
}
