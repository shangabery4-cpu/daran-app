import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import { getFirestore, doc, collection, getDoc, getDocsFromServer, query, orderBy } from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import { firebaseConfig, schoolId } from './config.js';

// A read-only kiosk. It never writes to Firestore and requires an existing active school member.
// Classroom rotation is entirely local (no server reads).
const $ = (id) => document.getElementById(id);
const REFRESH_MS = 15 * 60 * 1000;
const ROTATE_MS = 12 * 1000;
const digits = '٠١٢٣٤٥٦٧٨٩';
const translations = {
  ckb: { title:'دارەجات — شاشەی قوتابخانە', subtitle:'تەنها پیشاندان • چوونەژوورەوەی پارێزراو', board:'ئامادەبوونی قوتابیان', name:'ناوی قوتابی', status:'دۆخ', present:'ئامادە', absent:'نائامادە', excused:'مۆڵەت‌پێدراو', unknown:'دیاری نەکراوە', off:'پشوو', duty:'دەوام', empty:'هیچ پۆلێک نییە.', updated:'دوایین نوێکردنەوە', page:'پەڕە' },
  en: { title:'Daragat — School Display', subtitle:'Display only • Protected sign-in', board:'Student Attendance', name:'Student name', status:'Status', present:'Present', absent:'Absent', excused:'Excused', unknown:'Not marked', off:'Holiday', duty:'School day', empty:'No classes yet.', updated:'Last refreshed', page:'Page' },
  ar: { title:'دارەجات — شاشة المدرسة', subtitle:'للعرض فقط • تسجيل دخول محمي', board:'حضور الطلبة', name:'اسم الطالب', status:'الحالة', present:'حاضر', absent:'غائب', excused:'مجاز', unknown:'غير محدد', off:'عطلة', duty:'دوام', empty:'لا توجد صفوف.', updated:'آخر تحديث', page:'صفحة' }
};
const state = { db:null, auth:null, user:null, students:[], attendance:new Map(), classes:[], page:0, busy:false, lastReadAt:0, lastReadText:'', pauseUntil:0, workingSaturdays:[], holidays:[], language:'ckb' };
const queryDate = new URLSearchParams(location.search).get('date');
function localDate() { const d = new Date(); const p = (v) => String(v).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  const check = new Date(y,m-1,d,12);
  return y >= 2000 && y <= 2100 && check.getFullYear()===y && check.getMonth()===m-1 && check.getDate()===d;
}
function currentDate() { return validDate(queryDate) ? queryDate : localDate(); }
function num(value) { return state.language === 'ckb' ? String(value).replace(/[0-9]/g,(n)=>digits[+n]) : String(value); }
function label() { return translations[state.language]; }
function notice(message) { $('message').textContent=message; $('message').hidden=false; setTimeout(()=>{$('message').hidden=true;},7000); }
function status(text, kind='') { $('status').textContent=text; $('status').className='pill '+kind; }
function showBoard(isVisible) { $('login').hidden=isVisible; $('board').hidden=!isVisible; for (const id of ['refresh','fullscreen','signout']) $(id).hidden=!isVisible; }

function renderLanguage() {
  document.documentElement.lang = state.language === 'ckb' ? 'ckb-IQ' : state.language;
  document.documentElement.dir = state.language === 'en' ? 'ltr' : 'rtl';
  $('title').textContent=label().title;
  $('subtitle').textContent=label().subtitle;
  $('board-title').textContent=label().board;
  $('date-text').textContent=currentDate();
  renderCards();
}

function holidayLabel() {
  const date=currentDate();
  const [y,m,d]=date.split('-').map(Number);
  const weekday=new Date(y,m-1,d,12).getDay();
  const off=state.holidays.includes(date)||weekday===5||(weekday===6&&!state.workingSaturdays.includes(date));
  $('holiday').textContent=off?label().off:label().duty;
  $('holiday').className='holiday'+(off?' off':'');
}

function renderCards() {
  const classes=state.classes;
  const pages=Math.max(1,Math.ceil(classes.length/3));
  state.page=((state.page%pages)+pages)%pages;
  $('page-counter').textContent=label().page+' '+num(state.page+1)+' / '+num(pages);
  $('previous').disabled=pages===1;
  $('next').disabled=pages===1;
  holidayLabel();
  const container=$('cards');
  container.replaceChildren();
  const selected=classes.slice(state.page*3,state.page*3+3);
  if (!selected.length) {
    const p=document.createElement('p');
    p.textContent=label().empty;
    container.append(p);
    return;
  }
  for(const name of selected) {
    const article=document.createElement('article');
    article.className='class-card';
    const title=document.createElement('h2');
    title.textContent=name;
    const scroller=document.createElement('div');
    scroller.className='scroll-list';
    const table=document.createElement('table');
    const thead=document.createElement('thead');
    const tr=document.createElement('tr');
    for(const header of [label().name,label().status]) {
      const th=document.createElement('th');
      th.textContent=header;
      tr.append(th);
    }
    thead.append(tr);
    const tbody=document.createElement('tbody');
    for(const student of state.students.filter((item)=>item.className===name)) {
      const row=document.createElement('tr');
      const nameCell=document.createElement('td');
      nameCell.textContent=student.name;
      const statusCell=document.createElement('td');
      const badge=document.createElement('span');
      const value=state.attendance.get(student.id)||'unknown';
      badge.className='status-label '+(['present','absent','excused'].includes(value)?value:'unknown');
      badge.textContent=label()[value]||label().unknown;
      statusCell.append(badge);
      row.append(nameCell,statusCell);
      tbody.append(row);
    }
    table.append(thead,tbody);
    scroller.append(table);
    article.append(title,scroller);
    container.append(article);
  }
}

async function readSchoolCalendar() {
  state.workingSaturdays=[];state.holidays=[];
  try {
    const snap=await getDoc(doc(state.db,'schools',schoolId));
    if(snap.exists()){
      const data=snap.data();
      state.workingSaturdays=Array.isArray(data.workingSaturdays)?data.workingSaturdays.filter(validDate).slice(0,400):[];
      state.holidays=Array.isArray(data.holidays)?data.holidays.filter(validDate).slice(0,400):[];
    }
  }catch { /* Optional school calendar. */ }
}

async function loadDisplay({ forceRoster=false, force=false }={}) {
  if(!state.user||state.busy||document.visibilityState==='hidden')return;
  const now=Date.now();
  if(!force&&state.lastReadAt&&now-state.lastReadAt<REFRESH_MS)return;
  if(force&&state.lastReadAt&&now-state.lastReadAt<60_000){notice('تکایە پێش نوێکردنەوەی دووبارە ١ خولەک چاوەڕوان بە.');return;}
  const activeUid=state.user.uid;
  state.busy=true;
  state.lastReadAt=now;
  $('refresh').disabled=true;
  status('زانیاری نوێ دەکرێتەوە…');
  try {
    const needRoster=forceRoster||state.students.length===0;
    const [studentSnap,attendanceSnap]=await Promise.all([
      needRoster?getDocsFromServer(query(collection(state.db,'schools',schoolId,'students'),orderBy('name'))):Promise.resolve(null),
      getDocsFromServer(collection(state.db,'schools',schoolId,'days',currentDate(),'attendance'))
    ]);
    if(state.user?.uid!==activeUid)return;
    if(studentSnap)state.students=studentSnap.docs.filter((item)=>item.data().active===true).map((item)=>({id:item.id,name:String(item.data().name||''),className:String(item.data().className||'')}));
    state.attendance=new Map(attendanceSnap.docs.map((item)=>[item.id,item.data().status]));
    state.classes=[...new Set(state.students.map((item)=>item.className))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ckb'));
    state.lastReadText=new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    renderCards();
    $('read-info').textContent=label().updated+': '+state.lastReadText+' • '+num(15)+' min'; 
    status('پەیوەندی چالاکە','ready');
  }catch(error){status('پەیوەندی هەڵەیە','error');notice(error?.code==='permission-denied'?'مۆڵەتت نییە؛ دەسەڵاتی هەژمارەکەت بپشکنە.':'نوێکردنەوە سەرکەوتوو نەبوو؛ داتای پێشوو ماوەتەوە.');}
  finally{state.busy=false;$('refresh').disabled=false;}
}

async function handleUser(user) {
  state.user=null;state.students=[];state.attendance=new Map();state.classes=[];state.page=0;state.lastReadAt=0;
  if(!user){showBoard(false);status('چوونەژوورەوە پێویستە');return;}
  try{
    const member=await getDoc(doc(state.db,'schools',schoolId,'members',user.uid));
    if(!member.exists()||member.data().active!==true||!['admin','staff'].includes(member.data().role))throw new Error('not-member');
    state.user=user;
    await readSchoolCalendar();
    showBoard(true);
    await loadDisplay({forceRoster:true});
  }catch(error){notice('هەژمارەکە مۆڵەتی پیشاندانی ئەم قوتابخانەیەی نییە.');await signOut(state.auth);}
}

function initialize() {
  $('language').addEventListener('change',(event)=>{state.language=event.target.value;renderLanguage();});
  $('login-form').addEventListener('submit',async(event)=>{
    event.preventDefault();
    const button=$('login-submit');button.disabled=true;
    try{await signInWithEmailAndPassword(state.auth,$('email').value.trim(),$('password').value);$('password').value='';}
    catch{notice('چوونەژوورەوە سەرکەوتوو نەبوو؛ ئیمەیڵ و وشەی نهێنی بپشکنە.');}
    finally{button.disabled=false;}
  });
  $('signout').addEventListener('click',()=>signOut(state.auth).catch(()=>notice('دەرچوون سەرکەوتوو نەبوو.')));
  $('refresh').addEventListener('click',()=>{state.pauseUntil=Date.now()+60_000;loadDisplay({forceRoster:true,force:true});});
  $('fullscreen').addEventListener('click',()=>document.documentElement.requestFullscreen?.().catch(()=>notice('شاشەی پڕ بەردەست نییە.')));
  $('previous').addEventListener('click',()=>{state.page--;state.pauseUntil=Date.now()+60_000;renderCards();});
  $('next').addEventListener('click',()=>{state.page++;state.pauseUntil=Date.now()+60_000;renderCards();});
  $('cards').addEventListener('pointerdown',()=>{state.pauseUntil=Date.now()+60_000;});
  document.addEventListener('keydown',()=>{state.pauseUntil=Date.now()+60_000;});
  setInterval(()=>{if(state.user&&document.visibilityState==='visible'&&Date.now()>state.pauseUntil&&state.classes.length>3){state.page++;renderCards();}},ROTATE_MS);
  setInterval(()=>{if(state.user&&document.visibilityState==='visible')loadDisplay();},60_000);
  setInterval(()=>{if(state.user&&document.visibilityState==='visible'&&Date.now()>state.pauseUntil){for(const el of document.querySelectorAll('.scroll-list')){if(el.scrollHeight>el.clientHeight){el.scrollTop=el.scrollTop+8>=el.scrollHeight-el.clientHeight?0:el.scrollTop+8;}}}},3000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadDisplay();});
  renderLanguage();
  if(!firebaseConfig?.apiKey||!schoolId){status('ڕێکخستنی Firebase نییە','error');notice('ڕێکخستنی Firebase تەواو نییە.');return;}
  const app=initializeApp(firebaseConfig);
  state.auth=getAuth(app);
  state.db=getFirestore(app);
  onAuthStateChanged(state.auth,handleUser,()=>{showBoard(false);notice('هەڵەی چوونەژوورەوە.');});
}
initialize();
