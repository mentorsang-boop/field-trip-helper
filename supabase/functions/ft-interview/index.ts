import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { askClaude } from '../_shared/claude.ts';
import { admin, AppError, serve, verifyStudent } from '../_shared/common.ts';

const MAX_TURNS = 3;          // 사진 1장당 질문 수
const PER_MINUTE = 10;        // 학생 1명당 분당 AI 호출
const FINAL = [
  { question: '오늘 체험한 일을 직업으로 하면 어떨 것 같아?', choices: ['해보고 싶다', '조금 관심 생겼다', '나랑은 안 맞다', '잘 모르겠다'] },
  { question: '오늘 새로 알게 된 거 하나만 말해줘', choices: [] },
];

const SYSTEM = `너는 특성화고 학생의 현장체험학습 결과보고서를 돕는 친근한 인터뷰어다.
학생이 방금 올린 사진과 미션 정보를 보고, 보고서에 쓸 내용을 끌어내는 질문을 한 번에 하나만 한다.

규칙:
- 반말로, 친근하고 짧게 묻는다(질문은 40자 이내).
- 사진에 실제로 보이는 것을 구체적으로 짚어 묻는다. (예: "뒤에 큰 오븐이 보이네! 이건 뭐 하는 기계였어?")
- 학생이 한 단어로만 답해도 칭찬하고 넘어간다. 다그치거나 길게 쓰라고 하지 않는다.
- 선택지(choices)는 학생이 고르기 쉬운 짧은 표현 2~4개로 만든다. 사진과 미션에 맞게 만든다.
- 사진에서 확실하지 않은 것은 단정하지 말고 "~같은데 맞아?"처럼 묻는다.
- 사람 얼굴, 외모, 신체에 대해 평가하는 질문은 하지 않는다.
- 이 사진에 대해 이미 ${MAX_TURNS}번 물었거나 보고서에 쓸 내용이 충분하면 done을 true로 한다.
- 반드시 JSON만 출력한다: {"question": string, "choices": string[], "done": boolean}`;

type Row = { id: string; turn: number; question: string; choices: string[] | null; answer: string | null };

// 입력: ids + (photo_id | final:true) + 선택적으로 { interview_id, answer }
// 답이 있으면 저장하고, 이어서 다음 질문을 돌려준다.
serve(async (b) => {
  const st = await verifyStudent(b);
  const { data: trip } = await admin.from('ft_trips').select('is_open').eq('id', st.trip_id).single();
  if (!trip!.is_open) throw new AppError(403, '체험이 끝나서 인터뷰를 할 수 없어요.');

  if (b.interview_id && typeof b.answer === 'string') {
    await admin.from('ft_interview').update({ answer: b.answer.trim().slice(0, 500) || '모르겠어요' })
      .eq('id', b.interview_id).eq('student_id', st.id).is('answer', null);
  }
  return b.final ? finalTurn(st.id) : photoTurn(st.id, b.photo_id);
});

async function rows(studentId: string, photoId: string | null): Promise<Row[]> {
  const q = admin.from('ft_interview').select('id, turn, question, choices, answer').eq('student_id', studentId).order('turn');
  const { data } = await (photoId ? q.eq('photo_id', photoId) : q.is('photo_id', null));
  return data ?? [];
}

const asItem = (r: Row) => ({ id: r.id, turn: r.turn, question: r.question, choices: r.choices ?? [] });
const pack = (list: Row[], done: boolean, item: Row | null = null) => ({
  done,
  item: item && asItem(item),
  history: list.filter((r) => r.answer != null).map((r) => ({ question: r.question, answer: r.answer })),
});

async function insert(row: Record<string, unknown>) {
  const { data, error } = await admin.from('ft_interview').insert(row).select('id, turn, question, choices, answer').single();
  if (error) throw error;
  return data as Row;
}

async function finalTurn(studentId: string) {
  const list = await rows(studentId, null);
  const open = list.find((r) => r.answer == null);
  if (open) return pack(list, false, open);
  if (list.length >= FINAL.length) return pack(list, true);
  const f = FINAL[list.length];
  return pack(list, false, await insert({ student_id: studentId, turn: list.length + 1, ...f }));
}

async function photoTurn(studentId: string, photoId: string) {
  const { data: photo } = await admin.from('ft_photos')
    .select('id, storage_path, interview_done, missions:ft_missions(title, guide, report_section)')
    .eq('id', photoId).eq('student_id', studentId).maybeSingle();
  if (!photo) throw new AppError(404, '사진을 찾을 수 없어요.');

  const list = await rows(studentId, photo.id);
  if (photo.interview_done) return pack(list, true);
  const open = list.find((r) => r.answer == null);
  if (open) return pack(list, false, open);

  const markDone = () => admin.from('ft_photos').update({ interview_done: true }).eq('id', photo.id);
  if (list.length >= MAX_TURNS) { await markDone(); return pack(list, true); }

  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from('ft_interview').select('id', { count: 'exact', head: true })
    .eq('student_id', studentId).gte('created_at', since);
  if ((count ?? 0) >= PER_MINUTE) throw new AppError(429, '잠깐만! 조금 있다가 다시 눌러줘.');

  const { data: file } = await admin.storage.from('ft-photos').download(photo.storage_path);
  if (!file) throw new AppError(404, '사진을 불러오지 못했어요.');
  const m: any = photo.missions;
  const history = list.map((r, i) => `${i + 1}. 질문: ${r.question}\n   답: ${r.answer}`).join('\n') || '(아직 없음)';
  const out = await askClaude(SYSTEM, [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: encodeBase64(new Uint8Array(await file.arrayBuffer())) } },
    { type: 'text', text: `미션: ${m.title} (${m.guide ?? ''})\n보고서 항목: ${m.report_section ?? ''}\n이 사진에 대해 지금까지 ${list.length}번 물었다. 최대 ${MAX_TURNS}번, 꼬리 질문은 최대 1번.\n\n지금까지 문답:\n${history}\n\n다음 질문 1개를 JSON으로.` },
  ]);

  const question = typeof out.question === 'string' ? out.question.trim().slice(0, 80) : '';
  if ((out.done && list.length > 0) || !question) { await markDone(); return pack(list, true); }

  const choices = Array.isArray(out.choices) ? out.choices.filter((c: unknown) => typeof c === 'string').slice(0, 4) : [];
  return pack(list, false, await insert({ student_id: studentId, photo_id: photo.id, turn: list.length + 1, question, choices }));
}
