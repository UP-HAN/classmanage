/**
 * Firestore: users/{uid}/classStatus/main 에 전체 DB JSON(payloadJson) 동기화.
 * Firebase compat SDK + Auth 로그인 후 initForUser(uid) 호출.
 */
(function (global) {
  var DEBOUNCE_MS = 200;
  var debounceTimer = null;
  var firestoreRef = null;
  var syncEnabled = false;
  /** @type {null | function(): void} */
  var firestoreUnsub = null;
  /** 동일 payloadJson 이 연속 스냅샷으로 올 때 hydrate·route 반복 방지 */
  var lastSnapshotPayloadJson = null;

  function readLocalStorageDb() {
    var C = global.ClassStatusCore;
    if (!C) return null;
    try {
      var raw = localStorage.getItem(C.STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function uploadPayload(db) {
    if (!firestoreRef || !db) return Promise.resolve();
    var payloadJson = JSON.stringify(db);
    lastSnapshotPayloadJson = payloadJson;
    return firestoreRef.set({
      payloadJson: payloadJson,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  }

  function warnFirestorePermissionOnce(err) {
    console.warn("[ClassStatus] Firestore 저장 실패:", err);
    if (!err || err.code !== "permission-denied") return;
    if (global.__classStatusFirestorePermDeniedWarned) return;
    global.__classStatusFirestorePermDeniedWarned = true;
    var msg =
      "클라우드(Firestore)에 저장이 거절되었습니다.\n\n" +
      "익명 학생이 아바타·비밀번호를 올릴 때도 선생님 학급 문서에 쓰기가 필요합니다.\n" +
      "프로젝트의 firestore.rules 에서 YOUR_TEACHER_AUTH_UID 를 선생님 UID로 바꾼 뒤\n" +
      "터미널에서: firebase deploy --only firestore:rules\n\n" +
      "자세한 설명: FIREBASE_SETUP.md";
    try {
      if (typeof global.alert === "function") global.alert(msg);
    } catch (e) {}
  }

  function afterLocalSave(db, immediate) {
    if (!syncEnabled || !firestoreRef) return;
    clearTimeout(debounceTimer);
    if (immediate) {
      uploadPayload(db).catch(warnFirestorePermissionOnce);
    } else {
      debounceTimer = setTimeout(function () {
        uploadPayload(db).catch(warnFirestorePermissionOnce);
      }, DEBOUNCE_MS);
    }
  }

  function resetSync() {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    if (typeof firestoreUnsub === "function") {
      try {
        firestoreUnsub();
      } catch (e) {}
      firestoreUnsub = null;
    }
    firestoreRef = null;
    syncEnabled = false;
    lastSnapshotPayloadJson = null;
  }

  function notifyDbSyncedFromRemote() {
    try {
      if (typeof global.dispatchEvent === "function" && global.CustomEvent) {
        global.dispatchEvent(new CustomEvent("classstatus-db-synced"));
      }
    } catch (e) {}
  }

  function attachFirestoreSnapshotListener() {
    if (!firestoreRef || typeof firestoreRef.onSnapshot !== "function") return;
    if (typeof firestoreUnsub === "function") {
      try {
        firestoreUnsub();
      } catch (e) {}
      firestoreUnsub = null;
    }
    firestoreUnsub = firestoreRef.onSnapshot(
      function (snap) {
        if (!snap || !snap.exists) return;
        var data = snap.data() || {};
        var raw = data.payloadJson;
        if (typeof raw !== "string" || !raw.length) return;
        if (raw === lastSnapshotPayloadJson) return;
        try {
          var parsed = JSON.parse(raw);
          if (!parsed || !parsed.users) return;
          var C = global.ClassStatusCore;
          if (!C || typeof C.hydrateDb !== "function") return;
          lastSnapshotPayloadJson = raw;
          C.hydrateDb(parsed);
          notifyDbSyncedFromRemote();
        } catch (e) {
          console.warn("[ClassStatus] 원격 payload 적용 실패:", e);
        }
      },
      function (err) {
        console.warn("[ClassStatus] Firestore 스냅샷 오류:", err);
      }
    );
  }

  /**
   * @param {string} uid Firebase Auth uid
   */
  function initForUser(uid) {
    resetSync();
    var cfg = global.ClassStatusFirebaseConfig;
    if (!cfg || !cfg.enabled || !String(cfg.apiKey || "").trim()) {
      return Promise.resolve(false);
    }
    if (typeof firebase === "undefined" || !firebase.initializeApp) {
      console.warn("[ClassStatus] Firebase SDK가 없습니다.");
      return Promise.resolve(false);
    }
    if (!uid) {
      return Promise.resolve(false);
    }

    try {
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(cfg);
      }
    } catch (e) {
      console.warn("[ClassStatus] Firebase 초기화 실패:", e);
      return Promise.resolve(false);
    }

    var fs = firebase.firestore();
    firestoreRef = fs.collection("users").doc(uid).collection("classStatus").doc("main");
    var C = global.ClassStatusCore;
    if (!C) {
      console.warn("[ClassStatus] ClassStatusCore가 없습니다.");
      return Promise.resolve(false);
    }

    return firestoreRef
      .get()
      .then(function (snap) {
        if (snap.exists) {
          var data = snap.data() || {};
          var raw = data.payloadJson;
          if (typeof raw === "string" && raw.length) {
            try {
              var parsed = JSON.parse(raw);
              if (parsed && parsed.users) {
                lastSnapshotPayloadJson = raw;
                C.hydrateDb(parsed);
                syncEnabled = true;
                attachFirestoreSnapshotListener();
                return true;
              }
            } catch (e) {
              console.warn("[ClassStatus] 클라우드 payload 파싱 실패:", e);
            }
          }
        }

        var local = readLocalStorageDb();
        if (local && local.users && local.users.length) {
          C.hydrateDb(local);
          syncEnabled = true;
          return uploadPayload(local).then(function () {
            attachFirestoreSnapshotListener();
            return true;
          });
        }

        syncEnabled = true;
        attachFirestoreSnapshotListener();
        return true;
      })
      .catch(function (err) {
        console.warn("[ClassStatus] Firestore 읽기 실패:", err);
        syncEnabled = false;
        firestoreRef = null;
        return false;
      })
      .then(function (ok) {
        if (ok) syncEnabled = !!firestoreRef;
        return ok;
      });
  }

  global.ClassStatusFirebase = {
    initForUser: initForUser,
    afterLocalSave: afterLocalSave,
    resetSync: resetSync,
    isSyncEnabled: function () {
      return syncEnabled;
    },
  };
})(typeof window !== "undefined" ? window : this);
