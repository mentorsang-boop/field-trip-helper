import { admin, AppError, serve } from '../_shared/common.ts';

// 학생 첫 화면용: 반·이름 목록만 (번호·기기 정보는 보내지 않음)
serve(async ({ trip_id, cp_id }) => {
  const { data: trip } = await admin.from('ft_trips').select('title, place, is_open').eq('id', trip_id).maybeSingle();
  if (!trip) throw new AppError(404, '체험학습을 찾을 수 없어요. QR을 다시 찍어줘.');

  const { data: students } = await admin.from('ft_students').select('id, class_no, name, device_id')
    .eq('trip_id', trip_id).order('class_no').order('number');

  let checkpoint = null;
  if (cp_id) {
    const { data } = await admin.from('ft_checkpoints').select('name, is_active')
      .eq('id', cp_id).eq('trip_id', trip_id).maybeSingle();
    checkpoint = data;
  }

  return {
    trip,
    checkpoint,
    students: (students ?? []).map((s) => ({ id: s.id, class_no: s.class_no, name: s.name, taken: !!s.device_id })),
  };
});
