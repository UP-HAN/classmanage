# 🔍 학급운영도구 프로젝트 심층 분석 보고서

> 📅 분석 시각: 2026-05-22 23:46 (KST)
> 이 문서는 "저장해줘" 명령 시 프로젝트 전체를 재분석하여 처음부터 새로 작성됩니다.

---

## 1. 프로젝트 개요

**학급 RPG · STATUS 관리 웹앱** — 6학년 학급 운영을 게임형(LV·칭호·Calory·EXP·직업) 시스템으로 관리하는 웹앱

| 항목 | 내용 |
|------|------|
| **스택** | 순수 HTML/CSS/바닐라 JS (프레임워크·빌드 도구 없음) + Express 백엔드 (Node.js) + MySQL |
| **저장소** | `localStorage` + Express REST API / MySQL 실시간 동기화 (`js/api-sync.js`) |
| **인증** | 자체 세션/DB 연동 로그인 (선생님/학생) |
| **배포** | AWS Lightsail 단일 서버 (`IP: 3.35.13.249`, Nginx 및 PM2 `class-backend` 연동) |
| **코드 규모** | `app.js` **18,707줄** (약 770KB), `app.css` **4,164줄** (약 82.5KB), `server.js` **895줄** (약 35KB) |
| **PRD 버전** | v3.0 (2026-05-22 업데이트 — 모의투자 주가 변동성 배율 및 기준가 재설정 기능 도입, AWS Lightsail 완전 통합, 주식 포트폴리오 동기화 버그 완벽 해결) |

---

## 2. 파일 구조 맵

```
학급운영도구/
├── index.html                # 루트 → app/index.html로 리다이렉트
├── PRD.md                    # 제품 요구사항 v2.5
├── Pre-PRD.MD                # 사전 PRD (구현 시 이 문서 우선)
├── 프로그램초안설명서.MD       # 기술·디자인 명세 (CSS 토큰·컴포넌트)
├── app/
│   ├── index.html            # 메인 앱 진입점 (#app 루트, v=1.0.12 버전 적용)
│   ├── app.js                # ★ 전체 로직 단일 파일 (18,707줄 IIFE)
│   └── app.css               # 전체 스타일 (4,164줄)
├── js/
│   ├── core.js               # DB 저장/로드, 세션, 해싱 (158줄)
│   ├── firebase-config.js    # Firebase 설정 (완전 폐기 / 사용 안함)
│   ├── firebase-config.example.js  # 설정 예시 템플릿
│   ├── firebase-sync.js      # Firestore 양방향 동기화 (폐기)
│   └── api-sync.js           # REST API 기반 실시간 양방향 백엔드 동기화 (최신)
├── teacher/
│   ├── index.html            # 선생님 모드 바로가기 (리다이렉트)
│   └── teacher.css           # 선생님 모드 전용 CSS 스타일
├── character/
│   └── 1~25.PNG              # 학생 아바타 이미지 (25개)
├── 사전소스/
│   └── PDF, 이미지 등         # 학급 규칙·소개 원본 자료
├── [Han_Rule]/
│   ├── 한의표 전용 안티그래비티 글로벌 룰.md  # 작업 철학·트리거 워드
│   ├── SAVE_POINT.md          # 세션별 작업 상태 기록 (최신 업데이트)
│   ├── PROJECT_ANALYSIS.md    # ← 이 문서
│   └── skills/                # 스킬 파일 11개
│       ├── dev-save.md        # "저장해줘" 스킬
│       ├── dev-sync.md        # "동기화해줘" 스킬
│       ├── dev-feature.md     # "기능 추가" 스킬
│       ├── dev-bugfix.md      # "버그 수정" 스킬
│       ├── dev-refactor.md    # "리팩토링" 스킬
│       ├── dev-deploy.md      # "배포" 스킬
│       ├── han-inbox-storage-organizer.md
│       ├── han-knowledge-extractor.md
│       ├── han-project-archiver.md
│       ├── han-regular-checkup.md
│       └── han-wiki-schema.md
├── server/
│   ├── .env.example          # 백엔드 설정 환경변수 예시
│   ├── db.js                 # MySQL 커넥션 풀 설정
│   ├── migrate.js            # 로컬 데이터 MySQL 이관용 스크립트 (stock_portfolio 대응)
│   ├── package.json          # Node.js 패키지 의존성 정의
│   ├── schema.sql            # 데이터베이스 테이블 정의 (stock_portfolio 컬럼 탑재)
│   └── server.js             # Express 백엔드 서버 엔드포인트 및 자동 스키마 마이그레이션 모듈 (895줄)
├── AWS_LIGHTSAIL_SSH_GUIDE.md # AWS Lightsail 터미널 접속 관련 가이드
├── firebase.json              # Hosting 설정 (폐기)
├── firestore.rules            # Firestore 보안 규칙 (폐기)
├── .firebaserc                # Firebase 프로젝트 연결 (폐기)
├── deploy-hosting.ps1         # 배포 스크립트 (폐기)
├── FIREBASE_SETUP.md          # Firebase 연동 안내 (폐기)
├── DEPLOY_HOSTING.md          # Hosting 배포 가이드 (폐기)
├── styles.css                 # 루트 스타일 (미사용 — app/app.css가 메인)
└── 학급운영도구대화.md          # 개발 대화 기록 (86KB)
```

---

## 3. 현재 구현된 기능

### ✅ 핵심 기능 (MVP)

| 기능 | 상태 | 상세 |
|------|:---:|------|
| 선생님/학생 이중 로그인 | ✅ | Firebase Auth 대신 자체 DB 기반 세션 로그인 및 로컬 저장소 모드 전면 지원 |
| 선생님 대시보드 | ✅ | 학생 수, 활동 건수, 바로가기 메뉴 및 데이터 관리 |
| 학생 CRUD | ✅ | 추가, 상세 편집, 단일/일괄 삭제 기능 |
| 엑셀 일괄 등록/업데이트 | ✅ | SheetJS CDN 활용, 직업·칭호 포함 / 업데이트 시 직업 인원 제한 우회 강제 반영 |
| LV/EXP/Calory 시스템 | ✅ | EXP 0~100% 구간 관리, 시각적 세그먼트 바 렌더링 |
| 칭호 시스템 | ✅ | 다중 보유, 획득일 기록 및 바이트 관리 |
| 일괄 조정 | ✅ | 다중 선택을 통한 EXP/LV 가감, 변동 사유 기록 |
| 활동 로그 | ✅ | 모든 변동 이력 보존, 개별 삭제·되돌림, 전체 일괄 삭제 지원 |
| 행동발달특성사항 | ✅ | 선생님 전용, 학생별 특이사항 CRUD 관리 |
| 학생 본인 STATUS 보드 | ✅ | 본인 계정 데이터만 읽기 전용으로 시각화 및 비밀번호 변경 기능 |

### 🚀 확장 기능 (최근 세션에서 업그레이드됨)

| 기능 | 상태 | 상세 |
|------|:---:|------|
| 디지털 칠판 (TV 3단 레이아웃) | ✅ | 시계·날씨·시간표·급식·달력·To-Do·알림장 / TV 가독성 극대화를 위한 시간표 과목명 폰트 크기 확대 적용 |
| 매일 7시 자동 리셋 | ✅ | 오전 7시 기준 시간표 및 알림장 데이터만 초기화, 나머지 대시보드 상태 보존 |
| 1인1역 직업 시스템 (16종) | ✅ | 직업별 배정 인원 한도 적용, 선생님 강제 배정 및 엑셀 일괄 업로드 매핑 지원 |
| 은행원 주급 관리 & 세금 자동 징수 | ✅ | 주급 지급 시 국세청(국고) 세금 10% 자동 원천징수, 지급 이력에 따른 세금 정보 자동 보정 |
| 국세청 국고 유입 경로 요약 및 필터 | ✅ | 날짜별 시작/종료 필터 및 오늘/이번주/전체 퀵 필터 제공, 교사 암호 검증 후 세금 및 국고 내역 전체 리셋 기능 지원 |
| 국고 수동 조정 경고 승인 | ✅ | 교사가 국고를 수동 조정할 때 경고창 하단의 "그래도 이대로 반영하겠습니까?" 체크 후 승인 처리로 실수 예방 |
| 쿠폰 상점 | ✅ | 상인(학생) 등록 → 교사 승인 → 구매 프로세스 구축, 구매 대금이 국고 매출로 자동 유입 |
| 칭호 상점 및 일괄 지급 | ✅ | 제안/승인/판매, 글자색 및 배경색 커스텀 옵션, 10% 정산 수익, 실시간 배지 스타일 프리뷰 및 교사 일괄 지급 지원 |
| 청소 체크리스트 | ✅ | 수/금 요일별 4구역 실명 서명 확인, 완료 시 인센티브(EXP/Calory) 자동 지급 |
| 통계청 체크리스트 | ✅ | 1주(5일) 영업일 단위 수행, 주말 차단 버그 해결, 승인 시 담당 학생 EXP 즉시 반영 |
| 우체부 심부름 | ✅ | 학생 심부름 요청 등록 → 교사 승인/반려 워크플로우 연동 |
| 매일 자동 EXP 성장 | ✅ | 평일 매일 +10%p 자동 성장, 주말 제외 처리 |
| 학생 아바타 (투명도 & 50% 축소) | ✅ | 픽셀 SVG 캐릭터 및 커스텀 이미지 업로드 지원 / 캐릭터 크기 `5.5rem` 축소 및 투명도 유지로 배경과의 조화도 향상 |
| 아바타 업로드 용량 & 최적화 | ✅ | 이미지 업로드 용량 한도 500KB 확장 및 신규 업로드/초기화 시 기존 커스텀 이미지(`avatarCustom`) 가비지 정리로 전체 DB 용량 관리 최적화 |
| 아바타 렌더링 신뢰성 개선 | ✅ | `isSafeAvatarDataUrl` 최대 길이 150만 자 확장 및 MIME 검증 정규식 완화로 다양한 포맷의 Data URL 렌더링 실패 이슈 완벽 해결 |
| DJ 신청곡 일일 제한 및 본인 수정 | ✅ | 하루 최대 8곡 신청 한도 초과 시 마감 처리, 대기중(!confirmed) 곡에 대해 본인이 직접 내용 수정 및 수정 시 큐 후순위 자동 재정렬 기능 구현 |
| 쿠폰상인 등 타이핑 중 동기화 렌더링 제어 | ✅ | 사용자가 인풋 폼 타이핑 중 실시간 백엔드 동기화 렌더링이 트리거되어 작성 중이던 폼 데이터가 초기화 및 유실되는 현상 원천 차단 (`isUserTyping()` 락) |
| 학급 가상 주식 모의투자 시스템 | ✅ | 한국투자증권 실시간 시세 연동(1 Cal = 10,000원 고정), 소수점 4자리 fractional 매수/매도 거래, Chart.js 원형 자산 배분 그래프 및 보유 종목 요약 정보 학생 보드 연동, 교사용 개장/폐장 및 GAS URL 설정, 감사 로그 대시보드 구현 |
| **모의투자 레버리지 및 기준가 재설정** | ✅ | 변동성 배율(1배, 1.5배, 2배, 3배, 5배) 설정, 전일종가 기반 동적 레버리지 단가 계산, 교사용 "모든 종목 기준가를 현재가로 재설정" 일괄 기준선 초기화 매커니즘 구현 |
| **주식 포트폴리오 실시간 동기화** | ✅ | MySQL DB에 `stock_portfolio` 컬럼을 확장하고, REST API 동기화 프로토콜(`/api/sync` GET/POST) 상에서 JSON 파싱/직렬화를 수행하여 다중 기기 환경에서 주식 투자 현황 완벽 연동 구현 |

### 📋 미구현 (후속 검토)

| 기능 | 상태 |
|------|:---:|
| 학부모 열람 모드 | ❌ |
| 다중 학급 관리 | ❌ |
| 레벨업 자동 계산 (EXP 100%→LV+1) | ❌ |
| 학급 랭킹/리더보드 | ❌ |
| 학기 종료 데이터 아카이빙 | ❌ |
| 학생 초기화(리셋) | ❌ |

---

## 4. 아키텍처 강점과 약점

### 💪 강점

1. **단일 백엔드 데이터베이스 일원화** — Firebase 의존성을 완전히 제거하고, AWS Lightsail 내 MySQL 데이터베이스로 모든 상태를 중앙 집중식으로 연동 및 관리
2. **오프라인 우선 구조** — `localStorage`에 즉시 반영하고, API 연동 모듈(`js/api-sync.js`)이 백그라운드에서 백엔드와 양방향 비동기 동기화를 안전하게 수행하여 끊김 없는 UX 제공
3. **완성도 높은 디자인 시스템** — 다크 네이비 테마 및 세련된 네온 액센트의 CSS 변수 토큰화, 반응형 카드 그리드 레이아웃
4. **타이핑 동기화 안전장치** — 포커스 활성화 중 렌더링을 일시 차단하는 `isUserTyping` 기능으로 실시간 분산 환경에서 발생하는 극심한 렌더링 간섭 차단
5. **실시간 주식 정보 프록시** — GAS(Google Apps Script) 프록시를 통해 한국거래소 실시간 주가 정보를 쿼리하고, 백엔드를 통해 안정적으로 다중 기기에 서빙

### ⚠️ 개선 가능 영역

| 영역 | 현황 | 개선 방향 |
|------|------|-----------|
| **코드 구조** | `app/app.js` 18,707줄 단일 파일 | 향후 핵심 모듈별(로그인, 대시보드, 모의투자, 상점 등) 파일 분할 검토 |
| **HTML 생성** | 바닐라 JS 문자열 템플릿 연결 생성 | 경량 가상 DOM 또는 템플릿 컴포넌트 구조 도입 고려 |
| **에러 핸들링** | API 연결 끊김 시 단순 로그 및 콘솔 경고 | 오프라인 모드일 때 최상단 오프라인 인디케이터 배너 노출로 직관성 보강 |

---

## 5. 기술 상세

### 코드 스타일 규칙
- **JavaScript:** `var` 선언, ES5 호환, IIFE 패턴, `escapeHtml()` 필수 적용으로 XSS 방지
- **HTML:** ES6 템플릿 리터럴 및 문자열 연결 (`+`) 방식의 순수 DOM 주입 생성
- **CSS:** `:root` 변수 기반 토큰 관리 (다크 네이비 테마), 유연한 미디어 쿼리 기반 반응형 처리
- **DB:** 로컬 `getDb()` 조작 후 `saveDb(db)` 수행 및 백그라운드 API Sync 호출
- **라우팅:** 해시 라우팅 기반 (`#/teacher/...`, `#/student/...`)

### 핵심 알고리즘 및 엔진

#### 1. 자가 치유형 DB 스키마 마이그레이션 (`server/server.js`)
백엔드가 부팅될 때 `checkAndMigrateSchema()` 함수가 구동되어 MySQL 데이터베이스 테이블 명세를 진단합니다. 신규 기능 탑재로 인해 `students` 테이블에 `stock_portfolio` 컬럼이 누락되었음이 감지되면 자동으로 `ALTER TABLE` 쿼리를 실행하여 동적으로 스키마를 보정합니다.
```javascript
async function checkAndMigrateSchema() {
  try {
    const [columns] = await db.query("SHOW COLUMNS FROM students LIKE 'stock_portfolio'");
    if (columns.length === 0) {
      await db.query("ALTER TABLE students ADD COLUMN stock_portfolio MEDIUMTEXT DEFAULT NULL");
      console.log('[Schema Migration] students 테이블에 stock_portfolio 컬럼이 성공적으로 추가되었습니다!');
    }
  } catch (err) {
    console.error('[Schema Migration] 스키마 동적 검증 및 추가 중 에러 발생:', err);
  }
}
```

#### 2. 동적 레버리지 배율 주가 연산 (`app/app.js`)
KIS API를 통해 확보한 전일 기준가(`stck_sdpr` 또는 교사 강제 리셋 기준가)와 실시간 현재가 사이의 변동폭을 교사가 설정한 레버리지 배율(1.0x ~ 5.0x)에 맞게 증폭하여 최종 가격을 계산합니다.
$$\text{표시 가격} = \text{기준가} + (\text{실제 현재가} - \text{기준가}) \times \text{배율}$$
최소 주가는 100 Cal 이하로 떨어지지 않도록 보정 로직(`Math.max(100, price)`)을 걸어 부도/상폐를 방지합니다.

#### 3. 타이핑 간섭 락 (`isUserTyping`)
실시간 동기화로 인해 화면 전체가 리렌더링(`route()`)되는 주기에, 폼 입력을 차단하는 핵심 유틸입니다.
```javascript
function isUserTyping() {
  var active = document.activeElement;
  if (!active) return false;
  var tag = active.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    var type = active.type.toLowerCase();
    return (type === 'text' || type === 'number' || type === 'password');
  }
  return false;
}
```

### AWS Lightsail & 백엔드 구성
- **Express Backend:** Node.js Express 프레임워크 기반 REST API 서버, DB 동기화 컨트롤러
- **Database:** MySQL Local Instance (utf8mb4 환경) 연동
- **Nginx Web Server:** 정적 파일(HTML, JS, CSS) 서빙 및 `/api` 라우트 프록시 처리, Let's Encrypt HTTPS 적용
- **PM2 Service:** `class-backend` 백엔드 프로세스 데몬 관리 및 무중단 실행

---

## 6. 스킬 파일 목록

### 🎮 개발 전용 스킬 (6개)

| 스킬 | 트리거 워드 | 용도 |
|------|-----------|------|
| `dev-save.md` | "저장해줘" / "세이브" | SAVE_POINT.md + PROJECT_ANALYSIS.md 작성 및 기록 동기화 |
| `dev-sync.md` | "동기화해줘" / "이전 작업 이어서" | 세이브 포인트 파일을 읽어 작업 복원 및 개발 환경 세팅 |
| `dev-feature.md` | "기능 추가" / "새 기능" | 기존 바닐라/IIFE 아키텍처 패턴에 부합하는 클린 코드 개발 설계 |
| `dev-bugfix.md` | "버그 수정" / "에러 수정" | 원인 추적부터 유닛 확인까지 아우르는 정밀 디버깅 가이드라인 |
| `dev-refactor.md` | "리팩토링" / "코드 정리" | 전역 네임스페이스 및 대규모 소스 안정성 유지 리팩토링 |
| `dev-deploy.md` | "배포" / "디플로이" | AWS Lightsail 단일 서버 신뢰 배포 체크리스트 |

### 📚 위키 관리 스킬 (5개)

| 스킬 | 트리거 워드 | 용도 |
|------|-----------|------|
| `han-regular-checkup.md` | "정기점검 해줘" | 수집함 비우기 및 제텔카스텐 지식 노드 연계 강화 대청소 |
| `han-inbox-storage-organizer.md` | "Inbox 정리해줘" | 외부에서 유입된 무겁고 가벼운 자료의 자동 정렬 분배 |
| `han-project-archiver.md` | "프로젝트 아카이빙 해줘" | 완료 이벤트의 지식화 및 노하우 보존 |
| `han-knowledge-extractor.md` | "대화에서 노하우 추출해 줘" | 주요 에러 트랙킹 및 AI 프롬프팅 최적화 로그 저장 |
| `han-wiki-schema.md` | (상시 가동) | 의표 위키 사서 규범 및 데이터 가이드라인 준수 확인 |

---

## 7. ⚠️ 프로젝트 개발 및 배포 룰 (중요)

> 🚨 **AI 모델 개발 수칙 및 가이드라인**
> 이 아키텍처 규칙은 학급운영도구 개발 과정에서 반드시 준수해야 하는 절대적인 규칙입니다.

### 🚫 Firebase 사용 절대 금지 (폐기)
* **Firebase Hosting, Firestore, Firebase Auth 등 모든 Firebase 연동은 완전히 중단(사용 안 함)되었습니다.**
* 로컬의 `deploy-hosting.ps1`이나 Firebase CLI를 사용한 어떠한 배포 명령도 절대로 수행하거나 권장해서는 안 됩니다.

### 🔑 SSH 실서버 접속 룰
* **실서버(AWS Lightsail) 접속 시, 로컬 터미널을 통한 SSH PEM 키 접속 방식을 절대로 권장하거나 가이드하지 않습니다.**
* **이유**: PEM 키 경로 입력 및 인코딩 오류, 윈도우 PowerShell의 특수 기호(`<`, `>`) ParserError 등의 빈번한 오류를 방지하기 위함입니다.
* **접속 방법**: 무조건 **[AWS Lightsail 홈페이지 콘솔]**에 웹 브라우저로 접속한 후, 인스턴스에 있는 **주황색 터미널 아이콘(`>_`)**을 클릭하여 브라우저 콘솔을 통해서 터미널에 접속하는 방식을 지침으로 삼아야 합니다.

### 🚀 실서버 배포 룰
* 실서버 배포는 다음의 **단일 Git Pull 워크플로우**로 제한합니다:
  1. 로컬에서 기능 개발 및 Git Push 완료.
  2. **AWS 웹 콘솔 터미널**로 접속.
  3. 아래 명령어를 실행하여 배포 완료:
     ```bash
     cd /home/ubuntu/app
     git pull
     pm2 restart class-backend
     ```
