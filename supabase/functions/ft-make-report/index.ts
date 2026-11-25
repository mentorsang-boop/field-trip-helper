import { askClaude } from '../_shared/claude.ts';
import { admin, AppError, serve, verifyStudent } from '../_shared/common.ts';

const PER_DAY = 5;
const DONT_KNOW = ['모르겠어요', '잘 모르겠다', '모르겠다'];

const SYSTEM = `너는 특성화고 학생의 현장체험학습 결과보고서를 대신 정리해 주는 도우미다.
아래 인터뷰 문답만 근거로 보고서를 작성한다.

규칙:
- 학생이 말하지 않은 사실, 숫자, 감정은 절대 지어내지 않는다. 문답에 없으면 그 내용은 쓰지 않는다.
- "모르겠어요" 답변은 보고서에 넣지 않는다.
- 고등학생이 직접 쓴 것처럼 자연스럽고 쉬운 문장으로 쓴다. 과하게 어른스럽거나 꾸민 표현은 쓰지 않는다.
- 문장은 "~했다", "~였다" 체로 쓴다.
- 각 항목은 2~4문장으로 쓴다. 내용이 부족하면 1문장이어도 된다.
- 반드시 JSON만 출력한다:
  {"activity": string, "learned": string, "feeling": string, "career": string,
   "photo_captions": {"<photo_id>": string}}`;

const fmt = (iso: string | null, opt: Intl.DateTimeFormatOptions) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false, ...opt }) : '';

// 문답(텍스트만, 실명 없음)으로 보고서 초안 생성 → reports 저장
serve(async (b) => {
  const st = await verifyStudent(b);
  const { data: trip } = await admin.from('ft_trips').select('title, place, starts_at, ends_at, is_open').eq('id', st.trip_id).single();
  if (!trip!.is_open) throw new AppError(403, '체험이 끝나서 보고서를 새로 만들 수 없어요.');

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const { data: old } = await admin.from('ft_reports').select('gen_count, gen_day').eq('student_id', st.id).maybeSingle();
  const used = old?.gen_day === today ? old.gen_count : 0;
  if (used >= PER_DAY) throw new AppError(429, `보고서는 하루 ${PER_DAY}번까지 만들 수 있어요. 지금 보고서를 고쳐서 써줘.`);

  const { data: qa } = await admin.from('ft_interview')
    .select('photo_id, question, answer, photos:ft_photos(missions:ft_missions(sort, title, report_section))')
    .eq('student_id', st.id).not('answer', 'is', null).order('created_at');
  const useful = (qa ?? []).filter((r: any) => !DONT_KNOW.includes(r.answer.trim()));

  // 사진별로 묶어 텍스트로 만든다
  const groups = new Map<string, string[]>();
  for (const r of useful as any[]) {
    const m = r.photos?.missions;
    const head = r.photo_id ? `[미션 ${m?.sort}: ${m?.title} → 보고서 항목: ${m?.report_section}] (photo_id: ${r.photo_id})` : '[마무리 질문]';
    if (!groups.has(head)) groups.set(head, []);
    groups.get(head)!.push(`- 질문: ${r.question} / 답: ${r.answer}`);
  }
  const photoIds = new Set((useful as any[]).map((r) => r.photo_id).filter(Boolean));

  let out: any = {};
  if (useful.length) {
    const text = `[체험] ${trip!.title} / 장소: ${trip!.place ?? ''}\n\n` +
      [...groups].map(([head, lines]) => `${head}\n${lines.join('\n')}`).join('\n\n');
    out = await askClaude(SYSTEM, [{ type: 'text', text }], 1500);
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const captions: Record<string, string> = {};
  for (const [id, c] of Object.entries(out.photo_captions ?? {})) if (photoIds.has(id) && typeof c === 'string') captions[id] = c;

  const date = fmt(trip!.starts_at, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const end = fmt(trip!.ends_at, { hour: '2-digit', minute: '2-digit' });
  const content = {
    overview: `일시: ${date}${end ? ' ~ ' + end : ''}\n장소: ${trip!.place ?? ''}`,
    activity: str(out.activity), learned: str(out.learned), feeling: str(out.feeling), career: str(out.career),
    photo_captions: captions,
    confirmed: {},
  };

  const now = new Date().toISOString();
  const { error } = await admin.from('ft_reports').upsert({
    student_id: st.id, content, status: 'draft', updated_at: now, submitted_at: null, gen_count: used + 1, gen_day: today,
  }, { onConflict: 'student_id' });
  if (error) throw error;
  return { content, status: 'draft' };
});
