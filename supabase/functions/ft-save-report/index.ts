import { admin, AppError, serve, verifyStudent } from '../_shared/common.ts';

const KEYS = ['activity', 'learned', 'feeling', 'career'];

// 학생 수정본 저장 / 문단 확인 표시 / 제출
serve(async (b) => {
  const st = await verifyStudent(b);
  const { data: trip } = await admin.from('ft_trips').select('is_open').eq('id', st.trip_id).single();
  if (!trip!.is_open) throw new AppError(403, '체험이 끝나서 더 고칠 수 없어요.');

  const { data: r } = await admin.from('ft_reports').select('content').eq('student_id', st.id).maybeSingle();
  if (!r) throw new AppError(404, '보고서를 먼저 만들어줘.');

  const content = { ...r.content };
  for (const k of KEYS) if (typeof b[k] === 'string') content[k] = b[k].trim().slice(0, 2000);
  if (b.confirmed && typeof b.confirmed === 'object') {
    content.confirmed = Object.fromEntries(KEYS.map((k) => [k, !!b.confirmed[k]]));
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { content, updated_at: now };
  if (b.submit) {
    if (!KEYS.every((k) => content.confirmed?.[k])) throw new AppError(409, '모든 문단을 확인해줘.');
    patch.status = 'submitted';
    patch.submitted_at = now;
  }
  const { data, error } = await admin.from('ft_reports').update(patch).eq('student_id', st.id).select('content, status').single();
  if (error) throw error;
  return data;
});
