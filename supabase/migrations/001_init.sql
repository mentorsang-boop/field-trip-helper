-- 현장체험학습 도우미 v0.2.0 : 테이블, RLS, 기본 데이터, 사진 버킷

-- ===== 테이블 =====
create table ft_trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  place text,
  starts_at timestamptz,
  ends_at timestamptz,
  lat double precision,
  lng double precision,
  radius_m int not null default 300,
  is_open boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

-- QR 비밀키는 교사도 읽지 못하게 별도 테이블에 둔다 (Edge Function만 접근)
create table ft_trip_secrets (
  trip_id uuid primary key references ft_trips(id) on delete cascade,
  qr_secret text not null default encode(extensions.gen_random_bytes(32), 'hex')
);

create table ft_checkpoints (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references ft_trips(id) on delete cascade,
  name text not null,
  sort int not null default 0,
  is_active boolean not null default false
);

create table ft_students (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references ft_trips(id) on delete cascade,
  class_no text not null,
  number int,
  name text not null,
  device_id text
);

create table ft_checkins (
  id uuid primary key default gen_random_uuid(),
  checkpoint_id uuid not null references ft_checkpoints(id) on delete cascade,
  student_id uuid not null references ft_students(id) on delete cascade,
  checked_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  distance_m int,
  method text not null check (method in ('qr', 'manual')),
  unique (checkpoint_id, student_id)
);

create table ft_missions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references ft_trips(id) on delete cascade,
  sort int not null default 0,
  emoji text,
  title text not null,
  guide text,
  report_section text
);

create table ft_photos (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references ft_students(id) on delete cascade,
  mission_id uuid not null references ft_missions(id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table ft_interview (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references ft_students(id) on delete cascade,
  photo_id uuid references ft_photos(id) on delete set null,
  turn int not null,
  question text not null,
  choices jsonb,
  answer text,
  created_at timestamptz not null default now()
);

create table ft_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references ft_students(id) on delete cascade,
  content jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

create index on ft_checkpoints (trip_id);
create index on ft_students (trip_id);
create index on ft_checkins (student_id);
create index on ft_missions (trip_id);
create index on ft_photos (student_id);
create index on ft_photos (mission_id);
create index on ft_interview (student_id);

-- ===== 새 체험을 만들면 비밀키 + 기본 체크포인트 3개 + 미션 4개 자동 생성 =====
create function ft_on_trip_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into ft_trip_secrets (trip_id) values (new.id);
  insert into ft_checkpoints (trip_id, name, sort) values
    (new.id, '출발', 1), (new.id, '현장 도착', 2), (new.id, '해산', 3);
  insert into ft_missions (trip_id, sort, emoji, title, guide, report_section) values
    (new.id, 1, '📍', '도착한 곳', '도착해서 처음 본 장소를 찍어요', '장소 소개'),
    (new.id, 2, '🔧', '일하는 모습', '장비, 작업 과정, 일하는 사람을 찍어요', '활동 내용'),
    (new.id, 3, '⭐', '기억에 남는 장면', '오늘 가장 인상 깊은 순간', '느낀 점'),
    (new.id, 4, '🙋', '직접 해본 것', '내가 직접 만져보거나 해본 것을 찍어요', '체험 활동');
  return new;
end $$;

create trigger ft_trip_created after insert on ft_trips
  for each row execute function ft_on_trip_created();

-- ===== RLS: anon은 전부 막고, 교사는 자기 체험 데이터만 =====
create function ft_is_trip_owner(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ft_trips where id = t and created_by = auth.uid());
$$;

create function ft_student_trip(s uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select trip_id from ft_students where id = s;
$$;

alter table ft_trips        enable row level security;
alter table ft_trip_secrets enable row level security;  -- 정책 없음 = 서버 전용
alter table ft_checkpoints  enable row level security;
alter table ft_students     enable row level security;
alter table ft_checkins     enable row level security;
alter table ft_missions     enable row level security;
alter table ft_photos       enable row level security;
alter table ft_interview    enable row level security;
alter table ft_reports      enable row level security;

create policy teacher_all on ft_trips for all to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy teacher_all on ft_checkpoints for all to authenticated
  using (ft_is_trip_owner(trip_id)) with check (ft_is_trip_owner(trip_id));
create policy teacher_all on ft_students for all to authenticated
  using (ft_is_trip_owner(trip_id)) with check (ft_is_trip_owner(trip_id));
create policy teacher_all on ft_missions for all to authenticated
  using (ft_is_trip_owner(trip_id)) with check (ft_is_trip_owner(trip_id));
create policy teacher_all on ft_checkins for all to authenticated
  using (ft_is_trip_owner(ft_student_trip(student_id))) with check (ft_is_trip_owner(ft_student_trip(student_id)));
create policy teacher_all on ft_photos for all to authenticated
  using (ft_is_trip_owner(ft_student_trip(student_id))) with check (ft_is_trip_owner(ft_student_trip(student_id)));
create policy teacher_all on ft_interview for all to authenticated
  using (ft_is_trip_owner(ft_student_trip(student_id))) with check (ft_is_trip_owner(ft_student_trip(student_id)));
create policy teacher_all on ft_reports for all to authenticated
  using (ft_is_trip_owner(ft_student_trip(student_id))) with check (ft_is_trip_owner(ft_student_trip(student_id)));

-- 이 프로젝트에는 다른 앱도 있으므로 ft_ 테이블에만 적용
revoke all on ft_trips, ft_trip_secrets, ft_checkpoints, ft_students, ft_checkins, ft_missions, ft_photos, ft_interview, ft_reports from anon;
revoke all on ft_trip_secrets from authenticated;
revoke execute on function ft_is_trip_owner(uuid), ft_student_trip(uuid), ft_on_trip_created() from anon, public;
grant execute on function ft_is_trip_owner(uuid), ft_student_trip(uuid) to authenticated;

-- 교사 현황판 실시간 갱신용
alter publication supabase_realtime add table ft_checkins;

-- ===== 사진 버킷 (private). 경로: {trip_id}/{student_id}/{파일명} =====
insert into storage.buckets (id, name, public) values ('ft-photos', 'ft-photos', false);

-- 다른 앱의 사진 경로에서 오류가 나지 않도록 uuid로 바꾸지 않고 글자로 비교
create policy ft_teacher_read_photos on storage.objects for select to authenticated
  using (bucket_id = 'ft-photos' and exists (select 1 from ft_trips t where t.id::text = (storage.foldername(name))[1] and t.created_by = auth.uid()));
create policy ft_teacher_delete_photos on storage.objects for delete to authenticated
  using (bucket_id = 'ft-photos' and exists (select 1 from ft_trips t where t.id::text = (storage.foldername(name))[1] and t.created_by = auth.uid()));
