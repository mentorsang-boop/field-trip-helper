import { CONFIG } from '../config.js';
import imageCompression from 'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/+esm';
import { callFn, h, hhmm, sb } from './sb.js';

const p = new URLSearchParams(location.search);
const tripId = p.get('trip'), cpId = p.get('cp'), token = p.get('t');
const app = document.getElementById('app');
document.getElementById('ver').textContent = 'v' + CONFIG.version;

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 저장 불가 */ } },
};
let deviceId = store.get('ft_device');
if (!deviceId) { deviceId = crypto.randomUUID(); store.set('ft_device', deviceId); }
const meKey = `ft_student_${tripId}`;
let me = JSON.parse(store.get(meKey) || 'null'); // { id, name, class_no }
let roster;

const show = (...nodes) => app.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
const setMe = (s) => {
  me = s;
  store.set(meKey, s ? JSON.stringify(s) : null);
  document.getElementById('who').textContent = s ? `${s.class_no} ${s.name}` : '';
};
const checkSvg = () => {
  const d = document.createElement('div');
  d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  return d.firstChild;
};

function errorScreen(msg, retry) {
  show(h('div', { class: 'center' },
    h('p', { class: 'q' }, ''), h('p', {}, msg),
    retry && h('button', { class: 'btn', onclick: retry }, '다시 해볼게')));
}

async function start() {
  if (!tripId) return show(h('div', { class: 'center' }, h('p', { class: 'q' }, '선생님이 띄운 QR을 찍어줘')));
  try {
    roster = await callFn('roster', { trip_id: tripId, cp_id: cpId });
  } catch (e) { return errorScreen(e.message, start); }
  if (me && !roster.students.some((s) => s.id === me.id)) setMe(null);
  me ? (setMe(me), afterRegistered()) : pickScreen();
}

// 등록된 폰: 이번 QR 체크포인트를 아직 안 찍었으면 출석 화면, 아니면 미션 홈
let status;
const ids = () => ({ trip_id: tripId, student_id: me.id, device_id: deviceId });
async function afterRegistered() {
  try {
    status = await callFn('my-status', ids());
  } catch (e) {
    if (e.status === 403) { setMe(null); return pickScreen(e.message); }
    return errorScreen(e.message, afterRegistered);
  }
  updateSteps();
  cpId && token && !status.checked.includes(cpId) ? attendScreen() : home();
}

const allPhotos = () => status.missions.every((m) => m.photos.length);
const allTalked = () => allPhotos() && status.missions.every((m) => m.photos.every((p) => p.interview_done));

function updateSteps() {
  const [att, pho, itv, rep] = document.querySelectorAll('.steps span');
  const n = status.missions.filter((m) => m.photos.length).length;
  const set = (el, done, now, text) => { el.className = done ? 'done' : now ? 'now' : ''; el.textContent = text; };
  set(att, status.checked.length, true, '출석');
  set(pho, allPhotos(), status.checked.length, `사진 ${n}/${status.missions.length}`);
  set(itv, allTalked() && status.final_done, n > 0, '인터뷰');
  set(rep, status.report?.status === 'submitted', status.final_done, '보고서');
  // 지금 할 일은 하나만 강조
  [att, pho, itv, rep].filter((el) => el.className === 'now').slice(1).forEach((el) => { el.className = ''; });
}

// ① 반 → 이름 → "나 맞아요"
function pickScreen(msg) {
  const classes = [...new Set(roster.students.map((s) => s.class_no))];
  let cls = classes[0], picked = null;
  const names = h('div', { class: 'names' });
  const seg = h('div', { class: 'seg' });
  const sheet = h('div', { class: 'sheet', hidden: true });
  const note = h('p', { class: 'err' }, msg ?? '');

  function renderNames() {
    seg.replaceChildren(...classes.map((c) => h('button', { class: c === cls ? 'on' : '', onclick: () => { cls = c; picked = null; renderNames(); } }, c)));
    names.replaceChildren(...roster.students.filter((s) => s.class_no === cls).map((s) =>
      h('button', {
        class: s.taken ? 'taken' : picked === s ? 'on' : '',
        onclick: () => {
          if (s.taken) { note.textContent = `${s.name}: 다른 폰에 등록된 이름이에요. 선생님께 말해주세요.`; return; }
          picked = s; note.textContent = ''; renderNames(); renderSheet();
        },
      }, s.name)));
    sheet.hidden = !picked;
  }
  function renderSheet() {
    const btn = h('button', { class: 'btn', onclick: confirm }, '나 맞아요');
    sheet.replaceChildren(h('p', { class: 'hint' }, '선택한 이름'), h('p', { class: 'display', style: 'font-size:22px' }, `${picked.class_no} ${picked.name}`), btn);
    async function confirm() {
      btn.disabled = true; btn.textContent = '등록하는 중…';
      try {
        await callFn('register-device', { trip_id: tripId, student_id: picked.id, device_id: deviceId });
        setMe({ id: picked.id, name: picked.name, class_no: picked.class_no });
        afterRegistered();
      } catch (e) {
        note.textContent = e.message; btn.disabled = false; btn.textContent = '나 맞아요';
        if (e.status === 409) { picked.taken = true; picked = null; renderNames(); }
      }
    }
  }
  renderNames();
  show(h('p', { class: 'q' }, '반을 고르고', h('br'), '내 이름을 눌러줘'), seg, names, note, sheet);
}

// ② 출석하기 버튼 하나
function attendScreen() {
  const btn = h('button', { class: 'btn big', onclick: go }, '출석하기');
  const note = h('p', { class: 'err' });
  show(h('div', { class: 'center' },
    h('p', { class: 'hint' }, '지금 체크하는 곳'),
    h('p', { class: 'q' }, `${roster.checkpoint?.name ?? '출석'}`),
    btn, note,
    h('p', { class: 'hint' }, '누르면 위치를 한 번만 확인해요. 위치를 허용하지 않아도 출석돼요.'),
    h('button', { class: 'btn ghost', onclick: home }, '미션 사진으로 가기')));

  async function go() {
    btn.disabled = true; btn.textContent = '위치 확인 중…'; note.textContent = '';
    const pos = await getPosition();
    btn.textContent = '출석하는 중…';
    try {
      const r = await callFn('checkin', { trip_id: tripId, student_id: me.id, device_id: deviceId, cp_id: cpId, token, lat: pos?.latitude, lng: pos?.longitude });
      doneScreen(r);
    } catch (e) {
      if (e.status === 403) { setMe(null); return pickScreen(e.message); }
      note.textContent = e.message; btn.disabled = false; btn.textContent = '출석하기';
    }
  }
}

// 위치는 이 순간 한 번만. 거부·실패하면 null
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  });
}

// ③ 완료
function doneScreen(r) {
  const icon = h('div', { class: 'check' }, checkSvg());
  show(h('div', { class: 'center' },
    icon,
    h('p', { class: 'q' }, r.already ? '이미 체크했어요' : `${r.cp_name} 완료!`),
    h('p', { class: 'time' }, hhmm(r.checked_at)),
    r.outside && h('p', { class: 'hint' }, '체험 장소와 조금 떨어져 있어요. 선생님이 확인할 거예요.'),
    h('button', { class: 'btn ghost', style: 'margin-top:12px', onclick: home }, '미션 사진 찍으러 가기')));
  if (r.outside) icon.classList.add('warn');
  if (!status.checked.includes(cpId)) status.checked.push(cpId);
  updateSteps();
}

// ④ 미션 카드 홈
const MAX_PHOTOS = 2;
const pending = {}; // mission_id → { file, state: 'uploading' | 'failed', msg }
let confirmDel = null;

function home() {
  updateSteps();
  const closed = !status.trip.is_open;
  show(
    h('p', { class: 'q' }, '오늘의 미션 '),
    h('p', { class: 'hint' }, closed ? '체험이 끝나서 사진을 더 올릴 수 없어요.' : '카드마다 사진을 1~2장 올려줘. 학교에 돌아가서 올려도 돼요.'),
    ...status.missions.map((m) => card(m, closed)),
    finishBox(closed));
}

// 마무리 질문 2개 → 보고서 버튼
function finishBox(closed) {
  if (status.report) return h('button', { class: 'btn', onclick: () => reportScreen() }, '내 보고서 보기');
  if (!allTalked()) return h('p', { class: 'hint' }, '미션 4개의 사진과 인터뷰를 마치면 보고서를 만들 수 있어요.');
  if (closed) return h('p', { class: 'hint' }, '체험이 끝나서 보고서를 만들 수 없어요.');
  if (!status.final_done) {
    return h('div', { class: 'mission' }, h('b', {}, '마지막 질문 2개'),
      chats.final ? chatBox('final') : h('button', { class: 'btn', onclick: () => talk('final') }, '시작하기'));
  }
  return h('button', { class: 'btn', onclick: makeReport }, '보고서 만들기');
}

// ⑤ AI 인터뷰 (사진별 + 마무리)
const chats = {}; // photo_id | 'final' → { history, item, loading, err, writing, draft, done }

async function talk(key, extra = {}) {
  const c = (chats[key] ??= { history: [] });
  c.loading = true; c.err = null;
  home();
  try {
    const r = await callFn('interview', { ...ids(), ...(key === 'final' ? { final: true } : { photo_id: key }), ...extra });
    Object.assign(c, { history: r.history, item: r.item, done: r.done, writing: false, draft: '' });
    if (r.done) {
      if (key === 'final') status.final_done = true;
      else status.missions.forEach((m) => m.photos.forEach((p) => { if (p.id === key) p.interview_done = true; }));
    }
  } catch (e) { c.err = e.message; }
  c.loading = false;
  home();
}

function chatBox(key) {
  const c = chats[key];
  const say = (text) => talk(key, { interview_id: c.item.id, answer: text });
  const ready = c.item && !c.loading;
  return h('div', { class: 'chat' },
    c.history.flatMap((x) => [h('div', { class: 'bub ai' }, x.question), h('div', { class: 'bub me' }, x.answer)]),
    c.item && h('div', { class: 'bub ai' }, c.item.question),
    c.loading && h('p', { class: 'hint' }, '질문 생각 중…'),
    c.err && h('p', { class: 'err' }, c.err),
    c.err && !c.item && h('button', { class: 'btn ghost', onclick: () => talk(key) }, '다시 해볼게'),
    ready && c.writing && h('div', { class: 'write' },
      h('textarea', { rows: 2, placeholder: '짧게 써도 돼!', 'aria-label': '답 쓰기', oninput: (e) => { c.draft = e.target.value; } }, c.draft ?? ''),
      h('p', { class: 'hint' }, '키보드의 마이크 버튼을 누르면 말로 입력돼요'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', style: 'flex:1', onclick: () => c.draft?.trim() && say(c.draft) }, '보내기'),
        h('button', { class: 'btn ghost', style: 'flex:1', onclick: () => { c.writing = false; home(); } }, '취소'))),
    ready && !c.writing && h('div', { class: 'choices' },
      c.item.choices.map((t) => h('button', { onclick: () => say(t) }, t)),
      h('button', { class: 'alt', onclick: () => { c.writing = true; home(); } }, '직접 쓰기'),
      h('button', { class: 'alt', onclick: () => say('모르겠어요') }, '모르겠어요')));
}

// ⑥ 보고서
const SECTIONS = [['activity', '활동 내용'], ['learned', '알게 된 점'], ['feeling', '느낀 점'], ['career', '진로와 연결']];
let editing = null;

async function makeReport() {
  show(h('div', { class: 'center' }, h('p', { class: 'q' }, '보고서 쓰는 중… '), h('p', { class: 'hint' }, '30초쯤 걸려요. 화면을 닫지 말아줘.')));
  try {
    status.report = await callFn('make-report', ids());
    updateSteps();
    reportScreen();
  } catch (e) { errorScreen(e.message, () => (status.report ? reportScreen() : home())); }
}

async function saveReport(patch) {
  try {
    status.report = await callFn('save-report', { ...ids(), ...patch });
    editing = null;
    updateSteps();
    reportScreen();
  } catch (e) { reportScreen(e.message); }
}

function reportScreen(msg) {
  const r = status.report, c = r.content, conf = { ...(c.confirmed ?? {}) };
  const closed = !status.trip.is_open, sent = r.status === 'submitted';
  const left = SECTIONS.filter(([k]) => !conf[k]).length;

  const para = ([k, label]) => {
    if (editing === k) {
      const ta = h('textarea', { rows: 5, 'aria-label': label + ' 고치기' }, c[k] ?? '');
      return h('div', { class: 'para' }, h('h4', {}, label + ' · 고치는 중'), ta,
        h('div', { class: 'acts' },
          h('button', { class: 'ok', onclick: () => saveReport({ [k]: ta.value, confirmed: { ...conf, [k]: true } }) }, '저장'),
          h('button', { class: 'edit', onclick: () => { editing = null; reportScreen(); } }, '취소')));
    }
    return h('div', { class: 'para' + (conf[k] ? ' ok' : '') },
      h('h4', {}, label, conf[k] ? h('span', {}, '확인') : null),
      h('p', {}, c[k] || '(이 부분은 인터뷰에 내용이 없어요. 고칠래요를 눌러 한 줄 써도 돼요.)'),
      !closed && h('div', { class: 'acts' },
        !conf[k] && h('button', { class: 'ok', onclick: () => saveReport({ confirmed: { ...conf, [k]: true } }) }, '맞아요'),
        h('button', { class: 'edit', onclick: () => { editing = k; reportScreen(); } }, '고칠래요')));
  };

  show(
    h('p', { class: 'q' }, sent ? '제출 완료! ' : '내 보고서 확인 '),
    h('p', { class: 'hint' }, closed ? '체험이 끝나서 더 고칠 수 없어요.' : sent ? '체험이 끝나기 전까지는 고칠 수 있어요.' : '문단마다 맞으면 , 고치고 싶으면 를 눌러줘.'),
    h('div', { class: 'para ok' }, h('h4', {}, '체험 개요'), h('p', { style: 'white-space:pre-line' }, c.overview)),
    SECTIONS.map(para),
    msg && h('p', { class: 'err' }, msg),
    !sent && !closed && h('button', { class: 'btn', disabled: left > 0, onclick: () => saveReport({ submit: true }) }, left ? `제출하기 (${left}개 남음)` : '제출하기'),
    !closed && h('button', { class: 'btn ghost', onclick: makeReport }, '처음부터 다시 만들기'),
    h('button', { class: 'btn ghost', onclick: home }, '← 미션으로'));
}

function card(m, closed) {
  const p = pending[m.id];
  const cls = p?.state === 'failed' ? 'fail' : m.photos.length ? 'done' : '';
  return h('div', { class: 'mission ' + cls },
    h('div', { class: 'm-head' },
      h('span', { class: 'emo' }, String(m.sort)),
      h('div', {}, h('b', {}, m.title), h('span', {}, m.guide ?? '')),
      m.photos.length ? h('span', { class: 'tick' }, '완료') : null),
    m.photos.length ? h('div', { class: 'thumbs' }, m.photos.map((ph) =>
      h('div', { class: 'thumb' },
        h('img', { src: ph.url, alt: `${m.title} 사진` }),
        !closed && h('button', { class: 'del', 'aria-label': '사진 지우기', onclick: () => delPhoto(m, ph) }, confirmDel === ph.id ? '지울까?' : '×')))) : null,
    m.photos.map((ph, i) => ph.interview_done ? null
      : chats[ph.id] ? chatBox(ph.id)
      : !closed && h('button', { class: 'btn ghost', onclick: () => talk(ph.id) }, `${m.photos.length > 1 ? i + 1 + '번 ' : ''}사진 이야기하기`)),
    m.err && h('p', { class: 'err' }, m.err),
    p?.state === 'uploading' && h('p', { class: 'hint' }, '사진 올리는 중…'),
    p?.state === 'failed' && h('p', { class: 'err' }, p.msg),
    p?.state === 'failed' && h('button', { class: 'btn danger', onclick: () => upload(m, p.file) }, '다시 올리기'),
    !closed && !p && m.photos.length < MAX_PHOTOS && h('div', { class: 'row' },
      h('button', { class: 'btn', style: 'flex:1', onclick: () => pick(m, true) }, '찍기'),
      h('button', { class: 'btn ghost', style: 'flex:1', onclick: () => pick(m, false) }, '앨범')));
}

function pick(m, camera) {
  const inp = h('input', { type: 'file', accept: 'image/*', capture: camera ? 'environment' : null, hidden: true });
  inp.onchange = () => { const f = inp.files[0]; inp.remove(); if (f) upload(m, f); };
  document.body.append(inp);
  inp.click();
}

async function upload(m, file) {
  pending[m.id] = { file, state: 'uploading' };
  home();
  try {
    const small = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1600, fileType: 'image/jpeg', useWebWorker: true });
    pending[m.id].file = small;
    const { path, token: t } = await callFn('upload-url', { ...ids(), mission_id: m.id });
    const { error } = await sb.storage.from('ft-photos').uploadToSignedUrl(path, t, small, { contentType: 'image/jpeg' });
    if (error) throw new Error('인터넷이 약해요. 다시 올려줄래?');
    const ph = await callFn('upload-url', { ...ids(), mission_id: m.id, action: 'done', path });
    m.photos.push(ph);
    delete pending[m.id];
    talk(ph.id); // 사진이 올라가면 바로 인터뷰 시작
  } catch (e) {
    pending[m.id] = { file: pending[m.id].file, state: 'failed', msg: e.message || '사진을 못 올렸어요. 다시 올려줄래?' };
    home();
  }
}

async function delPhoto(m, ph) {
  if (confirmDel !== ph.id) { confirmDel = ph.id; return home(); }
  confirmDel = null;
  try {
    await callFn('upload-url', { ...ids(), action: 'delete', photo_id: ph.id });
    m.photos = m.photos.filter((x) => x.id !== ph.id);
  } catch (e) {
    m.err = e.message;
  }
  home();
  delete m.err;
}

start();
