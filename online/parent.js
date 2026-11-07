import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, schoolId } from './config.js';

// Parent portal: individual getDoc requests only; never list/query students or attendance.
// Firestore Rules, not this browser-side UI, enforce family membership.
const $ = (id) => document.getElementById(id);
const digits = '٠١٢٣٤٥٦٧٨٩';
const num = (value) => String(value).replace(/[0-9]/g, (d) => digits[Number(d)]);
const labels = { present:'ئامادە', absent:'نائامادە', excused:'مۆڵەت‌پێدراو' };
const state = { auth:null, db:null, user:null, students:[], cache:new Map(), report:null, busy:false };
let noticeTimer;

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parts = value.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12);
  return date.getFullYear() === parts[0] && date.getMonth() + 1 === parts[1] && date.getDate() === parts[2];
}
function configured() {
  return firebaseConfig && ['apiKey','authDomain','projectId','appId'].every((k) => typeof firebaseConfig[k] === 'string' && !!firebaseConfig[k])
    && typeof schoolId === 'string' && /^[A-Za-z0-9_-]{2,60}$/.test(schoolId);
}
function notify(message, error = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').className = error ? 'error' : '';
  $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 8000);
}
function readableError(error) {
  if (error?.code === 'permission-denied') return 'مۆڵەتی خوێندنەوەت نییە؛ هەژمار و یاساکانی Firestore بپشکنە.';
  if (error?.code?.startsWith('auth/')) return 'هەڵەی چوونەژوورەوە؛ ئیمەیڵ و وشەی نهێنی بپشکنە.';
  return 'کارەکە سەرکەوتوو نەبوو؛ پەیوەندی و ڕێکخستنەکان بپشکنە.';
}
function busy(value) {
  state.busy = value;
  $('login-form').querySelectorAll('button,input').forEach((el) => { el.disabled = value; });
  $('report-form').querySelectorAll('button,input,select').forEach((el) => { el.disabled = value; });
}
function showPortal(value) {
  $('login-panel').hidden = !!value;
  $('portal').hidden = !value;
  $('logout').hidden = !value;
  $('connection').textContent = value ? 'پەیوەندی چالاکە' : 'چوونەژوورەوە پێویستە';
}
async function login(event) {
  event.preventDefault();
  if (state.busy) return;
  busy(true);
  try {
    await signInWithEmailAndPassword(state.auth, $('email').value.trim(), $('password').value);
    $('password').value = '';
  } catch(error) { notify(readableError(error), true); }
  finally { busy(false); }
}
async function loadParent(user) {
  const membership = await getDoc(doc(state.db,'schools',schoolId,'members',user.uid));
  if (!membership.exists()) throw new Error('parent-not-registered');
  const member = membership.data();
  if (member.active !== true || member.role !== 'parent' || !Array.isArray(member.studentIds)) throw new Error('parent-not-registered');
  const ids = [...new Set(member.studentIds)].filter((id) => typeof id === 'string' && id.length > 0 && !id.includes('/'));
  if (!ids.length || ids.length > 20) throw new Error('invalid-students');
  const results = await Promise.all(ids.map((id) => getDoc(doc(state.db,'schools',schoolId,'students',id))));
  if (state.auth.currentUser?.uid !== user.uid) return;
  state.students = results.filter((snap) => snap.exists()).map((snap) => ({
    id:snap.id, name:String(snap.data().name || ''), className:String(snap.data().className || '')
  }));
  if (!state.students.length) throw new Error('invalid-students');
  $('student-select').replaceChildren();
  for (const student of state.students) $('student-select').add(new Option(student.name + ' — ' + student.className, student.id));
  $('user-summary').textContent = (user.email || 'هەژماری دایک‌وباوک') + ' • ' + schoolId;
  showPortal(true);
}
async function handleAuth(user) {
  state.user = null;
  state.students = [];
  state.cache = new Map();
  state.report = null;
  $('report-preview').hidden = true;
  showPortal(false);
  if (!user) return;
  busy(true);
  try {
    await loadParent(user);
    if (state.auth.currentUser?.uid === user.uid) state.user = user;
  } catch(error) {
    notify(error.message === 'parent-not-registered' || error.message === 'invalid-students'
      ? 'هەژمارەکەت وەک دایک‌وباوک تۆمار نەکراوە، یان ناسنامەی قوتابی پەیوەست نەکراوە. لەگەڵ بەڕێوەبەر قسە بکە.'
      : readableError(error), true);
    await signOut(state.auth);
  } finally { busy(false); }
}
function datesForWeek(first) {
  if (!validDay(first)) return null;
  const parts = first.split('-').map(Number);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(parts[0], parts[1]-1, parts[2]+i, 12);
    const pad = (n) => String(n).padStart(2,'0');
    dates.push(date.getFullYear() + '-' + pad(date.getMonth()+1) + '-' + pad(date.getDate()));
  }
  return dates.filter((day) => day <= today());
}
function datesForMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const parts = month.split('-').map(Number);
  if (parts[0] < 2000 || parts[0] > 2100 || parts[1] < 1 || parts[1] > 12) return null;
  const count = new Date(parts[0], parts[1], 0).getDate();
  return Array.from({length:count},(_,i) => month + '-' + String(i+1).padStart(2,'0')).filter((day) => day <= today());
}
function modeChange() {
  const isWeek = $('report-mode').value === 'week';
  $('week-field').hidden = !isWeek;
  $('month-field').hidden = isWeek;
  $('week-start').required = isWeek;
  $('report-month').required = !isWeek;
  $('report-preview').hidden = true;
  state.report = null;
}
function csvCell(value) {
  const clean = String(value).replace(/[\r\n\t]/g,' ').trim();
  const safe = /^[=+\-@]/.test(clean) ? "'" + clean : clean;
  return '"' + safe.replace(/"/g,'""') + '"';
}
function downloadReport() {
  if (!state.report) return;
  const report = state.report;
  const rows = [['ناوی قوتابی','پۆل','بەروار','دۆخ']];
  for (const row of report.rows) rows.push([report.student.name,report.student.className,row.date,row.label]);
  const content = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'daragat-parent-' + report.student.id + '-' + report.key + '.csv'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
async function buildReport(event) {
  event.preventDefault();
  if (!state.user || state.busy) return;
  const student = state.students.find((item) => item.id === $('student-select').value);
  if (!student) return notify('قوتابی هەڵبژێرە.',true);
  const isWeek = $('report-mode').value === 'week';
  const key = isWeek ? $('week-start').value : $('report-month').value;
  const dates = isWeek ? datesForWeek(key) : datesForMonth(key);
  if (!dates || !dates.length) return notify('بەروارێکی ڕاستەقینە و نەهاتوو هەڵبژێرە.',true);
  const missing = dates.filter((date) => !state.cache.has(student.id + '/' + date));
  if (missing.length && !window.confirm('بۆ ئەم ڕاپۆرتە تا ' + num(missing.length) + ' خوێندنەوە لە Firebase ئەنجام دەدرێت. بەردەوام دەبیت؟')) return;
  busy(true);
  $('report-preview').hidden = true;
  const uid = state.user.uid;
  try {
    // Limit concurrency to three document reads at a time.
    for (let offset=0; offset<missing.length; offset+=3) {
      const chunk = missing.slice(offset, offset+3);
      const result = await Promise.all(chunk.map((date) => getDoc(doc(state.db,'schools',schoolId,'days',date,'attendance',student.id))));
      if (state.user?.uid !== uid) return;
      result.forEach((snap,i) => state.cache.set(student.id + '/' + chunk[i],snap.exists() ? snap.data().status : ''));
    }
    const rows = dates.map((date) => {
      const value = state.cache.get(student.id + '/' + date);
      return { date, value, label:labels[value] || 'تۆمار نەکراوە' };
    });
    if (state.user?.uid !== uid) return;
    state.report = { student, key, rows };
    $('report-title').textContent = 'ڕاپۆرتی ' + student.name;
    $('report-subtitle').textContent = (isWeek ? '٧ ڕۆژ' : 'مانگانە') + ' • ' + key + ' • ' + student.className;
    for (const [status,id] of [['present','count-present'],['absent','count-absent'],['excused','count-excused']]) $(''+id).textContent = num(rows.filter((row) => row.value === status).length);
    const table = $('report-rows'); table.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement('tr');
      const d = document.createElement('td'); d.textContent = row.date;
      const st = document.createElement('td'); st.textContent = row.label;
      tr.append(d,st); table.append(tr);
    }
    $('report-preview').hidden = false;
    notify('ڕاپۆرتەکە بە سەرکەوتوویی ئامادە کرا.');
  } catch(error) { notify(readableError(error),true); }
  finally { busy(false); }
}
function start() {
  $('week-start').value = today();
  $('report-month').value = today().slice(0,7);
  $('login-form').addEventListener('submit',login);
  $('report-form').addEventListener('submit',buildReport);
  $('report-mode').addEventListener('change',modeChange);
  $('download-csv').addEventListener('click',downloadReport);
  $('print-report').addEventListener('click',() => { if(state.report) window.print(); });
  $('logout').addEventListener('click',() => signOut(state.auth).catch((e) => notify(readableError(e),true)));
  $('student-select').addEventListener('change',() => {state.report=null;$('report-preview').hidden=true;});
  if (!configured()) {$('setup').hidden=false;$('login-panel').hidden=true;return;}
  try {
    const app=initializeApp(firebaseConfig);
    state.auth=getAuth(app);
    state.db=getFirestore(app);
    onAuthStateChanged(state.auth,handleAuth,() => notify('هەڵەی چوونەژوورەوە.',true));
  } catch(error) { $('setup').hidden=false;$('login-panel').hidden=true;notify(readableError(error),true); }
}
start();
