/** Pure checks used by the Daragat Firebase legacy backup. */
export function versionOf(manifest) {
  return manifest && typeof manifest.version === 'string' ? manifest.version : null;
}
export function sameContent(manifest, fingerprint) {
  return !!(manifest && typeof manifest.sha256 === 'string' && manifest.sha256 === fingerprint);
}
export function assertExpectedVersion(expected, actual) {
  if (versionOf(expected) !== versionOf(actual)) {
    throw new Error('backup-conflict');
  }
}
