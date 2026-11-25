import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm';
import { CONFIG } from '../config.js';
import { callFn, DEMO, h, hhmm, sb } from './sb.js';

const $ = (id) => document.getElementById(id);
$('ver').textContent = 'v' + CONFIG.version;

let trip, cps = [], students = [], checkins = [], cp = null, booted = false, pollTimer;

// ===== 로그인 =====
sb.auth.onAuthStateChange((_e, session) => {
  // 콜백 안에서 바로 DB를 부르면 supabase-js가 멈출 수 있어 한 틱 미룬다
  if (session && !booted) { booted = true; setTimeout(boot, 0); }
  if (!session) { booted = false; $('main').hidden = true; $('login').hidden = false; }
});
$('login').onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value, password: $('pw').value });
  $('login-err').textContent = error ? '이메일 또는 비밀번호를 확인해 주세요.' : '';
};
$('logout').onclick = () => sb.auth.signOut();

async function boot(selectId) {
  $('login').hidden = true; $('main').hidden = false;
  let { data: trips } = await sb.from('ft_trips').select('*').order('created_at', { ascending: false });
  if (!trips?.length) {
    const { data } = await sb.from('ft_trips').insert({ title: '현장체험학습' }).select().single();
    trips = [data];
  }
  $('trip-sel').replaceChildren(...trips.map((t) => h('option', { value: t.id }, t.title)));
  $('trip-sel').value = selectId ?? trips[0].id;
  selectTrip(trips.find((t) => t.id === $('trip-sel').value));
  $('trip-sel').onchange = () => selectTrip(trips.find((t) => t.id === $('trip-sel').value));
}
$('new-trip').onclick = async () => {
  const { data } = await sb.from('ft_trips').insert({ title: '새 현장체험학습' }).select().single();
  boot(data.id);
};

async function selectTrip(t) {
  trip = t;
  fillSettings();
  const { data } = await sb.from('ft_checkpoints').select('*').eq('trip_id', trip.id).order('sort');
  cps = data ?? [];
  cp = cps.find((c) => c.is_active) ?? cps[0];
  loadMissions();
  await refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 5000);
}

// ===== 화면 전환 =====
$('pages').onclick = (e) => {
  const page = e.target.dataset.page;
  if (!page) return;
  for (const b of $('pages').children) b.classList.toggle('on', b === e.target);
  for (const p of ['board', 'roster', 'settings', 'submit']) $('page-' + p).hidden = p !== page;
  $('page-close').hidden = page !== 'submit';
  $('page-missions').hidden = page !== 'settings';
  if (page === 'submit') loadSubmit();
  if (page === 'roster') renderRosterList();
};

// ===== 제출 현황 · CSV · 체험 종료 · 전체 삭제 =====
let summary = [];
async function loadSubmit() {
  renderOpen();
  const ids = students.map((s) => s.id);
  if (!ids.length) { $('sub-table').textContent = '명단을 먼저 등록해 주세요.'; summary = []; return; }
  const [ck, ph, iv, rp] = await Promise.all([
    sb.from('ft_checkins').select('student_id, checkpoint_id, checked_at, method').in('student_id', ids),
    sb.from('ft_photos').select('student_id, interview_done').in('student_id', ids),
    sb.from('ft_interview').select('student_id').is('photo_id', null).not('answer', 'is', null).in('student_id', ids),
    sb.from('ft_reports').select('student_id, status, submitted_at').in('student_id', ids),
  ]);
  summary = students.map((s) => {
    const mine = (ph.data ?? []).filter((x) => x.student_id === s.id);
    return {
      s,
      checks: (ck.data ?? []).filter((x) => x.student_id === s.id),
      photos: mine.length,
      talked: mine.filter((x) => x.interview_done).length,
      final: (iv.data ?? []).filter((x) => x.student_id === s.id).length >= 2,
      report: (rp.data ?? []).find((x) => x.student_id === s.id),
    };
  });
  const sent = summary.filter((x) => x.report?.status === 'submitted').length;
  $('sub-summary').textContent = `보고서 제출 ${sent}/${students.length}명 · 작성 중 ${summary.filter((x) => x.report && x.report.status !== 'submitted').length}명`;
  const tag = (cls, t) => h('span', { class: 'tag ' + cls }, t);
  $('sub-table').replaceChildren(h('table', {},
    h('tr', {}, ['반', '번호', '이름', '출석', '사진', '인터뷰', '보고서', ''].map((t) => h('th', {}, t))),
    summary.map((x) => h('tr', {},
      h('td', {}, x.s.class_no), h('td', {}, x.s.number ?? ''), h('td', {}, x.s.name),
      h('td', {}, `${x.checks.length}/${cps.length}`),
      h('td', {}, `${x.photos}장`),
      h('td', {}, `${x.talked}/${x.photos}` + (x.final ? ' · 마무리 ' : '')),
      h('td', {}, x.report?.status === 'submitted' ? tag('ok', '제출') : x.report ? tag('warn', '작성 중') : tag('miss', '없음')),
      h('td', {}, x.report ? h('a', { href: `report.html?student=${x.s.id}`, target: DEMO ? null : '_blank' }, '보기') : '')))));
}
$('sub-refresh').onclick = loadSubmit;
// 데모(공유 페이지)에서는 새 창이 막힐 수 있어 같은 창에서 연다
$('print-all').onclick = () => (DEMO ? location.assign(`report.html?trip=${trip.id}`) : window.open(`report.html?trip=${trip.id}`, '_blank'));

$('csv').onclick = async () => {
  if (!summary.length) await loadSubmit();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['반', '번호', '이름', ...cps.map((c) => c.name), '사진 수', '인터뷰 끝난 사진', '마무리 질문', '보고서', '제출 시각'];
  const lines = summary.map((x) => [
    x.s.class_no, x.s.number, x.s.name,
    ...cps.map((c) => { const k = x.checks.find((y) => y.checkpoint_id === c.id); return k ? (k.method === 'manual' ? '수동' : hhmm(k.checked_at)) : ''; }),
    x.photos, x.talked, x.final ? 'O' : '', x.report?.status === 'submitted' ? '제출' : x.report ? '작성 중' : '',
    x.report?.submitted_at ? new Date(x.report.submitted_at).toLocaleString('ko-KR') : '',
  ]);
  const csv = '﻿' + [head, ...lines].map((r) => r.map(esc).join(',')).join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `${trip.title}_출결제출.csv` });
  document.body.append(a); a.click(); a.remove();
};

function renderOpen() {
  $('open-state').textContent = trip.is_open ? '지금은 학생이 사진·인터뷰·보고서를 고칠 수 있어요.' : '체험이 종료되어 학생이 더 고칠 수 없어요.';
  $('open-toggle').textContent = trip.is_open ? '체험 종료 (학생 수정 잠금)' : '다시 열기';
  $('open-toggle').className = 'btn small ' + (trip.is_open ? 'danger' : '');
  delete $('open-toggle').dataset.armed;
}
$('open-toggle').onclick = async () => {
  const btn = $('open-toggle');
  if (trip.is_open && !btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = '한 번 더 누르면 종료돼요'; return; }
  const { error } = await sb.from('ft_trips').update({ is_open: !trip.is_open }).eq('id', trip.id);
  if (!error) trip.is_open = !trip.is_open;
  renderOpen();
};

$('del-1').onclick = () => { $('del-box').hidden = false; };
$('del-cancel').onclick = () => { $('del-box').hidden = true; };
$('del-2').onclick = async () => {
  $('del-2').disabled = true; $('del-2').textContent = '삭제하는 중…';
  const ids = students.map((s) => s.id);
  if (ids.length) {
    const { data: ph } = await sb.from('ft_photos').select('storage_path').in('student_id', ids);
    const paths = (ph ?? []).map((x) => x.storage_path);
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from('ft-photos').remove(paths.slice(i, i + 100));
  }
  await sb.from('ft_trips').delete().eq('id', trip.id);
  $('del-box').hidden = true; $('del-2').disabled = false; $('del-2').textContent = '정말 삭제';
  boot();
};

// ===== 출결 현황판 =====
async function refresh() {
  if (!trip || !cp) return;
  const [s, c] = await Promise.all([
    sb.from('ft_students').select('id, class_no, number, name, device_id').eq('trip_id', trip.id).order('class_no').order('number'),
    sb.from('ft_checkins').select('*').eq('checkpoint_id', cp.id),
  ]);
  students = s.data ?? []; checkins = c.data ?? [];
  render();
}

function statusOf(st) {
  const c = checkins.find((x) => x.student_id === st.id);
  if (!c) return { cls: 'miss', sub: '미체크', c };
  if (c.distance_m != null && trip.radius_m && c.distance_m > trip.radius_m) return { cls: 'warn', sub: `${c.distance_m}m`, c };
  return { cls: 'ok', sub: c.method === 'manual' ? '수동' : hhmm(c.checked_at), c };
}

function render() {
  $('cp-tabs').replaceChildren(...cps.map((x) =>
    h('button', { class: [x.id === cp.id && 'on', x.is_active && 'live'].filter(Boolean).join(' '), onclick: () => { cp = x; refresh(); } }, x.name)));
  $('cp-toggle').textContent = cp.is_active ? `■ '${cp.name}' 체크 종료` : `▶ '${cp.name}' 체크 시작`;
  $('cp-toggle').className = 'btn small ' + (cp.is_active ? 'danger' : '');

  const missing = students.filter((s) => statusOf(s).cls === 'miss');
  $('count').replaceChildren(`${students.length - missing.length}`, h('small', {}, ` / ${students.length}명 체크`));
  $('missing').className = 'missing' + (missing.length ? '' : ' none');
  $('missing').onclick = students.length ? null : () => document.querySelector('[data-page=roster]').click();
  $('missing').style.cursor = students.length ? '' : 'pointer';
  $('missing').textContent = students.length === 0 ? '명단이 없어요. 여기를 눌러 엑셀 명단을 올려주세요.'
    : missing.length ? `미체크 ${missing.length}명: ` + missing.map((s) => `${s.class_no} ${s.name}`).join(' · ') : '모두 체크했어요 ';

  const classes = [...new Set(students.map((s) => s.class_no))];
  $('board').replaceChildren(...classes.map((k) => {
    const list = students.filter((s) => s.class_no === k);
    return h('div', { class: 'cls' }, h('h3', {}, `${k} · ${list.length}명`),
      h('div', { class: 'grid' }, list.map((s) => {
        const st = statusOf(s);
        return h('button', { class: 'st ' + st.cls, onclick: () => openStudent(s) }, s.name, h('small', {}, st.sub));
      })));
  }));
  if (!$('qr-view').hidden) $('qr-toggle').textContent = $('cp-toggle').textContent;
}

async function toggleCp() {
  const on = !cp.is_active;
  // 한 번에 한 체크포인트만 진행
  if (on) await sb.from('ft_checkpoints').update({ is_active: false }).eq('trip_id', trip.id);
  await sb.from('ft_checkpoints').update({ is_active: on }).eq('id', cp.id);
  cps.forEach((x) => { x.is_active = on && x.id === cp.id; });
  render();
}
$('cp-toggle').onclick = toggleCp;
$('qr-toggle').onclick = toggleCp;

// ===== 학생 칸 → 수동 출석 / 취소 / 기기 초기화 =====
let selected;
function openStudent(s) {
  selected = s;
  const st = statusOf(s);
  $('stu-name').textContent = `${s.class_no} ${s.name}`;
  $('stu-info').textContent = `${cp.name}: ${st.c ? (st.c.method === 'manual' ? '수동 출석' : hhmm(st.c.checked_at) + ' 출석') + (st.c.distance_m != null ? ` · 장소에서 ${st.c.distance_m}m` : ' · 위치 없음') : '미체크'} / 기기 ${s.device_id ? '등록됨' : '없음'}`;
  $('stu-manual').hidden = !!st.c;
  $('stu-undo').hidden = !st.c;
  $('stu-reset').hidden = !s.device_id;
  $('stu-dialog').showModal();
}
async function act(fn) { await fn(); $('stu-dialog').close(); refresh(); }
$('stu-manual').onclick = () => act(() => sb.from('ft_checkins').insert({ checkpoint_id: cp.id, student_id: selected.id, method: 'manual' }));
$('stu-undo').onclick = () => act(() => sb.from('ft_checkins').delete().eq('checkpoint_id', cp.id).eq('student_id', selected.id));
$('stu-reset').onclick = () => act(() => sb.from('ft_students').update({ device_id: null }).eq('id', selected.id));
$('stu-close').onclick = () => $('stu-dialog').close();

// ===== 회전 QR =====
let qrTimer, gaugeTimer;
$('qr-open').onclick = () => { $('qr-view').hidden = false; render(); drawQr(); };
$('qr-close').onclick = () => { $('qr-view').hidden = true; clearTimeout(qrTimer); clearInterval(gaugeTimer); };

async function drawQr() {
  clearTimeout(qrTimer); clearInterval(gaugeTimer);
  $('qr-title').textContent = `${cp.name}`;
  try {
    const r = await callFn('qr-token', { cp_id: cp.id });
    const url = new URL(CONFIG.studentPage ?? 'index.html', location.href);
    url.search = new URLSearchParams({ trip: r.trip_id, cp: cp.id, t: r.token });
    if (DEMO) { $('qr-link').href = url.href; $('qr-link').hidden = false; }
    const size = Math.min(innerWidth - 64, innerHeight - 260, 640);
    await QRCode.toCanvas($('qr-canvas'), url.href, { width: Math.max(size, 200), margin: 1 });
    const end = Date.now() + r.expires_in;
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      $('qr-gauge').style.width = (left / 300) + '%';
      $('qr-left').textContent = `새 QR까지 ${Math.ceil(left / 1000)}초`;
    };
    tick(); gaugeTimer = setInterval(tick, 250);
    qrTimer = setTimeout(drawQr, r.expires_in + 200);
  } catch (e) {
    $('qr-left').textContent = e.message + ' (3초 뒤 다시 시도)';
    qrTimer = setTimeout(drawQr, 3000);
  }
}

// ===== 명단: 엑셀 파일을 올리면 바로 등록 =====
// 머리글('반','번호','이름','학년','학번')을 찾아 열을 맞춘다. 머리글이 없으면 반·번호·이름 순서로 본다.
function parseRoster(rows) {
  rows = rows.map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean));
  const find = (r, words) => r.findIndex((c) => words.some((w) => c.replace(/\s/g, '').includes(w)));
  const hi = rows.slice(0, 10).findIndex((r) => find(r, ['이름', '성명']) >= 0);
  let col;
  if (hi >= 0) {
    const r = rows[hi];
    col = { grade: find(r, ['학년']), cls: r.findIndex((c) => /^(학급|반)$|반$/.test(c.replace(/\s/g, '')) && !c.includes('번')), num: find(r, ['번호']), id: find(r, ['학번']), name: find(r, ['이름', '성명']) };
    rows = rows.slice(hi + 1);
  } else {
    col = rows[0]?.length >= 3 ? { grade: -1, cls: 0, num: 1, id: -1, name: 2 } : { grade: -1, cls: 0, num: -1, id: -1, name: 1 };
  }
  const at = (r, i) => (i >= 0 ? r[i] ?? '' : '');
  return rows.map((r) => {
    const name = at(r, col.name);
    let grade = at(r, col.grade).replace(/학년$/, ''), cls = at(r, col.cls).replace(/반$/, ''), num = at(r, col.num);
    const id = at(r, col.id).replace(/\D/g, '');
    if (id.length === 5 && !cls) { grade = id[0]; cls = String(+id.slice(1, 3)); num = num || String(+id.slice(3)); } // 학번 30101 → 3-1 1번
    const class_no = grade && cls && !cls.includes('-') ? `${grade}-${cls}` : cls;
    const n = parseInt(num, 10);
    return name && class_no ? { class_no, number: Number.isNaN(n) ? null : n, name } : null;
  }).filter(Boolean);
}

async function addRoster(list) {
  if (!list.length) {
    $('roster-msg').className = 'err';
    $('roster-msg').textContent = "이름을 찾지 못했어요. 첫 줄에 '반', '번호', '이름'(또는 '학번', '이름') 머리글이 있는지 확인해 주세요.";
    return;
  }
  const seen = new Set(students.map((s) => s.class_no + '|' + s.name));
  const fresh = list.filter((r) => !seen.has(r.class_no + '|' + r.name) && seen.add(r.class_no + '|' + r.name));
  $('roster-msg').className = '';
  if (!fresh.length) { $('roster-msg').textContent = `${list.length}명 모두 이미 등록돼 있어요.`; return; }
  const { error } = await sb.from('ft_students').insert(fresh.map((r) => ({ ...r, trip_id: trip.id })));
  if (error) { $('roster-msg').className = 'err'; $('roster-msg').textContent = '등록하지 못했어요: ' + error.message; return; }
  const byClass = Object.entries(fresh.reduce((a, r) => ((a[r.class_no] = (a[r.class_no] ?? 0) + 1), a), {})).map(([c, n]) => `${c} ${n}명`).join(', ');
  $('roster-msg').textContent = `${fresh.length}명 등록했어요 (${byClass})` + (list.length > fresh.length ? ` · 이미 있던 ${list.length - fresh.length}명은 건너뜀` : '');
  $('roster-text').value = '';
  await refresh();
  renderRosterList();
}

async function readRosterFile(f) {
  if (!f) return;
  $('roster-msg').className = ''; $('roster-msg').textContent = `${f.name} 읽는 중…`;
  try {
    let rows;
    if (/\.xlsx?$/i.test(f.name)) {
      const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const wb = XLSX.read(await f.arrayBuffer());
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    } else {
      rows = (await f.text()).split(/\r?\n/).map((l) => l.split(/\t|,/));
    }
    await addRoster(parseRoster(rows));
  } catch (e) {
    $('roster-msg').className = 'err'; $('roster-msg').textContent = '파일을 읽지 못했어요: ' + e.message;
  }
}
$('roster-file').onchange = (e) => { readRosterFile(e.target.files[0]); e.target.value = ''; };
$('roster-drop').ondragover = (e) => { e.preventDefault(); $('roster-drop').classList.add('over'); };
$('roster-drop').ondragleave = () => $('roster-drop').classList.remove('over');
$('roster-drop').ondrop = (e) => { e.preventDefault(); $('roster-drop').classList.remove('over'); readRosterFile(e.dataTransfer.files[0]); };
$('roster-add').onclick = () => addRoster(parseRoster($('roster-text').value.split(/\r?\n/).map((l) => l.split(/\t|,/))));

function renderRosterList() {
  const classes = [...new Set(students.map((s) => s.class_no))];
  $('roster-list').replaceChildren(
    h('p', { class: 'hint' }, students.length ? `등록된 학생 ${students.length}명` : '아직 등록된 학생이 없어요.'),
    ...classes.map((c) => {
      const list = students.filter((s) => s.class_no === c);
      return h('p', {}, h('b', {}, `${c} (${list.length}명) `), list.map((s) => `${s.number ?? ''} ${s.name}`).join(' · '));
    }));
  $('roster-clear').hidden = !students.length;
  $('roster-clear').textContent = '명단 전체 지우기';
  delete $('roster-clear').dataset.armed;
}
$('roster-clear').onclick = async () => {
  const btn = $('roster-clear');
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = '한 번 더 누르면 출결·사진·보고서까지 모두 지워져요'; return; }
  await sb.from('ft_students').delete().eq('trip_id', trip.id);
  $('roster-msg').textContent = '명단을 지웠어요.';
  await refresh();
  renderRosterList();
};

// ===== 미션 카드 편집 =====
let missions = [], removedMissions = [];
async function loadMissions() {
  const { data } = await sb.from('ft_missions').select('*').eq('trip_id', trip.id).order('sort');
  missions = data ?? []; removedMissions = [];
  renderMissions();
}
function renderMissions() {
  $('mission-list').replaceChildren(...missions.map((m, i) => h('div', { class: 'mrow' },
    h('input', { value: m.emoji ?? '', 'aria-label': '이모지', class: 'emoji-in', oninput: (e) => { m.emoji = e.target.value; } }),
    h('input', { value: m.title ?? '', placeholder: '미션 이름', 'aria-label': '미션 이름', oninput: (e) => { m.title = e.target.value; } }),
    h('input', { value: m.guide ?? '', placeholder: '학생에게 보일 안내 문구', 'aria-label': '안내 문구', oninput: (e) => { m.guide = e.target.value; } }),
    h('button', { class: 'btn ghost small', onclick: () => { missions.splice(i, 1); if (m.id) removedMissions.push(m); renderMissions(); } }, '지우기'))));
}
$('mission-add').onclick = () => { missions.push({ emoji: '', title: '', guide: '' }); renderMissions(); };
$('mission-save').onclick = async () => {
  if (missions.some((m) => !m.title.trim())) { $('mission-msg').textContent = '미션 이름이 비어 있어요.'; return; }
  for (const m of removedMissions) {
    const { data: ph } = await sb.from('ft_photos').select('storage_path').eq('mission_id', m.id);
    if (ph?.length) await sb.storage.from('ft-photos').remove(ph.map((x) => x.storage_path));
    await sb.from('ft_missions').delete().eq('id', m.id);
  }
  for (const [i, m] of missions.entries()) {
    const row = { sort: i + 1, emoji: m.emoji || '', title: m.title.trim(), guide: m.guide?.trim() || null, report_section: m.report_section || m.title.trim() };
    if (m.id) await sb.from('ft_missions').update(row).eq('id', m.id);
    else await sb.from('ft_missions').insert({ ...row, trip_id: trip.id });
  }
  $('mission-msg').textContent = `미션 ${missions.length}개 저장했어요.`;
  loadMissions();
};

// ===== 체험 설정 =====
const toLocal = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
function fillSettings() {
  const f = $('page-settings').elements;
  for (const k of ['title', 'place', 'lat', 'lng', 'radius_m']) f[k].value = trip[k] ?? '';
  f.starts_at.value = toLocal(trip.starts_at);
  f.ends_at.value = toLocal(trip.ends_at);
}
$('here').onclick = () => navigator.geolocation.getCurrentPosition(
  (p) => { const f = $('page-settings').elements; f.lat.value = p.coords.latitude.toFixed(6); f.lng.value = p.coords.longitude.toFixed(6); },
  () => { $('settings-msg').textContent = '위치를 가져오지 못했어요. 브라우저 위치 권한을 확인해 주세요.'; },
  { enableHighAccuracy: true, timeout: 10000 });
$('page-settings').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const num = (v) => v === '' ? null : Number(v);
  const patch = {
    title: f.title.value, place: f.place.value || null,
    starts_at: f.starts_at.value ? new Date(f.starts_at.value).toISOString() : null,
    ends_at: f.ends_at.value ? new Date(f.ends_at.value).toISOString() : null,
    lat: num(f.lat.value), lng: num(f.lng.value), radius_m: num(f.radius_m.value) ?? 300,
  };
  const { error } = await sb.from('ft_trips').update(patch).eq('id', trip.id);
  $('settings-msg').textContent = error ? '저장하지 못했어요: ' + error.message : '저장했어요.';
  if (!error) { Object.assign(trip, patch); $('trip-sel').selectedOptions[0].textContent = trip.title; }
};
