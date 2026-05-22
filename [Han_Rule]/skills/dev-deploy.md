---
name: dev-deploy
description: 학급운영도구를 Firebase Hosting에 안전하게 배포하기 위한 체크리스트와 절차를 자동화하는 스킬입니다.
---

# Dev Deploy Skill (배포)

## 🎯 트리거 워드
- **"배포"**, **"디플로이"**, **"올려줘"**, **"호스팅"**

## 🛠️ 작동 절차

### 1단계: 배포 전 체크리스트

AI는 배포 전에 다음을 순서대로 확인합니다:

- [ ] `js/firebase-config.js` — `enabled: true`, API 키·프로젝트 ID 정상
- [ ] `js/firebase-config.js` — `teacherFirestoreUid` 값이 올바른 선생님 UID
- [ ] `firestore.rules` — `YOUR_TEACHER_AUTH_UID` 대신 실제 UID가 들어가 있는지
- [ ] `firebase.json` — `public: "."` 설정 확인
- [ ] `.firebaserc` — 프로젝트 ID 연결 확인
- [ ] `app/app.js` — `console.log` 디버그 코드 제거 확인
- [ ] `index.html` → `app/index.html` 리다이렉트 정상

### 2단계: 로컬 테스트 (선택)

```powershell
cd "학급운영도구 경로"
firebase serve --only hosting
# 브라우저에서 http://localhost:5000 확인
```

### 3단계: 배포 실행

```powershell
# Hosting만 배포
firebase deploy --only hosting

# Firestore 규칙도 함께 배포 (규칙 변경 시)
firebase deploy --only hosting,firestore:rules
```

또는 기존 스크립트 사용:
```powershell
.\deploy-hosting.ps1
```

### 4단계: 배포 후 확인
- [ ] `https://{프로젝트ID}.web.app` 접속 → 앱 정상 로딩
- [ ] 선생님 로그인 정상
- [ ] 학생 로그인 정상 (익명 Auth)
- [ ] 데이터 저장/로드 정상 (Firestore)
- [ ] 디지털 칠판 정상

### 5단계: 배포 완료 브리핑

> **🚀 배포 완료**
> - **URL:** `https://{프로젝트ID}.web.app`
> - **Hosting:** ✅ / **Firestore Rules:** ✅ or 변경 없음
> - **확인 사항:** {테스트 결과}

## ⚠️ 주의사항
- `firebase-config.js`에 실제 키가 있지만 **웹 클라이언트용이므로 정상**입니다. 보안은 Firestore 규칙으로 보강합니다.
- Authentication → 설정 → **승인된 도메인**에 배포 도메인이 포함되어 있는지 확인합니다.
- 배포 후 학생들이 사용 중이면 **Firestore 데이터가 리셋되지 않는지** 반드시 확인합니다.
