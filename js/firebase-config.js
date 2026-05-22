/**
 * Firebase 연동 시 enabled: true 및 아래 값을 채웁니다.
 * (firebase-config.example.js 참고)
 */
window.ClassStatusFirebaseConfig = {
  /** true: Firebase 로그인 + Firestore 동기화 */
  enabled: true,
  apiKey: "AIzaSyDQUsqYxtdy9z0pKnSy8yDPHBajT8VqdB4",
  authDomain: "cm-c58c2.firebaseapp.com",
  projectId: "cm-c58c2",
  storageBucket: "cm-c58c2.firebasestorage.app",
  messagingSenderId: "390173906593",
  appId: "1:390173906593:web:321d68154a5b0aebca82e0",
  measurementId: "G-LX2SPQGG3W",
  /** Authentication → 선생님 계정 UID (학생·Firestore 경로와 동일해야 함) */
  teacherFirestoreUid: "4acblY6SDDcflRd2H6HpzwtWVvi1",
};
