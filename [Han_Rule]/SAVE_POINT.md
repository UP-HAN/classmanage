# 💾 학급운영도구 — 세이브 포인트

> ⚠️ 이 파일은 AI 개발 도우미가 자동 생성한 작업 상태 기록입니다.
> 새 세션에서 **"동기화해줘"**라고 말하면 이 파일을 읽고 이전 작업을 이어갑니다.

## 📅 세이브 시각
- **날짜/시간:** 2026-05-22 23:46 (KST)
- **세션 환경:** Antigravity (Windows, 학급운영도구 워크스페이스)

---

## ✅ 이번 세션에서 완료한 작업

1. **주식 포트폴리오(stock_portfolio) 동기화 오류 해결 및 DB 구조 확장**:
   - **MySQL 스키마 보강 (`server/schema.sql`, `server/migrate.js`)**: `students` 테이블에 개별 학생의 모의투자 포트폴리오를 저장할 `stock_portfolio MEDIUMTEXT` 컬럼 추가. 마이그레이션 스크립트에 객체 직렬화 로직 반영.
   - **자가 치유형 스키마 마이그레이션 (`server/server.js`)**: 백엔드 구동 시 실행되는 `checkAndMigrateSchema()` 함수를 설계하여, `students` 테이블 내 `stock_portfolio` 컬럼 유무를 검사하고 부재 시 즉시 `ALTER TABLE students ADD COLUMN stock_portfolio MEDIUMTEXT DEFAULT NULL`을 수행하는 자동 마이그레이션 안전장치 탑재.
   - **동기화 프로토콜 보강 (`server/server.js`)**: `/api/sync` GET 및 POST 요청 처리부에서 `stock_portfolio` 필드의 JSON 파싱 및 데이터 직렬화 예외 처리를 정밀하게 반영하여, 학생들의 실시간 평가금액 및 보유 주식 동기화가 완벽하게 일어날 수 있도록 함.

2. **모의투자 변동성 배율(레버리지) 조절 및 기준가 수동 재설정 기능 연동**:
   - **Express 백엔드 (`server/server.js`)**: KIS API 연동 시 전일 종가/기준가격(`stck_sdpr`) 필드를 추가로 파싱 및 캐싱하여 프론트엔드로 전달.
   - **프론트엔드 엔진 (`app/app.js`)**: `getLeveragedPrices` 헬퍼 함수를 구축하여 표시 가격(`기준가 + (실제현재가 - 기준가) * 배율`)을 실시간 계산하고, 5분 로컬 캐시가 적용 중이더라도 배율 변경이나 기준가 재설정이 발생하는 순간 네트워크 요청 없이 즉각 리렌더링하도록 흐름 최적화. 최소 주가는 부도/상폐 방지를 위해 100 Cal로 자동 하한선 보정.
   - **교사용 제어 UI**: 레버리지 배율(1배, 1.5배, 2배, 3배, 5배)을 선택하여 즉시 단가에 적용 가능하도록 폼 추가 및 "모든 종목의 기준가를 현재가로 재설정" 버튼을 통해 동적 기준선 초기화 매커니즘 구현.

3. **아키텍처 룰(Rule) 개편 및 수칙 공식 명문화**:
   - **Firebase 완전 폐기**: Firebase Hosting, Firestore, Auth 등의 사용을 완전히 종료하고 프론트/백엔드 모두 AWS Lightsail 단일 서버 통합 아키텍처로 진화하였음을 공식 규칙으로 등록.
   - **SSH 접속 수칙 제정**: 로컬 터미널의 PEM 키 접속에 따른 ParserError 및 기호 오류 방지를 위해, 실서버 접속 시 무조건 **[AWS Lightsail 홈페이지 콘솔]** 내의 **주황색 브라우저 터미널 아이콘(`>_`)**을 이용하도록 강제 규칙 수립.
   - **배포 수칙 단일화**: Nginx 정적 파일 서빙 이관에 따라 실서버 `/home/ubuntu/app` 경로에서의 `git pull` & `pm2 restart class-backend` 조합만으로 프론트/백엔드가 동시에 반영되도록 프로세스 단일화.

4. **로컬 커밋 및 GitHub 원격지 Push 완료**:
   - `server/server.js`, `app/app.js`, `[Han_Rule]/PROJECT_ANALYSIS.md` 등의 신규 추가 및 변경점이 GitHub 원격 저장소(`main` 브랜치)로 안전하게 push 완료되었습니다.

---

## 📝 변경된 파일 목록

| 파일 경로 | 변경 유형 | 변경 내용 요약 |
|-----------|----------|---------------|
| `server/schema.sql` | 수정 | `students` 테이블에 `stock_portfolio` 컬럼 추가 |
| `server/migrate.js` | 수정 | DB 초기 구축 및 마이그레이션 시 `stock_portfolio` 필드 매핑 및 바인딩 처리 |
| `server/server.js` | 수정 | `/api/sync` 프로토콜 연동 및 기동 시 컬럼 유무를 검사하는 자가 마이그레이션 기능 탑재 |
| `app/app.js` | 수정 | 동적 레버리지 엔진 구현, 교사 설정 UI 개편 (배율 및 기준가 리셋) |
| `[Han_Rule]/PROJECT_ANALYSIS.md` | 수정 | 전체 프로젝트 규모, DB 동기화 알고리즘 갱신 및 ⚠️ 프로젝트 개발/배포 룰 명문화 |
| `[Han_Rule]/SAVE_POINT.md` | 갱신 | 현재 세션의 작업 성과 요약 및 완료 상태 업데이트 (이 문서) |

---

## ⏳ 미완성 작업 (다음 세션에서 이어서)
- 없음. (모의투자 추가 요구사항, 주식 동기화 버그 픽스 및 시스템 아키텍처 규칙화 완벽 완료)

## 🐛 알려진 이슈
- 없음.

## 💡 다음 AI에게 전하는 메모
> **1. 아키텍처 환경**
> - 선생님은 빌드 도구 없이 순수 HTML/CSS/바닐라 JS를 활용한 정적 클라이언트 서빙 방식을 유지합니다.
> - 백엔드는 Node.js Express 및 Local MySQL 인스턴스로 동기화되며, Firebase는 완전히 미사용(폐기) 처리 상태입니다.
> - 배포 시에는 Lightsail 웹 브라우저 터미널을 이용해 `cd /home/ubuntu/app && git pull && pm2 restart class-backend` 순으로 배포를 완료합니다.
> 
> **2. 상태 복원 및 코드 편집 시 주의점**
> - `app.js`는 대규모 단일 IIFE 구조(약 18,707줄)로 되어 있으므로 함수 누락이나 중괄호 매칭 에러가 없도록 섬세하게 편집해야 합니다.
> - 실시간 Firebase 동기화 로직은 `js/api-sync.js` 및 `server` 연동으로 이관되었으며, input 입력 중 동기화 렌더링에 의한 데이터 유실을 방지하는 `isUserTyping` 상태 락(lock) 메커니즘이 `app.js`에 내장되어 있습니다.
