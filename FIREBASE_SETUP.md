# Firebase (Auth + Firestore) 연동 안내

## 반드시: Firestore 규칙 배포 (학생 저장·아바타 동기화)

학생은 **익명 로그인**이라 `users/{선생UID}/classStatus/main` 에 **직접 쓰기**해야 합니다.  
콘솔 규칙이 `request.auth.uid == userId` 만 허용하면 **학생 저장이 전부 거절**되고, 교사 화면에도 반영되지 않습니다.

1. 프로젝트 루트의 **`firestore.rules`** 를 열고, **`YOUR_TEACHER_AUTH_UID`** 를 `firebase-config.js` 의 **`teacherFirestoreUid`** 와 **완전히 같은 문자열**(선생님 Auth UID)로 바꿉니다.
2. 터미널에서 (이미 `firebase login` 한 상태):

   ```bash
   firebase deploy --only firestore:rules
   ```

3. 호스팅만 쓰고 규칙을 한 번도 안 올렸다면, 위 명령이 **필수**입니다.  
   (웹앱 `firebase deploy --only hosting` 은 규칙을 바꾸지 않습니다.)

---

## 동작 요약

- `js/firebase-config.js`에서 **`enabled: true`** 이고 API 키가 있으면:
  - **Firebase Authentication — 이메일/비밀번호**로 선생님 로그인.
  - **학생 로그인**은 이름 + 숫자 4자리 비밀번호이며, 앱이 **익명(Anonymous) 로그인** 후 선생님과 동일한 학급 DB(`payloadJson`)를 불러옵니다.
  - **`teacherFirestoreUid`** 에 선생님 계정의 **Auth UID**를 넣어야 학생 로그인이 동작합니다. (콘솔 → Authentication → 사용자 → 해당 이메일 행에서 UID 복사)
- **`enabled: false`** 이면 **로컬 전용**이며, 시작 화면에서 선생님(`teacher` / `demo123`) 또는 학생(이름 / 4자리)을 고릅니다.

## Firestore 문서 경로

- `users/{Firebase uid}/classStatus/main`
- 필드: `payloadJson` (전체 앱 DB JSON 문자열), `updatedAt`

(이전 단일 경로 `classStatus/main`은 사용하지 않습니다. 예전 데이터는 콘솔에서 수동 이전하거나 새 계정으로 다시 시작하세요.)

## 설정 순서

1. [Firebase 콘솔](https://console.firebase.google.com/) → 프로젝트 → **Authentication** → **이메일/비밀번호** 사용 설정  
2. **사용자** 탭에서 선생님 계정 **수동 추가** (또는 앱에 회원가입을 나중에 붙임)  
3. **Firestore Database** 생성  
4. 웹 앱 config를 `firebase-config.js`에 넣고 `enabled: true`  
5. **학생 로그인 사용 시** Authentication → **Sign-in method**에서 **익명(Anonymous)** 을 사용 설정합니다.  
6. `firebase-config.js`에 **`teacherFirestoreUid`** 를 선생님 계정 UID로 채웁니다.

## 학생 비밀번호 변경·동기화와 Firestore 규칙

- 학생이 첫 로그인에서 비밀번호를 바꾸면 `payloadJson`이 갱신되어 Firestore에 **업로드**되려면, **익명 학생**도 선생님 UID 경로에 **쓰기**가 가능해야 합니다. 기본 규칙 `request.auth.uid == userId` 만으로는 익명 UID ≠ 선생님 UID 이라 **학생이 저장할 수 없습니다.**
- 학급 단말을 신뢰한다는 전제에서, **특정 선생님 UID** 문서에 한해 인증된 사용자 전원에게 쓰기를 허용하는 예시는 다음과 같습니다. (`TEACHER_UID` 를 `teacherFirestoreUid` 와 동일한 문자열로 바꿉니다.)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/classStatus/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        request.auth.uid == userId ||
        userId == 'TEACHER_UID'
      );
    }
  }
}
```

- 이렇게 하면 **로그인한 누구나** 해당 학급 문서 전체를 덮어쓸 수 있어 **악의적인 클라이언트에 취약**합니다. 공개 배포 시 [App Check](https://firebase.google.com/docs/app-check)·백엔드 검증 등을 검토하세요.
- 선생님 문서에 **쓰기를 열지 않으면** 학생 비밀번호 변경은 **그 기기의 로컬에만** 남고, 선생님이 로그인해 동기화할 때 덮어씌워질 수 있습니다.

## 보안 규칙 예시 (인증된 사용자만 본인 문서)

개발용으로 잠깐 테스트할 때와, 배포 시 모두 **인증**을 기준으로 좁히는 것을 권장합니다.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

공개 HTML에 `if true` 규칙을 두면 누구나 읽기/쓰기가 가능합니다.

## 데이터 한도

- 문서당 최대 약 **1MB** (`payloadJson`).

## 로컬 캐시

- 로그인 후 Firestore에서 받은 내용이 **메모리 + localStorage**에도 들어갑니다.
- **로그아웃** 시 세션·로컬 캐시·동기화 참조를 비웁니다.
