# Firebase Hosting 배포 가이드

이 프로젝트는 **순수 정적 파일**(HTML/CSS/JS)이므로 **Firebase Hosting**에 그대로 올리면 됩니다. 공개 디렉터리는 **`학급운영도구` 폴더 전체**입니다 (`index.html`, `app/`, `js/` 등 상대 경로 유지).

---

## 1. 사전 준비

- [Node.js](https://nodejs.org/) 설치 (LTS 권장)
- Firebase 콘솔에서 이미 만든 **프로젝트** (Firestore·Auth 쓰는 그 프로젝트와 동일하면 됨)

---

## 2. Firebase CLI 설치

PowerShell 또는 터미널에서:

```bash
npm install -g firebase-tools
```

---

## 3. 로그인

```bash
firebase login
```

브라우저에서 Google 계정으로 허용합니다.

---

## 4. 프로젝트 연결

`학급운영도구` 폴더로 이동한 뒤:

```bash
cd "학급운영도구가 있는 경로"
```

처음이면 **프로젝트 ID**를 연결합니다.

**방법 A — 예시 파일 복사**

```bash
copy .firebaserc.example .firebaserc
```

`.firebaserc`를 열어 `"여기에-Firebase-프로젝트-ID"`를 콘솔에 보이는 **프로젝트 ID**로 바꿉니다.

**방법 B — CLI로 생성**

```bash
firebase use --add
```

목록에서 프로젝트를 고르면 `.firebaserc`가 생성됩니다.

이 저장소에는 이미 **`firebase.json`** 이 있어 `public`이 현재 폴더(`.`)로 잡혀 있습니다. 다른 폴더를 쓰고 싶다면 `firebase init hosting`으로 다시 잡거나 `firebase.json`만 수정하면 됩니다.

---

## 5. 배포

PowerShell에서 이 폴더(`학급운영도구`)로 이동한 뒤:

```powershell
firebase deploy --only hosting
```

또는 같은 폴더에 있는 **`deploy-hosting.ps1`** 실행 (로그인·`.firebaserc` 준비 후):

```powershell
.\deploy-hosting.ps1
```

완료되면 터미널에 **Hosting URL**(예: `https://프로젝트ID.web.app`)이 출력됩니다.

**학생 아바타·PIN이 클라우드에 안 올라가면** Hosting과 별도로 **Firestore 규칙**을 배포해야 합니다. `firestore.rules`에서 `YOUR_TEACHER_AUTH_UID`를 `teacherFirestoreUid`와 같게 바꾼 뒤:

```powershell
firebase deploy --only firestore:rules
```

자세한 설명은 **`FIREBASE_SETUP.md`** 맨 위 절을 참고하세요.

---

## 6. 확인할 것

| 항목 | 설명 |
|------|------|
| `js/firebase-config.js` | `enabled: true` 및 웹 앱 config — 배포된 도메인은 콘솔 **승인 도메인**에 자동으로 잡히는 경우가 많고, 문제 있으면 Authentication → 설정 → **승인된 도메인**에 `프로젝트ID.web.app` 등 추가 |
| Firestore 규칙 | 루트 **`firestore.rules`** 를 수정한 뒤 `firebase deploy --only firestore:rules` — 익명 학생이 선생님 학급 문서에 쓰려면 `FIREBASE_SETUP.md` 의 **YOUR_TEACHER_AUTH_UID** 절차 필수 |
| API 키 | 웹 클라이언트용 키는 HTML에 노출되는 것이 정상이나, 보안은 **규칙·App Check**로 보강 |

---

## 7. 이후 수정

파일 수정 후 같은 명령으로 다시 배포합니다.

```bash
firebase deploy --only hosting
```

---

## 8. 로컬에서 미리보기 (선택)

```bash
firebase serve --only hosting
```

브라우저에서 `http://localhost:5000` 으로 확인합니다.

---

## 참고

- **백엔드 서버는 없습니다.** Hosting은 **정적 호스팅**만 담당하고, Firestore/Auth는 브라우저 SDK로 직접 연결합니다.
- 루트 `index.html`이 `app/index.html`로 넘기므로, 배포 후 **사이트 주소**만 열면 앱으로 진입할 수 있습니다.
