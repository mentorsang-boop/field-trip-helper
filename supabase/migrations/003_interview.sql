-- v0.5.0 : 사진별 인터뷰 끝남 표시
alter table ft_photos add column interview_done boolean not null default false;
create index on ft_interview (student_id, created_at);
