import { admin, AppError, serve, verifyStudent } from '../_shared/common.ts';

const BUCKET = 'ft-photos';
const MAX_PER_MISSION = 2;

// action 없음: 업로드용 signed URL 발급
// action 'done': 실제로 올라갔는지 확인하고 photos 행 생성
// action 'delete': 내 사진 지우기
serve(async (b) => {
  const st = await verifyStudent(b);
  const { data: trip } = await admin.from('ft_trips').select('is_open').eq('id', st.trip_id).single();
  if (!trip!.is_open) throw new AppError(403, '체험이 끝나서 더 올리거나 지울 수 없어요.');

  if (b.action === 'delete') {
    const { data: p } = await admin.from('ft_photos').select('id, storage_path')
      .eq('id', b.photo_id).eq('student_id', st.id).maybeSingle();
    if (!p) throw new AppError(404, '사진을 찾을 수 없어요.');
    await admin.storage.from(BUCKET).remove([p.storage_path]);
    await admin.from('ft_photos').delete().eq('id', p.id);
    return { ok: true };
  }

  const { data: m } = await admin.from('ft_missions').select('id')
    .eq('id', b.mission_id).eq('trip_id', st.trip_id).maybeSingle();
  if (!m) throw new AppError(404, '미션을 찾을 수 없어요.');
  const prefix = `${st.trip_id}/${st.id}/${m.id}/`;

  if (b.action === 'done') {
    const path = String(b.path ?? '');
    const name = path.slice(prefix.length);
    if (!path.startsWith(prefix) || !name || name.includes('/')) throw new AppError(400, '사진 정보가 이상해요. 다시 올려줘.');

    const { data: files } = await admin.storage.from(BUCKET).list(prefix.slice(0, -1), { search: name });
    if (!files?.some((f) => f.name === name)) throw new AppError(409, '사진이 아직 안 올라갔어요. 다시 올려줘.');

    let { data: photo, error } = await admin.from('ft_photos')
      .insert({ student_id: st.id, mission_id: m.id, storage_path: path }).select('id').single();
    if (error?.code === '23505') {
      ({ data: photo } = await admin.from('ft_photos').select('id').eq('storage_path', path).single());
    } else if (error) throw error;

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
    return { id: photo!.id, url: signed?.signedUrl };
  }

  const { count } = await admin.from('ft_photos').select('id', { count: 'exact', head: true })
    .eq('student_id', st.id).eq('mission_id', m.id);
  if ((count ?? 0) >= MAX_PER_MISSION) throw new AppError(409, `미션마다 사진은 ${MAX_PER_MISSION}장까지예요.`);

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(prefix + crypto.randomUUID() + '.jpg');
  if (error) throw error;
  return { path: data.path, token: data.token };
});
