import { admin, AppError, serve } from '../_shared/common.ts';

const TAKEN = '다른 폰에 등록된 이름이에요. 선생님께 말해주세요.';

// 한 학생 = 한 기기, 한 기기 = 한 학생
serve(async ({ trip_id, student_id, device_id }) => {
  if (!trip_id || !student_id || !device_id) throw new AppError(400, '정보가 부족해요. QR을 다시 찍어줘.');

  const { data: s } = await admin.from('ft_students').select('id, device_id')
    .eq('id', student_id).eq('trip_id', trip_id).maybeSingle();
  if (!s) throw new AppError(404, '명단에 없는 이름이에요. 선생님께 말해주세요.');
  if (s.device_id === device_id) return { ok: true };
  if (s.device_id) throw new AppError(409, TAKEN);

  const { data: other } = await admin.from('ft_students').select('name')
    .eq('trip_id', trip_id).eq('device_id', device_id).maybeSingle();
  if (other) throw new AppError(409, `이 폰은 이미 '${other.name}' 이름으로 등록돼 있어요. 선생님께 말해주세요.`);

  // device_id가 비어 있을 때만 묶는다 (두 폰이 동시에 골라도 하나만 성공)
  const { data: upd } = await admin.from('ft_students').update({ device_id })
    .eq('id', student_id).is('device_id', null).select('id');
  if (!upd?.length) throw new AppError(409, TAKEN);
  return { ok: true };
});
