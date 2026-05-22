(function (global) {
  var STORAGE_KEY = "class-status-db-v1";
  var SESSION_KEY = "classStatusSession";
  /** Firebase 등에서 주입 시 메모리가 우선 (동기 loadDb와 호환) */
  var memoryDb = null;

  function randomSalt() {
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function hex(buf) {
    return Array.from(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function hashPassword(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle
      .digest("SHA-256", enc.encode(salt + "|" + password))
      .then(hex);
  }

  function loadDb() {
    if (memoryDb) return memoryDb;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /**
   * 클라우드에서 받은 DB로 메모리·로컬 스토리지만 갱신 (원격 저장 트리거 없음)
   */
  function hydrateDb(db) {
    if (!db || typeof db !== "object") return;
    memoryDb = db;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {}
    if (typeof window !== "undefined") {
      window.__avatarsCompressedThisSession = false;
    }
  }

  function saveDb(db, immediate) {
    if (!db || typeof db !== "object") return;
    if (db.activityLogs && Array.isArray(db.activityLogs) && db.activityLogs.length > 150) {
      db.activityLogs = db.activityLogs.slice(-150);
    }
    if (db.recyclerLogs && Array.isArray(db.recyclerLogs) && db.recyclerLogs.length > 50) {
      db.recyclerLogs = db.recyclerLogs.slice(-50);
    }
    if (db.envLogs && Array.isArray(db.envLogs) && db.envLogs.length > 50) {
      db.envLogs = db.envLogs.slice(-50);
    }
    if (db.bulkAdjustments && Array.isArray(db.bulkAdjustments) && db.bulkAdjustments.length > 50) {
      db.bulkAdjustments = db.bulkAdjustments.slice(-50);
    }
    if (db.couponShop && db.couponShop.merchantLog && Array.isArray(db.couponShop.merchantLog) && db.couponShop.merchantLog.length > 100) {
      db.couponShop.merchantLog = db.couponShop.merchantLog.slice(-100);
    }
    if (db.canteenShop && db.canteenShop.merchantLog && Array.isArray(db.canteenShop.merchantLog) && db.canteenShop.merchantLog.length > 100) {
      db.canteenShop.merchantLog = db.canteenShop.merchantLog.slice(-100);
    }
    memoryDb = db;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {}
    if (global.ClassStatusServer && typeof global.ClassStatusServer.afterLocalSave === "function") {
      global.ClassStatusServer.afterLocalSave(db, immediate);
    } else if (global.ClassStatusFirebase && typeof global.ClassStatusFirebase.afterLocalSave === "function") {
      global.ClassStatusFirebase.afterLocalSave(db, immediate);
    }
  }

  function ensureDb() {
    var db = loadDb();
    if (db && db.users && db.users.length) {
      return Promise.resolve(db);
    }
    var salt = randomSalt();
    return hashPassword("demo123", salt).then(function (hash) {
      var next = {
        version: 1,
        users: [
          {
            id: "u-teacher",
            loginId: "teacher",
            passwordHash: hash,
            salt: salt,
            role: "teacher",
            displayName: "담임",
          },
        ],
        students: [],
        titleGrants: [],
        activityLogs: [],
        bulkAdjustments: [],
        behaviorNotes: [],
        classJobQuotas: {},
        bankPayrollRequests: [],
        taxCollectionRequests: [],
        djRequests: [],
        recyclerLogs: [],
        envLogs: [],
        hallOfFame: {
          bestNotes: [null, null, null],
          bestGroup: ["", "", ""],
          bestPresenter: [null, null, null]
        },
      };
      saveDb(next);
      return next;
    });
  }

  function findUserByLoginId(db, loginId) {
    var id = String(loginId).trim();
    for (var i = 0; i < db.users.length; i++) {
      if (db.users[i].loginId === id) return db.users[i];
    }
    return null;
  }

  function verifyUserPassword(user, password) {
    return hashPassword(password, user.salt).then(function (h) {
      return h === user.passwordHash;
    });
  }

  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setSession(obj) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function clearDbCache() {
    memoryDb = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  function uid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  global.ClassStatusCore = {
    STORAGE_KEY: STORAGE_KEY,
    SESSION_KEY: SESSION_KEY,
    loadDb: loadDb,
    saveDb: saveDb,
    hydrateDb: hydrateDb,
    ensureDb: ensureDb,
    hashPassword: hashPassword,
    randomSalt: randomSalt,
    findUserByLoginId: findUserByLoginId,
    verifyUserPassword: verifyUserPassword,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    clearDbCache: clearDbCache,
    uid: uid,
  };
})(typeof window !== "undefined" ? window : this);
