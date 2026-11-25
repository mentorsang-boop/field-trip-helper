# 현장체험학습 도우미 v1.0.0-rc2

학생이 휴대폰으로 출석 → 미션 사진 → AI 인터뷰 → 결과보고서 제출까지 끝내는 웹앱.
v0.9.0 = 기능 완성, 실제 휴대폰 점검 전. 아래 점검표를 모두 통과하면 v1.0.0.

## 현재 배포 상태
- Supabase 프로젝트: `school-promo-booking` (다른 앱과 함께 쓰므로 테이블은 `ft_`, 함수는 `ft-`, 사진 버킷은 `ft-photos`로 구분)
- 테이블·RLS·버킷·Edge Functions 9개 적용 완료
- 교사 로그인: 비밀번호 하나(초기값 `0000`, 서버에 해시로만 저장, 10분에 10번 틀리면 잠금). 바꾸는 법은 `supabase/migrations/006_teacher_pin.sql` 맨 아래 참고
- 남은 설정: Supabase 대시보드 → Edge Functions → Secrets에 `ANTHROPIC_API_KEY` 등록

## 데모 모드 (서버 없이 미리 보기)
`config.js`에 실제 Supabase 주소를 넣기 전에는 자동으로 데모 모드로 열립니다. 가짜 서버(`js/mock.js`)가 이 브라우저에만 데이터를 저장하고, AI 대신 예시 질문이 나옵니다.
```bash
python3 -m http.server 5813
```
→ http://localhost:5813/teacher.html (아무 이메일·비밀번호로 로그인)

## 폴더 구조
```
index.html / js/student.js   학생 화면
teacher.html / js/teacher.js 교사 화면 (출결 현황, 명단, 제출 현황, 체험 설정, 마무리)
report.html / js/report.js   보고서 A4 인쇄 (?student=ID 한 명, ?trip=ID 전체)
js/sb.js                     Supabase 연결, 공통 도우미
css/style.css                색·글꼴 변수 (여기서만 바꾸면 전체 적용)
config.js                    Supabase URL / anon key / 버전
supabase/migrations/         001~004 SQL (번호 순서대로 실행)
supabase/functions/          Edge Functions 9개 + _shared
supabase/config.toml         함수 설정
```

## 설치 순서
1. supabase.com 새 프로젝트 (지역: Seoul)
2. SQL Editor에서 `supabase/migrations/001_init.sql` → `002` → `003` → `004` 순서로 붙여넣고 Run
3. Authentication → Users → Add user로 교사 계정 만들기
4. Project Settings → API의 Project URL, anon key를 `config.js`에 넣기
5. [Supabase CLI](https://supabase.com/docs/guides/cli) 설치 후 이 폴더에서:
   ```bash
   supabase login
   supabase link --project-ref 프로젝트ID
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy
   ```
   모델을 바꾸려면 `supabase secrets set CLAUDE_MODEL=모델이름` (기본 claude-sonnet-5-5)
6. GitHub 저장소에 올리고 Settings → Pages → Branch: main / root
   (위치 권한·기기 ID는 https에서만 동작하므로 반드시 Pages 주소로 사용)
7. `index.html`의 "[학기말]" 문구를 실제 삭제 시점으로 바꾸기

## 현장 사용 순서 (교사)
1. `teacher.html` 로그인 → 체험 설정(장소·일시·좌표·반경) → 명단 붙여넣기
2. 출결 현황 → 체크포인트 탭 → ▶ 체크 시작 → 📱 QR 띄우기 (30초마다 바뀜)
3. 폰이 없는 학생은 이름을 눌러 ✋ 수동 출석, 폰을 바꾼 학생은 기기 초기화
4. 귀교 후 제출 현황에서 진행률 확인 → 🖨 전체 보고서 인쇄 / ⬇ CSV
5. 체험 마무리 → 🔒 체험 종료 (학생 수정 잠금) → 학기말에 🗑 전체 삭제

## Edge Functions
| 이름 | 호출자 | 역할 |
|---|---|---|
| roster | 학생 | 반·이름 목록 |
| register-device | 학생 | 이름 ↔ 기기 묶기 (1:1) |
| checkin | 학생 | QR 토큰(60초)·기기·위치 검증 후 출석 |
| qr-token | 교사 | 30초 회전 토큰 |
| upload-url | 학생 | 사진 업로드 주소 발급 / 업로드 확인 / 삭제 |
| my-status | 학생 | 출석·사진·인터뷰·보고서 상태 |
| interview | 학생 | 사진별 질문(최대 3개, 분당 10회) + 마무리 질문 2개 |
| make-report | 학생 | 문답으로 보고서 생성 (하루 5회, 사진·실명 안 보냄) |
| save-report | 학생 | 문단 확인·수정·제출 |

## 점검표 (휴대폰 2대 이상, 모두 통과하면 v1.0.0)
- [ ] 학생이 QR을 찍고 이름을 고른 뒤 출석하기까지 15초 이내
- [ ] QR 사진을 찍어 1분 뒤 다른 폰으로 접속하면 "QR이 바뀌었어요"로 거부
- [ ] 같은 이름을 다른 폰에서 고르면 막힘 → 교사가 기기 초기화하면 다시 고를 수 있음
- [ ] 교사 현황판에 출석이 5초 안에 초록으로 반영
- [ ] 위치 권한을 거부해도 출석됨 (교사 화면에 "위치 없음")
- [ ] 반경 밖에서 출석하면 노란 칸 + 거리 표시
- [ ] 비행기 모드로 사진 올리기 → 빨간 카드·다시 올리기 → 재시도 성공
- [ ] 사진 4장 → 인터뷰 → 마무리 질문 → 보고서 생성, 학생이 말하지 않은 내용이 없음
- [ ] "모르겠어요"만 눌러도 오류 없이 짧은 보고서가 나옴
- [ ] 문단 4개를 모두 확인해야 제출 버튼이 켜짐
- [ ] `report.html`이 A4 한 장(최대 두 장)으로 인쇄됨, 전체 인쇄는 학생마다 페이지 나뉨
- [ ] CSV를 엑셀로 열었을 때 한글이 깨지지 않음
- [ ] 체험 종료 후 학생이 사진·인터뷰·보고서를 고칠 수 없음
- [ ] 전체 삭제 후 Storage의 사진도 지워짐

## 변경 기록
- v1.0.0-rc2 (2026-11-25) 교사 로그인을 이메일 없이 비밀번호 하나로 변경(서버 확인, 틀린 횟수 잠금)
- v1.0.0-rc1 (2026-11-25) 실제 Supabase(school-promo-booking)에 연결: ft_ 접두사로 다른 앱과 분리, 다른 앱 권한을 건드리던 SQL 수정, 사진 정책을 다른 앱 경로에서도 오류 없게 수정, QR 라이브러리를 jsdelivr로 변경
- v0.9.3 (2026-11-25) 디자인 전면 교체: 엑셀 느낌(초록 머리줄, 눈금선 표, 각진 모서리, Noto Sans KR), 이모지 장식 제거, 미션 번호 표시, 진행 단계는 지금 할 일 하나만 강조
- v0.9.2 (2026-11-25) 엑셀(.xlsx) 명단을 올리면 바로 등록(반·번호·이름 / 학번·이름 자동 인식, 끌어다 놓기), 명단 보기·전체 지우기, 교사가 미션 카드 수정·추가·삭제, 기본 4번 미션을 "직접 해본 것"으로 변경
- v0.9.1 (2026-11-25) 데모 모드 추가, 화면에 "false"가 보이던 문제와 보고서 문단이 "[object …]"로 보이던 문제 수정
- v0.9.0 (2026-11-25) AI 인터뷰(채팅·선택지·직접 쓰기·마무리 질문), 보고서 생성·확인·수정·제출, A4 인쇄, 제출 현황, CSV, 체험 종료, 전체 삭제, 점검표
- v0.4.0 (2026-11-25) 미션 사진: 압축, signed URL 업로드, 썸네일, 다시 올리기, 지우기
- v0.3.0 (2026-11-25) 출결 MVP: 교사 로그인, 명단, 회전 QR, 학생 출석, 현황판, 수동 출석, 기기 초기화
- v0.2.0 (2026-11-25) 기초 세팅: 폴더 구조, config.js, DB 마이그레이션
- v0.1.0 (2026-11-25) 디자인 시안
