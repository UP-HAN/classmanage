# 학급관리 웹앱 PRD (Product Requirements Document)

**문서 버전:** 2.0  
**작성일:** 2026-03-22 (v1.0) → 2026-05-19 (v2.0 업데이트)  
**프로젝트명:** 학급 RPG · STATUS 관리 웹앱  

---

## 1. 개요

### 1.1 목적

6학년 학급 운영을 **게임형(STATUS·LV·칭호·화폐·경험치·직업)** 개념과 연동하여, **선생님은 기록·조정·관찰**을, **학생은 본인 상태 확인 및 직업별 역할 수행**을 할 수 있는 **학급관리 웹앱**의 요구사항을 정의한다.

### 1.2 범위 (v2.0 기준)

- **MVP 기능:** 로그인, 역할(선생/학생), 대시보드, 학생·상태 데이터, 일괄 조정, 행동발달특성 기록(선생 전용).
- **확장 기능 (구현 완료):** 1인1역 직업 시스템(16종), 은행 주급, 국세 징수, 쿠폰 상점, 청소 체크리스트, 통계청 체크리스트, 우체부 심부름, 디지털 칠판(TV 레이아웃), 매일 자동 EXP 성장, 학생 아바타 시스템.
- **데이터 저장:** localStorage + Firebase Firestore 실시간 양방향 동기화.
- **배포:** Firebase Hosting (정적 파일).

### 1.3 비범위 (후속 검토 대상)

- 구글 시트와의 실시간 양방향 동기화.
- 학부모 전용 계정·열람.
- 푸시 알림·모바일 네이티브 앱 (반응형 웹은 기본 지원).
- 다중 학급 관리 (현재 1학급 단일 DB).

---

## 2. 사용자·권한

### 2.1 역할

| 역할 | 설명 |
|------|------|
| **선생님** | 학급 전체 데이터 조회·편집, 일괄 조정, 행동발달특성 기록, 디지털 칠판 운영, 직업 배정·관리, 각종 승인 처리. |
| **학생** | 본인 LV·칭호·Calory·EXP·최근 활동 조회, **직업별 전용 기능** 수행 (은행원: 주급 지급, 국세직원: 세금 징수, 통계원: 체크리스트, 청소부: 체크리스트, 쿠폰상인: 상품 등록, 우체부: 심부름 등). |

### 2.2 인증

| 모드 | 선생님 | 학생 |
|------|--------|------|
| **Firebase (클라우드)** | 이메일/비밀번호 (Firebase Auth) | 이름 + 4자리 PIN → 익명 로그인 후 학급 DB 공유 |
| **로컬 전용** | `teacher` / `demo123` | 이름 + 4자리 PIN |

- 세션: `sessionStorage` 기반. 로그아웃 시 세션 클리어 후 로그인 화면.
- 학생 첫 로그인 시 PIN 변경 강제 (`pinMustChange: true`).

### 2.3 데이터 접근 정책

- **선생님:** 전 학생 목록, 모든 데이터 읽기/쓰기, 모든 승인 처리.
- **학생:** 본인 프로필·본인 활동 로그·본인 직업 기능만. 타 학생 상세 데이터 접근 불가.

---

## 3. 기능 요구사항

### 3.1 랜딩·로그인

- **FR-L1:** 앱 최초 진입 시 선생님/학생 이중 로그인 화면 표시.
- **FR-L2:** 인증 성공 시 역할에 따라 **선생님 모드** 또는 **학생 모드** 대시보드로 이동.
- **FR-L3:** Firebase 모드에서 학생은 **익명 로그인** 후 `teacherFirestoreUid` 경로의 학급 DB를 공유.

---

### 3.2 기본 대시보드

**선생님 모드**

- **FR-TD1:** 학급 요약(학생 수, 최근 7일 활동 건수 등 간단 지표).
- **FR-TD2:** 디지털 칠판·학생 목록·일괄 조정 바로가기 버튼.
- **FR-TD3:** 행동발달특성사항 메뉴 진입점.
- **FR-TD4:** 1인1역 관리, 쿠폰상점, 통계청 등 각종 관리 메뉴 진입.

**학생 모드**

- **FR-SD1:** 본인 LV·칭호·Calory·EXP(0~100% 바)를 한 화면에서 요약.
- **FR-SD2:** 최근 주요 활동(EXP/Calory 변동) 목록.
- **FR-SD3:** 본인 직업에 따른 전용 기능 패널 (은행원: 주급, 국세직원: 징수 등).

---

### 3.3 학생 목록·등록 (선생님 모드)

- **FR-SL1:** 카드 그리드 형태로 학생 목록 표시 (번호·이름·LV·Calory·EXP 바·체크박스).
- **FR-SL2:** 학생 추가 (단일) 및 **엑셀 일괄 등록** (XLSX 양식 다운로드 → 업로드).
- **FR-SL3:** 학생 상세 편집 (개별 정보, LV/EXP/Calory/쿠폰 수정, 칭호 관리).
- **FR-SL4:** 단일 삭제, **선택 일괄 삭제** (연계 데이터 전부 정리).
- **FR-SL5:** **엑셀 일괄 업데이트** (번호 기준 매칭, LV·EXP·Calory·직업·칭호 등 반영).
- **FR-SL6:** **학생 상세 엑셀 내보내기** (현재 전체 데이터 다운로드).

---

### 3.4 LV·칭호·화폐(Calory)·경험치

- **FR-STAT1:** 각 학생에 대해 **LV**를 저장·표시.
- **FR-STAT2:** **칭호**를 다수 보유 가능, 획득일과 함께 목록으로 표시.
- **FR-STAT3:** **화폐(Calory)** 잔액 저장·표시.
- **FR-STAT4:** **경험치(EXP)** 0~100 스케일. 활동과 연결된 증감 이력.
- **FR-STAT5:** **소지 쿠폰** 수량 관리 (기본 쿠폰 + 쿠폰상점 구매 쿠폰).

---

### 3.5 최근 주요 활동 (경험치 연동)

- **FR-ACT1:** EXP/Calory 변동 시 활동 유형/설명 기록.
- **FR-ACT2:** 선생님은 학생별 최근 활동 목록 조회, **개별 삭제 시 수치 되돌림**.
- **FR-ACT3:** 학생은 본인 최근 활동 목록만 조회.
- **FR-ACT4:** 목록에 최소 일시·활동 요약·EXP 변동량·Calory 변동량 포함.
- **FR-ACT5:** **전체 활동 로그 일괄 삭제** 기능 (수치 되돌림 포함).

---

### 3.6 경험치·LV 동시 조정 (선생님 모드)

- **FR-BULK1:** 여러 학생 선택 후 EXP 동일 값 가감.
- **FR-BULK2:** 여러 학생 선택 후 LV 동일 값 가감/설정.
- **FR-BULK3:** 일괄 조정 시 활동 사유 필수 기록, `bulkJobId`로 이력 연결.

---

### 3.7 행동발달특성사항 (선생님 전용 메뉴)

- **FR-BEH1:** 선생님 모드 전용 별도 메뉴.
- **FR-BEH2:** 학생 단위로 작성·수정·조회.
- **FR-BEH3:** 작성자·시각 메타데이터.
- **FR-BEH4:** 학생 모드에서 접근 불가.

---

### 3.8 디지털 칠판 (TV 레이아웃) ⭐

- **FR-DB1:** 3단 레이아웃 — 좌: 학생 명단·활동, 중앙: 시계·날씨·시간표·급식, 우: 설정·달력·To-Do·알림장.
- **FR-DB2:** 학생 활동 집계는 **오전 7시 기준** `boardDateKey()`로 하루 전환.
- **FR-DB3:** 시간표: 아침활동 + 1~6교시, 각각 과목·수업 내용 입력.
- **FR-DB4:** 급식: NEIS 급식 API + 수동 입력.
- **FR-DB5:** 날씨: Open-Meteo API (기온·날씨코드·강수확률·미세먼지).
- **FR-DB6:** 달력: 날짜별 메모(체크리스트). 7시 리셋 대상 아님.
- **FR-DB7:** To-Do 리스트. 7시 리셋 대상 아님.
- **FR-DB8:** 알림장: 텍스트 + 확대 모달 + 글자 크기 조절. **내용만 7시에 초기화**.
- **FR-DB9:** **매일 오전 7시 집계 경계:**
  - 비움: 시간표 전체(과목·활동), 알림장 본문.
  - 유지: 급식 API 필드, 날씨 좌표, 달력 메모, To-Do, 학생 활동 집계(날짜키별).
- **FR-DB10:** `body.app-body--digital-board` 클래스로 전체 레이아웃 확장.

---

### 3.9 1인1역 직업 시스템 ⭐

- **FR-JOB1:** 16종 직업 정의:

| ID | 직업명 | 아이콘 | 비고 |
|----|--------|--------|------|
| `bank_m` | 은행(남) | 🏦 | 남학생 대상 주급 지급 |
| `bank_f` | 은행(여) | 🏦 | 여학생 대상 주급 지급 |
| `statistician` | 통계원 | 📊 | 통계청 체크리스트 관리 |
| `tax_m` | 국세직원(남) | 🧾 | 남학생 대상 세금 징수 |
| `tax_f` | 국세직원(여) | 🧾 | 여학생 대상 세금 징수 |
| `postman` | 우체부 | 📮 | 심부름 요청 처리 |
| `cleaner` | 청소부 | 🧹 | 청소 체크리스트 (수/금) |
| `recycler` | 분리수거부 | ♻️ | |
| `env` | 환경부 | 🌿 | |
| `handyman` | 다재다능이 | ⭐ | |
| `line` | 줄관리원 | 📏 | |
| `air` | 공기청정위원 | 🌬️ | |
| `coupon_merchant` | 쿠폰상인 | 🎫 | 쿠폰 상품 등록·판매 |
| `store_merchant` | 매점상인 | 🏪 | |
| `dj` | DJ | 🎧 | |
| `credit` | 신용평가위원 | 📈 | |

- **FR-JOB2:** 직업별 인원 한도 (`classJobQuotas`). 선생님이 조정 가능.
- **FR-JOB3:** 선생님이 학생 상세에서 직업 배정/변경.
- **FR-JOB4:** 엑셀 일괄 등록/업데이트에서 직업 반영.

---

### 3.10 은행원 주급 시스템

- **FR-BANK1:** 은행원(남)은 남학생에게, 은행원(여)는 여학생에게 주급 지급.
- **FR-BANK2:** 교차 지급: 은행(남) ↔ 은행(여) 상호 지급 가능.
- **FR-BANK3:** 주급 요청 → 선생님 승인 → Calory 지급 + 활동 로그.
- **FR-BANK4:** `bankPayrollRequests` 컬렉션으로 요청·승인 이력 관리.

---

### 3.11 국세직원 세금 징수

- **FR-TAX1:** 국세직원(남)은 남학생, 국세직원(여)는 여학생 대상 징수.
- **FR-TAX2:** 주급 기준 금액의 **10% 자동 계산** (내림).
- **FR-TAX3:** 징수 요청 → 선생님 승인 → Calory 차감 + 국고 적립.
- **FR-TAX4:** 국고 총액 = 승인된 징수 합계 + 쿠폰상점 매출. 수동 오버라이드 가능.

---

### 3.12 쿠폰 상점

- **FR-COUPON1:** 쿠폰상인이 상품(이름·가격·수량) 등록 → 선생님 승인.
- **FR-COUPON2:** 승인된 상품은 전체 학생이 구매 가능 (Calory 차감).
- **FR-COUPON3:** 구매 시 국고에 매출 적립, 학생에게 쿠폰 지급.
- **FR-COUPON4:** 학생별 보유 쿠폰 관리 (`couponShop.holdings`).

---

### 3.13 청소 체크리스트

- **FR-CLEAN1:** 수요일·금요일에만 작성 가능.
- **FR-CLEAN2:** 4개 구역, 청소부 학생이 각 구역에 서명.
- **FR-CLEAN3:** 요주의 자리 최대 3명 지정.
- **FR-CLEAN4:** 전 구역 서명 완료 후 선생님께 승인 요청 → 인센티브 Calory 지급.

---

### 3.14 통계청 체크리스트

- **FR-STATS1:** 1주(주간) 기간 단위로 운영. 날짜별 + 주간 점수 관리.
- **FR-STATS2:** 디지털 칠판 학생 활동 수치를 기본값으로 자동 반영.
- **FR-STATS3:** 통계원(학생)이 보정 → 선생님 승인 요청 → 승인 시 EXP 반영.
- **FR-STATS4:** 점수 +1당 EXP +20%p, -1당 EXP -10%p.

---

### 3.15 칭호 상점

- **FR-TITLE1:** 교사 및 학생 모두 칭호 제안 가능 (교사 등록은 즉시 판매, 학생 제안은 교사 승인 후 판매 시작).
- **FR-TITLE2:** 제안할 수 있는 칭호의 길이는 공백 포함 최대 12글자 제한.
- **FR-TITLE3:** 칭호 기본 구매 가격은 100 Calory로 고정.
- **FR-TITLE4:** 구매 옵션으로 "글자 색깔 변경" (+50 Calory), "색깔 및 배경 변경" (+100 Calory) 지원. 구매자가 컬러 피커를 통해 실시간 preview 확인 가능.
- **FR-TITLE5:** 학생 제안 칭호가 판매될 때마다 칭호 기본 가격의 10% (10 Calory)를 제안자에게 정산 지급하고, 나머지 결제액(90 ~ 190 Calory)은 국고로 편입.
- **FR-TITLE6:** 획득한 칭호는 학생 STATUS 화면 및 교사 학생 상세정보에서 커스텀 스타일이 반영된 배지(status-pill) 형태로 렌더링.
- **FR-TITLE7:** 교사는 여러 명의 학생을 선택하여 칭호를 일괄적으로 즉시 지급할 수 있는 칭호 일괄 지급 기능을 지원한다. 지급 시 칭호명, 스타일 옵션(없음, 글자 색상, 글자 및 배경 색상)을 커스텀으로 설정하고 실시간 프리뷰로 확인이 가능하며, 구매가 아니므로 칼로리나 정산금 처리는 발생하지 않고 활동 로그에 지급 내역이 등록된다.

---

### 3.16 우체부 심부름

- **FR-POST1:** 우체부 학생이 심부름 기록 등록.
- **FR-POST2:** 선생님 승인 워크플로우.

---

### 3.17 매일 자동 EXP 성장

- **FR-GROWTH1:** 평일 오전 7시 집계일 전환 시, 전원 **EXP +20%p** 자동 부여.
- **FR-GROWTH2:** 주말(토·일)에는 자동 성장 없음.

---

### 3.18 DJ 워크플로우 (신규)

- **FR-DJ1:** 모든 학생은 본인의 STATUS 보드에서 '🎵 노래 신청하기' 기능으로 DJ에게 곡(제목, 신청자)을 전송.
- **FR-DJ2:** DJ 학생은 `#/student/dj` 경로에서 신청받은 곡 목록을 조회하고 '확인 완료' 처리.
- **FR-DJ3:** 교사의 별도 승인 절차 없음. (DJ가 자체 확인/관리)

---

### 3.19 분리수거부 워크플로우 (신규)

- **FR-RECYCLER1:** 분리수거부 학생은 `#/student/recycler`에서 정기/비정기 분리수거 활동 내역(버린 물품 종류 등)을 기입.
- **FR-RECYCLER2:** 저장 후 교사에게 승인 요청 전송.
- **FR-RECYCLER3:** 교사는 `#/teacher/recycler`에서 검토 후 인센티브(EXP/Calory) 입력 및 승인(또는 반려).

---

### 3.20 환경부 워크플로우 (신규)

- **FR-ENV1:** 환경부 학생은 `#/student/env`에서 교실 관리 체크리스트(요일 바꾸기, 시간표 설정, 칠판 지우기 등)와 '환경 파괴범'을 기입.
- **FR-ENV2:** 저장 후 교사에게 승인 요청 전송.
- **FR-ENV3:** 교사는 `#/teacher/env`에서 검토 후 인센티브(EXP/Calory) 입력 및 승인(또는 반려).

---

### 3.21 교사 직업 장부 마스터 권한 (신규)

- **FR-MASTER1:** 교사는 모든 학생의 1인 1역 전용 장부(청소, 우체부, 통계청, 분리수거부, 환경부 등) 화면에 직접 접근 가능.
- **FR-MASTER2:** 교사 권한으로 접근 시, 해당 직업 학생 본인인 것처럼 장부 작성, 저장, 승인 요청을 강제로 대리 수행 가능.
- **FR-MASTER3:** 교사 대시보드의 '1인 1역 관리' 표와 '학생 상세 정보' 화면에 [장부 직접 수정] 버튼 제공.
- **FR-GROWTH3:** 활동 로그에 "매일 아침 성장" 기록.

---

### 3.22 학생 아바타

- **FR-AVA1:** 성별·ID 기반 픽셀 SVG 아바타 자동 생성.
- **FR-AVA2:** 커스텀 이미지 업로드 지원.
- **FR-AVA3:** `character/` 폴더에 기본 아바타 이미지 25개 포함.

---

## 4. 화면 목록 (IA)

### 선생님 모드 (`#/teacher/...`)

1. 대시보드
2. 디지털 칠판 (`#/teacher/board`)
3. 학생 목록 / 학생 추가 / 학생 상세 (`#/teacher/students`)
4. 학생 STATUS 보드 (`#/teacher/students/:id/status`)
5. 일괄 조정(EXP·LV) (`#/teacher/bulk`)
6. 행동발달특성사항 (`#/teacher/behavior`)
7. 1인1역 관리 (드롭다운 메뉴)
   - 직업 배정·한도 관리
   - 은행 주급 승인
   - 국세 징수 승인
   - 통계청 체크리스트
   - 청소 체크리스트 승인
   - 우체부 심부름 승인
   - 쿠폰상점 상품 승인

### 학생 모드 (`#/student`)

1. 본인 대시보드 (STATUS 보드)
2. 본인 최근 활동
3. 직업별 전용 화면 (은행원 주급, 국세직원 징수, 통계원 체크리스트 등)

---

## 5. 데이터 모델

```json
{
  "version": 1,
  "users": [{ "id", "loginId", "passwordHash?", "salt?", "pinCode?", "pinMustChange?", "role", "displayName", "studentId?" }],
  "students": [{ "id", "name", "number", "gender", "lv", "exp", "calory", "coupons", "jobId?" }],
  "titleGrants": [{ "id", "studentId", "titleText", "acquiredAt", "textColor?", "bgColor?" }],
  "activityLogs": [{ "id", "studentId", "occurredAt", "summary", "expDelta", "caloryDelta?", "bulkJobId?" }],
  "bulkAdjustments": [{ "id", "createdAt", "createdByUserId", "type", "summary" }],
  "behaviorNotes": [{ "id", "studentId", "body", "authorUserId", "createdAt", "updatedAt" }],
  "classJobQuotas": { "bank_m": 1, "bank_f": 1, ... },
  "bankPayrollRequests": [{ "id", "submittedByStudentId", "lines", "status", ... }],
  "taxCollectionRequests": [{ "id", "submittedByStudentId", "lines", "status", ... }],
  "postmanErrandRequests": [{ "id", "submittedByStudentId", "status", ... }],
  "cleaningChecklistRequests": [{ "id", "dateYmd", "zone1~4StudentId", "attentionStudentIds", "status", ... }],
  "statisticsChecklist": { "periods": [{ "id", "cols", "cellDelta", "weeklyAdjust" }] },
  "statisticsApprovalRequests": [{ "id", "periodId", "submittedByStudentId", "cellDelta", "weeklyAdjust", "status" }],
  "couponShop": { "pendingOffers", "products", "holdings", "merchantLog", "treasuryTotal" },
  "titleShop": { "pendingSubmissions": [{ "id", "creatorStudentId?", "titleText", "createdAt" }], "approvedTitles": [{ "id", "creatorStudentId?", "titleText", "createdAt" }] },
  "classTaxTotalManual": null,
  "lastDailyExpGrowthBoardKey": "YYYY-MM-DD",
  "digitalBoard": {
    "timetable": { "morning", "p1"~"p6": { "subject", "activity" } },
    "mealApi": { "neisKey", "atptCode", "schoolCode" },
    "weather": { "lat", "lon" },
    "todos": [{ "id", "text", "done" }],
    "notice": "",
    "noticeFontPx": 28,
    "mealManual": "",
    "boardActivity": { "YYYY-MM-DD": { "studentId": number } },
    "calendarMemos": { "YYYY-MM-DD": { "items": [{ "id", "text", "done" }] } },
    "dailyContentKey": "YYYY-MM-DD"
  }
}
```

---

## 6. 비기능 요구사항

- **보안:** 비밀번호 평문 저장 금지 (SHA-256 + salt 또는 PIN 4자리). Firestore 규칙으로 접근 통제.
- **성능:** 학급 규모 수십 명 기준 즉시 반응.
- **저장:** localStorage + Firestore 양방향 동기화 (debounce 2초). 문서당 최대 1MB.
- **접근성:** 키보드 조작·대비 가능 (학교 환경).
- **호환성:** Chrome/Edge 기준. 디지털 칠판은 TV/대형 모니터 최적화.

---

## 7. 외부 API

| 용도 | URL 패턴 | 비고 |
|------|----------|------|
| 날씨 | `https://api.open-meteo.com/v1/forecast` | 기온, 날씨코드, 강수확률 |
| 미세먼지 | `https://air-quality-api.open-meteo.com/v1/air-quality` | PM2.5 |
| 급식 | `https://open.neis.go.kr/hub/mealServiceDietInfo` | NEIS API KEY·시도교육청·학교코드 |

---

## 8. 수용 기준 (Acceptance Criteria)

- [x] 선생님/학생 이중 로그인이 Firebase·로컬 모드 양쪽에서 동작.
- [x] 학생 CRUD·엑셀 일괄 등록·업데이트·내보내기 동작.
- [x] 디지털 칠판 3단 레이아웃·시계·날씨·시간표·급식·달력·To-Do·알림장 동작.
- [x] 7시 경계에서 시간표·알림장만 초기화, 나머지 유지.
- [x] 16종 직업 배정·한도 관리·직업별 학생 전용 기능 동작.
- [x] 은행 주급·국세 징수·쿠폰 상점·청소 체크리스트·통계청 승인 워크플로우 동작.
- [x] 평일 매일 전원 EXP +20%p 자동 성장.
- [x] EXP 변동 모든 경로에서 활동 이력 근거 기록 (일괄 조정 포함).
- [x] Firebase Firestore 양방향 실시간 동기화 동작.
- [ ] 학부모 열람 모드 (후속).
- [ ] 다중 학급 관리 (후속).

---

## 9. 용어

| 용어 | 설명 |
|------|------|
| Calory | 학급 내 가상 화폐 단위. |
| 최근 주요 활동 | EXP/Calory 변동이 있었던 활동을 시간순으로 보여 주는 목록. |
| 동시 조정 | 다중 선택 학생에 동일 규칙으로 EXP 또는 LV를 한 번에 적용. |
| boardDateKey | 오전 7시 기준으로 하루가 바뀌는 활동 집계용 날짜 키. |
| 국고 | 세금 징수 + 쿠폰상점 매출의 합산 총액. |
| 1인1역 | 학급 내 학생 직업 배정 시스템 (16종). |

---

*본 문서는 구현 착수 후 피드백에 따라 버전을 올려 갱신한다.*
