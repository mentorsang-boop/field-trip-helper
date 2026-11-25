import { AppError, qrSecret, qrToken, serve, SLOT_MS, teacher } from '../_shared/common.ts';

// 교사 전용: 지금 30초 구간의 QR 토큰과 남은 시간(ms)
serve(async ({ cp_id }, req) => {
  const db = await teacher(req);
  const { data: cp } = await db.from('ft_checkpoints').select('id, trip_id').eq('id', cp_id).maybeSingle();
  if (!cp) throw new AppError(404, '체크포인트를 찾을 수 없어요.');

  const now = Date.now();
  const slot = Math.floor(now / SLOT_MS);
  return {
    trip_id: cp.trip_id,
    token: await qrToken(await qrSecret(cp.trip_id), cp.id, slot),
    expires_in: (slot + 1) * SLOT_MS - now,
  };
});
