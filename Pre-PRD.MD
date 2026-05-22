# Pre-PRD — 학급 RPG · STATUS (웹앱)

**문서 목적:** 다른 환경(예: 다른 Cursor 계정)에서 **이 MD만** 분석해 동일한 기능·**동일한 비주얼 톤**으로 페이지를 재구현할 수 있게 하는 사전 PRD이다.  
**문서 버전:** 1.0 · **기준 구현일:** 2026-03-22  

---

## 1. 제품 한 줄

**6학년 학급 운영**을 게임형(STATUS·LV·칭호·Calory·EXP)으로 관리하는 **클라이언트 전용 웹앱**(로컬 스토리지). 선생님은 기록·조정·디지털 칠판, 학생은 본인 STATUS만 본다.

---

## 2. 범위 (반드시 포함)

| 구분 | 내용 |
|------|------|
| 저장소 | 브라우저 `localStorage` 단일 JSON (서버 없음) |
| 인증 | **별도 로그인 화면 없음.** 첫 DB에 있는 **선생님 계정으로 자동 세션** (후속으로 선생/학생 분리 로그인 추가 예정) |
| 선생님 | 대시보드, **디지털 칠판(TV 레이아웃)**, 학생 목록·추가·상세·삭제(단일/일괄), 엑셀 일괄 등록, 일괄 EXP/LV 조정, 행동발달특성 기록 |
| 학생 | 본인 LV·칭호·Calory·EXP·최근 활동(STATUS 보드) |

---

## 3. 비범위 (초기 버전)

- 구글 시트 동기화, 학부모 계정, 푸시·네이티브 앱  
- 서버/API 백엔드 (급식·날씨는 **브라우저에서 외부 공개 API** 호출만)

---

## 4. 사용자·역할

| 역할 | 권한 |
|------|------|
| **teacher** | 전 학생 데이터, 디지털 칠판, 일괄 조정, 행동발달특성(전부) |
| **student** | **본인** 데이터만. 타 학생·행동발달특성 메뉴 없음 |

**세션 객체 (예시 필드):** `userId`, `role` (`teacher` \| `student`), `studentId` (학생일 때), `displayName`  

---

## 5. 정보 구조 (IA) · 라우팅

- **해시 라우터** 사용: `#/teacher/...`, `#/student`  
- **선생님 기본:** `#/teacher` 또는 `#/teacher/dashboard` → 대시보드  
- **선생님 메뉴:** 대시보드, 디지털 칠판, 학생 목록, 일괄 조정, 행동발달특성  
- **학생:** `#/student` 고정 (다른 경로 시 `#/student`로 교정)

**주요 경로**

- `#/teacher` — 대시보드  
- `#/teacher/board` — 디지털 칠판  
- `#/teacher/students` — 학생 목록(카드 그리드)  
- `#/teacher/students/new` — 학생 추가  
- `#/teacher/students/:id` — 학생 상세  
- `#/teacher/students/:id/status` — 해당 학생 STATUS 보드(선생)  
- `#/teacher/bulk` — 일괄 조정  
- `#/teacher/behavior` — 행동발달 목록  
- `#/teacher/behavior/:id` — 학생별 행동 기록  
- `#/student` — 학생 본인 화면  

---

## 6. 기능 요구사항 (상세)

### 6.1 진입·세션

- **FR-1:** 루트 `index.html`은 로그인 폼을 두지 않고 **앱(`app/index.html`)으로 리다이렉트**하며, `ensureDb()`로 DB 존재를 보장한다.  
- **FR-2:** 세션이 없으면 로컬 DB에서 **역할이 `teacher`인 사용자**를 찾아 자동으로 `setSession`한다. (데모 계정: `teacher` / `demo123` — 최초 DB 시드에 포함)  
- **FR-3:** 로그아웃은 세션 클리어 후 루트로 이동 → 다시 자동 선생 세션으로 진입 가능.

### 6.2 선생님 대시보드

- 등록 학생 수, 최근 7일 활동 건수 등 **간단 지표 카드**  
- 디지털 칠판·학생 목록·일괄 조정 **바로가기 버튼**  
- 행동발달특성 안내 문구 (링크)

### 6.3 디지털 칠판 (핵심 화면)

- **TV 레이아웃:** 왼쪽 학생 명단·활동, 가운데 시계·날씨·시간표·급식, 오른쪽 설정·달력·To-Do·알림장  
- **학생 활동:** 교시/일별 집계가 **매일 오전 8시**를 기준으로 바뀜 (`boardDateKey`와 동일 규칙).  
- **시간표:** 각 교시(아침+1~6교시)마다 **과목(짧은 입력)** + **수업 및 활동 내용** 입력  
- **오늘의 급식:** 나이스(NEIS) 급식 API — **API 키·시도교육청코드·학교코드**는 **8시 리셋 대상 아님** (유지)  
- **날씨:** Open-Meteo (위도·경도) + 미세먼지 보조 API  
- **오른쪽 달력:** 날짜별 메모(체크리스트) — **8시 리셋 대상 아님**  
- **To-Do 리스트** — **8시 리셋 대상 아님**  
- **오늘의 알림장:** 텍스트 + 확대 모달 + 글자 크기 조절 — **내용(텍스트)은 매일 8시 집계일이 바뀔 때 비움** (글자 크기 설정은 유지)  
- **매일 8시 집계 경계가 바뀔 때:**  
  - **비움:** 시간표 전체(과목·활동), 알림장 본문  
  - **유지:** 급식 API 필드, 날씨 좌표, 달력 메모, To-Do, 학생 활동 집계는 날짜 키별로만 관리(기존 로직)  
- 구현 시 `digitalBoard.dailyContentKey`로 “이번 집계일에 맞춰 저장된 칸인지”를 구분하고, 집계일이 바뀌면 시간표·알림장만 초기화.

### 6.4 학생 목록·등록

- **카드 그리드:** 번호·이름, LV, Calory, EXP 바(세그먼트), 체크박스(일괄 선택)  
- **학생 추가·엑셀 일괄 등록** (양식 다운로드, XLSX 업로드)  
- **단일 삭제** (카드 버튼), **선택 일괄 삭제**  
- 삭제 시 학생·연계된 user·로그·칭호·행동기록·**디지털 칠판 일별 활동 키** 등에서 해당 `studentId` 제거

### 6.5 학생 상세·STATUS

- EXP/LV/Calory/쿠폰 등 편집, 활동 로그, 칭호  
- **STATUS 보드:** 선생/학생 모드에 따라 표시 범위 차이(학생은 EXP 상승 활동만 등)

### 6.6 일괄 조정

- 선택 학생에 EXP 가감, LV 가감/지정, 사유 필수, `bulkAdjustments`에 작업 메타, 활동 로그에 `bulkJobId` 연결

### 6.7 행동발달특성

- 학생별 목록·기록·수정, 작성자·시각 메타

---

## 7. 데이터 모델 (엔티티 수준)

- **User:** id, loginId, passwordHash, salt, role, displayName, studentId?  
- **Student:** id, name, number, gender, lv, exp, calory, coupons  
- **TitleGrant:** studentId, titleText, acquiredAt  
- **ActivityLog:** studentId, occurredAt, summary, expDelta, bulkJobId?  
- **BulkAdjustment:** id, createdAt, createdByUserId, type, summary  
- **BehaviorNote:** id, studentId, body, authorUserId, createdAt, updatedAt  
- **digitalBoard** (nested): timetable(아침+p1~p6: subject/activity), mealApi, weather, todos, notice, noticeFontPx, boardActivity(날짜키→학생id→수), calendarMemos, dailyContentKey, mealManual(선택)  

---

## 8. 비기능

- 비밀번호 평문 저장 금지 (SHA-256 + salt)  
- 학급 수십 명 기준 즉시 반응  
- 디지털 칠판은 **클래스 `app-body--digital-board`**로 전체 레이아웃 전환  

---

## 9. 디자인 방향 (반드시 준수)

- **다크 네이비·블루 그라데이션** 배경, **시안 앰버(`accent`)** + **골드(`gold`)** 포인트  
- **카드형 패널**, 둥근 pill 네비·버튼, **그림자·얇은 테두리**  
- **구체 수치·색상·폰트 스택은 `프로그램초안설명서.MD`의 CSS 변수·클래스명을 그대로 따를 것**  

---

## 10. 수용 기준 (체크리스트)

- [ ] 로그인 페이지 없이 앱 진입 시 선생님 화면까지 동작  
- [ ] 디지털 칠판 레이아웃·시계·날씨·시간표·급식·달력·To-Do·알림장이 동일한 정보 구조로 동작  
- [ ] 8시 경계에서 시간표·알림장만 초기화되고 급식 키·달력·To-Do는 유지  
- [ ] 학생 CRUD·엑셀·일괄 조정·행동발달·학생 STATUS가 PRD와 연결됨  
- [ ] 시각 스타일이 **프로그램초안설명서**의 토큰·컴포넌트와 일치  

---

## 11. 참고

- 세부 PRD·용어는 `PRD.md`와 병행 가능하나, **구현과 충돌 시 이 Pre-PRD + 프로그램초안설명서를 우선**한다.  
- 외부 API: **Open-Meteo**, **NEIS 급식 Open API** (CORS 이슈 시 문서에 명시).

---

*문서 끝*
