import test from 'node:test';
import assert from 'node:assert/strict';
import {YEAR_ARCHIVE_FORMAT,validateYearArchivePackage,planYearArchiveImport} from '../online/year-archive-core.mjs';

const record = (id, value = 'v1') => ({
  id, meta:{id,year:'2025 / 2026',stored:true},
  snapshot:JSON.stringify({v:1,kind:'year-archive',store:{schoolResultsApp_v1:value}})
});
const pack = (...records) => ({
  format:YEAR_ARCHIVE_FORMAT,version:1,records,
  index:records.map(r=>r.meta)
});

test('accepts a valid Sorani archive and reconstructs index',()=>{
  const pkg=validateYearArchivePackage(pack(record('y_123','قوتابی')));
  assert.equal(pkg.records.length,1);
  assert.equal(pkg.index[0].stored,true);
});
test('rejects duplicate ids',()=>{
  assert.throws(()=>validateYearArchivePackage(pack(record('y_1'),record('y_1'))),/invalid-archive/);
});
test('rejects invalid archive snapshot',()=>{
  assert.throws(()=>validateYearArchivePackage(pack({...record('y_1'),snapshot:'oops'})),/invalid-archive-snapshot/);
});
test('rejects unexpected keys inside stored school snapshot',()=>{
  const r=record('y_1');
  r.snapshot=JSON.stringify({v:1,store:{schoolResultsApp_v1:'a',adminPassword:'secret'}});
  assert.throws(()=>validateYearArchivePackage(pack(r)),/invalid-archive-snapshot/);
});
test('adds only missing archives and retains existing index',()=>{
  const old=record('y_1'),newOne=record('y_2');
  const result=planYearArchiveImport([old],[old.meta],pack(old,newOne));
  assert.equal(result.additions.length,1);
  assert.equal(result.additions[0].id,'y_2');
  assert.equal(result.skipped,1);
  assert.deepEqual(result.mergedIndex.map(v=>v.id),['y_1','y_2']);
});
test('conflicting existing archive cannot be overwritten',()=>{
  assert.throws(()=>planYearArchiveImport([record('y_1','a')],[],pack(record('y_1','b'))),/archive-conflict/);
});
test('archived records not in index are preserved',()=>{
  const pkg=validateYearArchivePackage({...pack(record('y_1')),index:[]});
  assert.equal(pkg.index[0].id,'y_1');
});
