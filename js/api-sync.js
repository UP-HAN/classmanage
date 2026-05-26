(function (global) {
  var serverConfig = {
    enabled: true,
    apiUrl: "https://class.ches.es.kr"
  };
  global.ClassStatusServerConfig = serverConfig;

  var syncEnabled = false;
  var currentSession = null;

  function isSyncActive() {
    if (syncEnabled) return true;
    var C = global.ClassStatusCore;
    if (C && typeof C.getSession === "function") {
      var s = C.getSession();
      if (s && s.userId) {
        syncEnabled = true;
        return true;
      }
    }
    return false;
  }

  function isServerCloudEnabled() {
    var cfg = global.ClassStatusServerConfig;
    return !!(cfg && cfg.enabled && String(cfg.apiUrl || "").trim());
  }

  function fetchFromApi(endpoint, options) {
    var cfg = global.ClassStatusServerConfig;
    var url = cfg.apiUrl + endpoint;
    options = options || {};
    options.headers = options.headers || {};
    options.headers["Content-Type"] = "application/json";
    
    // Inject selected class year from local storage if set
    var selectedYear = localStorage.getItem("currentClassYear");
    if (selectedYear) {
      options.headers["X-Class-Year"] = selectedYear;
    }

    // Inject session info for server-side smart merge
    var C = global.ClassStatusCore;
    if (C && typeof C.getSession === "function") {
      var session = C.getSession();
      if (session) {
        if (session.role) {
          options.headers["X-Session-Role"] = session.role;
        }
        if (session.studentId) {
          options.headers["X-Session-Student-Id"] = session.studentId;
        }
      }
    }
    
    return fetch(url, options).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (err) {
          throw new Error(err.msg || "API 요청 실패");
        });
      }
      return res.json();
    });
  }

  function login(loginId, password) {
    return fetchFromApi("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ loginId: loginId, password: password })
    }).then(function (data) {
      if (data.ok && data.session) {
        var C = global.ClassStatusCore;
        if (C) {
          C.setSession(data.session);
        }
        currentSession = data.session;
        syncEnabled = true;
        return data.session;
      }
      throw new Error("로그인 응답 형식이 올바르지 않습니다.");
    });
  }

  // 아바타 원격 서버 저장
  function uploadAvatar(studentId, avatarDataUrl, avatarCustom) {
    if (!isServerCloudEnabled()) return Promise.resolve();
    return fetchFromApi("/api/students/" + studentId + "/avatar", {
      method: "POST",
      body: JSON.stringify({ avatarDataUrl: avatarDataUrl, avatarCustom: avatarCustom })
    });
  }

  // API 서버로부터 전체 DB 로드 및 로컬 DB 갱신
  function syncStudentsFromRemote() {
    if (!isServerCloudEnabled() || !isSyncActive()) return Promise.resolve();
    return fetchFromApi("/api/sync")
      .then(function (data) {
        if (data.ok && data.db) {
          var C = global.ClassStatusCore;
          if (!C) return;
          C.hydrateDb(data.db);
        }
      })
      .catch(function (err) {
        console.warn("[ClassStatus] 원격 데이터 동기화 실패:", err);
      });
  }

  var DEBOUNCE_MS = 1000;
  var debounceTimer = null;

  function afterLocalSave(db, immediate) {
    if (!isServerCloudEnabled() || !isSyncActive()) return;
    clearTimeout(debounceTimer);
    
    function upload() {
      return fetchFromApi("/api/sync", {
        method: "POST",
        body: JSON.stringify(db)
      }).catch(function (err) {
        console.warn("[ClassStatus] Express 서버 저장 실패:", err);
      });
    }

    if (immediate) {
      upload();
    } else {
      debounceTimer = setTimeout(upload, DEBOUNCE_MS);
    }
  }

  function getYearsList() {
    if (!isServerCloudEnabled()) return Promise.resolve({ ok: false, years: [], activeYear: null });
    return fetchFromApi("/api/years");
  }

  function createYear(year) {
    if (!isServerCloudEnabled()) return Promise.reject(new Error("Cloud server not enabled"));
    return fetchFromApi("/api/years", {
      method: "POST",
      body: JSON.stringify({ year: year })
    });
  }

  function setActiveYear(year) {
    if (!isServerCloudEnabled()) return Promise.reject(new Error("Cloud server not enabled"));
    return fetchFromApi("/api/years/active", {
      method: "POST",
      body: JSON.stringify({ year: year })
    });
  }

  global.ClassStatusServer = {
    isServerCloudEnabled: isServerCloudEnabled,
    login: login,
    uploadAvatar: uploadAvatar,
    syncStudentsFromRemote: syncStudentsFromRemote,
    afterLocalSave: afterLocalSave,
    isSyncEnabled: isSyncActive,
    getYearsList: getYearsList,
    createYear: createYear,
    setActiveYear: setActiveYear
  };
})(typeof window !== "undefined" ? window : this);

