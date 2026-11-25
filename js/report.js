import { h, sb } from './sb.js';

// report.html?student=ID (한 명) 또는 report.html?trip=ID (전체, 학생마다 페이지 나눔)
const p = new URLSearchParams(location.search);
const pages = document.getElementById('pages');
const info = document.getElementById('info');
document.getElementById('print').onclick = () => window.print();

const SECTIONS = [['activity', '활동 내용'], ['learned', '알게 된 점'], ['feeling', '느낀 점'], ['career', '진로와 연결']];
const msg = (t) => { info.textContent = ''; pages.replaceChildren(h('div', { class: 'msg' }, t)); };

async function main() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return msg('교사 화면(teacher.html)에서 로그인한 뒤 다시 열어주세요.');

  let q = sb.from('ft_students').select('id, class_no, number, name, trips:ft_trips(title, place)');
  q = p.get('student') ? q.eq('id', p.get('student')) : q.eq('trip_id', p.get('trip')).order('class_no').order('number');
  const { data: students } = await q;
  if (!students?.length) return msg('학생을 찾을 수 없어요.');

  const ids = students.map((s) => s.id);
  const [{ data: reports }, { data: photos }] = await Promise.all([
    sb.from('ft_reports').select('student_id, content, status').in('student_id', ids),
    sb.from('ft_photos').select('id, student_id, storage_path, created_at, missions:ft_missions(sort, title)').in('student_id', ids).order('created_at'),
  ]);

  const urls = {};
  const paths = (photos ?? []).map((x) => x.storage_path);
  for (let i = 0; i < paths.length; i += 100) {
    const { data } = await sb.storage.from('ft-photos').createSignedUrls(paths.slice(i, i + 100), 3600);
    data?.forEach((d) => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
  }

  const withReport = students.filter((s) => reports?.some((r) => r.student_id === s.id));
  if (!withReport.length) return msg('아직 만들어진 보고서가 없어요.');
  pages.replaceChildren(...withReport.map((s) => page(s, reports.find((r) => r.student_id === s.id), photos ?? [], urls)));
  info.textContent = `${withReport.length}명` + (students.length > withReport.length ? ` (보고서 없는 ${students.length - withReport.length}명 제외)` : '');
}

function page(s, r, photos, urls) {
  const c = r.content ?? {};
  // 미션마다 첫 사진 1장씩, 최대 4장
  const seen = new Set();
  const picks = photos.filter((x) => x.student_id === s.id)
    .sort((a, b) => (a.missions?.sort ?? 0) - (b.missions?.sort ?? 0))
    .filter((x) => !seen.has(x.missions?.sort) && seen.add(x.missions?.sort))
    .slice(0, 4);

  return h('section', { class: 'page' },
    h('h1', {}, '현장체험학습 결과보고서'),
    h('table', { class: 'meta' },
      h('tr', {}, h('th', {}, '학생'), h('td', {}, `${s.class_no} ${s.number ?? ''}번 ${s.name}`), h('th', {}, '제출'), h('td', {}, r.status === 'submitted' ? '제출함' : '작성 중')),
      h('tr', {}, h('th', {}, '체험명'), h('td', { colspan: 3 }, s.trips?.title ?? '')),
      h('tr', {}, h('th', {}, '개요'), h('td', { colspan: 3 }, h('p', {}, c.overview ?? '')))),
    SECTIONS.map(([k, label]) => [h('h2', {}, label), c[k] ? h('p', {}, c[k]) : h('p', { class: 'empty' }, '(내용 없음)')]),
    picks.length ? h('div', { class: 'photos' }, picks.map((x) =>
      h('figure', {}, h('img', { src: urls[x.storage_path], alt: x.missions?.title ?? '사진' }),
        h('figcaption', {}, c.photo_captions?.[x.id] || x.missions?.title || '')))) : null);
}

main().catch((e) => msg('불러오지 못했어요: ' + e.message));
