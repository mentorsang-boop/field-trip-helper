import { admin, AppError, qrSecret, qrToken, serve, SLOT_MS, verifyStudent } from '../_shared/common.ts';

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

serve(async (b) => {
  const st = await verifyStudent(b);

  const { data: cp } = await admin.from('ft_checkpoints').select('id, name, is_active')
    .eq('id', b.cp_id).eq('trip_id', st.trip_id).maybeSingle();
  if (!cp) throw new AppError(404, 'QR을 다시 찍어줘.');

  const { data: done } = await admin.from('ft_checkins').select('checked_at')
    .eq('checkpoint_id', cp.id).eq('student_id', st.id).maybeSingle();
  if (done) return { already: true, checked_at: done.checked_at, cp_name: cp.name };

  if (!cp.is_active) throw new AppError(409, `지금은 '${cp.name}' 체크 시간이 아니에요.`);

  // 현재 30초 구간과 직전 구간 토큰만 인정 (최대 60초)
  const secret = await qrSecret(st.trip_id);
  const slot = Math.floor(Date.now() / SLOT_MS);
  const valid = typeof b.token === 'string' &&
    (b.token === await qrToken(secret, cp.id, slot) || b.token === await qrToken(secret, cp.id, slot - 1));
  if (!valid) throw new AppError(410, 'QR이 바뀌었어요. 선생님 화면의 QR을 다시 찍어줘.');

  const { data: trip } = await admin.from('ft_trips').select('lat, lng, radius_m').eq('id', st.trip_id).single();
  const lat = typeof b.lat === 'number' ? b.lat : null;
  const lng = typeof b.lng === 'number' ? b.lng : null;
  const distance_m = lat != null && lng != null && trip!.lat != null && trip!.lng != null
    ? distanceM(lat, lng, trip!.lat, trip!.lng) : null;

  const { data: row, error } = await admin.from('ft_checkins')
    .insert({ checkpoint_id: cp.id, student_id: st.id, lat, lng, distance_m, method: 'qr' })
    .select('checked_at').single();
  if (error?.code === '23505') return { already: true, checked_at: new Date().toISOString(), cp_name: cp.name };
  if (error) throw error;

  return { checked_at: row.checked_at, cp_name: cp.name, distance_m, outside: distance_m != null && distance_m > trip!.radius_m };
});
