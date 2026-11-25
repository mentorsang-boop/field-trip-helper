-- v1.0.0-rc2 : 교사 공용 비밀번호(해시만 저장)와 틀린 횟수 기록. 서버(Edge Function)만 접근
create table ft_settings (key text primary key, value text not null);
create table ft_login_fails (id bigint generated always as identity primary key, at timestamptz not null default now());
alter table ft_settings enable row level security;
alter table ft_login_fails enable row level security;
revoke all on ft_settings, ft_login_fails from anon, authenticated;

insert into ft_settings (key, value) values ('teacher_pin_hash', extensions.crypt('0000', extensions.gen_salt('bf')));

create function ft_check_pin(pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from ft_settings where key = 'teacher_pin_hash' and value = extensions.crypt(pin, value));
$$;
revoke execute on function ft_check_pin(text) from public, anon, authenticated;
grant execute on function ft_check_pin(text) to service_role;

-- 비밀번호 바꾸기 (SQL Editor에서 실행):
-- update ft_settings set value = extensions.crypt('새비밀번호', extensions.gen_salt('bf')) where key = 'teacher_pin_hash';
