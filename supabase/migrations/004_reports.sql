-- v0.9.0 : 보고서 생성 횟수 제한(하루 5회)용
alter table ft_reports
  add column gen_count int not null default 0,
  add column gen_day date;
