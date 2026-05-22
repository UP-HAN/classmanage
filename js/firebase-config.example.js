/**
 * 이 파일을 복사해 `firebase-config.js`로 저장한 뒤 Firebase 콘솔 값을 채웁니다.
 * `firebase-config.js`는 비공개 저장소에만 두거나 .gitignore에 넣으세요.
 *
 * enabled: true 일 때
 *   - Authentication에서 이메일/비밀번호 로그인 사용
 *   - 선생님 계정을 콘솔에서 추가한 뒤 app에서 로그인
 */
window.ClassStatusFirebaseConfig = {
  /** true: Firebase 로그인 + Firestore 동기화 (users/{uid}/classStatus/main) */
  enabled: false,
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  /** 선생님 계정의 Firebase Auth UID (학생 로그인 시 같은 학급 DB를 불러오기 위해 필요) */
  teacherFirestoreUid: "",
};
