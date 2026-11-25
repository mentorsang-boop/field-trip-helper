import { CONFIG } from '../config.js';

// config.js에 실제 Supabase 주소가 없으면 데모 모드(가짜 서버, 이 브라우저에만 저장)
export const DEMO = CONFIG.supabaseUrl.includes('YOUR-PROJECT');
const backend = DEMO ? await import('./mock.js') : await import('./live.js');
export const sb = backend.sb;
export const callFn = backend.callFn;

if (DEMO) {
  const bar = document.createElement('div');
  bar.style.cssText = 'background:#FFF4CE;color:#5C3B00;border-bottom:1px solid #E8D48A;padding:8px 16px;font-size:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
  bar.innerHTML = '<b>데모 모드</b><span>실제 서버 없이 이 브라우저에만 저장돼요. AI 대신 예시 질문이 나와요.</span>' +
    `<a href="teacher.html" style="color:#185C37">교사 화면</a><a href="${CONFIG.studentPage ?? 'index.html'}?trip=demo-trip" style="color:#185C37">학생 화면</a>` +
    '<button style="margin-left:auto;border:0;border-radius:8px;padding:4px 10px;cursor:pointer">데모 초기화</button>';
  bar.querySelector('button').onclick = () => { backend.reset(); location.reload(); };
  document.body.prepend(bar);
}

// 작은 DOM 도우미: h('button', { class: 'btn', onclick }, '텍스트')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

export const hhmm = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
