// 데모용 가짜 서버. Supabase·Edge Function과 같은 모양으로 동작하고, 데이터는 이 브라우저 localStorage에만 저장한다.
// (같은 브라우저의 교사 탭과 학생 탭이 데이터를 함께 쓴다)
const KEY = 'ft_demo_db';
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { console.warn('저장 공간 부족', e); } },
};

function seed() {
  const trip = 'demo-trip';
  const d = { trips: [], trip_secrets: [], checkpoints: [], students: [], checkins: [], missions: [], photos: [], interview: [], reports: [] };
  d.trips.push({ id: trip, title: '제빵 공장 현장체험학습 (예시)', place: '○○제과 공장', starts_at: '2026-12-03T04:00:00.000Z', ends_at: '2026-12-03T07:30:00.000Z',
    lat: 37.5665, lng: 126.978, radius_m: 300, is_open: true, created_by: 'demo', created_at: now() });
  addTripDefaults(d, trip);
  const names = { '3-1': ['김가온', '박도윤', '이하늘', '정우진', '한소율', '윤채원'], '3-2': ['이서진', '정하람', '최민준', '한지우', '윤태오', '서은비'], '3-3': ['강래온', '문예린', '신도현', '권나연', '황지안', '송유찬'] };
  for (const [c, list] of Object.entries(names)) list.forEach((name, i) => d.students.push({ id: uid(), trip_id: trip, class_no: c, number: i + 1, name, device_id: null }));
  // 예시로 몇 명은 '출발' 체크를 해둔다
  const start = d.checkpoints.find((x) => x.name === '출발');
  d.students.slice(1, 12).forEach((s, i) => d.checkins.push({ id: uid(), checkpoint_id: start.id, student_id: s.id, checked_at: now(), lat: null, lng: null, distance_m: i === 3 ? 420 : null, method: i === 5 ? 'manual' : 'qr' }));
  return d;
}

function addTripDefaults(d, tripId) {
  d.trip_secrets.push({ trip_id: tripId, qr_secret: uid() });
  ['출발', '현장 도착', '해산'].forEach((name, i) => d.checkpoints.push({ id: uid(), trip_id: tripId, name, sort: i + 1, is_active: false }));
  [['📍', '도착한 곳', '도착해서 처음 본 장소를 찍어요', '장소 소개'], ['🔧', '일하는 모습', '장비, 작업 과정, 일하는 사람을 찍어요', '활동 내용'],
    ['⭐', '기억에 남는 장면', '오늘 가장 인상 깊은 순간', '느낀 점'], ['🙋', '직접 해본 것', '내가 직접 만져보거나 해본 것을 찍어요', '체험 활동']]
    .forEach(([emoji, title, guide, report_section], i) => d.missions.push({ id: uid(), trip_id: tripId, sort: i + 1, emoji, title, guide, report_section }));
}

let db;
const sync = () => { try { db = JSON.parse(ls.get(KEY)) || db; } catch { /* 그대로 */ } if (!db) { db = seed(); save(); } };
const save = () => ls.set(KEY, JSON.stringify(db));
sync();

export function reset() {
  try { Object.keys(localStorage).filter((k) => k.startsWith('ft_')).forEach((k) => localStorage.removeItem(k)); } catch { /* 무시 */ }
}

const DEFAULTS = {
  trips: () => ({ is_open: true, radius_m: 300, created_by: 'demo', created_at: now() }),
  checkins: () => ({ checked_at: now(), lat: null, lng: null, distance_m: null }),
  photos: () => ({ created_at: now(), interview_done: false }),
  interview: () => ({ created_at: now(), answer: null }),
  reports: () => ({ status: 'draft', gen_count: 0, updated_at: now() }),
};

function removeTrip(id) {
  const sids = db.students.filter((s) => s.trip_id === id).map((s) => s.id);
  db.photos.filter((p) => sids.includes(p.student_id)).forEach((p) => ls.set('ft_demo_file:' + p.storage_path, null));
  for (const t of ['checkins', 'photos', 'interview', 'reports']) db[t] = db[t].filter((r) => !sids.includes(r.student_id));
  for (const t of ['checkpoints', 'students', 'missions', 'trip_secrets']) db[t] = db[t].filter((r) => r.trip_id !== id);
}

// supabase-js 쿼리 빌더 흉내 (이 앱이 쓰는 기능만)
class Query {
  constructor(t) { t = t.replace(/^ft_/, ''); Object.assign(this, { t, f: [], op: 'select', ord: [], one: null, cols: '*', opts: {} }); }
  select(cols = '*', opts = {}) { if (this.op === 'select') { this.cols = cols; this.opts = opts; } else this.cols = cols; return this; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  in(k, vs) { this.f.push((r) => vs.includes(r[k])); return this; }
  is(k, v) { this.f.push((r) => (r[k] ?? null) === v); return this; }
  not(k, _op, v) { this.f.push((r) => (r[k] ?? null) !== v); return this; }
  gte(k, v) { this.f.push((r) => r[k] >= v); return this; }
  order(k, { ascending = true } = {}) { this.ord.push([k, ascending]); return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  insert(v) { this.op = 'insert'; this.val = v; return this; }
  update(v) { this.op = 'update'; this.val = v; return this; }
  upsert(v, { onConflict = 'id' } = {}) { this.op = 'upsert'; this.val = v; this.key = onConflict; return this; }
  delete() { this.op = 'delete'; return this; }
  then(ok, bad) { return new Promise((r) => setTimeout(r, 60)).then(() => this.run()).then(ok, bad); }

  run() {
    sync();
    const T = db[this.t];
    let rows;
    if (this.op === 'insert') {
      rows = [].concat(this.val).map((r) => ({ id: uid(), ...(DEFAULTS[this.t]?.() ?? {}), ...r }));
      if (this.t === 'checkins' && rows.some((r) => T.some((x) => x.checkpoint_id === r.checkpoint_id && x.student_id === r.student_id))) {
        return { data: null, error: { code: '23505', message: '이미 출석했어요.' } };
      }
      T.push(...rows);
      if (this.t === 'trips') rows.forEach((r) => addTripDefaults(db, r.id));
    } else if (this.op === 'upsert') {
      rows = [].concat(this.val).map((r) => {
        const old = T.find((x) => x[this.key] === r[this.key]);
        if (old) return Object.assign(old, r);
        const n = { id: uid(), ...(DEFAULTS[this.t]?.() ?? {}), ...r };
        T.push(n);
        return n;
      });
    } else {
      rows = T.filter((r) => this.f.every((f) => f(r)));
      if (this.op === 'update') rows.forEach((r) => Object.assign(r, this.val));
      if (this.op === 'delete') {
        if (this.t === 'trips') rows.forEach((r) => removeTrip(r.id));
        if (this.t === 'students') for (const t of ['checkins', 'photos', 'interview', 'reports']) db[t] = db[t].filter((x) => !rows.some((r) => r.id === x.student_id));
        if (this.t === 'missions') db.photos = db.photos.filter((x) => !rows.some((r) => r.id === x.mission_id));
        db[this.t] = db[this.t].filter((r) => !rows.includes(r));
      }
    }
    if (this.op !== 'select') save();

    for (const [k, asc] of [...this.ord].reverse()) rows = [...rows].sort((a, b) => ((a[k] ?? '') > (b[k] ?? '') ? 1 : (a[k] ?? '') < (b[k] ?? '') ? -1 : 0) * (asc ? 1 : -1));
    const join = (r) => {
      const o = { ...r };
      if (this.cols.includes('trips(')) o.trips = db.trips.find((t) => t.id === r.trip_id) ?? null;
      if (this.cols.includes('missions(')) o.missions = db.missions.find((m) => m.id === r.mission_id) ?? null;
      return o;
    };
    if (this.opts.head) return { data: null, count: rows.length, error: null };
    if (this.one) {
      if (!rows.length && this.one === 'single') return { data: null, error: { message: '찾을 수 없어요.' } };
      return { data: rows[0] ? join(rows[0]) : null, error: null };
    }
    return { data: rows.map(join), count: rows.length, error: null };
  }
}

// 사진은 작게 줄여 dataURL로 저장 (localStorage 용량 때문)
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 480 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

let session = JSON.parse(ls.get('ft_demo_session') || 'null');
const listeners = [];
const notify = (e) => listeners.forEach((cb) => cb(e, session));

export const sb = {
  from: (t) => new Query(t),
  auth: {
    getSession: async () => ({ data: { session } }),
    onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session)); return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword({ email }) {
      session = { access_token: 'demo', user: { id: 'demo', email } };
      ls.set('ft_demo_session', JSON.stringify(session)); notify('SIGNED_IN');
      return { error: null };
    },
    async signOut() { session = null; ls.set('ft_demo_session', null); notify('SIGNED_OUT'); return { error: null }; },
  },
  storage: {
    from: () => ({
      async uploadToSignedUrl(path, _t, file) {
        try { ls.set('ft_demo_file:' + path, await shrink(file)); return { error: null }; } catch (e) { return { error: e }; }
      },
      async createSignedUrls(paths) { return { data: paths.map((p) => ({ path: p, signedUrl: ls.get('ft_demo_file:' + p) })) }; },
      async remove(paths) { paths.forEach((p) => ls.set('ft_demo_file:' + p, null)); return { error: null }; },
    }),
  },
};

// ===== Edge Function 흉내 =====
const fail = (status, msg) => { throw Object.assign(new Error(msg), { status }); };
const SLOT = 30_000;
const tok = (cp, slot) => String(Math.abs([...`${cp}:${slot}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))).padStart(8, '0').slice(0, 8);
const trip = (id) => db.trips.find((t) => t.id === id);
function student(b) {
  const s = db.students.find((x) => x.id === b.student_id && x.trip_id === b.trip_id);
  if (!s || s.device_id !== b.device_id) fail(403, '이 폰에 등록된 이름이 아니에요. 이름을 다시 골라줘.');
  return s;
}
const openOnly = (s, what) => { if (!trip(s.trip_id).is_open) fail(403, `체험이 끝나서 ${what} 수 없어요.`); };
const DONT_KNOW = ['모르겠어요', '잘 모르겠다', '모르겠다'];
const PHOTO_Q = [
  { question: '사진에서 가장 먼저 눈에 띄는 게 뭐야?', choices: ['기계', '일하는 사람', '재료', '공간'] },
  { question: '그건 어디에 쓰이는 것 같았어?', choices: ['만드는 데', '옮기는 데', '포장하는 데'] },
  { question: '그걸 보니까 어떤 느낌이었어?', choices: ['신기했다', '힘들어 보였다', '멋있었다'] },
];
const FINAL = [
  { question: '오늘 체험한 일을 직업으로 하면 어떨 것 같아?', choices: ['해보고 싶다', '조금 관심 생겼다', '나랑은 안 맞다', '잘 모르겠다'] },
  { question: '오늘 새로 알게 된 거 하나만 말해줘', choices: [] },
];

function turn(s, photoId, list) {
  const pack = (done, item = null) => ({ done, item: item && { id: item.id, turn: item.turn, question: item.question, choices: item.choices }, history: list.filter((r) => r.answer != null).map((r) => ({ question: r.question, answer: r.answer })) });
  const open = list.find((r) => r.answer == null);
  if (open) return pack(false, open);
  const bank = photoId ? PHOTO_Q : FINAL;
  if (list.length >= bank.length) {
    if (photoId) db.photos.find((p) => p.id === photoId).interview_done = true;
    return pack(true);
  }
  const row = { id: uid(), student_id: s.id, photo_id: photoId, turn: list.length + 1, ...bank[list.length], answer: null, created_at: now() };
  db.interview.push(row);
  return pack(false, row);
}

const fns = {
  roster({ trip_id, cp_id }) {
    const t = trip(trip_id) ?? fail(404, '체험학습을 찾을 수 없어요. QR을 다시 찍어줘.');
    const cp = db.checkpoints.find((c) => c.id === cp_id && c.trip_id === trip_id);
    return {
      trip: { title: t.title, place: t.place, is_open: t.is_open },
      checkpoint: cp ? { name: cp.name, is_active: cp.is_active } : null,
      students: db.students.filter((s) => s.trip_id === trip_id).sort((a, b) => a.class_no.localeCompare(b.class_no) || a.number - b.number)
        .map((s) => ({ id: s.id, class_no: s.class_no, name: s.name, taken: !!s.device_id })),
    };
  },
  'register-device'({ trip_id, student_id, device_id }) {
    const s = db.students.find((x) => x.id === student_id && x.trip_id === trip_id) ?? fail(404, '명단에 없는 이름이에요.');
    if (s.device_id === device_id) return { ok: true };
    if (s.device_id) fail(409, '다른 폰에 등록된 이름이에요. 선생님께 말해주세요.');
    const other = db.students.find((x) => x.trip_id === trip_id && x.device_id === device_id);
    if (other) fail(409, `이 폰은 이미 '${other.name}' 이름으로 등록돼 있어요. 선생님께 말해주세요.`);
    s.device_id = device_id;
    return { ok: true };
  },
  checkin(b) {
    const s = student(b);
    const cp = db.checkpoints.find((c) => c.id === b.cp_id && c.trip_id === s.trip_id) ?? fail(404, 'QR을 다시 찍어줘.');
    const done = db.checkins.find((c) => c.checkpoint_id === cp.id && c.student_id === s.id);
    if (done) return { already: true, checked_at: done.checked_at, cp_name: cp.name };
    if (!cp.is_active) fail(409, `지금은 '${cp.name}' 체크 시간이 아니에요.`);
    const slot = Math.floor(Date.now() / SLOT);
    if (b.token !== tok(cp.id, slot) && b.token !== tok(cp.id, slot - 1)) fail(410, 'QR이 바뀌었어요. 선생님 화면의 QR을 다시 찍어줘.');
    const t = trip(s.trip_id);
    let distance_m = null;
    if (typeof b.lat === 'number' && t.lat != null) {
      const r = (d) => (d * Math.PI) / 180;
      const a = Math.sin(r(t.lat - b.lat) / 2) ** 2 + Math.cos(r(b.lat)) * Math.cos(r(t.lat)) * Math.sin(r(t.lng - b.lng) / 2) ** 2;
      distance_m = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }
    const row = { id: uid(), checkpoint_id: cp.id, student_id: s.id, checked_at: now(), lat: b.lat ?? null, lng: b.lng ?? null, distance_m, method: 'qr' };
    db.checkins.push(row);
    return { checked_at: row.checked_at, cp_name: cp.name, distance_m, outside: distance_m != null && distance_m > t.radius_m };
  },
  'qr-token'({ cp_id }) {
    const cp = db.checkpoints.find((c) => c.id === cp_id) ?? fail(404, '체크포인트를 찾을 수 없어요.');
    const n = Date.now(), slot = Math.floor(n / SLOT);
    return { trip_id: cp.trip_id, token: tok(cp.id, slot), expires_in: (slot + 1) * SLOT - n };
  },
  'upload-url'(b) {
    const s = student(b);
    openOnly(s, '더 올리거나 지울');
    if (b.action === 'delete') {
      const p = db.photos.find((x) => x.id === b.photo_id && x.student_id === s.id) ?? fail(404, '사진을 찾을 수 없어요.');
      ls.set('ft_demo_file:' + p.storage_path, null);
      db.photos = db.photos.filter((x) => x !== p);
      return { ok: true };
    }
    const prefix = `${s.trip_id}/${s.id}/${b.mission_id}/`;
    if (b.action === 'done') {
      if (!ls.get('ft_demo_file:' + b.path)) fail(409, '사진이 아직 안 올라갔어요. 다시 올려줘.');
      const p = { id: uid(), student_id: s.id, mission_id: b.mission_id, storage_path: b.path, created_at: now(), interview_done: false };
      db.photos.push(p);
      return { id: p.id, url: ls.get('ft_demo_file:' + b.path) };
    }
    if (db.photos.filter((x) => x.student_id === s.id && x.mission_id === b.mission_id).length >= 2) fail(409, '미션마다 사진은 2장까지예요.');
    return { path: prefix + uid() + '.jpg', token: 'demo' };
  },
  'my-status'(b) {
    const s = student(b), t = trip(s.trip_id);
    const photos = db.photos.filter((p) => p.student_id === s.id);
    const rep = db.reports.find((r) => r.student_id === s.id);
    return {
      trip: { title: t.title, is_open: t.is_open },
      checked: db.checkins.filter((c) => c.student_id === s.id).map((c) => c.checkpoint_id),
      final_done: db.interview.filter((r) => r.student_id === s.id && !r.photo_id && r.answer != null).length >= 2,
      report: rep ? { content: rep.content, status: rep.status } : null,
      missions: db.missions.filter((m) => m.trip_id === s.trip_id).sort((a, b) => a.sort - b.sort).map((m) => ({
        ...m, photos: photos.filter((p) => p.mission_id === m.id).map((p) => ({ id: p.id, url: ls.get('ft_demo_file:' + p.storage_path), interview_done: p.interview_done })),
      })),
    };
  },
  interview(b) {
    const s = student(b);
    openOnly(s, '인터뷰를 할');
    if (b.interview_id && typeof b.answer === 'string') {
      const r = db.interview.find((x) => x.id === b.interview_id && x.student_id === s.id && x.answer == null);
      if (r) r.answer = b.answer.trim().slice(0, 500) || '모르겠어요';
    }
    const photoId = b.final ? null : b.photo_id;
    if (photoId && !db.photos.some((p) => p.id === photoId && p.student_id === s.id)) fail(404, '사진을 찾을 수 없어요.');
    return turn(s, photoId, db.interview.filter((r) => r.student_id === s.id && (r.photo_id ?? null) === photoId).sort((a, b) => a.turn - b.turn));
  },
  'make-report'(b) {
    const s = student(b), t = trip(s.trip_id);
    openOnly(s, '보고서를 새로 만들');
    const qa = db.interview.filter((r) => r.student_id === s.id && r.answer != null && !DONT_KNOW.includes(r.answer.trim()));
    const byMission = (sort) => qa.filter((r) => r.photo_id && db.missions.find((m) => m.id === db.photos.find((p) => p.id === r.photo_id)?.mission_id)?.sort === sort).map((r) => r.answer);
    const finals = db.interview.filter((r) => r.student_id === s.id && !r.photo_id).sort((a, b) => a.turn - b.turn);
    const ok = (a) => a && !DONT_KNOW.includes(a.trim());
    const doing = [...byMission(1), ...byMission(2)];
    const feel = [...byMission(3), ...byMission(4)];
    // 데모: AI 대신 학생 답을 그대로 이어 붙인 예시 문장
    const content = {
      overview: `일시: 2026년 12월 3일 (목) 13:00 ~ 16:30\n장소: ${t.place ?? ''}`,
      activity: doing.length ? `${t.place}에서 체험을 했다. 사진을 찍으며 ${doing.join(', ')} 같은 것을 보았다.` : '',
      learned: ok(finals[1]?.answer) ? `오늘 ${finals[1].answer}을(를) 새로 알게 되었다.` : '',
      feeling: feel.length ? `기억에 남는 장면을 보며 ${feel.join(', ')}고 느꼈다.` : '',
      career: ok(finals[0]?.answer) ? `이 일을 직업으로 한다면 '${finals[0].answer}'는 생각이 들었다.` : '',
      photo_captions: {},
      confirmed: {},
    };
    const old = db.reports.find((r) => r.student_id === s.id);
    if (old) Object.assign(old, { content, status: 'draft', submitted_at: null, updated_at: now() });
    else db.reports.push({ id: uid(), student_id: s.id, content, status: 'draft', updated_at: now(), submitted_at: null });
    return { content, status: 'draft' };
  },
  'save-report'(b) {
    const s = student(b);
    openOnly(s, '더 고칠');
    const r = db.reports.find((x) => x.student_id === s.id) ?? fail(404, '보고서를 먼저 만들어줘.');
    const KEYS = ['activity', 'learned', 'feeling', 'career'];
    for (const k of KEYS) if (typeof b[k] === 'string') r.content[k] = b[k].trim();
    if (b.confirmed) r.content.confirmed = Object.fromEntries(KEYS.map((k) => [k, !!b.confirmed[k]]));
    if (b.submit) {
      if (!KEYS.every((k) => r.content.confirmed?.[k])) fail(409, '모든 문단을 확인해줘.');
      r.status = 'submitted'; r.submitted_at = now();
    }
    r.updated_at = now();
    return { content: r.content, status: r.status };
  },
};

export async function callFn(name, body) {
  await new Promise((r) => setTimeout(r, ['interview', 'make-report'].includes(name) ? 900 : 250));
  sync();
  const out = fns[name](body);
  save();
  return JSON.parse(JSON.stringify(out));
}
