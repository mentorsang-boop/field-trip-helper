import { admin, serve, verifyStudent } from '../_shared/common.ts';

// 학생 홈 화면에 필요한 상태를 한 번에: 출석한 체크포인트, 미션별 사진(1시간 signed URL)
serve(async (b) => {
  const st = await verifyStudent(b);
  const [trip, checkins, missions, photos, finals, report] = await Promise.all([
    admin.from('ft_trips').select('title, is_open').eq('id', st.trip_id).single(),
    admin.from('ft_checkins').select('checkpoint_id').eq('student_id', st.id),
    admin.from('ft_missions').select('id, sort, emoji, title, guide').eq('trip_id', st.trip_id).order('sort'),
    admin.from('ft_photos').select('id, mission_id, storage_path, interview_done').eq('student_id', st.id).order('created_at'),
    admin.from('ft_interview').select('id', { count: 'exact', head: true }).eq('student_id', st.id).is('photo_id', null).not('answer', 'is', null),
    admin.from('ft_reports').select('content, status').eq('student_id', st.id).maybeSingle(),
  ]);

  const list = photos.data ?? [];
  const urls: Record<string, string> = {};
  if (list.length) {
    const { data } = await admin.storage.from('ft-photos').createSignedUrls(list.map((p) => p.storage_path), 3600);
    data?.forEach((d) => { if (d.path && d.signedUrl) urls[d.path] = d.signedUrl; });
  }

  return {
    trip: trip.data,
    checked: (checkins.data ?? []).map((c) => c.checkpoint_id),
    final_done: (finals.count ?? 0) >= 2,
    report: report.data,
    missions: (missions.data ?? []).map((m) => ({
      ...m,
      photos: list.filter((p) => p.mission_id === m.id)
        .map((p) => ({ id: p.id, url: urls[p.storage_path], interview_done: p.interview_done })),
    })),
  };
});
