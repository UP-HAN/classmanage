(function () {
  var C = window.ClassStatusCore;
  if (!C) {
    console.error("ClassStatusCore missing");
    return;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  var taxFilterStart = "";
  var taxFilterEnd = "";

  function tsToYmd(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var dd = d.getDate();
    return y + "-" + (m < 10 ? "0" + m : m) + "-" + (dd < 10 ? "0" + dd : dd);
  }

  function isTimestampInRange(ts, start, end) {
    if (!ts) return false;
    var ymd = tsToYmd(ts);
    if (start && ymd < start) return false;
    if (end && ymd > end) return false;
    return true;
  }

  function fmtTime(ts) {
    try {
      return new Date(ts).toLocaleString("ko-KR");
    } catch (e) {
      return "";
    }
  }

  function fmtDateShort(ts) {
    try {
      var d = new Date(ts);
      return d.getMonth() + 1 + "/" + d.getDate();
    } catch (e) {
      return "—";
    }
  }

  function fmtMonthKo(ts) {
    try {
      return new Date(ts).getMonth() + 1 + "월";
    } catch (e) {
      return "—";
    }
  }

  /** 경험치 스케일: 최소 0, 최대 100(=100% 표시) */
  var EXP_MAX = 100;

  function clampExp(exp) {
    var e = typeof exp === "number" && !isNaN(exp) ? exp : 0;
    if (e < 0) return 0;
    if (e > EXP_MAX) return EXP_MAX;
    return e;
  }

  /**
   * EXP가 100% 이상이면 자동 레벨업.
   * LV +1, EXP는 초과분 유지 (예: 110 → LV+1, EXP=10).
   * 여러 레벨을 한 번에 올라갈 수도 있음 (EXP 200 → LV+2, EXP=0).
   * @param {object} st - student 객체 (st.lv, st.exp 직접 수정)
   * @param {object} db - db 객체 (활동 로그 기록용)
   * @returns {number} 올라간 레벨 수
   */
  function autoLevelUp(st, db) {
    if (!st) return 0;
    var levelsGained = 0;
    var raw = typeof st.exp === "number" && !isNaN(st.exp) ? st.exp : 0;
    while (raw >= EXP_MAX) {
      raw -= EXP_MAX;
      st.lv = (typeof st.lv === "number" && !isNaN(st.lv) ? st.lv : 1) + 1;
      levelsGained++;
    }
    st.exp = Math.max(0, raw);
    if (levelsGained > 0 && db) {
      addActivityLog(db, {
        studentId: st.id,
        summary: "🎉 레벨 업! LV " + (st.lv - levelsGained) + " → LV " + st.lv + " (경험치 100% 달성)",
        expDelta: 0,
      });
    }
    return levelsGained;
  }

  function expPercentProgress(exp) {
    var e = clampExp(exp);
    return { current: e, max: EXP_MAX, pct: e };
  }

  function expRemainToFull(exp) {
    return Math.max(0, EXP_MAX - clampExp(exp));
  }

  /** 통계청 체크리스트: 유효 점수가 +1 될 때마다 EXP +20(%p), -1 될 때마다 EXP -10(%p) */
  function statsExpChangeFromUnitDelta(units) {
    if (units > 0) return units * 20;
    if (units < 0) return units * 10;
    return 0;
  }

  function studentCoupons(st) {
    return typeof st.coupons === "number" && !isNaN(st.coupons) ? st.coupons : 0;
  }

  function lastExpGainLog(logs) {
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].expDelta !== 0) return logs[i];
    }
    return null;
  }

  function getDb() {
    var db = C.loadDb();
    if (db) {
      ensureHallOfFame(db);
      autoCompressLargeAvatars(db);
    }
    return db;
  }

  function saveDb(db, immediate) {
    return C.saveDb(db, immediate);
  }

  function requireSession() {
    var s = C.getSession();
    if (s && s.userId) return s;
    return null;
  }

  function getUser(db, id) {
    for (var i = 0; i < db.users.length; i++) {
      if (db.users[i].id === id) return db.users[i];
    }
    return null;
  }

  function getStudent(db, id) {
    for (var i = 0; i < db.students.length; i++) {
      if (db.students[i].id === id) return db.students[i];
    }
    return null;
  }

  function normStudentLoginId(raw) {
    return String(raw || "")
      .trim()
      .replace(/\s+/g, "");
  }

  function normalizePinDigits(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (!d.length) return "0000";
    if (d.length >= 4) return d.slice(-4);
    while (d.length < 4) d = "0" + d;
    return d.slice(-4);
  }

  function findStudentUserByLoginId(db, loginRaw) {
    if (!db || !db.users) return null;
    var key = normStudentLoginId(loginRaw);
    if (!key) return null;
    var i;
    for (i = 0; i < db.users.length; i++) {
      var u = db.users[i];
      if (u.role !== "student") continue;
      if (normStudentLoginId(u.loginId) === key) return u;
    }
    return null;
  }

  function findStudentUserForLogin(db, loginRaw) {
    var u = findStudentUserByLoginId(db, loginRaw);
    if (u) return u;
    var key = normStudentLoginId(loginRaw);
    if (!key) return null;
    var i;
    for (i = 0; i < db.users.length; i++) {
      var usr = db.users[i];
      if (usr.role !== "student") continue;
      var st = getStudent(db, usr.studentId);
      if (st && String(st.number) === key) return usr;
    }
    return null;
  }

  function verifyStudentLogin(user, pin) {
    if (!user || user.role !== "student") return Promise.resolve(false);
    var p = normalizePinDigits(pin);
    if (typeof user.pinCode === "string" && /^\d{4}$/.test(user.pinCode)) {
      return Promise.resolve(user.pinCode === p);
    }
    return C.verifyUserPassword(user, p);
  }

  function studentUserNeedsPinChange(db, session) {
    if (!db || !session || session.role !== "student") return false;
    var u = getUser(db, session.userId);
    if (!u || u.role !== "student") return false;
    if (u.pinMustChange === true) return true;
    if (typeof u.pinCode === "string" && u.pinCode === "0000") return true;
    return false;
  }

  function studentByNumber(db, num) {
    var n = String(num).trim();
    for (var i = 0; i < db.students.length; i++) {
      if (String(db.students[i].number) === n) return db.students[i];
    }
    return null;
  }

  function normHeaderCell(h) {
    return String(h || "")
      .replace(/\s/g, "")
      .replace(/[()]/g, "")
      .toLowerCase();
  }

  function findColIndex(headers, candidates) {
    var i, j, c, h;
    for (i = 0; i < headers.length; i++) {
      h = normHeaderCell(headers[i]);
      for (j = 0; j < candidates.length; j++) {
        c = candidates[j].toLowerCase();
        if (h === c || h.indexOf(c) === 0) return i;
      }
    }
    return -1;
  }

  /** 직업 vs 직업ID 구분 등 정확히 일치할 때 */
  function findColIndexExact(headers, exactNorm) {
    var i;
    var t = String(exactNorm || "")
      .replace(/\s/g, "")
      .toLowerCase();
    for (i = 0; i < headers.length; i++) {
      if (normHeaderCell(headers[i]) === t) return i;
    }
    return -1;
  }

  function syncStudentLoginDisplayName(db, student) {
    if (!db || !student) return;
    var nid = normStudentLoginId(student.name);
    var i;
    for (i = 0; i < db.users.length; i++) {
      if (db.users[i].studentId === student.id) {
        db.users[i].displayName = student.name;
        if (nid) db.users[i].loginId = nid;
        return;
      }
    }
  }

  function resolveJobIdFromExcelRow(row, idxLabel, idxId) {
    var idRaw = idxId >= 0 ? cellStr(row, idxId).trim() : "";
    if (idRaw) {
      if (idRaw === "bank") idRaw = "bank_m";
      if (idRaw === "tax") idRaw = "tax_m";
      if (getJobDef(idRaw)) return { jobId: idRaw, err: null };
      return { jobId: null, err: "알 수 없는 직업ID: " + idRaw };
    }
    var labelRaw = idxLabel >= 0 ? cellStr(row, idxLabel).trim() : "";
    if (!labelRaw) return { jobId: "", err: null };
    if (labelRaw === "은행") return { jobId: "bank_m", err: null };
    if (labelRaw === "국세직원") return { jobId: "tax_m", err: null };
    var j;
    for (j = 0; j < CLASS_JOBS.length; j++) {
      if (CLASS_JOBS[j].label === labelRaw) return { jobId: CLASS_JOBS[j].id, err: null };
    }
    return { jobId: null, err: "알 수 없는 직업명: " + labelRaw };
  }

  function downloadStudentDetailExcelExport() {
    if (typeof XLSX === "undefined") {
      alert("엑셀 처리를 불러오는 중입니다. 네트워크 확인 후 새로고침해 주세요.");
      return;
    }
    var db = getDb();
    if (!db) return;
    ensureClassJobSettings(db);
    var sorted = db.students.slice().sort(function (a, b) {
      return Number(a.number) - Number(b.number);
    });
    var header = ["번호", "이름", "성별", "LV", "EXP", "Calory", "소지쿠폰", "직업", "직업ID", "칭호"];
    var aoa = [header];
    var ri;
    for (ri = 0; ri < sorted.length; ri++) {
      var s = sorted[ri];
      var g = studentGender(s);
      var genderStr = g === "male" ? "남" : g === "female" ? "여" : "";
      var jd = getJobDef(s.jobId);
      var jobLabel = jd ? jd.label : "";
      var jobId = s.jobId ? String(s.jobId) : "";
      var titles = titlesForStudent(db, s.id);
      var titleStr = titles
        .map(function (t) {
          return t.titleText;
        })
        .join(", ");
      aoa.push([
        String(s.number),
        s.name,
        genderStr,
        s.lv,
        s.exp,
        s.calory,
        studentCoupons(s),
        jobLabel,
        jobId,
        titleStr,
      ]);
    }
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 8 },
      { wch: 12 },
      { wch: 6 },
      { wch: 5 },
      { wch: 8 },
      { wch: 8 },
      { wch: 8 },
      { wch: 12 },
      { wch: 14 },
      { wch: 40 },
    ];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "학생상세");
    var d = new Date();
    var fn = "학급_학생상세_" + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + ".xlsx";
    XLSX.writeFile(wb, fn);
  }

  function parseTeacherStudentBulkUpdateRows(rows) {
    var patches = [];
    var errors = [];
    if (!rows || rows.length < 2) {
      errors.push("시트에 데이터가 없습니다.");
      return { patches: patches, errors: errors };
    }
    var headers = rows[0];
    var noi = findColIndex(headers, ["번호", "number", "no"]);
    if (noi < 0) {
      errors.push("첫 행에 「번호」열이 필요합니다.");
      return { patches: patches, errors: errors };
    }

    var ni = findColIndex(headers, ["이름", "name"]);
    var gi = findColIndex(headers, ["성별", "gender"]);
    var lvi = findColIndex(headers, ["lv", "레벨"]);
    var exi = findColIndex(headers, ["exp", "경험"]);
    var ci = findColIndex(headers, ["calory", "칼로리", "소지금"]);
    var coi = findColIndex(headers, ["소지쿠폰", "쿠폰", "coupon"]);
    var jobLabelI = findColIndexExact(headers, "직업");
    var jobIdI = findColIndexExact(headers, "직업id");
    if (jobIdI < 0) jobIdI = findColIndex(headers, ["job_id", "jobid"]);
    var titlesI = findColIndexExact(headers, "칭호");
    if (titlesI < 0) titlesI = findColIndex(headers, ["칭호목록", "titles"]);

    var hasJobCols = jobLabelI >= 0 || jobIdI >= 0;
    var hasTitlesCol = titlesI >= 0;

    var r;
    for (r = 1; r < rows.length && r < 300; r++) {
      var row = rows[r];
      if (!row || !row.length) continue;
      var numStr = cellStr(row, noi);
      if (!numStr) continue;
      var patch = { rowNum: r + 1, number: numStr };
      if (ni >= 0) {
        var nm = cellStr(row, ni);
        if (nm) patch.name = nm;
      }
      if (gi >= 0) {
        var gRaw = cellStr(row, gi);
        if (gRaw) patch.gender = normalizeGender(gRaw);
      }
      if (lvi >= 0) {
        var nlv = cellNum(row, lvi, -1);
        if (nlv >= 1) patch.lv = nlv;
      }
      if (exi >= 0) {
        var nex = cellNum(row, exi, 0);
        if (!isNaN(parseInt(cellStr(row, exi), 10))) patch.exp = nex;
      }
      if (ci >= 0) {
        var ncal = cellNum(row, ci, 0);
        patch.calory = ncal;
      }
      if (coi >= 0) {
        var nco = cellNum(row, coi, 0);
        if (nco < 0) nco = 0;
        patch.coupons = nco;
      }

      if (hasJobCols) {
        var jr = resolveJobIdFromExcelRow(row, jobLabelI, jobIdI);
        if (jr.err) {
          errors.push("행 " + (r + 1) + ": " + jr.err);
          continue;
        }
        patch.jobId = jr.jobId;
        patch._applyJob = true;
      }

      if (hasTitlesCol) {
        patch.titlesRaw = cellStr(row, titlesI);
        patch._applyTitles = true;
      }

      patches.push(patch);
    }
    return { patches: patches, errors: errors };
  }

  function applyBulkStudentPatches(db, patches) {
    var rowErrs = [];
    var ok = 0;
    var pi;
    for (pi = 0; pi < patches.length; pi++) {
      var patch = patches[pi];
      var st = studentByNumber(db, patch.number);
      if (!st) {
        rowErrs.push("행 " + patch.rowNum + ": 번호 " + patch.number + " 학생 없음");
        continue;
      }



      if (patch.name !== undefined) {
        st.name = patch.name;
        syncStudentLoginDisplayName(db, st);
      }
      if (patch.gender !== undefined) st.gender = patch.gender;
      if (patch.lv !== undefined) st.lv = patch.lv;
      if (patch.exp !== undefined) st.exp = clampExp(patch.exp);
      if (patch.calory !== undefined) st.calory = patch.calory;
      if (patch.coupons !== undefined) st.coupons = patch.coupons;

      if (patch._applyJob) {
        if (patch.jobId === "") delete st.jobId;
        else if (patch.jobId) st.jobId = patch.jobId;
      }

      if (patch._applyTitles) {
        db.titleGrants = db.titleGrants.filter(function (t) {
          return t.studentId !== st.id;
        });
        var raw = patch.titlesRaw || "";
        var parts = String(raw).split(/[,，]/);
        var qi;
        for (qi = 0; qi < parts.length; qi++) {
          var tx = String(parts[qi]).trim();
          if (!tx) continue;
          db.titleGrants.push({
            id: C.uid(),
            studentId: st.id,
            titleText: tx,
            acquiredAt: Date.now(),
          });
        }
      }

      ok++;
    }
    return { ok: ok, rowErrs: rowErrs };
  }

  function runExcelStudentBulkUpdate(file) {
    if (!file) return;
    if (typeof XLSX === "undefined") {
      alert("엑셀 처리를 불러오는 중입니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var data = new Uint8Array(e.target.result);
      var wb;
      try {
        wb = XLSX.read(data, { type: "array" });
      } catch (ex) {
        alert("파일을 읽을 수 없습니다. .xlsx 또는 .xls 형식인지 확인해 주세요.");
        return;
      }
      var sheetName = wb.SheetNames[0];
      var sheet = wb.Sheets[sheetName];
      var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      var parsed = parseTeacherStudentBulkUpdateRows(rows);
      if (parsed.errors.length && !parsed.patches.length) {
        alert(parsed.errors.join("\n"));
        return;
      }
      if (parsed.errors.length) {
        alert(parsed.errors.join("\n"));
      }
      if (!parsed.patches.length) {
        alert("반영할 행이 없습니다. 「번호」열을 확인해 주세요.");
        return;
      }
      var db = getDb();
      if (!db) return;
      ensureClassJobSettings(db);
      var result = applyBulkStudentPatches(db, parsed.patches);
      saveDb(db);
      var msg = "반영 완료: " + result.ok + "명 처리";
      if (result.rowErrs.length) {
        msg += "\n\n오류:\n" + result.rowErrs.slice(0, 25).join("\n");
        if (result.rowErrs.length > 25) msg += "\n… 외 " + (result.rowErrs.length - 25) + "건";
      }
      alert(msg);
      window.location.hash = "#/teacher/students";
    };
    reader.onerror = function () {
      alert("파일을 읽지 못했습니다.");
    };
    reader.readAsArrayBuffer(file);
  }

  function cellStr(row, idx) {
    if (!row || idx < 0 || idx >= row.length) return "";
    var v = row[idx];
    if (v === null || v === undefined) return "";
    if (typeof v === "number") {
      if (Number.isInteger(v)) return String(v);
      return String(Math.floor(v)).trim();
    }
    return String(v).trim();
  }

  function cellNum(row, idx, def) {
    var s = cellStr(row, idx);
    if (s === "") return def;
    var n = parseInt(s, 10);
    if (isNaN(n)) return def;
    return n;
  }

  function normalizeGender(g) {
    var t = String(g || "")
      .trim()
      .toLowerCase();
    if (t === "m" || t === "male" || t === "남" || t === "남자" || t === "남학생" || t === "boy") return "male";
    if (t === "f" || t === "female" || t === "여" || t === "여자" || t === "여학생" || t === "girl") return "female";
    return "female";
  }

  function studentGender(s) {
    return normalizeGender(s && s.gender);
  }

  function genderLabelKo(g) {
    return g === "male" ? "남학생" : "여학생";
  }

  function sanitizeAvatarId(s) {
    return String(s || "x")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 14) || "av";
  }

  function downloadStudentExcelTemplate() {
    if (typeof XLSX === "undefined") {
      alert("엑셀 처리를 불러오는 중입니다. 네트워크 확인 후 새로고침해 주세요.");
      return;
    }
    var ws = XLSX.utils.aoa_to_sheet([
      ["이름", "번호", "성별", "비밀번호", "LV", "EXP", "Calory", "소지쿠폰"],
      ["예시학생", "1", "여", "0000", "1", "0", "0", "0"],
    ]);
    ws["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 10 }, { wch: 10 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "학생목록");
    XLSX.writeFile(wb, "학급_학생등록_양식.xlsx");
  }

  function parseTeacherStudentImportRows(rows) {
    var items = [];
    var err = [];
    if (!rows || rows.length < 2) {
      err.push("시트에 데이터가 없습니다.");
      return { items: items, errors: err };
    }
    var headers = rows[0];
    var ni = findColIndex(headers, ["이름", "name"]);
    var noi = findColIndex(headers, ["번호", "number", "no"]);
    var pi = findColIndex(headers, ["비밀번호", "password"]);
    var lvi = findColIndex(headers, ["lv", "레벨"]);
    var exi = findColIndex(headers, ["exp", "경험"]);
    var ci = findColIndex(headers, ["calory", "칼로리", "소지금"]);
    var coi = findColIndex(headers, ["소지쿠폰", "쿠폰", "coupon"]);
    var gi = findColIndex(headers, ["성별", "gender", "sex"]);

    if (ni < 0 || noi < 0) {
      err.push("첫 행에 「이름」「번호」열이 있어야 합니다.");
      return { items: items, errors: err };
    }

    var seenNumbers = {};
    var seenLoginNames = {};
    var r;
    for (r = 1; r < rows.length && r < 200; r++) {
      var row = rows[r];
      if (!row || !row.length) continue;
      var name = cellStr(row, ni);
      var number = cellStr(row, noi);
      if (!name && !number) continue;
      if (!name || !number) {
        err.push("행 " + (r + 1) + ": 이름·번호를 모두 입력해 주세요.");
        continue;
      }
      var nk = normStudentLoginId(name);
      if (seenNumbers[number]) {
        err.push("행 " + (r + 1) + ": 번호 " + number + "이(가) 시트에서 중복됩니다.");
        continue;
      }
      if (nk && seenLoginNames[nk]) {
        err.push("행 " + (r + 1) + ": 이름(로그인 ID)이 시트에서 중복됩니다: " + name);
        continue;
      }
      seenNumbers[number] = true;
      if (nk) seenLoginNames[nk] = true;
      var password = cellStr(row, pi);
      if (!password) password = "0000";
      var lv = cellNum(row, lvi, 1);
      if (lv < 1) lv = 1;
      var exp = cellNum(row, exi, 0);
      var calory = cellNum(row, ci, 0);
      var coupons = cellNum(row, coi, 0);
      if (coupons < 0) coupons = 0;
      var genderRaw = gi >= 0 ? cellStr(row, gi) : "";
      var gender = normalizeGender(genderRaw);

      items.push({
        name: name,
        number: number,
        password: password,
        gender: gender,
        lv: lv,
        exp: exp,
        calory: calory,
        coupons: coupons,
        rowNum: r + 1,
      });
    }
    return { items: items, errors: err };
  }

  function importStudentsSequential(db, items, idx, stats, onDone) {
    if (idx >= items.length) {
      saveDb(db);
      onDone(stats);
      return;
    }
    var item = items[idx];
    if (studentByNumber(db, item.number)) {
      stats.duplicates.push("행 " + item.rowNum + " (번호 " + item.number + ")");
      importStudentsSequential(db, items, idx + 1, stats, onDone);
      return;
    }
    if (findStudentUserByLoginId(db, normStudentLoginId(item.name))) {
      stats.duplicates.push("행 " + item.rowNum + " (이름 로그인 중복: " + item.name + ")");
      importStudentsSequential(db, items, idx + 1, stats, onDone);
      return;
    }
    var sid = C.uid();
    db.students.push({
      id: sid,
      name: item.name,
      number: item.number,
      gender: item.gender != null ? item.gender : normalizeGender(""),
      lv: item.lv,
      exp: item.exp,
      calory: item.calory,
      coupons: item.coupons,
    });
    db.users.push({
      id: C.uid(),
      loginId: normStudentLoginId(item.name),
      pinCode: normalizePinDigits(item.password),
      pinMustChange: true,
      role: "student",
      displayName: item.name,
      studentId: sid,
    });
    addActivityLog(db, {
      studentId: sid,
      summary: "학급에 합류함 (엑셀 일괄 등록)",
      expDelta: 0,
    });
    stats.added++;
    importStudentsSequential(db, items, idx + 1, stats, onDone);
  }

  function runExcelStudentImport(file) {
    if (!file) return;
    if (typeof XLSX === "undefined") {
      alert("엑셀 처리를 불러오는 중입니다. 새로고침 후 다시 시도해 주세요.");
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var data = new Uint8Array(e.target.result);
      var wb;
      try {
        wb = XLSX.read(data, { type: "array" });
      } catch (ex) {
        alert("파일을 읽을 수 없습니다. .xlsx 또는 .xls 형식인지 확인해 주세요.");
        return;
      }
      var sheetName = wb.SheetNames[0];
      var sheet = wb.Sheets[sheetName];
      var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      var parsed = parseTeacherStudentImportRows(rows);
      if (parsed.errors.length && !parsed.items.length) {
        alert(parsed.errors.join("\n"));
        return;
      }
      if (parsed.errors.length) {
        alert(parsed.errors.join("\n"));
      }
      if (!parsed.items.length) {
        alert("추가할 학생 행이 없습니다. 이름·번호를 입력했는지 확인해 주세요.");
        return;
      }
      var db = getDb();
      var stats = { added: 0, duplicates: [] };
      importStudentsSequential(db, parsed.items, 0, stats, function (st) {
        var msg = "추가 완료: " + st.added + "명";
        if (st.duplicates.length) {
          msg += "\n\n건너뜀 (이미 같은 번호):\n" + st.duplicates.slice(0, 15).join("\n");
          if (st.duplicates.length > 15) msg += "\n… 외 " + (st.duplicates.length - 15) + "건";
        }
        alert(msg);
        window.location.hash = "#/teacher/students";
      });
    };
    reader.onerror = function () {
      alert("파일을 읽지 못했습니다.");
    };
    reader.readAsArrayBuffer(file);
  }

  function parseHash() {
    var h = window.location.hash.replace(/^#\/?/, "") || "";
    var parts = h
      .split("/")
      .map(function (p) {
        return String(p || "").trim();
      })
      .filter(Boolean);
    return parts;
  }

  function setHash(path) {
    window.location.hash = path.startsWith("#") ? path : "#/" + path;
  }

  function activityLogsForStudent(db, studentId) {
    return db.activityLogs
      .filter(function (l) {
        return l.studentId === studentId;
      })
      .sort(function (a, b) {
        return b.occurredAt - a.occurredAt;
      });
  }

  function titlesForStudent(db, studentId) {
    return db.titleGrants
      .filter(function (t) {
        return t.studentId === studentId;
      })
      .sort(function (a, b) {
        return b.acquiredAt - a.acquiredAt;
      });
  }



  function addActivityLog(db, rec) {
    var entry = {
      id: C.uid(),
      studentId: rec.studentId,
      occurredAt: rec.occurredAt != null ? rec.occurredAt : Date.now(),
      summary: rec.summary,
      expDelta: rec.expDelta != null ? rec.expDelta : 0,
      bulkJobId: rec.bulkJobId || null,
    };
    if (rec.caloryDelta != null && rec.caloryDelta !== 0) {
      entry.caloryDelta = rec.caloryDelta;
    }
    db.activityLogs.push(entry);
    if (db.activityLogs.length > 150) {
      db.activityLogs = db.activityLogs.slice(-150);
    }
  }

  /** 활동 로그 한 건 삭제. 로그에 기록된 expDelta·caloryDelta만큼 학생 수치를 되돌림 */
  function removeActivityLogEntry(db, logId, studentId) {
    if (!db || !Array.isArray(db.activityLogs) || !logId || !studentId) {
      return { ok: false, msg: "삭제할 수 없습니다." };
    }
    var log = null;
    var i;
    for (i = 0; i < db.activityLogs.length; i++) {
      if (db.activityLogs[i].id === logId) {
        log = db.activityLogs[i];
        break;
      }
    }
    if (!log || log.studentId !== studentId) {
      return { ok: false, msg: "해당 기록을 찾을 수 없습니다." };
    }
    var st = getStudent(db, studentId);
    if (!st) return { ok: false, msg: "학생을 찾을 수 없습니다." };
    var ed = typeof log.expDelta === "number" && !isNaN(log.expDelta) ? log.expDelta : 0;
    var cd = typeof log.caloryDelta === "number" && !isNaN(log.caloryDelta) ? log.caloryDelta : 0;
    var curExp = typeof st.exp === "number" && !isNaN(st.exp) ? st.exp : 0;
    var curCal = typeof st.calory === "number" && !isNaN(st.calory) ? st.calory : 0;
    st.exp = clampExp(curExp - ed);
    st.calory = Math.max(0, curCal - cd);
    db.activityLogs = db.activityLogs.filter(function (x) {
      return x.id !== logId;
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  /** 한 학생의 활동 로그를 모두 제거하고, 각 로그의 EXP·Calory 변화를 되돌림. 반환: 삭제한 로그 건수 */
  function clearAllActivityLogsForStudent(db, studentId) {
    if (!db || !Array.isArray(db.activityLogs) || !studentId) return 0;
    var st = getStudent(db, studentId);
    if (!st) return 0;
    var logs = db.activityLogs.filter(function (l) {
      return l.studentId === studentId;
    });
    if (!logs.length) return 0;
    var j;
    for (j = 0; j < logs.length; j++) {
      var log = logs[j];
      var ed = typeof log.expDelta === "number" && !isNaN(log.expDelta) ? log.expDelta : 0;
      var cd = typeof log.caloryDelta === "number" && !isNaN(log.caloryDelta) ? log.caloryDelta : 0;
      var curExp = typeof st.exp === "number" && !isNaN(st.exp) ? st.exp : 0;
      var curCal = typeof st.calory === "number" && !isNaN(st.calory) ? st.calory : 0;
      st.exp = clampExp(curExp - ed);
      st.calory = Math.max(0, curCal - cd);
    }
    db.activityLogs = db.activityLogs.filter(function (l) {
      return l.studentId !== studentId;
    });
    return logs.length;
  }

  function ensureBankPayrollRequests(db) {
    if (!db) return;
    if (!Array.isArray(db.bankPayrollRequests)) db.bankPayrollRequests = [];
  }

  function ensureTaxCollectionRequests(db) {
    if (!db) return;
    if (!Array.isArray(db.taxCollectionRequests)) db.taxCollectionRequests = [];
  }

  function ensurePostmanErrandRequests(db) {
    if (!db) return;
    if (!Array.isArray(db.postmanErrandRequests)) db.postmanErrandRequests = [];
  }

  function ensureCleaningChecklistRequests(db) {
    if (!db) return;
    if (!Array.isArray(db.cleaningChecklistRequests)) db.cleaningChecklistRequests = [];
  }

  function ensureDjSongRequests(db) {
    if (!db) return;
    if (!Array.isArray(db.djSongRequests)) db.djSongRequests = [];
  }

  function ensureDjDailyLogs(db) {
    if (!db) return;
    if (!Array.isArray(db.djDailyLogs)) db.djDailyLogs = [];
  }

  function ensureRecyclingLogs(db) {
    if (!db) return;
    if (!Array.isArray(db.recyclingLogs)) db.recyclingLogs = [];
  }

  function ensureEnvChecklistRequests(db) {
    if (!db) return;
    if (!Array.isArray(db.envChecklistRequests)) db.envChecklistRequests = [];
  }

  function ensureHallOfFame(db) {
    if (!db) return;
    if (!db.hallOfFame || typeof db.hallOfFame !== "object") {
      db.hallOfFame = {};
    }
    if (!Array.isArray(db.hallOfFame.bestNotes)) {
      db.hallOfFame.bestNotes = [null, null, null];
    }
    if (!Array.isArray(db.hallOfFame.bestGroup)) {
      db.hallOfFame.bestGroup = ["", "", ""];
    }
    if (!Array.isArray(db.hallOfFame.bestPresenter)) {
      db.hallOfFame.bestPresenter = [null, null, null];
    if (!Array.isArray(db.hallOfFame.excludedStudentIds)) {
      db.hallOfFame.excludedStudentIds = [];
    }
    }
  }

  /** 청소 체크리스트: 수요일·금요일만 */
  function isCleaningScheduleDay(d) {
    var day = d.getDay();
    return day === 3 || day === 5;
  }

  function weekdayLongKoFromDate(d) {
    var names = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
    return names[d.getDay()];
  }

  function cleaningRequestReferencesStudent(req, studentId) {
    if (!req || !studentId) return false;
    if (req.submittedByStudentId === studentId) return true;
    if (
      req.zone1StudentId === studentId ||
      req.zone2StudentId === studentId ||
      req.zone3StudentId === studentId ||
      req.zone4StudentId === studentId
    ) {
      return true;
    }
    var att = req.attentionStudentIds;
    if (Array.isArray(att) && att.indexOf(studentId) >= 0) return true;
    return false;
  }

  function getOrCreateCleaningDraft(db) {
    ensureCleaningChecklistRequests(db);
    var d = new Date();
    if (!isCleaningScheduleDay(d)) {
      return { ok: false, msg: "청소 체크리스트는 수요일·금요일에만 작성할 수 있습니다.", record: null };
    }
    var today = todayYmdLocal();
    var i;
    var rec = null;
    for (i = 0; i < db.cleaningChecklistRequests.length; i++) {
      if (db.cleaningChecklistRequests[i].dateYmd === today) {
        rec = db.cleaningChecklistRequests[i];
        break;
      }
    }
    if (rec && rec.status === "rejected") {
      db.cleaningChecklistRequests = db.cleaningChecklistRequests.filter(function (x) {
        return x.id !== rec.id;
      });
      saveDb(db);
      rec = null;
    }
    if (!rec) {
      rec = {
        id: C.uid(),
        dateYmd: today,
        weekdayKo: weekdayLongKoFromDate(d),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        zone1StudentId: null,
        zone2StudentId: null,
        zone3StudentId: null,
        zone4StudentId: null,
        attentionStudentIds: [],
        status: "draft",
        submittedByStudentId: null,
        incentiveCal: null,
        resolvedAt: null,
      };
      db.cleaningChecklistRequests.push(rec);
      saveDb(db);
    }
    return { ok: true, record: rec, msg: null };
  }

  function getZoneStudentIds(rec) {
    return [rec.zone1StudentId, rec.zone2StudentId, rec.zone3StudentId, rec.zone4StudentId];
  }

  function studentSignedCleaningZone(rec, studentId) {
    var z = getZoneStudentIds(rec);
    var i;
    for (i = 0; i < 4; i++) {
      if (z[i] === studentId) return i + 1;
    }
    return null;
  }

  function signCleaningZone(db, session, zoneNum) {
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "cleaner") {
      return { ok: false, msg: "청소부만 구역에 서명할 수 있습니다." };
    }
    var gr = getOrCreateCleaningDraft(db);
    if (!gr.ok) return gr;
    var rec = gr.record;
    if (rec.status !== "draft") {
      return { ok: false, msg: "이미 제출되었거나 처리된 기록입니다." };
    }
    if (zoneNum < 1 || zoneNum > 4) return { ok: false, msg: "구역이 올바르지 않습니다." };
    var z = getZoneStudentIds(rec);
    var zi = zoneNum - 1;
    var sid = session.studentId;
    var j;
    for (j = 0; j < 4; j++) {
      if (z[j] === sid) {
        return { ok: false, msg: "이미 다른 구역에 서명하셨습니다." };
      }
    }
    if (z[zi]) {
      return { ok: false, msg: "이 구역에는 이미 서명이 있습니다." };
    }
    if (zoneNum === 1) rec.zone1StudentId = sid;
    else if (zoneNum === 2) rec.zone2StudentId = sid;
    else if (zoneNum === 3) rec.zone3StudentId = sid;
    else rec.zone4StudentId = sid;
    rec.updatedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function saveCleaningZones(db, session, zone1Id, zone2Id, zone3Id, zone4Id) {
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "cleaner") {
      return { ok: false, msg: "청소부만 구역을 배정할 수 있습니다." };
    }
    var gr = getOrCreateCleaningDraft(db);
    if (!gr.ok) return gr;
    var rec = gr.record;
    if (rec.status !== "draft") {
      return { ok: false, msg: "이미 제출된 기록은 수정할 수 없습니다." };
    }
    var ids = [zone1Id, zone2Id, zone3Id, zone4Id];
    var seen = {};
    var i;
    for (i = 0; i < 4; i++) {
      var id = ids[i];
      if (id) {
        var zs = getStudent(db, id);
        if (!zs || zs.jobId !== "cleaner") {
          return { ok: false, msg: "구역 담당자는 청소부 학생만 지정할 수 있습니다." };
        }
        if (seen[id]) {
          return { ok: false, msg: "같은 학생을 중복해서 배정할 수 없습니다." };
        }
        seen[id] = true;
      }
    }
    rec.zone1StudentId = zone1Id || null;
    rec.zone2StudentId = zone2Id || null;
    rec.zone3StudentId = zone3Id || null;
    rec.zone4StudentId = zone4Id || null;
    rec.updatedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function saveCleaningAttentionStudents(db, session, rawIds) {
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "cleaner") {
      return { ok: false, msg: "청소부만 요주의 자리를 지정할 수 있습니다." };
    }
    var gr = getOrCreateCleaningDraft(db);
    if (!gr.ok) return gr;
    var rec = gr.record;
    if (rec.status !== "draft") {
      return { ok: false, msg: "이미 제출된 기록은 수정할 수 없습니다." };
    }
    var picked = [];
    var seen = {};
    var i;
    for (i = 0; i < rawIds.length; i++) {
      var id = String(rawIds[i] || "").trim();
      if (!id || seen[id]) continue;
      if (getStudent(db, id)) {
        seen[id] = true;
        picked.push(id);
      }
      if (picked.length >= 3) break;
    }
    rec.attentionStudentIds = picked;
    rec.updatedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function buildCleaningAttentionSelectHtml(db, name, selectedId) {
    var opts = '<option value="">— 선택 안함 —</option>';
    var sorted = db.students.slice().sort(function (a, b) {
      return Number(a.number) - Number(b.number);
    });
    var i;
    for (i = 0; i < sorted.length; i++) {
      var s = sorted[i];
      var sel = selectedId === s.id ? " selected" : "";
      opts +=
        '<option value="' +
        escapeHtml(s.id) +
        '"' +
        sel +
        ">" +
        escapeHtml(String(s.number != null ? s.number : "—") + ". " + (s.name || "")) +
        "</option>";
    }
    return '<select name="' + escapeHtml(name) + '" class="field cleaning-attn-select" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border); color: var(--text); padding: 0.4rem; border-radius: 4px; width: 100%;">' + opts + '</select>';
  }

  function formatCleaningAttentionDisplay(db, rec) {
    var ids = rec.attentionStudentIds || [];
    var names = [];
    var i;
    for (i = 0; i < ids.length; i++) {
      var s = getStudent(db, ids[i]);
      if (s) {
        names.push(String(s.number != null ? s.number : "—") + ". " + (s.name || ""));
      }
    }
    if (names.length === 0) return "없음";
    return names.join(", ");
  }

  function submitCleaningChecklistRequest(db, session) {
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "cleaner") {
      return { ok: false, msg: "청소부만 승인 요청을 보낼 수 있습니다." };
    }
    var gr = getOrCreateCleaningDraft(db);
    if (!gr.ok) return gr;
    var rec = gr.record;
    if (rec.status !== "draft") {
      return { ok: false, msg: "이미 제출되었거나 처리된 기록입니다." };
    }
    var z = getZoneStudentIds(rec);
    var i;
    for (i = 0; i < 4; i++) {
      if (!z[i]) return { ok: false, msg: "4개 구역 모두 서명되어야 승인 요청을 보낼 수 있습니다." };
    }
    var seen = {};
    for (i = 0; i < 4; i++) {
      if (seen[z[i]]) return { ok: false, msg: "같은 학생이 두 구역에 서명할 수 없습니다." };
      seen[z[i]] = true;
      var zs = getStudent(db, z[i]);
      if (!zs || zs.jobId !== "cleaner") {
        return { ok: false, msg: "모든 구역은 청소부 학생만 서명할 수 있습니다." };
      }
    }
    rec.status = "pending";
    rec.submittedByStudentId = session.studentId;
    rec.updatedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function approveCleaningChecklistRequest(db, reqId, incentiveRaw) {
    ensureCleaningChecklistRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.cleaningChecklistRequests.length; i++) {
      if (db.cleaningChecklistRequests[i].id === reqId) {
        req = db.cleaningChecklistRequests[i];
        break;
      }
    }
    if (!req || req.status !== "pending") {
      return { ok: false, msg: "이미 처리된 요청입니다." };
    }
    var inc = parseInt(String(incentiveRaw != null ? incentiveRaw : "").trim(), 10);
    if (isNaN(inc) || inc < 0) inc = 0;
    if (inc > 999999) inc = 999999;
    req.incentiveCal = inc;
    req.status = "approved";
    req.resolvedAt = Date.now();
    var signers = getZoneStudentIds(req);
    var dateStr = formatYmdLongKo(req.dateYmd);
    if (inc > 0) {
      for (i = 0; i < 4; i++) {
        var stu = getStudent(db, signers[i]);
        if (!stu) continue;
        stu.calory = Math.max(0, studentCaloryBalance(stu) + inc);
        addActivityLog(db, {
          studentId: stu.id,
          summary:
            "청소 체크리스트 인센티브 +" +
            inc +
            " Cal (선생님 저장) · " +
            dateStr,
          expDelta: 0,
          caloryDelta: inc,
        });
      }
    }
    saveDb(db);
    return { ok: true, msg: null };
  }

  function rejectCleaningChecklistRequest(db, reqId) {
    ensureCleaningChecklistRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.cleaningChecklistRequests.length; i++) {
      if (db.cleaningChecklistRequests[i].id === reqId) {
        req = db.cleaningChecklistRequests[i];
        break;
      }
    }
    if (!req || req.status !== "pending") {
      return { ok: false, msg: "이미 처리된 요청입니다." };
    }
    req.status = "rejected";
    req.resolvedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function ensureCouponShop(db) {
    if (!db) return;
    if (!db.couponShop || typeof db.couponShop !== "object") {
      db.couponShop = {
        pendingOffers: [],
        products: [],
        holdings: {},
        merchantLog: [],
        treasuryTotal: 0,
        rentals: [],
      };
    }
    if (!Array.isArray(db.couponShop.pendingOffers)) db.couponShop.pendingOffers = [];
    if (!Array.isArray(db.couponShop.products)) db.couponShop.products = [];
    if (!db.couponShop.holdings || typeof db.couponShop.holdings !== "object") db.couponShop.holdings = {};
    if (!Array.isArray(db.couponShop.merchantLog)) db.couponShop.merchantLog = [];
    if (!Array.isArray(db.couponShop.rentals)) db.couponShop.rentals = [];
    if (typeof db.couponShop.treasuryTotal !== "number" || isNaN(db.couponShop.treasuryTotal)) {
      db.couponShop.treasuryTotal = 0;
    }
  }

  function ensureCanteenShop(db) {
    if (!db) return;
    if (!db.canteenShop || typeof db.canteenShop !== "object") {
      db.canteenShop = {
        pendingOffers: [],
        products: [],
        holdings: {},
        merchantLog: [],
        treasuryTotal: 0,
        orders: [],
      };
    }
    if (!Array.isArray(db.canteenShop.pendingOffers)) db.canteenShop.pendingOffers = [];
    if (!Array.isArray(db.canteenShop.products)) db.canteenShop.products = [];
    if (!db.canteenShop.holdings || typeof db.canteenShop.holdings !== "object") db.canteenShop.holdings = {};
    if (!Array.isArray(db.canteenShop.merchantLog)) db.canteenShop.merchantLog = [];
    if (!Array.isArray(db.canteenShop.orders)) db.canteenShop.orders = [];
    if (typeof db.canteenShop.treasuryTotal !== "number" || isNaN(db.canteenShop.treasuryTotal)) {
      db.canteenShop.treasuryTotal = 0;
    }
  }

  function ensureTitleShop(db) {
    if (!db) return;
    if (!db.titleShop || typeof db.titleShop !== "object") {
      db.titleShop = {
        pendingSubmissions: [],
        approvedTitles: [],
        purchaseLog: [],
        treasuryTotal: 0
      };
    }
    if (!Array.isArray(db.titleShop.pendingSubmissions)) db.titleShop.pendingSubmissions = [];
    if (!Array.isArray(db.titleShop.approvedTitles)) db.titleShop.approvedTitles = [];
    if (!Array.isArray(db.titleShop.purchaseLog)) db.titleShop.purchaseLog = [];
    if (typeof db.titleShop.treasuryTotal !== "number" || isNaN(db.titleShop.treasuryTotal)) {
      db.titleShop.treasuryTotal = 0;
    }
    if (!Array.isArray(db.titleGrants)) db.titleGrants = [];
  }

  function submitTitleOffer(db, studentId, titleText, replaceTitleId) {
    ensureTitleShop(db);
    var txt = String(titleText || "").trim();
    if (!txt) return { ok: false, msg: "칭호명을 입력해 주세요." };
    if (txt.length > 12) return { ok: false, msg: "칭호는 12글자 이하로 입력해 주세요." };

    // 1. 대기 제한 (동시에 1개만 승인 대기 가능)
    var hasPending = db.titleShop.pendingSubmissions.some(function (s) {
      return s.creatorStudentId === studentId;
    });
    if (hasPending) {
      return { ok: false, msg: "이미 승인 대기 중인 칭호 신청이 있습니다. 한 번에 하나만 대기상태로 둘 수 있습니다." };
    }

    // 2. 한도 체크 (최대 5개)
    var myApprovedCount = db.titleShop.approvedTitles.filter(function (p) {
      return p.creatorStudentId === studentId;
    }).length;

    if (myApprovedCount >= 5) {
      if (!replaceTitleId) {
        return { ok: false, msg: "이미 등록된 칭호가 5개 가득 찼습니다. 새 칭호를 등록하려면 기존 칭호 중 하나를 교체(삭제)해야 합니다." };
      }
      var replaceValid = db.titleShop.approvedTitles.some(function (p) {
        return p.id === replaceTitleId && p.creatorStudentId === studentId;
      });
      if (!replaceValid) {
        return { ok: false, msg: "대체할 기존 칭호 정보가 올바르지 않습니다." };
      }
    }

    db.titleShop.pendingSubmissions.push({
      id: C.uid(),
      titleText: txt,
      creatorStudentId: studentId,
      createdAt: Date.now(),
      replaceTitleId: myApprovedCount >= 5 ? replaceTitleId : null
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function approveTitleOffer(db, submissionId) {
    ensureTitleShop(db);
    var sub = null;
    var i;
    for (i = 0; i < db.titleShop.pendingSubmissions.length; i++) {
      if (db.titleShop.pendingSubmissions[i].id === submissionId) {
        sub = db.titleShop.pendingSubmissions[i];
        db.titleShop.pendingSubmissions.splice(i, 1);
        break;
      }
    }
    if (!sub) return { ok: false, msg: "대기 중인 요청을 찾을 수 없습니다." };

    // 교체 대상이 있으면 기존 칭호를 삭제하고 환불 진행
    if (sub.replaceTitleId) {
      deleteAndRefundTitle(db, sub.replaceTitleId);
    }

    db.titleShop.approvedTitles.push({
      id: sub.id,
      titleText: sub.titleText,
      creatorStudentId: sub.creatorStudentId,
      createdAt: Date.now()
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function rejectTitleOffer(db, submissionId) {
    ensureTitleShop(db);
    var found = false;
    var i;
    for (i = 0; i < db.titleShop.pendingSubmissions.length; i++) {
      if (db.titleShop.pendingSubmissions[i].id === submissionId) {
        db.titleShop.pendingSubmissions.splice(i, 1);
        found = true;
        break;
      }
    }
    if (!found) return { ok: false, msg: "대기 중인 요청을 찾을 수 없습니다." };
    saveDb(db);
    return { ok: true, msg: null };
  }

  function deleteAndRefundTitle(db, titleId) {
    ensureTitleShop(db);
    var title = null;
    var i;
    for (i = 0; i < db.titleShop.approvedTitles.length; i++) {
      if (db.titleShop.approvedTitles[i].id === titleId) {
        title = db.titleShop.approvedTitles[i];
        db.titleShop.approvedTitles.splice(i, 1);
        break;
      }
    }
    if (!title) return { ok: false, msg: "등록된 칭호를 찾을 수 없습니다." };

    var deletedTitleText = title.titleText;

    // Refund and remove grants
    var keptGrants = [];
    var g;
    for (g = 0; g < db.titleGrants.length; g++) {
      var grant = db.titleGrants[g];
      if (grant.titleText === deletedTitleText) {
        var student = getStudent(db, grant.studentId);
        if (student) {
          var pricePaid = 100;
          if (db.titleShop.purchaseLog) {
            var p;
            for (p = 0; p < db.titleShop.purchaseLog.length; p++) {
              var log = db.titleShop.purchaseLog[p];
              if (log.buyerStudentId === student.id && log.titleText === deletedTitleText) {
                pricePaid = log.priceCal || 100;
                break;
              }
            }
          }
          student.calory = (student.calory || 0) + pricePaid;
          addActivityLog(db, {
            studentId: student.id,
            summary: "칭호 상점 개편 환불 · " + deletedTitleText + " (+" + pricePaid + " Cal)",
            expDelta: 0,
            caloryDelta: pricePaid
          });
        }
      } else {
        keptGrants.push(grant);
      }
    }
    db.titleGrants = keptGrants;
    saveDb(db);
    return { ok: true, msg: null };
  }

  function deleteApprovedTitle(db, titleId) {
    return deleteAndRefundTitle(db, titleId);
  }

  function addTeacherTitle(db, titleText) {
    ensureTitleShop(db);
    var txt = String(titleText || "").trim();
    if (!txt) return { ok: false, msg: "칭호명을 입력해 주세요." };
    if (txt.length > 12) return { ok: false, msg: "칭호는 12글자 이하로 입력해 주세요." };
    db.titleShop.approvedTitles.push({
      id: C.uid(),
      titleText: txt,
      creatorStudentId: null,
      createdAt: Date.now()
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function purchaseTitleProduct(db, buyerStudentId, titleId, opts) {
    ensureTitleShop(db);
    var buyer = getStudent(db, buyerStudentId);
    if (!buyer) return { ok: false, msg: "구매자 정보를 찾을 수 없습니다." };

    var title = null;
    var i;
    for (i = 0; i < db.titleShop.approvedTitles.length; i++) {
      if (db.titleShop.approvedTitles[i].id === titleId) {
        title = db.titleShop.approvedTitles[i];
        break;
      }
    }
    if (!title) return { ok: false, msg: "판매 중인 칭호가 아닙니다." };

    // 중복 구매 검사
    var alreadyHas = db.titleGrants.some(function (tg) {
      return tg.studentId === buyerStudentId && tg.titleText === title.titleText;
    });
    if (alreadyHas) return { ok: false, msg: "이미 보유한 칭호입니다." };

    // 옵션에 따른 가격 산정
    var optionFee = 0;
    var textColor = null;
    var bgColor = null;
    if (opts.optionType === "color") {
      optionFee = 50;
      textColor = opts.textColor || "#ffffff";
    } else if (opts.optionType === "full") {
      optionFee = 100;
      textColor = opts.textColor || "#ffffff";
      bgColor = opts.bgColor || "#1a237e";
    }
    var totalPrice = 100 + optionFee;

    var bal = studentCaloryBalance(buyer);
    if (bal < totalPrice) return { ok: false, msg: "Calory가 부족합니다. (" + totalPrice + " Cal 필요)" };

    // 구매자 Calory 차감 및 칭호 지급
    buyer.calory = Math.max(0, bal - totalPrice);
    db.titleGrants.push({
      id: C.uid(),
      studentId: buyerStudentId,
      titleText: title.titleText,
      textColor: textColor,
      bgColor: bgColor,
      acquiredAt: Date.now()
    });

    // 제안 학생 지급 (10 Calory)
    var creatorPaid = false;
    if (title.creatorStudentId) {
      var creator = getStudent(db, title.creatorStudentId);
      if (creator) {
        creator.calory = (creator.calory || 0) + 10;
        creatorPaid = true;
        addActivityLog(db, {
          studentId: creator.id,
          summary: "칭호 판매 수익 · " + title.titleText + " (+10 Cal)",
          expDelta: 0,
          caloryDelta: 10
        });
      }
    }

    // 국고 누적 (쿠폰 상점 오염 방지)
    var treasuryAmount = totalPrice - (creatorPaid ? 10 : 0);

    // 칭호샵 수입 및 로그 누적
    db.titleShop.purchaseLog.push({
      id: C.uid(),
      occurredAt: Date.now(),
      dateYmd: todayYmdLocal(),
      titleText: title.titleText,
      buyerStudentId: buyerStudentId,
      priceCal: totalPrice,
      treasuryAmount: treasuryAmount,
      optionType: opts.optionType || "basic"
    });
    db.titleShop.treasuryTotal = (db.titleShop.treasuryTotal || 0) + treasuryAmount;

    // 활동 로그 기록
    addActivityLog(db, {
      studentId: buyerStudentId,
      summary: "칭호 구매 · " + title.titleText + " (-" + formatNum(totalPrice) + " Cal, 국고 적립)",
      expDelta: 0,
      caloryDelta: -totalPrice
    });

    saveDb(db);
    return { ok: true, msg: null };
  }

  function sumCouponShopTreasury(db) {
    ensureCouponShop(db);
    return Math.max(0, Math.floor(db.couponShop.treasuryTotal));
  }

  function studentShopCouponCount(db, studentId) {
    if (!db || !studentId) return 0;
    ensureCouponShop(db);
    return (db.couponShop.rentals || []).filter(function (r) {
      return r.studentId === studentId && (r.status === "held" || r.status === "use_requested" || r.status === "merchant_approved");
    }).length;
  }

  function studentCouponDisplayTotal(db, st) {
    if (!st) return 0;
    return studentCoupons(st) + studentShopCouponCount(db, st.id);
  }

  function findCouponProduct(db, productId) {
    ensureCouponShop(db);
    var i;
    for (i = 0; i < db.couponShop.products.length; i++) {
      if (db.couponShop.products[i].id === productId) return db.couponShop.products[i];
    }
    return null;
  }

  function findCanteenProduct(db, productId) {
    ensureCanteenShop(db);
    var i;
    for (i = 0; i < db.canteenShop.products.length; i++) {
      if (db.canteenShop.products[i].id === productId) return db.canteenShop.products[i];
    }
    return null;
  }

  function submitCouponProductOffer(db, session, nameRaw, priceRaw, stockRaw, descRaw, isGroupRaw, groupTargetCountRaw) {
    ensureCouponShop(db);
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "coupon_merchant") {
      return { ok: false, msg: "쿠폰상인만 새 쿠폰을 신청할 수 있습니다." };
    }
    var name = String(nameRaw || "").trim();
    if (!name) return { ok: false, msg: "쿠폰 이름을 입력해 주세요." };
    var price = parseInt(String(priceRaw || "").trim(), 10);
    if (isNaN(price) || price < 1) return { ok: false, msg: "가격은 1 Cal 이상으로 입력해 주세요." };
    if (price > 999999) price = 999999;
    var stock = parseInt(String(stockRaw || "").trim(), 10);
    if (isNaN(stock) || stock < 1) return { ok: false, msg: "총 개수는 1개 이상으로 입력해 주세요." };
    if (stock > 9999) stock = 9999;
    var desc = String(descRaw || "").trim();
    if (desc.length > 300) desc = desc.substring(0, 300);

    var isGroup = isGroupRaw === "true" || isGroupRaw === true;
    var groupTargetCount = null;
    if (isGroup) {
      groupTargetCount = parseInt(String(groupTargetCountRaw || "").trim(), 10);
      if (isNaN(groupTargetCount) || groupTargetCount < 2) {
        return { ok: false, msg: "단체권 공동 구매 목표 인원은 2명 이상이어야 합니다." };
      }
      if (groupTargetCount > 50) groupTargetCount = 50;
    }

    db.couponShop.pendingOffers.push({
      id: C.uid(),
      type: "new",
      name: name,
      priceCal: price,
      totalStock: stock,
      submittedByStudentId: session.studentId,
      createdAt: Date.now(),
      status: "pending",
      desc: desc,
      isGroup: isGroup,
      groupTargetCount: groupTargetCount,
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function submitCouponPriceChangeOffer(db, session, productId, newPriceRaw) {
    ensureCouponShop(db);
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "coupon_merchant") {
      return { ok: false, msg: "쿠폰상인만 가격 수정을 신청할 수 있습니다." };
    }
    var prod = findCouponProduct(db, productId);
    if (!prod) return { ok: false, msg: "수정하려는 상품을 찾을 수 없습니다." };
    // Allow any coupon merchant to submit price changes for any coupon product
    var price = parseInt(String(newPriceRaw || "").trim(), 10);
    if (isNaN(price) || price < 1) return { ok: false, msg: "가격은 1 Cal 이상으로 입력해 주세요." };
    if (price > 999999) price = 999999;

    db.couponShop.pendingOffers = db.couponShop.pendingOffers.filter(function (x) {
      return !(x.targetProductId === productId && x.type === "price_change" && x.status === "pending");
    });

    db.couponShop.pendingOffers.push({
      id: C.uid(),
      type: "price_change",
      targetProductId: productId,
      name: prod.name,
      newPriceCal: price,
      submittedByStudentId: session.studentId,
      createdAt: Date.now(),
      status: "pending",
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function submitCanteenProductOffer(db, session, nameRaw, priceRaw, stockRaw) {
    ensureCanteenShop(db);
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "store_merchant") {
      return { ok: false, msg: "매점상인만 새 매점 상품을 신청할 수 있습니다." };
    }
    var name = String(nameRaw || "").trim();
    if (!name) return { ok: false, msg: "상품 이름을 입력해 주세요." };
    var price = parseInt(String(priceRaw || "").trim(), 10);
    if (isNaN(price) || price < 1) return { ok: false, msg: "가격은 1 Cal 이상으로 입력해 주세요." };
    if (price > 999999) price = 999999;
    var stock = parseInt(String(stockRaw || "").trim(), 10);
    if (isNaN(stock) || stock < 1) return { ok: false, msg: "총 개수는 1개 이상으로 입력해 주세요." };
    if (stock > 9999) stock = 9999;
    db.canteenShop.pendingOffers.push({
      id: C.uid(),
      type: "new",
      name: name,
      priceCal: price,
      totalStock: stock,
      submittedByStudentId: session.studentId,
      createdAt: Date.now(),
      status: "pending",
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function submitCanteenPriceChangeOffer(db, session, productId, newPriceRaw) {
    ensureCanteenShop(db);
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "store_merchant") {
      return { ok: false, msg: "매점상인만 가격 수정을 신청할 수 있습니다." };
    }
    var prod = findCanteenProduct(db, productId);
    if (!prod) return { ok: false, msg: "수정하려는 상품을 찾을 수 없습니다." };
    var price = parseInt(String(newPriceRaw || "").trim(), 10);
    if (isNaN(price) || price < 1) return { ok: false, msg: "가격은 1 Cal 이상으로 입력해 주세요." };
    if (price > 999999) price = 999999;

    db.canteenShop.pendingOffers = db.canteenShop.pendingOffers.filter(function (x) {
      return !(x.targetProductId === productId && x.type === "price_change" && x.status === "pending");
    });

    db.canteenShop.pendingOffers.push({
      id: C.uid(),
      type: "price_change",
      targetProductId: productId,
      name: prod.name,
      newPriceCal: price,
      submittedByStudentId: session.studentId,
      createdAt: Date.now(),
      status: "pending",
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function addTeacherCoupon(db, nameRaw, priceRaw, stockRaw) {
    ensureCouponShop(db);
    var name = String(nameRaw || "").trim();
    if (!name) return { ok: false, msg: "쿠폰 이름을 입력해 주세요." };
    var price = parseInt(String(priceRaw || "").trim(), 10);
    if (isNaN(price) || price < 1) return { ok: false, msg: "가격은 1 Cal 이상으로 입력해 주세요." };
    if (price > 999999) price = 999999;
    var stock = parseInt(String(stockRaw || "").trim(), 10);
    if (isNaN(stock) || stock < 1) return { ok: false, msg: "총 개수는 1개 이상으로 입력해 주세요." };
    if (stock > 9999) stock = 9999;

    db.couponShop.products.push({
      id: C.uid(),
      name: name,
      priceCal: price,
      totalStock: stock,
      remainingStock: stock,
      merchantStudentId: null,
      approvedAt: Date.now(),
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function deleteCouponProduct(db, productId) {
    ensureCouponShop(db);
    var found = false;
    var i;
    for (i = 0; i < db.couponShop.products.length; i++) {
      if (db.couponShop.products[i].id === productId) {
        db.couponShop.products.splice(i, 1);
        found = true;
        break;
      }
    }
    if (!found) return { ok: false, msg: "등록된 쿠폰을 찾을 수 없습니다." };
    saveDb(db);
    return { ok: true, msg: null };
  }

  function updateCouponProductDesc(db, session, productId, newDesc) {
    ensureCouponShop(db);
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "coupon_merchant") {
      return { ok: false, msg: "쿠폰상인만 소개를 수정할 수 있습니다." };
    }
    var prod = findCouponProduct(db, productId);
    if (!prod) return { ok: false, msg: "쿠폰을 찾을 수 없습니다." };
    // Allow any coupon merchant to update description for any coupon product
    var desc = String(newDesc || "").trim();
    if (desc.length > 300) desc = desc.substring(0, 300);
    prod.desc = desc;
    saveDb(db);
    return { ok: true, msg: null };
  }

  function requestUseCoupon(db, studentId, rentalId) {
    ensureCouponShop(db);
    var rental = null;
    var i;
    for (i = 0; i < db.couponShop.rentals.length; i++) {
      if (db.couponShop.rentals[i].id === rentalId) {
        rental = db.couponShop.rentals[i];
        break;
      }
    }
    if (!rental) return { ok: false, msg: "대여 정보를 찾을 수 없습니다." };
    if (rental.studentId !== studentId) return { ok: false, msg: "본인의 쿠폰만 사용할 수 있습니다." };
    if (rental.status !== "held") return { ok: false, msg: "이미 사용 요청 중이거나 사용이 완료된 쿠폰입니다." };

    rental.status = "use_requested";
    rental.useRequestedAt = Date.now();
    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function merchantApproveUseCoupon(db, merchantStudentId, rentalId) {
    ensureCouponShop(db);
    var rental = null;
    var i;
    for (i = 0; i < db.couponShop.rentals.length; i++) {
      if (db.couponShop.rentals[i].id === rentalId) {
        rental = db.couponShop.rentals[i];
        break;
      }
    }
    if (!rental) return { ok: false, msg: "대여 정보를 찾을 수 없습니다." };
    if (rental.status !== "use_requested") return { ok: false, msg: "사용 요청 상태가 아닙니다." };

    var prod = findCouponProduct(db, rental.productId);
    if (!prod) return { ok: false, msg: "쿠폰 정보가 유효하지 않습니다." };
    // Allow any coupon merchant to approve use requests for any coupon product

    rental.status = "merchant_approved";
    rental.merchantApprovedAt = Date.now();
    rental.approvedByMerchantStudentId = merchantStudentId;
    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function teacherApproveUseCoupon(db, rentalId) {
    ensureCouponShop(db);
    var rental = null;
    var i;
    for (i = 0; i < db.couponShop.rentals.length; i++) {
      if (db.couponShop.rentals[i].id === rentalId) {
        rental = db.couponShop.rentals[i];
        break;
      }
    }
    if (!rental) return { ok: false, msg: "대여 정보를 찾을 수 없습니다." };
    if (rental.status !== "merchant_approved" && rental.status !== "use_requested") {
      return { ok: false, msg: "승인할 수 없는 상태입니다." };
    }

    rental.status = "used";
    rental.resolvedAt = Date.now();

    addActivityLog(db, {
      studentId: rental.studentId,
      summary: "쿠폰 사용 완료 및 반납 · " + rental.couponName + " (최종 승인 완료)",
      expDelta: 0,
      caloryDelta: 0
    });

    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function teacherRejectUseCoupon(db, rentalId) {
    ensureCouponShop(db);
    var rental = null;
    var i;
    for (i = 0; i < db.couponShop.rentals.length; i++) {
      if (db.couponShop.rentals[i].id === rentalId) {
        rental = db.couponShop.rentals[i];
        break;
      }
    }
    if (!rental) return { ok: false, msg: "대여 정보를 찾을 수 없습니다." };

    rental.status = "held";
    rental.useRequestedAt = null;
    rental.merchantApprovedAt = null;
    rental.approvedByMerchantStudentId = null;

    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function addTeacherCanteen(db, nameRaw, priceRaw, stockRaw) {
    ensureCanteenShop(db);
    var name = String(nameRaw || "").trim();
    if (!name) return { ok: false, msg: "상품 이름을 입력해 주세요." };
    var price = parseInt(String(priceRaw || "").trim(), 10);
    if (isNaN(price) || price < 1) return { ok: false, msg: "가격은 1 Cal 이상으로 입력해 주세요." };
    if (price > 999999) price = 999999;
    var stock = parseInt(String(stockRaw || "").trim(), 10);
    if (isNaN(stock) || stock < 1) return { ok: false, msg: "총 개수는 1개 이상으로 입력해 주세요." };
    if (stock > 9999) stock = 9999;

    db.canteenShop.products.push({
      id: C.uid(),
      name: name,
      priceCal: price,
      totalStock: stock,
      remainingStock: stock,
      merchantStudentId: null,
      approvedAt: Date.now(),
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function deleteCanteenProduct(db, productId) {
    ensureCanteenShop(db);
    var found = false;
    var i;
    for (i = 0; i < db.canteenShop.products.length; i++) {
      if (db.canteenShop.products[i].id === productId) {
        db.canteenShop.products.splice(i, 1);
        found = true;
        break;
      }
    }
    if (!found) return { ok: false, msg: "등록된 상품을 찾을 수 없습니다." };
    saveDb(db);
    return { ok: true, msg: null };
  }

  function approveCouponPendingOffer(db, offerId) {
    ensureCouponShop(db);
    var offer = null;
    var i;
    for (i = 0; i < db.couponShop.pendingOffers.length; i++) {
      if (db.couponShop.pendingOffers[i].id === offerId) {
        offer = db.couponShop.pendingOffers[i];
        break;
      }
    }
    if (!offer || offer.status !== "pending") {
      return { ok: false, msg: "대기 중인 신청이 아닙니다." };
    }

    if (offer.type === "price_change") {
      var prod = findCouponProduct(db, offer.targetProductId);
      if (!prod) {
        return { ok: false, msg: "대상이 되는 상품을 찾을 수 없습니다." };
      }
      prod.priceCal = Math.max(1, Math.min(999999, Math.floor(offer.newPriceCal)));
    } else {
      var mer = getStudent(db, offer.submittedByStudentId);
      if (!mer || mer.jobId !== "coupon_merchant") {
        return { ok: false, msg: "쿠폰상인 정보가 올바르지 않습니다." };
      }
      var total = Math.max(1, Math.min(9999, Math.floor(offer.totalStock)));
      var price = Math.max(1, Math.min(999999, Math.floor(offer.priceCal)));
      db.couponShop.products.push({
        id: C.uid(),
        name: String(offer.name || "").trim() || "쿠폰",
        priceCal: price,
        totalStock: total,
        remainingStock: total,
        merchantStudentId: offer.submittedByStudentId,
        approvedAt: Date.now(),
        pendingOfferId: offer.id,
        desc: String(offer.desc || "").trim(),
        isGroup: !!offer.isGroup,
        groupTargetCount: offer.groupTargetCount || null,
        groupContributors: offer.isGroup ? [] : null,
      });
    }

    db.couponShop.pendingOffers = db.couponShop.pendingOffers.filter(function (x) {
      return x.id !== offer.id;
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function rejectCouponPendingOffer(db, offerId) {
    ensureCouponShop(db);
    var before = db.couponShop.pendingOffers.length;
    db.couponShop.pendingOffers = db.couponShop.pendingOffers.filter(function (x) {
      return !(x.id === offerId && x.status === "pending");
    });
    if (db.couponShop.pendingOffers.length === before) {
      return { ok: false, msg: "대기 중인 신청이 아닙니다." };
    }
    saveDb(db);
    return { ok: true, msg: null };
  }

  function approveCanteenPendingOffer(db, offerId) {
    ensureCanteenShop(db);
    var offer = null;
    var i;
    for (i = 0; i < db.canteenShop.pendingOffers.length; i++) {
      if (db.canteenShop.pendingOffers[i].id === offerId) {
        offer = db.canteenShop.pendingOffers[i];
        break;
      }
    }
    if (!offer || offer.status !== "pending") {
      return { ok: false, msg: "대기 중인 신청이 아닙니다." };
    }

    if (offer.type === "price_change") {
      var prod = findCanteenProduct(db, offer.targetProductId);
      if (!prod) {
        return { ok: false, msg: "대상이 되는 상품을 찾을 수 없습니다." };
      }
      prod.priceCal = Math.max(1, Math.min(999999, Math.floor(offer.newPriceCal)));
    } else {
      var mer = getStudent(db, offer.submittedByStudentId);
      if (!mer || mer.jobId !== "store_merchant") {
        return { ok: false, msg: "매점상인 정보가 올바르지 않습니다." };
      }
      var total = Math.max(1, Math.min(9999, Math.floor(offer.totalStock)));
      var price = Math.max(1, Math.min(999999, Math.floor(offer.priceCal)));
      db.canteenShop.products.push({
        id: C.uid(),
        name: String(offer.name || "").trim() || "매점물건",
        priceCal: price,
        totalStock: total,
        remainingStock: total,
        merchantStudentId: offer.submittedByStudentId,
        approvedAt: Date.now(),
        pendingOfferId: offer.id,
      });
    }

    db.canteenShop.pendingOffers = db.canteenShop.pendingOffers.filter(function (x) {
      return x.id !== offer.id;
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function rejectCanteenPendingOffer(db, offerId) {
    ensureCanteenShop(db);
    var before = db.canteenShop.pendingOffers.length;
    db.canteenShop.pendingOffers = db.canteenShop.pendingOffers.filter(function (x) {
      return !(x.id === offerId && x.status === "pending");
    });
    if (db.canteenShop.pendingOffers.length === before) {
      return { ok: false, msg: "대기 중인 신청이 아닙니다." };
    }
    saveDb(db);
    return { ok: true, msg: null };
  }

  function addCouponHolding(db, studentId, productId, delta) {
    ensureCouponShop(db);
    if (!db.couponShop.holdings[studentId]) db.couponShop.holdings[studentId] = {};
    var cur = parseInt(String(db.couponShop.holdings[studentId][productId] || 0), 10);
    if (isNaN(cur)) cur = 0;
    var next = cur + delta;
    if (next <= 0) delete db.couponShop.holdings[studentId][productId];
    else db.couponShop.holdings[studentId][productId] = next;
  }

  function addCanteenHolding(db, studentId, productId, delta) {
    ensureCanteenShop(db);
    if (!db.canteenShop.holdings[studentId]) db.canteenShop.holdings[studentId] = {};
    var cur = parseInt(String(db.canteenShop.holdings[studentId][productId] || 0), 10);
    if (isNaN(cur)) cur = 0;
    var next = cur + delta;
    if (next <= 0) delete db.canteenShop.holdings[studentId][productId];
    else db.canteenShop.holdings[studentId][productId] = next;
  }

  function purchaseCouponProduct(db, buyerStudentId, productId) {
    ensureCouponShop(db);
    var buyer = getStudent(db, buyerStudentId);
    var prod = findCouponProduct(db, productId);
    if (!buyer || !prod) return { ok: false, msg: "구매 정보를 확인할 수 없습니다." };

    // Calculate dynamic remaining stock based on rentals
    var activeRentals = (db.couponShop.rentals || []).filter(function (r) {
      return r.productId === productId && (r.status === "held" || r.status === "use_requested" || r.status === "merchant_approved");
    });
    var remainingStock = prod.totalStock - activeRentals.length;
    if (remainingStock <= 0) return { ok: false, msg: "품절된(대여 중인) 쿠폰입니다." };

    var price = Math.floor(prod.priceCal);
    if (price < 1) return { ok: false, msg: "가격 정보가 올바르지 않습니다." };
    var bal = studentCaloryBalance(buyer);
    if (bal < price) {
      return { ok: false, msg: "Calory가 부족합니다." };
    }
    buyer.calory = Math.max(0, bal - price);

    // Keep legacy remainingStock updated for safety
    prod.remainingStock = Math.max(0, remainingStock - 1);
    addCouponHolding(db, buyerStudentId, productId, 1);

    // Push new rental record
    if (!db.couponShop.rentals) db.couponShop.rentals = [];
    var rentalId = C.uid();
    db.couponShop.rentals.push({
      id: rentalId,
      productId: productId,
      couponName: prod.name,
      studentId: buyerStudentId,
      studentName: buyer.name,
      status: "held",
      rentedAt: Date.now(),
      useRequestedAt: null,
      merchantApprovedAt: null,
      resolvedAt: null
    });

    db.couponShop.treasuryTotal =
      (typeof db.couponShop.treasuryTotal === "number" && !isNaN(db.couponShop.treasuryTotal)
        ? db.couponShop.treasuryTotal
        : 0) + price;
    var dateYmd = todayYmdLocal();
    db.couponShop.merchantLog.push({
      id: C.uid(),
      occurredAt: Date.now(),
      dateYmd: dateYmd,
      productId: prod.id,
      couponName: prod.name,
      buyerStudentId: buyerStudentId,
      priceCal: price,
      merchantStudentId: prod.merchantStudentId,
      rentalId: rentalId,
    });
    addActivityLog(db, {
      studentId: buyerStudentId,
      summary:
        "쿠폰 구매 · " +
        prod.name +
        " (-" +
        formatNum(price) +
        " Cal, 국고 적립)",
      expDelta: 0,
      caloryDelta: -price,
    });
    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function joinGroupCoupon(db, buyerStudentId, productId) {
    ensureCouponShop(db);
    var buyer = getStudent(db, buyerStudentId);
    var prod = findCouponProduct(db, productId);
    if (!buyer || !prod || !prod.isGroup) return { ok: false, msg: "쿠폰 정보를 확인할 수 없습니다." };

    if (!prod.groupContributors) prod.groupContributors = [];

    if (prod.groupContributors.indexOf(buyerStudentId) !== -1) {
      return { ok: false, msg: "이미 공동 구매에 참여하셨습니다." };
    }

    var sharePrice = Math.ceil(prod.priceCal / prod.groupTargetCount);
    var bal = studentCaloryBalance(buyer);
    if (bal < sharePrice) {
      return { ok: false, msg: "Calory가 부족합니다. (" + formatNum(sharePrice) + " Cal 필요)" };
    }

    buyer.calory = Math.max(0, bal - sharePrice);
    prod.groupContributors.push(buyerStudentId);

    addActivityLog(db, {
      studentId: buyerStudentId,
      summary: "단체 쿠폰 공동구매 참여 · " + prod.name + " (-" + formatNum(sharePrice) + " Cal)",
      expDelta: 0,
      caloryDelta: -sharePrice,
    });

    if (prod.groupContributors.length >= prod.groupTargetCount) {
      var activeRentals = (db.couponShop.rentals || []).filter(function (r) {
        return r.productId === productId && (r.status === "held" || r.status === "use_requested" || r.status === "merchant_approved");
      });
      var remainingStock = prod.totalStock - activeRentals.length;
      prod.remainingStock = Math.max(0, remainingStock - 1);

      if (!db.couponShop.rentals) db.couponShop.rentals = [];
      var contributors = prod.groupContributors;
      var dateYmd = todayYmdLocal();

      var ci;
      for (ci = 0; ci < contributors.length; ci++) {
        var cStudentId = contributors[ci];
        var cStudent = getStudent(db, cStudentId);
        var cStudentName = cStudent ? cStudent.name : cStudentId;

        var rentalId = C.uid();
        db.couponShop.rentals.push({
          id: rentalId,
          productId: productId,
          couponName: prod.name + " (단체공동)",
          studentId: cStudentId,
          studentName: cStudentName,
          status: "held",
          rentedAt: Date.now(),
          useRequestedAt: null,
          merchantApprovedAt: null,
          resolvedAt: null
        });

        db.couponShop.merchantLog.push({
          id: C.uid(),
          occurredAt: Date.now(),
          dateYmd: dateYmd,
          productId: prod.id,
          couponName: prod.name + " (단체공동)",
          buyerStudentId: cStudentId,
          priceCal: sharePrice,
          merchantStudentId: prod.merchantStudentId,
          rentalId: rentalId,
        });

        addActivityLog(db, {
          studentId: cStudentId,
          summary: "단체 쿠폰 공동구매 달성 완료! · " + prod.name + " 대여 획득",
          expDelta: 0,
          caloryDelta: 0,
        });
      }

      db.couponShop.treasuryTotal =
        (typeof db.couponShop.treasuryTotal === "number" && !isNaN(db.couponShop.treasuryTotal)
          ? db.couponShop.treasuryTotal
          : 0) + prod.priceCal;

      prod.groupContributors = [];

      saveDb(db, true);
      alert("🎉 축하합니다! 목표 인원(" + prod.groupTargetCount + "명)이 모두 모여 [" + prod.name + "] 쿠폰 공동 구매가 성사되었습니다! 쿠폰함에 등록되었습니다.");
      return { ok: true, msg: null };
    }

    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function sumCanteenShopTreasury(db) {
    ensureCanteenShop(db);
    return Math.max(0, Math.floor(db.canteenShop.treasuryTotal));
  }

  function studentShopCanteenCount(db, studentId) {
    if (!db || !studentId) return 0;
    ensureCanteenShop(db);
    var h = db.canteenShop.holdings[studentId];
    if (!h || typeof h !== "object") return 0;
    var n = 0;
    var k;
    for (k in h) {
      if (Object.prototype.hasOwnProperty.call(h, k)) {
        var c = parseInt(String(h[k]), 10);
        if (!isNaN(c) && c > 0) n += c;
      }
    }
    return n;
  }

  function purchaseCanteenProduct(db, buyerStudentId, productId) {
    ensureCanteenShop(db);
    var buyer = getStudent(db, buyerStudentId);
    var prod = findCanteenProduct(db, productId);
    if (!buyer || !prod) return { ok: false, msg: "구매 정보를 확인할 수 없습니다." };
    if (prod.remainingStock <= 0) return { ok: false, msg: "품절된 상품입니다." };
    var price = Math.floor(prod.priceCal);
    if (price < 1) return { ok: false, msg: "가격 정보가 올바르지 않습니다." };
    var bal = studentCaloryBalance(buyer);
    if (bal < price) {
      return { ok: false, msg: "Calory가 부족합니다." };
    }
    
    // Hold Calory and Stock immediately
    buyer.calory = Math.max(0, bal - price);
    prod.remainingStock = Math.max(0, prod.remainingStock - 1);
    
    var orderId = C.uid();
    db.canteenShop.orders.push({
      id: orderId,
      occurredAt: Date.now(),
      dateYmd: todayYmdLocal(),
      productId: prod.id,
      productName: prod.name,
      buyerStudentId: buyerStudentId,
      buyerStudentName: buyer.name,
      priceCal: price,
      merchantStudentId: prod.merchantStudentId,
      status: "pending", // pending | completed | cancelled
      resolvedAt: null
    });

    addActivityLog(db, {
      studentId: buyerStudentId,
      summary:
        "매점 상품 구매 신청 · " +
        prod.name +
        " (-" +
        formatNum(price) +
        " Cal) · 인도 대기 중",
      expDelta: 0,
      caloryDelta: -price,
    });
    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function approveCanteenOrder(db, orderId, actorId, isTeacher) {
    ensureCanteenShop(db);
    var order = null;
    var i;
    for (i = 0; i < db.canteenShop.orders.length; i++) {
      if (db.canteenShop.orders[i].id === orderId) {
        order = db.canteenShop.orders[i];
        break;
      }
    }
    if (!order) return { ok: false, msg: "주문 내역을 찾을 수 없습니다." };
    if (order.status !== "pending") return { ok: false, msg: "이미 처리 완료된 주문입니다." };
    
    if (!isTeacher) {
      var actorStudent = getStudent(db, actorId);
      if (!actorStudent || actorStudent.jobId !== "store_merchant") {
        return { ok: false, msg: "매점 상인만 승인할 수 있습니다." };
      }
    }

    order.status = "completed";
    order.resolvedAt = Date.now();

    // Sum to Canteen Shop treasury
    db.canteenShop.treasuryTotal =
      (typeof db.canteenShop.treasuryTotal === "number" && !isNaN(db.canteenShop.treasuryTotal)
        ? db.canteenShop.treasuryTotal
        : 0) + order.priceCal;

    // Record into merchant log for sales journal
    db.canteenShop.merchantLog.push({
      id: C.uid(),
      occurredAt: Date.now(),
      dateYmd: order.dateYmd || todayYmdLocal(),
      productId: order.productId,
      canteenName: order.productName,
      buyerStudentId: order.buyerStudentId,
      priceCal: order.priceCal,
      merchantStudentId: order.merchantStudentId,
      orderId: order.id,
    });

    addActivityLog(db, {
      studentId: order.buyerStudentId,
      summary: "매점 상품 수령 완료 · " + order.productName + " (" + formatNum(order.priceCal) + " Cal)",
      occurredAt: Date.now(),
    });

    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function cancelCanteenOrder(db, orderId, actorId, isTeacher) {
    ensureCanteenShop(db);
    var order = null;
    var i;
    for (i = 0; i < db.canteenShop.orders.length; i++) {
      if (db.canteenShop.orders[i].id === orderId) {
        order = db.canteenShop.orders[i];
        break;
      }
    }
    if (!order) return { ok: false, msg: "주문 내역을 찾을 수 없습니다." };
    if (order.status !== "pending" && order.status !== "completed") {
      return { ok: false, msg: "취소할 수 없는 주문 상태입니다." };
    }

    if (!isTeacher) {
      var actorStudent = getStudent(db, actorId);
      if (!actorStudent || actorStudent.jobId !== "store_merchant") {
        return { ok: false, msg: "매점 상인만 취소할 수 있습니다." };
      }
    }

    var oldStatus = order.status;
    order.status = "cancelled";
    order.resolvedAt = Date.now();

    // Refund Calory to the buyer
    var buyer = getStudent(db, order.buyerStudentId);
    if (buyer) {
      buyer.calory = (buyer.calory || 0) + order.priceCal;
      addActivityLog(db, {
        studentId: order.buyerStudentId,
        summary: "매점 주문 취소로 인한 Calory 환불 (+" + formatNum(order.priceCal) + " Cal)",
        occurredAt: Date.now(),
      });
    }

    // Restore stock
    var prod = findCanteenProduct(db, order.productId);
    if (prod) {
      prod.remainingStock = (prod.remainingStock || 0) + 1;
    }

    // If completed before, reverse the finance effects
    if (oldStatus === "completed") {
      db.canteenShop.treasuryTotal = Math.max(0, (db.canteenShop.treasuryTotal || 0) - order.priceCal);
      db.canteenShop.merchantLog = db.canteenShop.merchantLog.filter(function(log) {
        if (log.orderId) {
          return log.orderId !== order.id;
        } else {
          return !(log.productId === order.productId && log.buyerStudentId === order.buyerStudentId && log.priceCal === order.priceCal);
        }
      });
    }

    saveDb(db, true);
    return { ok: true, msg: null };
  }

  function cancelCouponPurchase(db, rentalId, actorId, isTeacher) {
    ensureCouponShop(db);
    var rental = null;
    var i;
    for (i = 0; i < db.couponShop.rentals.length; i++) {
      if (db.couponShop.rentals[i].id === rentalId) {
        rental = db.couponShop.rentals[i];
        break;
      }
    }
    if (!rental) return { ok: false, msg: "대여/구매 내역을 찾을 수 없습니다." };

    if (!isTeacher) {
      var actorStudent = getStudent(db, actorId);
      if (!actorStudent || actorStudent.jobId !== "coupon_merchant") {
        return { ok: false, msg: "쿠폰 상인만 취소할 수 있습니다." };
      }
    }

    var prod = findCouponProduct(db, rental.productId);
    var price = prod ? Math.floor(prod.priceCal) : 0;

    // 1. Refund Calory to the buyer
    var buyer = getStudent(db, rental.studentId);
    if (buyer) {
      buyer.calory = (buyer.calory || 0) + price;
      addActivityLog(db, {
        studentId: rental.studentId,
        summary: "쿠폰 구매 취소로 인한 Calory 환불 (+" + formatNum(price) + " Cal)",
        occurredAt: Date.now(),
      });
    }

    // 2. Deduct holding
    addCouponHolding(db, rental.studentId, rental.productId, -1);

    // 3. Restore stock
    if (prod) {
      prod.remainingStock = (prod.remainingStock || 0) + 1;
    }

    // 4. Deduct treasuryTotal
    db.couponShop.treasuryTotal = Math.max(0, (db.couponShop.treasuryTotal || 0) - price);

    // 5. Delete merchantLog entry
    db.couponShop.merchantLog = db.couponShop.merchantLog.filter(function(log) {
      if (log.rentalId) {
        return log.rentalId !== rental.id;
      } else {
        return !(log.productId === rental.productId && log.buyerStudentId === rental.studentId && log.priceCal === price);
      }
    });

    // 6. Delete rental entry itself
    db.couponShop.rentals = db.couponShop.rentals.filter(function(r) {
      return r.id !== rentalId;
    });

    saveDb(db, true);
    return { ok: true, msg: null };
  }

  /** 주급(기준 금액)의 10%를 세금으로 (내림) */
  function taxFromPayrollBase(base) {
    var n = typeof base === "number" && !isNaN(base) ? Math.floor(base) : 0;
    if (n <= 0) return 0;
    return Math.floor(n * 0.1);
  }

  function taxCollectionRequestTotalTax(r) {
    if (!r || r.status === "undone") return 0;
    var sum = 0;
    var lines = r.lines || [];
    var i;
    for (i = 0; i < lines.length; i++) {
      var t = lines[i].taxAmount;
      sum += typeof t === "number" && !isNaN(t) ? Math.floor(t) : 0;
    }
    return sum;
  }

  function sumClassApprovedTaxCollected(db) {
    ensureTaxCollectionRequests(db);
    var total = 0;
    var i;
    for (i = 0; i < db.taxCollectionRequests.length; i++) {
      if (db.taxCollectionRequests[i].status === "approved") {
        total += taxCollectionRequestTotalTax(db.taxCollectionRequests[i]);
      }
    }
    return total;
  }

  function isClassTaxManualActive(db) {
    return db && db.classTaxTotalManual !== undefined && db.classTaxTotalManual !== null;
  }

  function sumTitleShopTreasury(db) {
    ensureTitleShop(db);
    return Math.max(0, Math.floor(db.titleShop.treasuryTotal || 0));
  }

  function getClassTaxTotalDisplay(db) {
    ensureTaxCollectionRequests(db);
    ensureCouponShop(db);
    ensureCanteenShop(db);
    ensureTitleShop(db);
    if (isClassTaxManualActive(db)) {
      var m =
        typeof db.classTaxTotalManual === "number" && !isNaN(db.classTaxTotalManual)
          ? db.classTaxTotalManual
          : parseInt(String(db.classTaxTotalManual), 10);
      if (!isNaN(m)) return Math.max(0, Math.floor(m));
    }
    return sumClassApprovedTaxCollected(db) + sumCouponShopTreasury(db) + sumCanteenShopTreasury(db) + sumTitleShopTreasury(db);
  }

  function shell(html) {
    var root = document.getElementById("app");
    if (!root) return;

    var activeEl = document.activeElement;
    var activeSelector = null;
    var selectionStart = null;
    var selectionEnd = null;
    var cursorPreserved = false;
    var inputValues = [];

    var typing = isUserTyping();
    var isBgSync = !!window.__classStatusIsBackgroundSync;

    if (typing || isBgSync) {
      if (activeEl && root.contains(activeEl)) {
        if (activeEl.id) {
          activeSelector = "#" + activeEl.id;
        } else if (activeEl.name) {
          var form = activeEl.closest("form");
          if (form && form.id) {
            activeSelector = "form#" + form.id + " [name='" + activeEl.name + "']";
          } else {
            activeSelector = "[name='" + activeEl.name + "']";
          }
        }
        if (activeSelector) {
          try {
            selectionStart = activeEl.selectionStart;
            selectionEnd = activeEl.selectionEnd;
            cursorPreserved = true;
          } catch (e) {}
        }
      }

      var inputs = root.querySelectorAll("input, textarea, select");
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        var tag = el.tagName.toLowerCase();
        var shouldSave = false;
        if (tag === "textarea" || tag === "select") {
          shouldSave = true;
        } else if (tag === "input") {
          var type = (el.type || "text").toLowerCase();
          var textTypes = ["text", "number", "password", "email", "search", "tel", "url"];
          if (textTypes.indexOf(type) !== -1) {
            shouldSave = true;
          }
        }
        if (shouldSave) {
          var sel = null;
          if (el.id) {
            sel = "#" + el.id;
          } else if (el.name) {
            var f = el.closest("form");
            if (f && f.id) {
              sel = "form#" + f.id + " [name='" + el.name + "']";
            } else {
              sel = "[name='" + el.name + "']";
            }
          }
          if (sel) {
            inputValues.push({
              selector: sel,
              value: el.value,
              focused: (el === activeEl)
            });
          }
        }
      }
    }

    root.innerHTML = html;

    if (inputValues.length > 0) {
      for (var j = 0; j < inputValues.length; j++) {
        var item = inputValues[j];
        var target = root.querySelector(item.selector);
        if (target) {
          target.value = item.value;
          if (item.focused) {
            target.focus();
            if (cursorPreserved && typeof target.setSelectionRange === "function") {
              try {
                target.setSelectionRange(selectionStart, selectionEnd);
              } catch (e) {}
            }
          }
        }
      }
    }
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function ymdFromDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function ymdCompactFromDate(d) {
    return d.getFullYear() + "" + pad2(d.getMonth() + 1) + "" + pad2(d.getDate());
  }

  /** 매일 오전 7시 기준으로 하루가 바뀌는 활동 집계용 날짜 키 */
  function boardDateKey() {
    var d = new Date();
    if (d.getHours() < 7) {
      d.setDate(d.getDate() - 1);
    }
    return ymdFromDate(d);
  }

  /** YYYY-MM-DD가 현지 달력 기준 토·일이면 true (정오로 파싱해 DST 영향 완화) */
  function isWeekendYmd(ymd) {
    var parts = String(ymd || "").split("-");
    if (parts.length !== 3) return false;
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10) - 1;
    var da = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(mo) || isNaN(da)) return false;
    var d = new Date(y, mo, da, 12, 0, 0, 0);
    var day = d.getDay();
    return day === 0 || day === 6;
  }

  /** 현지 기준 오늘이 토·일이면 true */
  function isWeekendLocalToday() {
    var day = new Date().getDay();
    return day === 0 || day === 6;
  }

  function normalizeTimetableSlot(slot) {
    if (slot && typeof slot === "object" && ("subject" in slot || "activity" in slot)) {
      return { subject: String(slot.subject || ""), activity: String(slot.activity || "") };
    }
    var s = String(slot == null ? "" : slot);
    if (s.length <= 5) {
      return { subject: s, activity: "" };
    }
    return { subject: "", activity: s };
  }

  function defaultDigitalBoard() {
    return {
      timetable: {
        morning: { subject: "", activity: "독서 · 안전교육" },
        p1: { subject: "국어", activity: "" },
        p2: { subject: "수학", activity: "" },
        p3: { subject: "사회", activity: "" },
        p4: { subject: "과학", activity: "" },
        p5: { subject: "체육", activity: "" },
        p6: { subject: "음악", activity: "" },
      },
      mealApi: { neisKey: "", atptCode: "", schoolCode: "" },
      weather: { lat: 37.5665, lon: 126.978 },
      todos: [],
      notice: "",
      mealManual: "",
      boardActivity: {},
      calendarMemos: {},
      noticeFontPx: 28,
    };
  }

  function ensureDigitalBoard(db) {
    if (!db.digitalBoard) db.digitalBoard = defaultDigitalBoard();
    else {
      var def = defaultDigitalBoard();
      var k;
      for (k in def) {
        if (db.digitalBoard[k] === undefined) db.digitalBoard[k] = def[k];
      }
      if (!db.digitalBoard.mealApi) db.digitalBoard.mealApi = def.mealApi;
      if (!db.digitalBoard.weather) db.digitalBoard.weather = def.weather;
      if (!db.digitalBoard.timetable) db.digitalBoard.timetable = def.timetable;
      if (!db.digitalBoard.boardActivity) db.digitalBoard.boardActivity = {};
      if (!Array.isArray(db.digitalBoard.todos)) db.digitalBoard.todos = [];
      if (!db.digitalBoard.calendarMemos || typeof db.digitalBoard.calendarMemos !== "object") {
        db.digitalBoard.calendarMemos = {};
      }
    }
    var tt = db.digitalBoard.timetable;
    var tk;
    for (tk in tt) {
      if (Object.prototype.hasOwnProperty.call(tt, tk)) {
        tt[tk] = normalizeTimetableSlot(tt[tk]);
      }
    }
    var defFill = defaultDigitalBoard();
    var ttKeys = ["morning", "p1", "p2", "p3", "p4", "p5", "p6"];
    var pi;
    for (pi = 0; pi < ttKeys.length; pi++) {
      var pk = ttKeys[pi];
      if (tt[pk] === undefined) {
        tt[pk] = normalizeTimetableSlot(defFill.timetable[pk]);
      }
    }
    migrateCalendarMemosIfNeeded(db);
  }

  function pruneBoardActivity(db) {
    ensureDigitalBoard(db);
    var ba = db.digitalBoard.boardActivity;
    var keys = Object.keys(ba);
    if (keys.length <= 40) return;
    keys.sort();
    var i;
    for (i = 0; i < keys.length - 40; i++) {
      delete ba[keys[i]];
    }
  }

  function removeStudentFromDb(db, studentId) {
    if (!db || !studentId) return;
    db.students = db.students.filter(function (x) {
      return x.id !== studentId;
    });
    db.users = db.users.filter(function (x) {
      return x.studentId !== studentId;
    });
    db.titleGrants = db.titleGrants.filter(function (x) {
      return x.studentId !== studentId;
    });
    db.activityLogs = db.activityLogs.filter(function (x) {
      return x.studentId !== studentId;
    });
    db.behaviorNotes = db.behaviorNotes.filter(function (x) {
      return x.studentId !== studentId;
    });
    ensureDigitalBoard(db);
    var ba = db.digitalBoard.boardActivity;
    var dk;
    for (dk in ba) {
      if (Object.prototype.hasOwnProperty.call(ba, dk) && ba[dk] && typeof ba[dk] === "object") {
        delete ba[dk][studentId];
      }
    }
    ensureBankPayrollRequests(db);
    db.bankPayrollRequests = db.bankPayrollRequests.filter(function (req) {
      if (!req || req.submittedByStudentId === studentId) return false;
      req.lines = (req.lines || []).filter(function (ln) {
        return ln.studentId !== studentId;
      });
      return req.lines.length > 0;
    });
    ensureTaxCollectionRequests(db);
    db.taxCollectionRequests = db.taxCollectionRequests.filter(function (req) {
      if (!req || req.submittedByStudentId === studentId) return false;
      req.lines = (req.lines || []).filter(function (ln) {
        return ln.studentId !== studentId;
      });
      return req.lines.length > 0;
    });
    ensureStatisticsApprovalRequests(db);
    db.statisticsApprovalRequests = db.statisticsApprovalRequests.filter(function (req) {
      return req && req.submittedByStudentId !== studentId;
    });
    ensurePostmanErrandRequests(db);
    db.postmanErrandRequests = db.postmanErrandRequests.filter(function (req) {
      return req && req.submittedByStudentId !== studentId;
    });
    ensureCleaningChecklistRequests(db);
    db.cleaningChecklistRequests = db.cleaningChecklistRequests.filter(function (req) {
      return req && !cleaningRequestReferencesStudent(req, studentId);
    });
    ensureCouponShop(db);
    delete db.couponShop.holdings[studentId];
    db.couponShop.pendingOffers = db.couponShop.pendingOffers.filter(function (o) {
      return o && o.submittedByStudentId !== studentId;
    });
    db.couponShop.products = db.couponShop.products.filter(function (p) {
      return p && p.merchantStudentId !== studentId;
    });
    db.couponShop.merchantLog = db.couponShop.merchantLog.filter(function (e) {
      return e && e.buyerStudentId !== studentId && e.merchantStudentId !== studentId;
    });
    ensureStatisticsChecklist(db);
    var spi;
    for (spi = 0; spi < db.statisticsChecklist.periods.length; spi++) {
      var per = db.statisticsChecklist.periods[spi];
      if (per.cellDelta && per.cellDelta[studentId]) delete per.cellDelta[studentId];
      if (per.weeklyAdjust && per.weeklyAdjust[studentId] !== undefined) {
        delete per.weeklyAdjust[studentId];
      }
    }
  }

  function getStudentBoardActivity(db, studentId) {
    ensureDigitalBoard(db);
    var key = boardDateKey();
    var day = db.digitalBoard.boardActivity[key];
    if (!day || typeof day[studentId] !== "number") return 0;
    return day[studentId];
  }

  function incStudentBoardActivity(db, studentId, delta) {
    ensureDigitalBoard(db);
    var key = boardDateKey();
    if (!db.digitalBoard.boardActivity[key]) db.digitalBoard.boardActivity[key] = {};
    var cur = db.digitalBoard.boardActivity[key][studentId] || 0;
    db.digitalBoard.boardActivity[key][studentId] = cur + delta;
    pruneBoardActivity(db);
    saveDb(db);
  }

  function parseYmdToDate(ymd) {
    var p = String(ymd || "")
      .trim()
      .split("-");
    if (p.length !== 3) return null;
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1;
    var d = parseInt(p[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d);
  }

  function compareYmd(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  function todayYmdLocal() {
    return ymdFromDate(new Date());
  }

  function startOfIsoWeekMondayFromDate(d) {
    var dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = dt.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff);
    return dt;
  }

  function thisWeekMondayYmd() {
    return ymdFromDate(startOfIsoWeekMondayFromDate(new Date()));
  }

  function nextMondayYmdAfter(ymd) {
    var d = parseYmdToDate(ymd);
    if (!d) return thisWeekMondayYmd();
    d.setDate(d.getDate() + 1);
    var guard = 0;
    while (d.getDay() !== 1 && guard++ < 14) {
      d.setDate(d.getDate() + 1);
    }
    return ymdFromDate(d);
  }

  function fiveWeekdayYmdsFromMonday(mondayYmd) {
    var d = parseYmdToDate(mondayYmd);
    if (!d) return [];
    var cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var out = [];
    var guard = 0;
    while (out.length < 5 && guard++ < 20) {
      var wd = cur.getDay();
      if (wd !== 0 && wd !== 6) out.push(ymdFromDate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  function formatStatisticsPeriodRangeKo(cols) {
    if (!cols || !cols.length) return "";
    var pa = parseYmdToDate(cols[0]);
    var pb = parseYmdToDate(cols[cols.length - 1]);
    if (!pa || !pb) return cols[0] + " ~ " + cols[cols.length - 1];
    return (
      (pa.getMonth() + 1) +
      "월 " +
      pa.getDate() +
      "일 ~ " +
      (pb.getMonth() + 1) +
      "월 " +
      pb.getDate() +
      "일"
    );
  }

  function ensureStatisticsChecklist(db) {
    if (!db) return;
    if (!db.statisticsChecklist || typeof db.statisticsChecklist !== "object") {
      db.statisticsChecklist = { periods: [] };
    }
    if (!Array.isArray(db.statisticsChecklist.periods)) db.statisticsChecklist.periods = [];
  }

  function ensureStatisticsApprovalRequests(db) {
    if (!db) return;
    if (!Array.isArray(db.statisticsApprovalRequests)) db.statisticsApprovalRequests = [];
  }

  function ensureStockMarket(db) {
    if (!db) return;
    if (!db.stockMarket || typeof db.stockMarket !== "object" || Array.isArray(db.stockMarket)) {
      db.stockMarket = {};
    }
    if (db.stockMarket.enabled === undefined) db.stockMarket.enabled = false;
    if (db.stockMarket.gasUrl === undefined) db.stockMarket.gasUrl = "";
    if (!Array.isArray(db.stockMarket.gasUrls)) {
      db.stockMarket.gasUrls = db.stockMarket.gasUrl ? [db.stockMarket.gasUrl, "", ""] : ["", "", ""];
    }
    if (!Array.isArray(db.stockMarket.stocks)) {
      db.stockMarket.stocks = [
        { code: "005930", name: "삼성전자" },
        { code: "000660", name: "SK하이닉스" },
        { code: "035420", name: "NAVER" },
        { code: "035720", name: "카카오" },
        { code: "025860", name: "남해화학" },
        { code: "000720", name: "현대건설" },
        { code: "090430", name: "아모레퍼시픽" },
        { code: "005380", name: "현대차" }
      ];
    }
    if (!Array.isArray(db.stockMarket.tradeLog)) db.stockMarket.tradeLog = [];
    if (!db.stockMarket.currentPrices || typeof db.stockMarket.currentPrices !== "object") {
      db.stockMarket.currentPrices = {};
    }
    if (typeof db.stockMarket.lastPricesUpdatedAt !== "number") {
      db.stockMarket.lastPricesUpdatedAt = 0;
    }
    if (db.stockMarket.multiplier === undefined) {
      db.stockMarket.multiplier = 1;
    }
    if (!db.stockMarket.rawPrices || typeof db.stockMarket.rawPrices !== "object") {
      db.stockMarket.rawPrices = {};
    }
  }

  function getLeveragedPrices(db, rawPrices) {
    ensureStockMarket(db);
    var mult = typeof db.stockMarket.multiplier === "number" ? db.stockMarket.multiplier : 1;
    var leveraged = {};
    var stocks = db.stockMarket.stocks || [];
    var basePriceUpdated = false;
    
    var i;
    for (i = 0; i < stocks.length; i++) {
      var stock = stocks[i];
      var code = stock.code;
      if (!code) continue;
      
      var rawItem = rawPrices && rawPrices[code];
      if (!rawItem || typeof rawItem.price !== "number") continue;
      
      // Initialize basePrice if not set
      if (stock.basePrice === undefined || stock.basePrice === null) {
        // Use stck_sdpr (previous day close) from server if available, otherwise raw current price
        stock.basePrice = rawItem.stck_sdpr || rawItem.price;
        basePriceUpdated = true;
      }
      
      var pBase = stock.basePrice;
      var pReal = rawItem.price;
      var pDisplay = Math.max(100, Math.round(pBase + (pReal - pBase) * mult));
      
      var changePrice = pDisplay - pBase;
      var changeRate = pBase > 0 ? ((changePrice / pBase) * 100).toFixed(2) : "0.00";
      var compareSign = "3";
      if (changePrice > 0) {
        compareSign = "2"; // Rise
      } else if (changePrice < 0) {
        compareSign = "5"; // Fall
      }
      
      leveraged[code] = {
        code: code,
        price: pDisplay,
        name: rawItem.name || stock.name,
        changePrice: Math.abs(changePrice),
        changeRate: changeRate,
        compareSign: compareSign,
        updatedAt: rawItem.updatedAt || Date.now()
      };
    }
    
    if (basePriceUpdated) {
      var session = C.getSession();
      var isTeacher = session && session.role === "teacher";
      if (isTeacher) {
        saveDb(db);
      } else {
        C.hydrateDb(db);
      }
    }
    
    return leveraged;
  }

  function ensureStudentStockPortfolio(st) {
    if (!st) return;
    if (!st.stockPortfolio || typeof st.stockPortfolio !== "object") {
      st.stockPortfolio = {};
    }
    if (!st.stockPortfolio.holdings || typeof st.stockPortfolio.holdings !== "object") {
      st.stockPortfolio.holdings = {};
    }
  }

  function fetchRealtimePrices(db, callback, forceRefresh) {
    ensureStockMarket(db);
    
    var codes = db.stockMarket.stocks.map(function(s) { return s.code; });
    if (!codes.length) {
      return callback({ ok: true, data: {} });
    }
    
    var now = Date.now();
    var lastUpdate = db.stockMarket.lastPricesUpdatedAt || 0;
    var cachedPrices = db.stockMarket.currentPrices || {};
    
    // forceRefresh가 아니고, 마지막 성공 업데이트가 5분(300,000ms) 이내인 경우 캐시 데이터 반환
    if (forceRefresh !== true && lastUpdate > 0 && (now - lastUpdate) < 300000 && Object.keys(cachedPrices).length > 0) {
      if (db.stockMarket.rawPrices && Object.keys(db.stockMarket.rawPrices).length > 0) {
        db.stockMarket.currentPrices = getLeveragedPrices(db, db.stockMarket.rawPrices);
      }
      return callback({ ok: true, data: db.stockMarket.currentPrices, cached: true });
    }
    
    // Express 백엔드 API URL 구성
    var apiUrl = (window.ClassStatusServerConfig && window.ClassStatusServerConfig.apiUrl) || "";
    var url = apiUrl + "/api/stocks/prices";
    if (forceRefresh === true) {
      url += "?refresh=true";
    }

    window.isFetchingStockPrices = true;
    
    fetch(url)
      .then(function(r) {
        if (!r.ok) {
          throw new Error("HTTP 오류 " + r.status);
        }
        return r.json();
      })
      .then(function(res) {
        window.isFetchingStockPrices = false;
        if (res) {
          window.stockPricesConfigured = res.isConfigured !== false;
        }
        if (res && res.ok && res.data) {
          if (res.isConfigured === false) {
            console.warn("한국투자증권 API 키가 Express 서버에 등록되지 않았습니다.");
          }
          
          db.stockMarket.rawPrices = res.data;
          
          var leveraged = getLeveragedPrices(db, res.data);
          db.stockMarket.currentPrices = leveraged;
          db.stockMarket.lastPricesUpdatedAt = Date.now();
          
          var session = C.getSession();
          var isTeacher = session && session.role === "teacher";
          if (isTeacher) {
            saveDb(db);
          } else {
            C.hydrateDb(db);
          }
          callback({ ok: true, data: leveraged });
        } else {
          var errMsg = (res && res.error) || "시세를 불러오지 못했습니다.";
          callback({ ok: false, msg: errMsg, data: cachedPrices });
        }
      })
      .catch(function(err) {
        window.isFetchingStockPrices = false;
        callback({ ok: false, msg: "서버 연결 실패: " + err.message, data: cachedPrices });
      });
  }

  function buyStock(db, studentId, code, mode, amount) {
    ensureStockMarket(db);
    var st = getStudent(db, studentId);
    if (!st) return { ok: false, msg: "학생을 찾을 수 없습니다." };
    ensureStudentStockPortfolio(st);
    
    var stock = db.stockMarket.stocks.find(function(s) { return s.code === code; });
    if (!stock) return { ok: false, msg: "존재하지 않는 종목입니다." };
    
    var priceInfo = window.currentStockPrices && window.currentStockPrices[code];
    if (!priceInfo || typeof priceInfo.price !== "number") {
      return { ok: false, msg: "실시간 시세가 동기화되지 않았습니다. 잠시 후 다시 시도해 주세요." };
    }
    
    var priceKrw = priceInfo.price;
    var priceKcal = priceKrw / 10000;
    if (priceKcal <= 0) return { ok: false, msg: "올바르지 않은 주식 가격입니다." };
    
    var buyKcal = 0;
    var buyShares = 0;
    
    if (mode === "kcal") {
      buyKcal = parseFloat(amount);
      if (isNaN(buyKcal) || buyKcal <= 0) return { ok: false, msg: "올바른 매수 금액을 입력해 주세요." };
      buyShares = buyKcal / priceKcal;
    } else if (mode === "shares") {
      buyShares = parseFloat(amount);
      if (isNaN(buyShares) || buyShares <= 0) return { ok: false, msg: "올바른 매수 수량을 입력해 주세요." };
      buyKcal = buyShares * priceKcal;
    } else {
      return { ok: false, msg: "잘못된 매수 유형입니다." };
    }
    
    buyKcal = Math.round(buyKcal * 100) / 100;
    buyShares = Math.round(buyShares * 10000) / 10000;
    
    if (st.calory < buyKcal) {
      return { ok: false, msg: "보유 칼로리(kcal)가 부족합니다." };
    }
    
    st.calory = Math.round((st.calory - buyKcal) * 100) / 100;
    
    var holding = st.stockPortfolio.holdings[code];
    if (!holding) {
      holding = { amount: 0, avgPriceKcal: 0 };
      st.stockPortfolio.holdings[code] = holding;
    }
    
    var prevAmount = holding.amount;
    var prevAvg = holding.avgPriceKcal;
    
    var newAmount = Math.round((prevAmount + buyShares) * 10000) / 10000;
    var newAvg = 0;
    if (newAmount > 0) {
      newAvg = ((prevAmount * prevAvg) + (buyShares * priceKcal)) / newAmount;
      newAvg = Math.round(newAvg * 10000) / 10000;
    }
    
    holding.amount = newAmount;
    holding.avgPriceKcal = newAvg;
    
    addActivityLog(db, {
      studentId: st.id,
      summary: "주식 매수: " + stock.name + " (" + code + ") " + buyShares + "주 매수",
      caloryDelta: -buyKcal
    });
    
    db.stockMarket.tradeLog.unshift({
      id: C.uid(),
      studentId: st.id,
      studentName: st.name,
      code: code,
      name: stock.name,
      type: "buy",
      shares: buyShares,
      priceKcal: priceKcal,
      priceKrw: priceKrw,
      totalKcal: buyKcal,
      occurredAt: Date.now()
    });
    
    return saveDb(db, true).then(function() {
      return { ok: true, msg: "매수가 완료되었습니다." };
    }).catch(function(err) {
      console.error("[StockMarket] 매수 동기화 실패:", err);
      var serverErrMsg = err && err.message ? err.message : "인터넷 연결을 확인하세요";
      return { ok: false, msg: "서버 동기화에 실패하여 매수를 진행할 수 없습니다. (" + serverErrMsg + ")" };
    });
  }

  function sellStock(db, studentId, code, mode, amount) {
    ensureStockMarket(db);
    var st = getStudent(db, studentId);
    if (!st) return { ok: false, msg: "학생을 찾을 수 없습니다." };
    ensureStudentStockPortfolio(st);
    
    var stock = db.stockMarket.stocks.find(function(s) { return s.code === code; });
    if (!stock) return { ok: false, msg: "존재하지 않는 종목입니다." };
    
    var holding = st.stockPortfolio.holdings[code];
    if (!holding || holding.amount <= 0) return { ok: false, msg: "보유하고 있지 않은 종목입니다." };
    
    var priceInfo = window.currentStockPrices && window.currentStockPrices[code];
    if (!priceInfo || typeof priceInfo.price !== "number") {
      return { ok: false, msg: "실시간 시세가 동기화되지 않았습니다. 잠시 후 다시 시도해 주세요." };
    }
    
    var priceKrw = priceInfo.price;
    var priceKcal = priceKrw / 10000;
    if (priceKcal <= 0) return { ok: false, msg: "올바르지 않은 주식 가격입니다." };
    
    var sellKcal = 0;
    var sellShares = 0;
    
    if (mode === "kcal") {
      sellKcal = parseFloat(amount);
      if (isNaN(sellKcal) || sellKcal <= 0) return { ok: false, msg: "올바른 매도 금액을 입력해 주세요." };
      sellShares = sellKcal / priceKcal;
    } else if (mode === "shares") {
      sellShares = parseFloat(amount);
      if (isNaN(sellShares) || sellShares <= 0) return { ok: false, msg: "올바른 매도 수량을 입력해 주세요." };
      sellKcal = sellShares * priceKcal;
    } else {
      return { ok: false, msg: "잘못된 매도 유형입니다." };
    }
    
    sellKcal = Math.round(sellKcal * 100) / 100;
    sellShares = Math.round(sellShares * 10000) / 10000;
    
    if (holding.amount < sellShares) {
      if (Math.abs(holding.amount - sellShares) < 0.0002) {
        sellShares = holding.amount;
        sellKcal = Math.round(sellShares * priceKcal * 100) / 100;
      } else {
        return { ok: false, msg: "보유한 수량(" + holding.amount + "주)보다 많이 매도할 수 없습니다." };
      }
    }
    
    st.calory = Math.round((st.calory + sellKcal) * 100) / 100;
    
    var remainingShares = Math.round((holding.amount - sellShares) * 10000) / 10000;
    if (remainingShares <= 0) {
      delete st.stockPortfolio.holdings[code];
    } else {
      holding.amount = remainingShares;
    }
    
    addActivityLog(db, {
      studentId: st.id,
      summary: "주식 매도: " + stock.name + " (" + code + ") " + sellShares + "주 매도",
      caloryDelta: sellKcal
    });
    
    db.stockMarket.tradeLog.unshift({
      id: C.uid(),
      studentId: st.id,
      studentName: st.name,
      code: code,
      name: stock.name,
      type: "sell",
      shares: sellShares,
      priceKcal: priceKcal,
      priceKrw: priceKrw,
      totalKcal: sellKcal,
      occurredAt: Date.now()
    });
    
    return saveDb(db, true).then(function() {
      return { ok: true, msg: "매도가 완료되었습니다." };
    }).catch(function(err) {
      console.error("[StockMarket] 매도 동기화 실패:", err);
      var serverErrMsg = err && err.message ? err.message : "인터넷 연결을 확인하세요";
      return { ok: false, msg: "서버 동기화에 실패하여 매도를 진행할 수 없습니다. (" + serverErrMsg + ")" };
    });
  }

  function cloneStatsPayload(obj) {
    try {
      return JSON.parse(JSON.stringify(obj == null ? {} : obj));
    } catch (e) {
      return {};
    }
  }

  function applyStatisticsPayloadToPeriod(period, cellDelta, weeklyAdjust) {
    period.cellDelta = cloneStatsPayload(cellDelta);
    period.weeklyAdjust = {};
    var wk = weeklyAdjust || {};
    var s;
    for (s in wk) {
      if (Object.prototype.hasOwnProperty.call(wk, s)) {
        var wv = parseInt(String(wk[s]), 10);
        if (!isNaN(wv) && wv !== 0) period.weeklyAdjust[s] = wv;
      }
    }
  }

  function collectStatisticsPayloadFromPanel(db, panel, periodId) {
    var period = findStatisticsPeriodById(db, periodId);
    if (!period || !panel) return null;
    var cellDelta = {};
    var dailyInputs = panel.querySelectorAll(".js-stats-daily");
    var i;
    for (i = 0; i < dailyInputs.length; i++) {
      var inp = dailyInputs[i];
      if (inp.disabled) continue;
      var sid = inp.getAttribute("data-student-id");
      var ymd = inp.getAttribute("data-ymd");
      var v = parseInt(String(inp.value || "").trim(), 10);
      if (isNaN(v)) v = 0;
      var base = boardActivityValueForStats(db, ymd, sid);
      var delta = v - base;
      if (!cellDelta[sid]) cellDelta[sid] = {};
      if (delta === 0) {
        if (cellDelta[sid][ymd] !== undefined) delete cellDelta[sid][ymd];
      } else {
        cellDelta[sid][ymd] = delta;
      }
    }
    for (var k in cellDelta) {
      if (Object.prototype.hasOwnProperty.call(cellDelta, k) && Object.keys(cellDelta[k]).length === 0) {
        delete cellDelta[k];
      }
    }
    var weeklyAdjust = {};
    var weekInputs = panel.querySelectorAll(".js-stats-weekly");
    for (i = 0; i < weekInputs.length; i++) {
      var win = weekInputs[i];
      if (win.disabled) continue;
      var sidW = win.getAttribute("data-student-id");
      var wv = parseInt(String(win.value || "").trim(), 10);
      if (isNaN(wv)) wv = 0;
      if (wv !== 0) weeklyAdjust[sidW] = wv;
    }
    return { cellDelta: cellDelta, weeklyAdjust: weeklyAdjust };
  }

  function saveStatisticsPeriodFromPanel(db, panel, periodId) {
    var period = findStatisticsPeriodById(db, periodId);
    if (!period) return { ok: false, msg: "기간을 찾을 수 없습니다." };
    var part = partitionStatisticsPeriods(db);
    if (!part.current || part.current.id !== period.id) {
      return { ok: false, msg: "진행 중인 기간만 저장할 수 없습니다." };
    }
    if (!collectStatisticsPayloadFromPanel(db, panel, periodId)) return { ok: false, msg: "데이터를 읽을 수 없습니다." };
    flushStatisticsPeriodFromPanel(db, panel, periodId);
    return { ok: true, msg: null };
  }

  function submitStatisticsApprovalRequest(db, session, panel, periodId) {
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "statistician") {
      return { ok: false, msg: "통계원만 요청할 수 있습니다." };
    }
    var part = partitionStatisticsPeriods(db);
    if (!part.current || part.current.id !== periodId) {
      return { ok: false, msg: "진행 중인 기간만 요청할 수 있습니다." };
    }
    var payload = collectStatisticsPayloadFromPanel(db, panel, periodId);
    if (!payload) return { ok: false, msg: "데이터를 읽을 수 없습니다." };
    ensureStatisticsApprovalRequests(db);
    db.statisticsApprovalRequests = db.statisticsApprovalRequests.filter(function (r) {
      return !(
        r &&
        r.status === "pending" &&
        r.submittedByStudentId === session.studentId &&
        r.periodId === periodId
      );
    });
    db.statisticsApprovalRequests.push({
      id: C.uid(),
      createdAt: Date.now(),
      submittedByStudentId: session.studentId,
      periodId: periodId,
      cellDelta: cloneStatsPayload(payload.cellDelta),
      weeklyAdjust: cloneStatsPayload(payload.weeklyAdjust),
      status: "pending",
      resolvedAt: null,
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function approveStatisticsApprovalRequest(db, reqId) {
    ensureStatisticsApprovalRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.statisticsApprovalRequests.length; i++) {
      if (db.statisticsApprovalRequests[i].id === reqId) {
        req = db.statisticsApprovalRequests[i];
        break;
      }
    }
    if (!req || req.status !== "pending") return { ok: false, msg: "이미 처리된 요청입니다." };
    var period = findStatisticsPeriodById(db, req.periodId);
    if (!period) return { ok: false, msg: "기간을 찾을 수 없습니다." };
    var sub = getStudent(db, req.submittedByStudentId);
    if (!sub || sub.jobId !== "statistician") {
      return { ok: false, msg: "통계원 정보가 올바르지 않습니다." };
    }
    var beforeSnap = statisticsEffectiveSnapshot(db, period);
    applyStatisticsPayloadToPeriod(period, req.cellDelta, req.weeklyAdjust);
    var afterSnap = statisticsEffectiveSnapshot(db, period);
    mergeStatisticsExpFromSnapshots(db, beforeSnap, afterSnap);
    req.status = "approved";
    req.resolvedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function rejectStatisticsApprovalRequest(db, reqId) {
    ensureStatisticsApprovalRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.statisticsApprovalRequests.length; i++) {
      if (db.statisticsApprovalRequests[i].id === reqId) {
        req = db.statisticsApprovalRequests[i];
        break;
      }
    }
    if (!req || req.status !== "pending") return { ok: false, msg: "이미 처리된 요청입니다." };
    req.status = "rejected";
    req.resolvedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function boardActivityValueForStats(db, ymd, studentId) {
    ensureDigitalBoard(db);
    var day = db.digitalBoard.boardActivity[ymd];
    if (!day || typeof day[studentId] !== "number") return 0;
    return day[studentId];
  }

  function statisticsDailyEffective(db, period, studentId, ymd) {
    var b = boardActivityValueForStats(db, ymd, studentId);
    var raw =
      period.cellDelta &&
      period.cellDelta[studentId] &&
      period.cellDelta[studentId][ymd];
    var delta = typeof raw === "number" && !isNaN(raw) ? raw : 0;
    return b + delta;
  }

  function statisticsRowDailySum(db, period, studentId) {
    var cols = period.cols || [];
    var sum = 0;
    var ci;
    for (ci = 0; ci < cols.length; ci++) {
      sum += statisticsDailyEffective(db, period, studentId, cols[ci]);
    }
    return sum;
  }

  function statisticsWeeklyAdjust(period, studentId) {
    var w = period.weeklyAdjust && period.weeklyAdjust[studentId];
    return typeof w === "number" && !isNaN(w) ? w : 0;
  }

  function statisticsRowGrandTotal(db, period, studentId) {
    return statisticsRowDailySum(db, period, studentId) + statisticsWeeklyAdjust(period, studentId);
  }

  function statisticsEffectiveSnapshot(db, period) {
    ensureStatisticsChecklist(db);
    var cols = period.cols || [];
    var students = studentsSortedByNumber(db);
    var out = {};
    var si, ci;
    for (si = 0; si < students.length; si++) {
      var sid = students[si].id;
      var days = {};
      for (ci = 0; ci < cols.length; ci++) {
        var ymd = cols[ci];
        days[ymd] = statisticsDailyEffective(db, period, sid, ymd);
      }
      out[sid] = { days: days, weekly: statisticsWeeklyAdjust(period, sid) };
    }
    return out;
  }

  function applyStatsChecklistUnitDeltaNoSave(db, studentId, unitDelta, detailLabel) {
    if (!db || !studentId || unitDelta === 0) return;
    var ch = statsExpChangeFromUnitDelta(unitDelta);
    if (ch === 0) return;
    var st = getStudent(db, studentId);
    if (!st) return;
    st.exp = clampExp(st.exp) + ch;
    if (st.exp < 0) st.exp = 0;
    autoLevelUp(st, db);
    addActivityLog(db, {
      studentId: studentId,
      summary: "통계청 체크리스트 · " + detailLabel,
      expDelta: ch,
    });
  }

  function mergeStatisticsExpFromSnapshots(db, before, after) {
    var sids = {};
    var s;
    for (s in before) {
      if (Object.prototype.hasOwnProperty.call(before, s)) sids[s] = true;
    }
    for (s in after) {
      if (Object.prototype.hasOwnProperty.call(after, s)) sids[s] = true;
    }
    for (s in sids) {
      var bSnap = before[s] || { days: {}, weekly: 0 };
      var aSnap = after[s] || { days: {}, weekly: 0 };
      var bdays = bSnap.days || {};
      var adays = aSnap.days || {};
      var allY = {};
      var ymd;
      for (ymd in bdays) allY[ymd] = true;
      for (ymd in adays) allY[ymd] = true;
      for (ymd in allY) {
        var bv = typeof bdays[ymd] === "number" && !isNaN(bdays[ymd]) ? bdays[ymd] : 0;
        var av = typeof adays[ymd] === "number" && !isNaN(adays[ymd]) ? adays[ymd] : 0;
        var du = Math.round(av - bv);
        if (du !== 0) {
          applyStatsChecklistUnitDeltaNoSave(db, s, du, ymd + " 칸");
        }
      }
      var bw = typeof bSnap.weekly === "number" && !isNaN(bSnap.weekly) ? bSnap.weekly : 0;
      var aw = typeof aSnap.weekly === "number" && !isNaN(aSnap.weekly) ? aSnap.weekly : 0;
      var wdu = Math.round(aw - bw);
      if (wdu !== 0) {
        applyStatsChecklistUnitDeltaNoSave(db, s, wdu, "주간 점수");
      }
    }
  }

  function flushStatisticsPeriodFromPanel(db, panel, periodId) {
    var payload = collectStatisticsPayloadFromPanel(db, panel, periodId);
    var period = findStatisticsPeriodById(db, periodId);
    if (!period || !payload) return;
    applyStatisticsPayloadToPeriod(period, payload.cellDelta, payload.weeklyAdjust);
    saveDb(db);
  }

  function createNewStatisticsPeriod(db) {
    ensureStatisticsChecklist(db);
    var periods = db.statisticsChecklist.periods;
    var monday;
    if (!periods.length) {
      monday = thisWeekMondayYmd();
    } else {
      var ends = periods
        .map(function (p) {
          return p.endYmd || (p.cols && p.cols.length ? p.cols[p.cols.length - 1] : "");
        })
        .filter(Boolean)
        .sort(compareYmd);
      var lastEnd = ends.length ? ends[ends.length - 1] : null;
      monday = lastEnd ? nextMondayYmdAfter(lastEnd) : thisWeekMondayYmd();
    }
    var cols = fiveWeekdayYmdsFromMonday(monday);
    if (!cols.length) return { ok: false, msg: "기간 열을 만들 수 없습니다." };
    var endYmd = cols[cols.length - 1];
    periods.push({
      id: C.uid(),
      mondayYmd: monday,
      cols: cols,
      endYmd: endYmd,
      cellDelta: {},
      weeklyAdjust: {},
      createdAt: Date.now(),
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function isStatisticsPeriodActive(period) {
    return compareYmd(todayYmdLocal(), period.endYmd) <= 0;
  }

  function isStatisticsPeriodPast(period) {
    return compareYmd(todayYmdLocal(), period.endYmd) > 0;
  }

  function partitionStatisticsPeriods(db) {
    ensureStatisticsChecklist(db);
    var list = db.statisticsChecklist.periods.slice();
    var current = null;
    var i;
    for (i = 0; i < list.length; i++) {
      if (isStatisticsPeriodActive(list[i])) {
        if (!current || compareYmd(list[i].mondayYmd, current.mondayYmd) > 0) {
          current = list[i];
        }
      }
    }
    var past = [];
    for (i = 0; i < list.length; i++) {
      if (isStatisticsPeriodPast(list[i])) past.push(list[i]);
    }
    past.sort(function (a, b) {
      return compareYmd(b.endYmd, a.endYmd);
    });
    return { current: current, past: past };
  }

  function canStartNewStatisticsPeriod(db) {
    ensureStatisticsChecklist(db);
    var list = db.statisticsChecklist.periods;
    if (!list.length) return true;
    var i;
    for (i = 0; i < list.length; i++) {
      if (isStatisticsPeriodActive(list[i])) return false;
    }
    return true;
  }

  function findStatisticsPeriodById(db, periodId) {
    ensureStatisticsChecklist(db);
    var periods = db.statisticsChecklist.periods;
    var i;
    for (i = 0; i < periods.length; i++) {
      if (periods[i].id === periodId) return periods[i];
    }
    return null;
  }

  function ymdShortKo(ymd) {
    var p = parseYmdToDate(ymd);
    if (!p) return String(ymd || "");
    return p.getMonth() + 1 + "/" + p.getDate();
  }

  function weekdayShortKo(ymd) {
    var p = parseYmdToDate(ymd);
    if (!p) return "";
    var names = ["일", "월", "화", "수", "목", "금", "토"];
    return names[p.getDay()];
  }

  function buildStatisticsRequestPreviewTableHtml(db, req) {
    var period = findStatisticsPeriodById(db, req.periodId);
    if (!period) {
      return '<p class="muted">기간을 찾을 수 없습니다.</p>';
    }
    var cols = period.cols || [];
    var students = studentsSortedByNumber(db);
    var colHead = cols
      .map(function (ymd) {
        return (
          '<th class="stats-col-day" title="' +
          escapeHtml(ymd) +
          '">' +
          escapeHtml(ymdShortKo(ymd) + " (" + weekdayShortKo(ymd) + ")") +
          "</th>"
        );
      })
      .join("");
    var rows = students
      .map(function (st) {
        var sid = st.id;
        var dailySum = 0;
        var tds = cols
          .map(function (ymd) {
            var base = boardActivityValueForStats(db, ymd, sid);
            var rawD = req.cellDelta && req.cellDelta[sid] && req.cellDelta[sid][ymd];
            var deltaN = typeof rawD === "number" && !isNaN(rawD) ? rawD : 0;
            var eff = base + deltaN;
            dailySum += eff;
            var edited = deltaN !== 0;
            var cell = formatNum(eff);
            if (edited) {
              cell = '<strong class="stats-cell--student-edit">' + cell + "</strong>";
            }
            return '<td class="td-num">' + cell + "</td>";
          })
          .join("");
        var wRaw = req.weeklyAdjust && req.weeklyAdjust[sid];
        var wv = typeof wRaw === "number" && !isNaN(wRaw) ? wRaw : 0;
        var wCell = formatNum(wv);
        if (wv !== 0) {
          wCell = '<strong class="stats-cell--student-edit">' + wCell + "</strong>";
        }
        var grand = dailySum + wv;
        return (
          "<tr>" +
          '<th scope="row" class="stats-name">' +
          escapeHtml(String(st.number != null ? st.number : "—")) +
          " " +
          escapeHtml(st.name || "") +
          "</th>" +
          tds +
          '<td class="td-num">' +
          formatNum(dailySum) +
          "</td>" +
          '<td class="td-num">' +
          wCell +
          "</td>" +
          '<td class="td-num"><strong>' +
          formatNum(grand) +
          "</strong></td></tr>"
        );
      })
      .join("");
    return (
      '<div class="table-wrap table-wrap--stats">' +
      '<table class="data stats-checklist-table stats-checklist-table--preview">' +
      "<thead><tr>" +
      '<th class="stats-col-name" scope="col">이름</th>' +
      colHead +
      '<th scope="col" class="td-num">총점</th>' +
      '<th scope="col" class="td-num">주간 점수 +.-</th>' +
      '<th scope="col" class="td-num">합계</th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      '<p class="muted stats-preview-legend">칠판 자동값과 다른 칸은 <strong class="stats-cell--student-edit">노란색 굵게</strong>로 표시됩니다.</p>'
    );
  }

  function buildStatisticsTeacherPendingHtml(db) {
    ensureStatisticsApprovalRequests(db);
    var pending = db.statisticsApprovalRequests.filter(function (r) {
      return r && r.status === "pending";
    });
    if (!pending.length) {
      return '<p class="muted stats-pending-empty">승인 대기 중인 통계청 요청이 없습니다.</p>';
    }
    pending.sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    return (
      '<div class="stats-pending-cards">' +
      pending
        .map(function (r) {
          var st = getStudent(db, r.submittedByStudentId);
          var name = st && st.name ? st.name : "—";
          var per = findStatisticsPeriodById(db, r.periodId);
          var range = per ? formatStatisticsPeriodRangeKo(per.cols || []) : "—";
          return (
            '<details class="bank-payroll-day stats-pending-request-fold">' +
            '<summary class="bank-payroll-day__summary">' +
            '<span class="bank-payroll-day__date">' +
            escapeHtml(name) +
            " · " +
            escapeHtml(range) +
            "</span>" +
            '<span class="bank-payroll-day__meta">' +
            escapeHtml(fmtTime(r.createdAt)) +
            " · 펼쳐서 내용 확인 후 승인</span></summary>" +
            '<div class="bank-payroll-day__body stats-pending-request-body">' +
            buildStatisticsRequestPreviewTableHtml(db, r) +
            '<div class="bank-payroll-card__actions stats-pending-request-actions">' +
            '<button type="button" class="btn btn--primary btn--sm js-stats-approve" data-req-id="' +
            escapeHtml(r.id) +
            '">승인</button>' +
            '<button type="button" class="btn btn--ghost btn--sm js-stats-reject" data-req-id="' +
            escapeHtml(r.id) +
            '">거절</button>' +
            "</div></div></details>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function buildStatisticsApprovalHistoryHtml(db, session) {
    ensureStatisticsApprovalRequests(db);
    var mine = db.statisticsApprovalRequests.filter(function (r) {
      return r.submittedByStudentId === session.studentId;
    });
    if (!mine.length) {
      return '<p class="muted bank-payroll__empty">아직 보낸 요청이 없습니다.</p>';
    }
    mine.sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    return (
      '<ul class="stats-history-list">' +
      mine
        .map(function (r) {
          var per = findStatisticsPeriodById(db, r.periodId);
          var range = per ? formatStatisticsPeriodRangeKo(per.cols || []) : "—";
          var stLabel =
            r.status === "pending"
              ? '<span class="bank-payroll-status bank-payroll-status--pending">대기</span>'
              : r.status === "approved"
                ? '<span class="bank-payroll-status bank-payroll-status--ok">승인됨</span>'
                : '<span class="bank-payroll-status bank-payroll-status--no">거절됨</span>';
          return (
            '<li class="stats-history-item">' +
            '<span class="stats-history-range">' +
            escapeHtml(range) +
            "</span> · " +
            '<span class="muted">' +
            escapeHtml(fmtTime(r.createdAt)) +
            "</span> · " +
            stLabel +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function buildStatisticsPeriodTableHtml(db, period, opts) {
    opts = opts || {};
    var preview = opts.preview === true;
    var cols = period.cols || [];
    var students = studentsSortedByNumber(db);
    var colHead = cols
      .map(function (ymd) {
        return (
          '<th class="stats-col-day" title="' +
          escapeHtml(ymd) +
          '">' +
          escapeHtml(ymdShortKo(ymd) + " (" + weekdayShortKo(ymd) + ")") +
          "</th>"
        );
      })
      .join("");
    var rows = students
      .map(function (st) {
        var sid = st.id;
        var dailyInputs = cols
          .map(function (ymd) {
            var eff = statisticsDailyEffective(db, period, sid, ymd);
            var base = boardActivityValueForStats(db, ymd, sid);
            var dis = preview ? " disabled" : "";
            return (
              '<td class="td-num">' +
              '<input type="number" step="1" class="js-stats-daily" data-stats-period-id="' +
              escapeHtml(period.id) +
              '" data-student-id="' +
              escapeHtml(sid) +
              '" data-ymd="' +
              escapeHtml(ymd) +
              '" value="' +
              eff +
              '" title="칠판 합계 ' +
              base +
              " (보정 가능)" +
              '"' +
              dis +
              " />" +
              "</td>"
            );
          })
          .join("");
        var rowSum = statisticsRowDailySum(db, period, sid);
        var wadj = statisticsWeeklyAdjust(period, sid);
        var grand = statisticsRowGrandTotal(db, period, sid);
        var wdis = preview ? " disabled" : "";
        return (
          "<tr>" +
          '<th scope="row" class="stats-name">' +
          escapeHtml(String(st.number != null ? st.number : "—")) +
          " " +
          escapeHtml(st.name || "") +
          "</th>" +
          dailyInputs +
          '<td class="td-num">' +
          '<span class="js-stats-daily-sum" data-student-id="' +
          escapeHtml(sid) +
          '">' +
          formatNum(rowSum) +
          "</span></td>" +
          '<td class="td-num">' +
          '<input type="number" step="1" class="js-stats-weekly" data-stats-period-id="' +
          escapeHtml(period.id) +
          '" data-student-id="' +
          escapeHtml(sid) +
          '" value="' +
          wadj +
          '"' +
          wdis +
          " />" +
          "</td>" +
          '<td class="td-num"><strong class="js-stats-grand" data-student-id="' +
          escapeHtml(sid) +
          '">' +
          formatNum(grand) +
          "</strong></td></tr>"
        );
      })
      .join("");
    return (
      '<div class="table-wrap table-wrap--stats">' +
      '<table class="data stats-checklist-table">' +
      "<thead><tr>" +
      '<th class="stats-col-name" scope="col">이름</th>' +
      colHead +
      '<th scope="col" class="td-num">총점</th>' +
      '<th scope="col" class="td-num">주간 점수 +.-</th>' +
      '<th scope="col" class="td-num">합계</th>' +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>"
    );
  }

  function buildStatisticsChecklistPanelHtml(db, period, opts) {
    opts = opts || {};
    var preview = opts.preview === true;
    var compact = opts.compact === true;
    var role = opts.role != null ? opts.role : preview ? "preview" : "teacher";
    var range = formatStatisticsPeriodRangeKo(period.cols || []);
    var hint;
    if (compact) {
      hint = "";
    } else if (role === "teacher") {
      hint =
        '<p class="panel__text muted stats-board-hint">선생님 화면에서 날짜·주간 칸을 바꾸면 <strong>잠시 후</strong> 학생 경험치에 반영됩니다. 칸 값이 <strong>+1</strong>일 때마다 해당 학생 EXP <strong>+20%</strong>, <strong>-1</strong>일 때마다 EXP <strong>-10%</strong>(최대 100%까지). 디지털 칠판 수치는 날짜 칸 기본값입니다.</p>';
    } else if (role === "student") {
      hint =
        '<p class="panel__text muted stats-board-hint">숫자는 <strong>디지털 칠판</strong> 해당 날짜 합계를 기본으로 가져옵니다. 확인·보정 후 <strong>선생님께 승인 요청</strong>을 보내세요. 승인되면 반영되며, 변동분(+1/-1)에 따라 경험치가 조정됩니다.</p>';
    } else {
      hint = '<p class="panel__text muted stats-board-hint">통계청 체크리스트 미리보기입니다.</p>';
    }
    var actions = "";
    if (!preview && opts.canEdit) {
      if (role === "teacher") {
        actions =
          '<div class="stats-actions"><button type="button" class="btn btn--primary js-stats-save" data-period-id="' +
          escapeHtml(period.id) +
          '">이 기간 저장</button></div>';
      } else if (role === "student") {
        actions =
          '<div class="stats-actions"><button type="button" class="btn btn--primary js-stats-submit-request" data-period-id="' +
          escapeHtml(period.id) +
          '">선생님께 승인 요청 보내기</button></div>';
      }
    }
    var titleTag = compact ? "h3" : "h2";
    var titleBlock = "";
    if (!opts.suppressTitle) {
      titleBlock =
        "<" +
        titleTag +
        ' class="panel__title">' +
        (compact ? "" : "📊 ") +
        escapeHtml(range) +
        "</" +
        titleTag +
        ">";
    }
    return (
      '<section class="panel stats-period-panel' +
      (opts.suppressTitle ? " stats-period-panel--inner-fold" : "") +
      '">' +
      titleBlock +
      hint +
      buildStatisticsPeriodTableHtml(db, period, opts) +
      actions +
      "</section>"
    );
  }

  function buildStatisticsChecklistHtml(db, opts) {
    opts = opts || {};
    ensureDigitalBoard(db);
    ensureStatisticsChecklist(db);
    ensureStatisticsApprovalRequests(db);
    var preview = opts.preview === true;
    var role = opts.role != null ? opts.role : preview ? "preview" : "teacher";
    var canEdit = !preview && opts.canEdit !== false;
    var part = partitionStatisticsPeriods(db);
    var canNew = canStartNewStatisticsPeriod(db) && canEdit && role === "teacher";
    var newBar = "";
    if (preview) {
      newBar = "";
    } else if (canNew) {
      newBar =
        '<div class="stats-new-bar">' +
        '<button type="button" class="btn btn--accent js-stats-new-period">새 주간 기간 시작</button>' +
        '<span class="muted stats-new-bar__hint">이전 주간이 모두 끝나면 새 표를 열 수 있습니다.</span>' +
        "</div>";
    } else if (role === "student") {
      newBar =
        '<div class="stats-new-bar">' +
        '<p class="muted stats-new-bar__muted">새 주간 기간은 선생님 화면에서 시작할 수 있습니다.</p>' +
        "</div>";
    } else {
      newBar =
        '<div class="stats-new-bar">' +
        '<p class="muted stats-new-bar__muted">진행 중인 주간이 끝나면 아래에서 새 기간을 시작할 수 있습니다.</p>' +
        "</div>";
    }
    var headerSub =
      role === "teacher"
        ? "디지털 칠판 수치가 날짜마다 기본 반영됩니다. 통계원 요청을 승인하거나 표에서 직접 저장할 수 있습니다."
        : role === "student"
          ? "확인·보정 후 선생님께 승인 요청을 보내세요. 승인되면 반영됩니다."
          : "미리보기입니다.";
    var teacherPending =
      !preview && role === "teacher"
        ? '<section class="panel stats-pending-panel"><h2 class="panel__title">승인 대기 (통계청)</h2>' +
          buildStatisticsTeacherPendingHtml(db) +
          "</section>"
        : "";
    var curHtml = "";
    if (part.current) {
      if (!preview && role === "teacher") {
        var curRange = formatStatisticsPeriodRangeKo(part.current.cols || []);
        curHtml =
          '<div class="stats-active-block">' +
          '<details class="bank-payroll-day stats-period-fold">' +
          '<summary class="bank-payroll-day__summary">' +
          '<span class="bank-payroll-day__date">' +
          escapeHtml(curRange) +
          "</span>" +
          '<span class="bank-payroll-day__meta">진행 중 · 펼쳐서 편집 · 저장</span></summary>' +
          '<div class="bank-payroll-day__body">' +
          buildStatisticsChecklistPanelHtml(db, part.current, {
            preview: preview,
            canEdit: canEdit,
            compact: false,
            role: role,
            suppressTitle: true,
          }) +
          "</div></details></div>";
      } else {
        curHtml =
          '<div class="stats-active-block">' +
          buildStatisticsChecklistPanelHtml(db, part.current, {
            preview: preview,
            canEdit: canEdit,
            compact: false,
            role: role,
          }) +
          "</div>";
      }
    } else {
      var noPeriodsEver = !db.statisticsChecklist.periods.length;
      curHtml =
        '<div class="panel stats-empty-panel"><p class="panel__text">' +
        (noPeriodsEver
          ? "아직 <strong>주간 체크리스트</strong>가 없습니다. " +
            (role === "teacher"
              ? "위에서 첫 기간을 만드세요."
              : "선생님께 첫 기간 시작을 요청해 주세요.")
          : "진행 중인 <strong>주간</strong> 표가 없습니다. " +
            (role === "teacher" ? "위에서 새 기간을 시작하세요." : "선생님께 새 기간 시작을 요청해 주세요.")) +
        "</p></div>";
    }
    var studentHistory =
      !preview && role === "student" && opts.session
        ? '<section class="panel bank-payroll-panel"><h2 class="panel__title">내가 보낸 요청</h2>' +
          '<p class="panel__text muted bank-payroll-student-hint">요청 후 선생님이 승인하면 반영됩니다.</p>' +
          buildStatisticsApprovalHistoryHtml(db, opts.session) +
          "</section>"
        : "";
    var pastHtml = "";
    if (part.past.length) {
      pastHtml = '<div class="stats-past-stack">';
      var pi;
      for (pi = 0; pi < part.past.length; pi++) {
        var p = part.past[pi];
        var title = formatStatisticsPeriodRangeKo(p.cols || []);
        pastHtml +=
          '<details class="bank-payroll-day stats-past-details stats-period-fold">' +
          '<summary class="bank-payroll-day__summary">' +
          '<span class="bank-payroll-day__date">' +
          escapeHtml(title) +
          "</span>" +
          '<span class="bank-payroll-day__meta">지난 기간 · 펼쳐 보기</span></summary>' +
          '<div class="bank-payroll-day__body">' +
          buildStatisticsChecklistPanelHtml(db, p, {
            preview: true,
            canEdit: false,
            compact: true,
            role: "preview",
            suppressTitle: role === "teacher",
          }) +
          "</div></details>";
      }
      pastHtml += "</div>";
    }
    return (
      '<div class="stats-checklist-root">' +
      '<header class="stats-checklist-head">' +
      '<h1 class="stats-checklist-title">통계청의 체크리스트</h1>' +
      '<p class="muted">' +
      escapeHtml(headerSub) +
      "</p></header>" +
      teacherPending +
      newBar +
      curHtml +
      studentHistory +
      (pastHtml ? '<h3 class="stats-past-heading">지난 주간 기간</h3>' + pastHtml : "") +
      "</div>"
    );
  }

  function recalcStatisticsRow(tr) {
    if (!tr) return;
    var firstInp = tr.querySelector(".js-stats-daily");
    if (!firstInp) return;
    var periodId = firstInp.getAttribute("data-stats-period-id");
    var sid = firstInp.getAttribute("data-student-id");
    var db = getDb();
    if (!db || !periodId || !sid) return;
    var period = findStatisticsPeriodById(db, periodId);
    if (!period) return;
    var cols = period.cols || [];
    var sum = 0;
    var ci;
    for (ci = 0; ci < cols.length; ci++) {
      var inp = tr.querySelector('.js-stats-daily[data-ymd="' + cols[ci] + '"]');
      if (!inp) continue;
      var v = parseInt(String(inp.value || "").trim(), 10);
      if (isNaN(v)) v = 0;
      sum += v;
    }
    var weekInp = tr.querySelector(".js-stats-weekly");
    var w = weekInp ? parseInt(String(weekInp.value || "").trim(), 10) : 0;
    if (isNaN(w)) w = 0;
    var sumEl = tr.querySelector(".js-stats-daily-sum");
    var grandEl = tr.querySelector(".js-stats-grand");
    if (sumEl) sumEl.textContent = formatNum(sum);
    if (grandEl) grandEl.textContent = formatNum(sum + w);
  }

  function bindStatisticsChecklist(opts) {
    opts = opts || {};
    var root = document.getElementById("app");
    if (!root) return;
    var role = opts.role || "teacher";
    var statsExpTimers = {};
    if (role === "teacher") {
      root.addEventListener("focusin", function (e) {
        var t = e.target;
        if (!t || !t.classList) return;
        if (!t.classList.contains("js-stats-daily") && !t.classList.contains("js-stats-weekly")) return;
        var v = parseInt(String(t.value || "").trim(), 10);
        if (isNaN(v)) v = 0;
        t.setAttribute("data-stats-exp-commit", String(v));
      });
    }
    root.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.classList) return;
      if (t.classList.contains("js-stats-daily") || t.classList.contains("js-stats-weekly")) {
        recalcStatisticsRow(t.closest("tr"));
        if (role === "teacher") {
          var periodId = t.getAttribute("data-stats-period-id");
          var panel = t.closest(".stats-period-panel");
          if (!periodId || !panel) return;
          var k =
            periodId +
            "|" +
            t.getAttribute("data-student-id") +
            "|" +
            (t.getAttribute("data-ymd") || "weekly");
          clearTimeout(statsExpTimers[k]);
          statsExpTimers[k] = setTimeout(function () {
            delete statsExpTimers[k];
            var db = getDb();
            if (!db) return;
            var nv = parseInt(String(t.value || "").trim(), 10);
            if (isNaN(nv)) nv = 0;
            var commit = parseInt(t.getAttribute("data-stats-exp-commit"), 10);
            if (isNaN(commit)) {
              t.setAttribute("data-stats-exp-commit", String(nv));
              return;
            }
            var du = nv - commit;
            if (du === 0) return;
            var sid = t.getAttribute("data-student-id");
            if (!sid) return;
            var detail = t.classList.contains("js-stats-weekly")
              ? "주간 점수"
              : (t.getAttribute("data-ymd") || "") + " 칸";
            applyStatsChecklistUnitDeltaNoSave(db, sid, du, detail);
            t.setAttribute("data-stats-exp-commit", String(nv));
            flushStatisticsPeriodFromPanel(db, panel, periodId);
          }, 350);
        }
      }
    });
    var btnNew = root.querySelector(".js-stats-new-period");
    if (btnNew && role === "teacher") {
      btnNew.addEventListener("click", function () {
        var db = getDb();
        if (!db) return;
        if (!canStartNewStatisticsPeriod(db)) {
          alert("진행 중인 기간이 있을 때는 새 기간을 만들 수 없습니다.");
          return;
        }
        var r = createNewStatisticsPeriod(db);
        if (!r.ok) {
          alert(r.msg || "기간을 만들 수 없습니다.");
          return;
        }
        route();
      });
    }
    if (role === "teacher") {
      var saves = root.querySelectorAll(".js-stats-save");
      var si;
      for (si = 0; si < saves.length; si++) {
        saves[si].addEventListener("click", function () {
          var db = getDb();
          if (!db) return;
          var periodId = this.getAttribute("data-period-id");
          var panel = this.closest(".stats-period-panel");
          if (!panel) return;
          var res = saveStatisticsPeriodFromPanel(db, panel, periodId);
          if (!res.ok) {
            alert(res.msg || "저장할 수 없습니다.");
            return;
          }
          alert("저장했습니다.");
        });
      }
      var approves = root.querySelectorAll(".js-stats-approve");
      for (si = 0; si < approves.length; si++) {
        approves[si].addEventListener("click", function () {
          var db = getDb();
          if (!db) return;
          var id = this.getAttribute("data-req-id");
          var res = approveStatisticsApprovalRequest(db, id);
          if (!res.ok) {
            alert(res.msg || "승인할 수 없습니다.");
            return;
          }
          alert("승인하여 반영했습니다.");
          route();
        });
      }
      var rejects = root.querySelectorAll(".js-stats-reject");
      for (si = 0; si < rejects.length; si++) {
        rejects[si].addEventListener("click", function () {
          var db = getDb();
          if (!db) return;
          var id = this.getAttribute("data-req-id");
          var res = rejectStatisticsApprovalRequest(db, id);
          if (!res.ok) {
            alert(res.msg || "처리할 수 없습니다.");
            return;
          }
          alert("거절했습니다.");
          route();
        });
      }
    }
    if (role === "student" && opts.session) {
      var subs = root.querySelectorAll(".js-stats-submit-request");
      var sj;
      for (sj = 0; sj < subs.length; sj++) {
        subs[sj].addEventListener("click", function () {
          var db = getDb();
          if (!db) return;
          var periodId = this.getAttribute("data-period-id");
          var panel = this.closest(".stats-period-panel");
          if (!panel) return;
          var res = submitStatisticsApprovalRequest(db, opts.session, panel, periodId);
          if (!res.ok) {
            alert(res.msg || "요청을 보낼 수 없습니다.");
            return;
          }
          alert("선생님께 승인 요청을 보냈습니다. 승인 후 반영됩니다.");
          route();
        });
      }
    }
  }

  function viewStudentStatisticsChecklist(session) {
    var db = getDb();
    if (!db) return;
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "statistician") {
      window.location.hash = "#/student";
      route();
      return;
    }
    var main = buildStatisticsChecklistHtml(db, {
      role: "student",
      canEdit: true,
      session: session,
    });
    shell(
      renderStudentChrome("통계청 · 체크리스트", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "stats"),
      })
    );
    bindLogout();
    bindStatisticsChecklist({ role: "student", session: session });
  }

  function viewTeacherStatisticsChecklist(session) {
    var db = getDb();
    if (!db) return;
    var main = buildStatisticsChecklistHtml(db, { role: "teacher", canEdit: true });
    shell(renderTeacherChrome("통계청 체크리스트", "statroll", main));
    bindLogout();
    bindStatisticsChecklist({ role: "teacher" });
  }

  function formatYmdLongKo(ymd) {
    var d = parseYmdToDate(ymd);
    if (!d) return String(ymd || "");
    return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일";
  }

  function submitPostmanErrandRequest(db, session, destination, content) {
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "postman") {
      return { ok: false, msg: "우체부 직업이 아닙니다." };
    }
    var dest = String(destination || "").trim();
    var body = String(content || "").trim();
    if (!dest) return { ok: false, msg: "목적지를 입력해 주세요." };
    if (!body) return { ok: false, msg: "심부름 내용을 입력해 주세요." };
    if (dest.length > 200) return { ok: false, msg: "목적지는 200자 이내로 입력해 주세요." };
    if (body.length > 2000) return { ok: false, msg: "심부름 내용은 2000자 이내로 입력해 주세요." };
    ensurePostmanErrandRequests(db);
    db.postmanErrandRequests.push({
      id: C.uid(),
      createdAt: Date.now(),
      dateYmd: todayYmdLocal(),
      destination: dest,
      content: body,
      submittedByStudentId: session.studentId,
      status: "pending",
      incentiveCal: null,
      resolvedAt: null,
    });
    saveDb(db);
    return { ok: true, msg: null };
  }

  function approvePostmanErrandRequest(db, reqId, incentiveRaw) {
    ensurePostmanErrandRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.postmanErrandRequests.length; i++) {
      if (db.postmanErrandRequests[i].id === reqId) {
        req = db.postmanErrandRequests[i];
        break;
      }
    }
    if (!req || req.status !== "pending") {
      return { ok: false, msg: "이미 처리된 요청입니다." };
    }
    var st = getStudent(db, req.submittedByStudentId);
    if (!st || st.jobId !== "postman") {
      return { ok: false, msg: "우체부 학생 정보가 올바르지 않습니다." };
    }
    var inc = parseInt(String(incentiveRaw != null ? incentiveRaw : "").trim(), 10);
    if (isNaN(inc) || inc < 0) inc = 0;
    if (inc > 999999) inc = 999999;
    req.incentiveCal = inc;
    req.status = "approved";
    req.resolvedAt = Date.now();
    if (inc > 0) {
      st.calory = Math.max(0, studentCaloryBalance(st) + inc);
      var destShort = String(req.destination || "").slice(0, 60);
      addActivityLog(db, {
        studentId: st.id,
        summary:
          "우체부 심부름 인센티브 +" +
          inc +
          " Cal (선생님 승인) · 목적지: " +
          destShort,
        expDelta: 0,
        caloryDelta: inc,
      });
    }
    saveDb(db);
    return { ok: true, msg: null };
  }

  function rejectPostmanErrandRequest(db, reqId) {
    ensurePostmanErrandRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.postmanErrandRequests.length; i++) {
      if (db.postmanErrandRequests[i].id === reqId) {
        req = db.postmanErrandRequests[i];
        break;
      }
    }
    if (!req || req.status !== "pending") {
      return { ok: false, msg: "이미 처리된 요청입니다." };
    }
    req.status = "rejected";
    req.resolvedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function buildPostmanErrandHistoryHtml(db, session) {
    ensurePostmanErrandRequests(db);
    var mine = db.postmanErrandRequests.filter(function (r) {
      return r.submittedByStudentId === session.studentId;
    });
    if (!mine.length) {
      return '<p class="muted bank-payroll__empty">아직 보낸 요청이 없습니다.</p>';
    }
    mine.sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    return (
      '<ul class="postman-history-list">' +
      mine
        .map(function (r) {
          var status =
            r.status === "pending"
              ? "대기"
              : r.status === "approved"
                ? "승인됨"
                : "거절됨";
          var inc =
            r.status === "approved" && r.incentiveCal != null && r.incentiveCal > 0
              ? " · 인센티브 " + formatNum(r.incentiveCal) + " Cal"
              : "";
          return (
            '<li class="postman-history-item">' +
            '<div class="postman-history-line"><strong>' +
            escapeHtml(formatYmdLongKo(r.dateYmd)) +
            "</strong> · " +
            status +
            inc +
            "</div>" +
            '<div class="muted postman-history-dest">목적지: ' +
            escapeHtml(r.destination) +
            "</div>" +
            '<div class="postman-history-content">' +
            escapeHtml(r.content) +
            "</div></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function buildPostmanErrandStudentHtml(db, session, opts) {
    opts = opts || {};
    var preview = opts.preview === true;
    var today = todayYmdLocal();
    var todayLabel = formatYmdLongKo(today);
    var formDisabled = preview ? " disabled" : "";
    var history = buildPostmanErrandHistoryHtml(db, session);
    return (
      '<div class="postman-errand-root">' +
      '<header class="postman-errand-head">' +
      '<h1 class="postman-errand-title">우체부의 심부름 일지</h1>' +
      "<p class=\"muted\">심부름 내용·목적지를 입력하고 선생님께 승인 요청하세요. 날짜는 요청 시점 기준으로 자동 기록됩니다.</p>" +
      "</header>" +
      '<section class="panel">' +
      '<h2 class="panel__title">새 심부름 기록</h2>' +
      (preview
        ? '<p class="panel__text muted bank-payroll-preview-note">※ <strong>미리보기</strong>에서는 요청을 보낼 수 없습니다.</p>'
        : "") +
      '<p class="panel__text"><strong>날짜(자동)</strong> ' +
      escapeHtml(todayLabel) +
      ' <span class="muted">(' +
      escapeHtml(today) +
      ")</span></p>" +
      '<form id="form-postman-errand" class="stack"' +
      (preview ? ' onsubmit="return false"' : "") +
      ">" +
      '<label class="field">목적지<input name="destination" type="text" maxlength="200" required' +
      formDisabled +
      ' autocomplete="off" placeholder="예: 교무실" /></label>' +
      '<label class="field">심부름 내용<textarea name="content" rows="5" maxlength="2000" required' +
      formDisabled +
      ' placeholder="무엇을 했는지 적어 주세요."></textarea></label>' +
      (preview
        ? '<p class="muted">미리보기에서는 저장되지 않습니다.</p>'
        : '<button type="submit" class="btn btn--primary">선생님께 승인 요청 보내기</button>') +
      "</form></section>" +
      '<section class="panel bank-payroll-panel">' +
      '<h2 class="panel__title">내가 보낸 요청</h2>' +
      history +
      "</section></div>"
    );
  }

  function buildPostmanErrandTeacherHtml(db) {
    ensurePostmanErrandRequests(db);
    var pending = db.postmanErrandRequests.filter(function (r) {
      return r.status === "pending";
    });
    pending.sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    var pendingBlock = pending.length
      ? pending
          .map(function (r) {
            var st = getStudent(db, r.submittedByStudentId);
            var name = st && st.name ? st.name : "—";
            var num = st && st.number != null ? st.number : "—";
            var contentHtml = escapeHtml(r.content || "").replace(/\n/g, "<br/>");
            return (
              '<article class="bank-payroll-card postman-teacher-card">' +
              '<div class="bank-payroll-card__head">' +
              "<span><strong>" +
              escapeHtml(name) +
              "</strong> (" +
              escapeHtml(String(num)) +
              ") · " +
              escapeHtml(formatYmdLongKo(r.dateYmd)) +
              "</span>" +
              '<span class="bank-payroll-status bank-payroll-status--pending">대기</span></div>' +
              '<div class="panel__text postman-teacher-detail"><strong>목적지</strong> ' +
              escapeHtml(r.destination || "") +
              "</div>" +
              '<div class="panel__text postman-teacher-detail"><strong>심부름 내용</strong><br/>' +
              contentHtml +
              "</div>" +
              '<div class="postman-teacher-actions">' +
              '<label class="field field--inline postman-incentive-label">인센티브 (Cal) ' +
              '<input type="number" class="js-postman-incentive" min="0" max="999999" step="1" placeholder="0" data-req-id="' +
              escapeHtml(r.id) +
              '" /></label>' +
              '<div class="row-actions row-actions--wrap">' +
              '<button type="button" class="btn btn--primary btn--sm js-postman-approve" data-req-id="' +
              escapeHtml(r.id) +
              '">승인</button>' +
              '<button type="button" class="btn btn--ghost btn--sm js-postman-reject" data-req-id="' +
              escapeHtml(r.id) +
              '">거절</button>' +
              "</div></div></article>"
            );
          })
          .join("")
      : '<p class="muted">승인 대기 중인 심부름이 없습니다.</p>';

    var rest = db.postmanErrandRequests.filter(function (r) {
      return r.status !== "pending";
    });
    rest.sort(function (a, b) {
      var ta = a.resolvedAt || a.createdAt || 0;
      var tb = b.resolvedAt || b.createdAt || 0;
      return tb - ta;
    });
    var restBlock = rest.length
      ? '<ul class="postman-history-list postman-history-list--teacher">' +
        rest
          .map(function (r) {
            var st = getStudent(db, r.submittedByStudentId);
            var name = st && st.name ? st.name : "—";
            var stLabel = r.status === "approved" ? "승인" : "거절";
            var inc =
              r.status === "approved" && r.incentiveCal != null && r.incentiveCal > 0
                ? " · 인센티브 " + formatNum(r.incentiveCal) + " Cal"
                : "";
            return (
              "<li>" +
              escapeHtml(name) +
              " · " +
              escapeHtml(formatYmdLongKo(r.dateYmd)) +
              " · " +
              stLabel +
              inc +
              " · " +
              escapeHtml(fmtTime(r.resolvedAt || r.createdAt)) +
              "</li>"
            );
          })
          .join("") +
        "</ul>"
      : "";

    return (
      '<section class="panel">' +
      '<h2 class="panel__title">승인 대기 (우체부 심부름)</h2>' +
      '<p class="panel__text muted">인센티브를 입력하면 승인 시 우체부 학생 Calory에 반영되고 활동 내역에 남습니다. 비우거나 0이면 승인만 처리됩니다.</p>' +
      pendingBlock +
      "</section>" +
      (restBlock
        ? '<section class="panel"><h2 class="panel__title">처리 내역</h2>' + restBlock + "</section>"
        : "")
    );
  }

  function bindPostmanErrandStudent(session) {
    var form = document.getElementById("form-postman-errand");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var db = getDb();
      if (!db) return;
      var fd = new FormData(form);
      var res = submitPostmanErrandRequest(db, session, fd.get("destination"), fd.get("content"));
      if (!res.ok) {
        alert(res.msg || "요청을 보낼 수 없습니다.");
        return;
      }
      alert("선생님께 승인 요청을 보냈습니다.");
      route();
    });
  }

  function viewStudentPostmanErrand(session) {
    var db = getDb();
    if (!db) return;
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "postman") {
      window.location.hash = "#/student";
      route();
      return;
    }
    var main = buildPostmanErrandStudentHtml(db, session, {});
    shell(
      renderStudentChrome("우체부 · 심부름 일지", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "postman"),
      })
    );
    bindLogout();
    bindPostmanErrandStudent(session);
  }

  function viewTeacherPostmanErrand(session) {
    var db = getDb();
    if (!db) return;
    var main = buildPostmanErrandTeacherHtml(db);
    shell(renderTeacherChrome("우체부 심부름 일지", "postroll", main));
    bindLogout();
    var root = document.getElementById("app");
    if (!root) return;
    var ai;
    var approves = root.querySelectorAll(".js-postman-approve");
    for (ai = 0; ai < approves.length; ai++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-req-id");
          if (!id) return;
          var inp = root.querySelector('.js-postman-incentive[data-req-id="' + id + '"]');
          var val = inp ? inp.value : "";
          if (!confirm("이 심부름을 승인하시겠습니까? (입력한 인센티브만큼 Calory가 오릅니다.)")) return;
          var r = approvePostmanErrandRequest(getDb(), id, val);
          if (!r.ok) {
            alert(r.msg || "처리할 수 없습니다.");
            return;
          }
          alert("승인했습니다.");
          route();
        });
      })(approves[ai]);
    }
    var rejects = root.querySelectorAll(".js-postman-reject");
    for (ai = 0; ai < rejects.length; ai++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-req-id");
          if (!id || !confirm("이 요청을 거절하시겠습니까?")) return;
          var r2 = rejectPostmanErrandRequest(getDb(), id);
          if (!r2.ok) {
            alert(r2.msg || "처리할 수 없습니다.");
            return;
          }
          alert("거절했습니다.");
          route();
        });
      })(rejects[ai]);
    }
  }

  function buildCleaningChecklistStudentHtml(db, session, opts) {
    opts = opts || {};
    var preview = opts.preview === true;
    var sid = session.studentId;
    var st = getStudent(db, sid);
    var d = new Date();
    var todayY = todayYmdLocal();
    var todayHuman = formatYmdLongKo(todayY) + " · " + weekdayLongKoFromDate(d);
    if (preview) {
      return (
        '<div class="cleaning-checklist-root">' +
        '<header class="postman-errand-head">' +
        '<h1 class="postman-errand-title">청소부의 청소 체크리스트</h1>' +
        '<p class="muted">수요일·금요일에 4개 구역 서명 후 선생님께 승인 요청합니다. <strong>미리보기</strong>에서는 저장되지 않습니다.</p>' +
        "</header>" +
        '<section class="panel"><p class="panel__text muted">미리보기입니다.</p></section></div>'
      );
    }
    if (!st || st.jobId !== "cleaner") {
      return '<p class="panel__text">청소부만 이용할 수 있습니다.</p>';
    }
    if (!isCleaningScheduleDay(d)) {
      var hist = buildCleaningHistoryStudentHtml(db, sid);
      return (
        '<div class="cleaning-checklist-root">' +
        '<header class="postman-errand-head">' +
        '<h1 class="postman-errand-title">청소부의 청소 체크리스트</h1>' +
        '<p class="muted">청소 기록 작성은 <strong>수요일·금요일</strong>에만 가능합니다.</p>' +
        '</header>' +
        '<section class="panel">' +
        '<p class="panel__text"><strong>오늘 날짜·요일</strong> ' +
        escapeHtml(todayHuman) +
        '</p>' +
        '</section>' +
        '<section class="panel bank-payroll-panel">' +
        '<h2 class="panel__title">나의 청소 기록</h2>' +
        hist +
        '</section>' +
        '</div>'
      );
    }
    var gr = getOrCreateCleaningDraft(db);
    if (!gr.ok) {
      return '<p class="panel__text">' + escapeHtml(gr.msg || "열 수 없습니다.") + "</p>";
    }
    var rec = gr.record;
    var z = getZoneStudentIds(rec);

    var zonesHtml = "";
    if (rec.status === "draft") {
      var cleaners = db.students.filter(function (s) {
        return s.jobId === "cleaner";
      }).sort(function (a, b) {
        return (a.number || 0) - (b.number || 0);
      });

      zonesHtml =
        '<form id="form-cleaning-zones" class="stack" style="gap: 1rem; width: 100%;">' +
          '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; width: 100%;">' +
            '<div class="cleaning-zone-card">' +
              '<div class="cleaning-zone-card__head">1구역 (칠판/교단 주변)</div>' +
              '<div class="cleaning-zone-card__body" style="padding-top: 0.5rem;">' +
                buildCleanerSelectHtml(cleaners, "zone1", rec.zone1StudentId) +
              '</div>' +
            '</div>' +
            '<div class="cleaning-zone-card">' +
              '<div class="cleaning-zone-card__head">2구역 (바닥 청소/빗자루)</div>' +
              '<div class="cleaning-zone-card__body" style="padding-top: 0.5rem;">' +
                buildCleanerSelectHtml(cleaners, "zone2", rec.zone2StudentId) +
              '</div>' +
            '</div>' +
            '<div class="cleaning-zone-card">' +
              '<div class="cleaning-zone-card__head">3구역 (창틀/먼지털기)</div>' +
              '<div class="cleaning-zone-card__body" style="padding-top: 0.5rem;">' +
                buildCleanerSelectHtml(cleaners, "zone3", rec.zone3StudentId) +
              '</div>' +
            '</div>' +
            '<div class="cleaning-zone-card">' +
              '<div class="cleaning-zone-card__head">4구역 (쓰레기통 분리수거)</div>' +
              '<div class="cleaning-zone-card__body" style="padding-top: 0.5rem;">' +
                buildCleanerSelectHtml(cleaners, "zone4", rec.zone4StudentId) +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button type="submit" class="btn btn--accent" style="width: 100%; margin-top: 0.5rem;">✍️ 구역 배정 및 서명 일괄 저장</button>' +
        '</form>';
    } else {
      var zText = [];
      var i;
      for (i = 0; i < 4; i++) {
        var zn = i + 1;
        var holder = z[i] ? getStudent(db, z[i]) : null;
        var line = holder
          ? escapeHtml(String(holder.number != null ? holder.number : "—") + ". " + (holder.name || "")) + " (서명 완료 ✅)"
          : '<span class="muted">미배정/미서명</span>';
        zText.push(
          '<div class="cleaning-zone-card">' +
            '<div class="cleaning-zone-card__head">' + zn + '구역</div>' +
            '<div class="cleaning-zone-card__body" style="font-weight: bold; color: var(--accent); padding-top: 0.5rem;">' +
              line +
            '</div>' +
          '</div>'
        );
      }
      zonesHtml = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; width: 100%;">' + zText.join("") + '</div>';
    }

    var att = rec.attentionStudentIds || [];
    var a1 = att[0] || "";
    var a2 = att[1] || "";
    var a3 = att[2] || "";
    var attnBlock =
      rec.status === "draft"
        ? '<section class="panel">' +
          '<h2 class="panel__title">요주의 자리 (최대 3명)</h2>' +
          '<p class="panel__text muted">학급 명단에서 선택합니다. 비워 두어도 됩니다.</p>' +
          '<form id="form-cleaning-attn" class="stack">' +
          '<label class="field">요주의 1' +
          buildCleaningAttentionSelectHtml(db, "attn1", a1) +
          "</label>" +
          '<label class="field">요주의 2' +
          buildCleaningAttentionSelectHtml(db, "attn2", a2) +
          "</label>" +
          '<label class="field">요주의 3' +
          buildCleaningAttentionSelectHtml(db, "attn3", a3) +
          "</label>" +
          '<button type="submit" class="btn btn--ghost">요주의 자리 저장</button>' +
          "</form></section>"
        : '<section class="panel">' +
          '<h2 class="panel__title">요주의 자리</h2>' +
          '<p class="panel__text">' +
          escapeHtml(formatCleaningAttentionDisplay(db, rec)) +
          "</p></section>";

    var allSigned = z[0] && z[1] && z[2] && z[3];
    var statusBlock = "";
    if (rec.status === "pending") {
      statusBlock =
        '<section class="panel"><p class="panel__text"><strong>선생님 승인 대기 중</strong>입니다.</p></section>';
    } else if (rec.status === "approved") {
      statusBlock =
        '<section class="panel"><p class="panel__text"><strong>선생님 승인 완료</strong> · 이번 청소 기록이 마감되었습니다.</p></section>';
    } else if (rec.status === "rejected") {
      statusBlock =
        '<section class="panel"><p class="panel__text"><strong>거절됨</strong> — 선생님께 문의하세요.</p></section>';
    }
    var submitBlock = "";
    if (rec.status === "draft" && allSigned) {
      submitBlock =
        '<section class="panel">' +
        '<p class="panel__text muted">인센티브 칸은 비워 두고, 선생님께 승인 요청을 보냅니다.</p>' +
        '<button type="button" class="btn btn--primary js-cleaning-submit">선생님께 승인 요청 보내기</button>' +
        "</section>";
    } else if (rec.status === "draft" && !allSigned) {
      submitBlock =
        '<section class="panel"><p class="muted">4개 구역 서명이 모두 끝나면 승인 요청을 보낼 수 있습니다.</p></section>';
    }
    var hist = buildCleaningHistoryStudentHtml(db, sid);
    return (
      '<div class="cleaning-checklist-root">' +
      '<header class="postman-errand-head">' +
      '<h1 class="postman-errand-title">청소부의 청소 체크리스트</h1>' +
      '<p class="muted">수요일·금요일 청소 후 구역별 담당자를 일괄 배정하고 서명하여 제출합니다.</p>' +
      "</header>" +
      '<section class="panel">' +
      '<p class="panel__text"><strong>날짜·요일(자동)</strong> ' +
      escapeHtml(todayHuman) +
      "</p>" +
      "</section>" +
      statusBlock +
      (rec.status === "draft" || rec.status === "pending"
        ? '<section class="panel"><h2 class="panel__title">위치별 체크 (서명)</h2>' +
          '<div style="width: 100%;">' +
          zonesHtml +
          "</div></section>" +
          attnBlock +
          submitBlock
        : '<section class="panel"><h2 class="panel__title">이번 날짜 기록</h2>' +
          '<div style="width: 100%;">' +
          zonesHtml +
          "</div></section>" +
          attnBlock) +
      '<section class="panel bank-payroll-panel">' +
      '<h2 class="panel__title">나의 청소 기록</h2>' +
      hist +
      "</section></div>"
    );
  }

  function buildCleanerSelectHtml(cleaners, name, selectedId) {
    var opts = '<option value="">— 청소부 선택 —</option>';
    var i;
    for (i = 0; i < cleaners.length; i++) {
      var s = cleaners[i];
      var sel = selectedId === s.id ? " selected" : "";
      opts +=
        '<option value="' +
        escapeHtml(s.id) +
        '"' +
        sel +
        ">" +
        escapeHtml(String(s.number != null ? s.number : "—") + ". " + (s.name || "")) +
        "</option>";
    }
    return '<select name="' + escapeHtml(name) + '" class="field cleaning-attn-select" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border); color: var(--text); padding: 0.4rem; border-radius: 4px; width: 100%;" required>' + opts + '</select>';
  }

  function buildCleaningHistoryStudentHtml(db, studentId) {
    ensureCleaningChecklistRequests(db);
    var mine = db.cleaningChecklistRequests.filter(function (r) {
      if (!r || r.status === "draft") return false;
      return studentSignedCleaningZone(r, studentId) != null;
    });
    if (!mine.length) {
      return '<p class="muted bank-payroll__empty">완료된 청소 기록이 아직 없습니다.</p>';
    }
    mine.sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    return (
      '<ul class="postman-history-list">' +
      mine
        .map(function (r) {
          var status =
            r.status === "pending"
              ? "대기"
              : r.status === "approved"
                ? "완료"
                : "거절";
          var inc =
            r.status === "approved" && r.incentiveCal != null && r.incentiveCal > 0
              ? " · 인센티브 " + formatNum(r.incentiveCal) + " Cal/인"
              : "";
          return (
            '<li class="postman-history-item">' +
            '<div class="postman-history-line"><strong>' +
            escapeHtml(formatYmdLongKo(r.dateYmd)) +
            "</strong> · " +
            escapeHtml(r.weekdayKo || "") +
            " · " +
            status +
            inc +
            "</div></li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function buildCleaningChecklistTeacherHtml(db) {
    ensureCleaningChecklistRequests(db);
    var pending = db.cleaningChecklistRequests.filter(function (r) {
      return r && r.status === "pending";
    });
    pending.sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    function zoneLine(db0, r, zi) {
      var id = getZoneStudentIds(r)[zi];
      var st0 = id ? getStudent(db0, id) : null;
      return st0
        ? escapeHtml(String(st0.number != null ? st0.number : "—")) + " " + escapeHtml(st0.name || "")
        : "—";
    }
    function attnLine(db0, r) {
      var att = r.attentionStudentIds || [];
      if (!att.length) return "—";
      return att
        .map(function (aid) {
          var s = getStudent(db0, aid);
          return s ? escapeHtml(s.name) : "—";
        })
        .join(", ");
    }
    var pendingBlock = pending.length
      ? pending
          .map(function (r) {
            return (
              '<article class="bank-payroll-card postman-teacher-card">' +
              '<div class="bank-payroll-card__head">' +
              "<span><strong>" +
              escapeHtml(formatYmdLongKo(r.dateYmd)) +
              "</strong> · " +
              escapeHtml(r.weekdayKo || "") +
              "</span>" +
              '<span class="bank-payroll-status bank-payroll-status--pending">대기</span></div>' +
              '<div class="cleaning-teacher-zones panel__text">' +
              "<div><strong>1구역</strong> " +
              zoneLine(db, r, 0) +
              "</div>" +
              "<div><strong>2구역</strong> " +
              zoneLine(db, r, 1) +
              "</div>" +
              "<div><strong>3구역</strong> " +
              zoneLine(db, r, 2) +
              "</div>" +
              "<div><strong>4구역</strong> " +
              zoneLine(db, r, 3) +
              "</div>" +
              "</div>" +
              '<div class="panel__text"><strong>요주의 자리</strong> ' +
              attnLine(db, r) +
              "</div>" +
              '<div class="postman-teacher-actions">' +
              '<label class="field field--inline postman-incentive-label">인센티브 (1인당 Cal, 공란·0 가능) ' +
              '<input type="number" class="js-cleaning-incentive" min="0" max="999999" step="1" placeholder="0" data-req-id="' +
              escapeHtml(r.id) +
              '" /></label>' +
              '<div class="row-actions row-actions--wrap">' +
              '<button type="button" class="btn btn--primary btn--sm js-cleaning-save" data-req-id="' +
              escapeHtml(r.id) +
              '">저장</button>' +
              '<button type="button" class="btn btn--ghost btn--sm js-cleaning-reject" data-req-id="' +
              escapeHtml(r.id) +
              '">거절</button>' +
              "</div></div></article>"
            );
          })
          .join("")
      : '<p class="muted">승인 대기 중인 청소 체크리스트가 없습니다.</p>';
    var rest = db.cleaningChecklistRequests.filter(function (r) {
      return r && r.status !== "pending";
    });
    rest.sort(function (a, b) {
      var ta = a.resolvedAt || a.createdAt || 0;
      var tb = b.resolvedAt || b.createdAt || 0;
      return tb - ta;
    });
    var restBlock = rest.length
      ? '<ul class="postman-history-list postman-history-list--teacher">' +
        rest
          .map(function (r) {
            var stLabel = r.status === "approved" ? "저장됨" : "거절";
            var inc =
              r.status === "approved" && r.incentiveCal != null && r.incentiveCal > 0
                ? " · " + formatNum(r.incentiveCal) + " Cal/인"
                : "";
            return (
              "<li>" +
              escapeHtml(formatYmdLongKo(r.dateYmd)) +
              " · " +
              stLabel +
              inc +
              " · " +
              escapeHtml(fmtTime(r.resolvedAt || r.createdAt)) +
              "</li>"
            );
          })
          .join("") +
        "</ul>"
      : "";
    return (
      '<section class="panel">' +
      '<h2 class="panel__title">승인 대기 (청소 체크리스트)</h2>' +
      '<p class="panel__text muted">인센티브를 입력하면 <strong>서명한 청소부 4인 각각</strong>에게 같은 Calory가 반영됩니다. 공란 또는 0이면 기록만 마감합니다.</p>' +
      pendingBlock +
      "</section>" +
      (restBlock
        ? '<section class="panel"><h2 class="panel__title">처리 내역</h2>' + restBlock + "</section>"
        : "")
    );
  }

  function bindCleaningChecklistStudent(session) {
    var root = document.getElementById("app");
    if (!root) return;
    var zonesForm = document.getElementById("form-cleaning-zones");
    if (zonesForm) {
      zonesForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(zonesForm);
        var r = saveCleaningZones(
          getDb(),
          session,
          fd.get("zone1"),
          fd.get("zone2"),
          fd.get("zone3"),
          fd.get("zone4")
        );
        if (!r.ok) {
          alert(r.msg || "구역 배정을 저장할 수 없습니다.");
          return;
        }
        alert("구역 배정 및 서명을 일괄 저장했습니다.");
        route();
      });
    }
    var attnForm = document.getElementById("form-cleaning-attn");
    if (attnForm) {
      attnForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(attnForm);
        var r = saveCleaningAttentionStudents(getDb(), session, [
          fd.get("attn1"),
          fd.get("attn2"),
          fd.get("attn3"),
        ]);
        if (!r.ok) {
          alert(r.msg || "저장할 수 없습니다.");
          return;
        }
        alert("요주의 자리를 저장했습니다.");
        route();
      });
    }
    var sub = root.querySelector(".js-cleaning-submit");
    if (sub) {
      sub.addEventListener("click", function () {
        var r = submitCleaningChecklistRequest(getDb(), session);
        if (!r.ok) {
          alert(r.msg || "요청을 보낼 수 없습니다.");
          return;
        }
        alert("선생님께 승인 요청을 보냈습니다.");
        route();
      });
    }
  }

  function viewStudentCleaningChecklist(session) {
    var db = getDb();
    if (!db) return;
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "cleaner") {
      window.location.hash = "#/student";
      route();
      return;
    }
    var main = buildCleaningChecklistStudentHtml(db, session, {});
    shell(
      renderStudentChrome("청소부 · 청소 체크리스트", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "cleaner"),
      })
    );
    bindLogout();
    bindCleaningChecklistStudent(session);
  }

  function viewTeacherCleaningChecklist(session) {
    var db = getDb();
    if (!db) return;
    var main = buildCleaningChecklistTeacherHtml(db);
    shell(renderTeacherChrome("청소부 청소 체크리스트", "cleanroll", main));
    bindLogout();
    var root = document.getElementById("app");
    if (!root) return;
    var ai;
    var saves = root.querySelectorAll(".js-cleaning-save");
    for (ai = 0; ai < saves.length; ai++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-req-id");
          if (!id) return;
          var inp = root.querySelector('.js-cleaning-incentive[data-req-id="' + id + '"]');
          var val = inp ? inp.value : "";
          if (!confirm("저장하면 이번 청소 활동이 마감됩니다. 인센티브가 있으면 청소부 4인에게 각각 반영됩니다. 계속할까요?")) return;
          var r = approveCleaningChecklistRequest(getDb(), id, val);
          if (!r.ok) {
            alert(r.msg || "처리할 수 없습니다.");
            return;
          }
          alert("저장했습니다.");
          route();
        });
      })(saves[ai]);
    }
    var rejects = root.querySelectorAll(".js-cleaning-reject");
    for (ai = 0; ai < rejects.length; ai++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-req-id");
          if (!id || !confirm("이 요청을 거절하시겠습니까?")) return;
          var r2 = rejectCleaningChecklistRequest(getDb(), id);
          if (!r2.ok) {
            alert(r2.msg || "처리할 수 없습니다.");
            return;
          }
          alert("거절했습니다.");
          route();
        });
      })(rejects[ai]);
    }
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(ctx, args);
      }, ms);
    };
  }

  var BOARD_PERIODS = [
    { key: "morning", label: "아침활동" },
    { key: "p1", label: "1교시" },
    { key: "p2", label: "2교시" },
    { key: "p3", label: "3교시" },
    { key: "p4", label: "4교시" },
    { key: "p5", label: "5교시" },
    { key: "p6", label: "6교시" },
  ];

  /** 학급 1인 1역 (교사가 학생별로 배정, 인원 한도는 classJobQuotas) */
  var CLASS_JOBS = [
    { id: "bank_m", label: "은행(남)", icon: "🏦" },
    { id: "bank_f", label: "은행(여)", icon: "🏦" },
    { id: "statistician", label: "통계원", icon: "📊" },
    { id: "tax_m", label: "국세직원(남)", icon: "🧾" },
    { id: "tax_f", label: "국세직원(여)", icon: "🧾" },
    { id: "postman", label: "우체부", icon: "📮" },
    { id: "cleaner", label: "청소부", icon: "🧹" },
    { id: "recycler", label: "분리수거부", icon: "♻️" },
    { id: "env", label: "환경부", icon: "🌿" },
    { id: "handyman", label: "다재다능이", icon: "⭐" },
    { id: "line", label: "줄관리원", icon: "📏" },
    { id: "air", label: "공기청정위원", icon: "🌬️" },
    { id: "coupon_merchant", label: "쿠폰상인", icon: "🎫" },
    { id: "store_merchant", label: "매점상인", icon: "🏪" },
    { id: "dj", label: "DJ", icon: "🎧" },
    { id: "credit", label: "신용평가위원", icon: "📈" },
  ];

  function ensureClassJobSettings(db) {
    if (!db) return;
    if (!db.classJobQuotas || typeof db.classJobQuotas !== "object") {
      db.classJobQuotas = {};
    }
    migrateLegacyBankJobData(db);
    migrateLegacyTaxJobData(db);
    var i;
    for (i = 0; i < CLASS_JOBS.length; i++) {
      var jid = CLASS_JOBS[i].id;
      if (db.classJobQuotas[jid] === undefined || db.classJobQuotas[jid] === null) {
        db.classJobQuotas[jid] = 1;
      }
    }
  }

  /** 예전 직업 id `bank` → 번호순으로 은행(남)/은행(여) 교대 배정, 인원 한도 키 이전, 은행(남)만 둘 있으면 한 명을 은행(여)로 보정 */
  function migrateLegacyBankJobData(db) {
    if (!db || !db.students) return;
    var dirty = false;
    var oldQ = db.classJobQuotas && db.classJobQuotas.bank;
    if (oldQ !== undefined && oldQ !== null) {
      if (db.classJobQuotas.bank_m === undefined || db.classJobQuotas.bank_m === null) {
        db.classJobQuotas.bank_m = oldQ;
      }
      if (db.classJobQuotas.bank_f === undefined || db.classJobQuotas.bank_f === null) {
        db.classJobQuotas.bank_f = oldQ;
      }
      delete db.classJobQuotas.bank;
      dirty = true;
    }
    var legacy = [];
    var si;
    for (si = 0; si < db.students.length; si++) {
      if (db.students[si].jobId === "bank") {
        legacy.push(db.students[si]);
      }
    }
    if (legacy.length) {
      legacy.sort(function (a, b) {
        return Number(a.number != null ? a.number : 0) - Number(b.number != null ? b.number : 0);
      });
      var li;
      for (li = 0; li < legacy.length; li++) {
        legacy[li].jobId = li % 2 === 0 ? "bank_m" : "bank_f";
      }
      dirty = true;
    }
    var ms;
    var fs;
    var guard = 0;
    while (guard++ < 20) {
      ms = [];
      fs = [];
      for (si = 0; si < db.students.length; si++) {
        var st2 = db.students[si];
        if (st2.jobId === "bank_m") ms.push(st2);
        else if (st2.jobId === "bank_f") fs.push(st2);
      }
      if (ms.length >= 2 && fs.length === 0) {
        ms.sort(function (a, b) {
          return Number(a.number != null ? a.number : 0) - Number(b.number != null ? b.number : 0);
        });
        ms[1].jobId = "bank_f";
        dirty = true;
        continue;
      }
      if (fs.length >= 2 && ms.length === 0) {
        fs.sort(function (a, b) {
          return Number(a.number != null ? a.number : 0) - Number(b.number != null ? b.number : 0);
        });
        fs[1].jobId = "bank_m";
        dirty = true;
        continue;
      }
      break;
    }
    if (dirty) saveDb(db);
  }

  /** 예전 직업 id `tax` → 번호순으로 국세직원(남)/국세직원(여) 교대 배정, 인원 한도 키 이전, 한쪽만 둘 있으면 한 명을 반대로 보정 */
  function migrateLegacyTaxJobData(db) {
    if (!db || !db.students) return;
    var dirty = false;
    var oldQ = db.classJobQuotas && db.classJobQuotas.tax;
    if (oldQ !== undefined && oldQ !== null) {
      if (db.classJobQuotas.tax_m === undefined || db.classJobQuotas.tax_m === null) {
        db.classJobQuotas.tax_m = oldQ;
      }
      if (db.classJobQuotas.tax_f === undefined || db.classJobQuotas.tax_f === null) {
        db.classJobQuotas.tax_f = oldQ;
      }
      delete db.classJobQuotas.tax;
      dirty = true;
    }
    var legacy = [];
    var si;
    for (si = 0; si < db.students.length; si++) {
      if (db.students[si].jobId === "tax") {
        legacy.push(db.students[si]);
      }
    }
    if (legacy.length) {
      legacy.sort(function (a, b) {
        return Number(a.number != null ? a.number : 0) - Number(b.number != null ? b.number : 0);
      });
      var li;
      for (li = 0; li < legacy.length; li++) {
        legacy[li].jobId = li % 2 === 0 ? "tax_m" : "tax_f";
      }
      dirty = true;
    }
    var ms;
    var fs;
    var guard = 0;
    while (guard++ < 20) {
      ms = [];
      fs = [];
      for (si = 0; si < db.students.length; si++) {
        var st2 = db.students[si];
        if (st2.jobId === "tax_m") ms.push(st2);
        else if (st2.jobId === "tax_f") fs.push(st2);
      }
      if (ms.length >= 2 && fs.length === 0) {
        ms.sort(function (a, b) {
          return Number(a.number != null ? a.number : 0) - Number(b.number != null ? b.number : 0);
        });
        ms[1].jobId = "tax_f";
        dirty = true;
        continue;
      }
      if (fs.length >= 2 && ms.length === 0) {
        fs.sort(function (a, b) {
          return Number(a.number != null ? a.number : 0) - Number(b.number != null ? b.number : 0);
        });
        fs[1].jobId = "tax_m";
        dirty = true;
        continue;
      }
      break;
    }
    if (dirty) saveDb(db);
  }

  function isBankJobId(jobId) {
    return jobId === "bank_m" || jobId === "bank_f" || jobId === "bank";
  }

  /** 은행원이 주급을 줄 수 있는 친구 성별: 'male' | 'female'. 은행 직업이 아니면 null */
  function bankPayrollTargetGenderForJob(jobId) {
    if (jobId === "bank_f") return "female";
    if (jobId === "bank_m" || jobId === "bank") return "male";
    return null;
  }

  /**
   * 은행원이 주급을 줄 수 있는 대상인지.
   * 은행(남): 남학생(본인 제외) + 은행(여) 은행원 / 은행(여): 여학생(본인 제외) + 은행(남)·레거시 은행원
   */
  function isPayrollRecipientForBanker(db, banker, recipient) {
    if (!banker || !recipient || recipient.id === banker.id) return false;
    var jid = banker.jobId;
    if (jid === "bank_m" || jid === "bank") {
      if (recipient.jobId === "bank_f") return true;
      return studentGender(recipient) === "male";
    }
    if (jid === "bank_f") {
      if (recipient.jobId === "bank_m" || recipient.jobId === "bank") return true;
      return studentGender(recipient) === "female";
    }
    return false;
  }

  function isTaxJobId(jobId) {
    return jobId === "tax_m" || jobId === "tax_f" || jobId === "tax";
  }

  /**
   * 국세 직원이 세금을 징수할 수 있는 대상인지.
   * 국세(남): 남학생(본인 제외) + 국세(여) / 국세(여): 여학생(본인 제외) + 국세(남)·레거시 국세
   */
  function isTaxRecipientForCollector(db, collector, recipient) {
    if (!collector || !recipient || recipient.id === collector.id) return false;
    var jid = collector.jobId;
    if (jid === "tax_m" || jid === "tax") {
      if (recipient.jobId === "tax_f") return true;
      return studentGender(recipient) === "male";
    }
    if (jid === "tax_f") {
      if (recipient.jobId === "tax_m" || recipient.jobId === "tax") return true;
      return studentGender(recipient) === "female";
    }
    return false;
  }

  function getJobDef(jobId) {
    if (!jobId) return null;
    var i;
    for (i = 0; i < CLASS_JOBS.length; i++) {
      if (CLASS_JOBS[i].id === jobId) return CLASS_JOBS[i];
    }
    return null;
  }

  function countStudentsWithJob(db, jobId, excludeStudentId) {
    if (!jobId || !db || !db.students) return 0;
    var n = 0;
    var i;
    for (i = 0; i < db.students.length; i++) {
      var s = db.students[i];
      if (excludeStudentId && s.id === excludeStudentId) continue;
      if (s.jobId === jobId) n++;
    }
    return n;
  }

  function getJobQuota(db, jobId) {
    ensureClassJobSettings(db);
    var q = db.classJobQuotas[jobId];
    return typeof q === "number" && !isNaN(q) ? Math.max(0, Math.floor(q)) : 1;
  }

  function canAssignJob(db, studentId, newJobId) {
    if (!newJobId) return true;
    var quota = getJobQuota(db, newJobId);
    var cnt = countStudentsWithJob(db, newJobId, studentId);
    return cnt < quota;
  }

  /**
   * 오전 7시 기준 boardDateKey가 바뀌면 시간표·알림장만 비움.
   * 급식 API, 날씨 좌표, 달력 메모, To-Do, 학생 활동 집계는 유지.
   * 최초 필드 없음: 현재 키만 기록하고 내용은 건드리지 않음(기존 데이터 보존).
   */
  function applyDailyBoardContentReset(db) {
    if (!db) return false;
    ensureDigitalBoard(db);
    var key = boardDateKey();
    var stored = db.digitalBoard.dailyContentKey;
    if (stored === undefined) {
      db.digitalBoard.dailyContentKey = key;
      saveDb(db);
      return false;
    }
    if (stored === key) return false;
    var i;
    for (i = 0; i < BOARD_PERIODS.length; i++) {
      var pk = BOARD_PERIODS[i].key;
      db.digitalBoard.timetable[pk] = { subject: "", activity: "" };
    }
    db.digitalBoard.notice = "";
    db.digitalBoard.dailyContentKey = key;
    saveDb(db);
    return true;
  }

  /**
   * 집계일(boardDateKey) 경계 처리 순서(고정):
   * 1) 경험치 정규화 → 2) 매일 성장 등 학생 EXP 반영 → 3) 마지막에 디지털 칠판(시간표·알림장) 리셋
   * 칠판 활동 점수를 통계·EXP와 맞춘 뒤에만 칠판 UI/본문을 비워야 하므로 리셋은 항상 맨 끝.
   * @returns {boolean} applyDailyBoardContentReset이 실제로 시간표·알림장을 비웠는지
   */
  function runDailyBoardBoundaryPipeline(db) {
    if (!db) return false;
    ensureExpNormalized(db);
    applyDailyExpGrowthIfNeeded(db);
    return applyDailyBoardContentReset(db);
  }

  function ensureExpNormalized(db) {
    if (!db || !Array.isArray(db.students)) return false;
    var changed = false;
    var i;
    for (i = 0; i < db.students.length; i++) {
      var s = db.students[i];
      var ce = clampExp(typeof s.exp === "number" && !isNaN(s.exp) ? s.exp : 0);
      if (s.exp !== ce) {
        s.exp = ce;
        changed = true;
      }
    }
    if (changed) saveDb(db);
    return changed;
  }

  /** 매일 오전 7시 집계일이 바뀔 때마다 전원 경험치 +20(%p) */
  function applyDailyExpGrowthIfNeeded(db) {
    if (!db || !Array.isArray(db.students)) return;
    var key = boardDateKey();
    var last = db.lastDailyExpGrowthBoardKey;
    if (last === undefined || last === null) {
      db.lastDailyExpGrowthBoardKey = key;
      saveDb(db);
      return;
    }
    if (last === key) return;
    if (!isWeekendYmd(key)) {
      var i;
      for (i = 0; i < db.students.length; i++) {
        var st = db.students[i];
        var prev = clampExp(st.exp);
        var add = 10;
        st.exp = prev + add;
        if (true) {
          addActivityLog(db, {
            studentId: st.id,
            summary: "매일 아침 성장 · 경험치 +" + add + "%",
            expDelta: add,
          });
          autoLevelUp(st, db);
        }
      }
    }
    db.lastDailyExpGrowthBoardKey = key;
    saveDb(db);
  }

  function wmoWeatherLabelKo(code) {
    var c = typeof code === "number" ? code : 0;
    var map = {
      0: "맑음",
      1: "대체로 맑음",
      2: "약간 흐림",
      3: "흐림",
      45: "안개",
      48: "안개",
      51: "이슬비",
      61: "비",
      63: "비",
      65: "강한 비",
      71: "눈",
      80: "소나기",
      95: "뇌우",
    };
    return map[c] != null ? map[c] : "날씨";
  }

  function wmoWeatherEmoji(code) {
    var c = typeof code === "number" ? code : 0;
    var map = {
      0: "☀️",
      1: "🌤️",
      2: "⛅",
      3: "☁️",
      45: "🌫️",
      48: "🌫️",
      51: "🌦️",
      53: "🌧️",
      55: "🌧️",
      61: "🌧️",
      63: "🌧️",
      65: "🌧️",
      71: "🌨️",
      73: "🌨️",
      75: "🌨️",
      77: "🌨️",
      80: "🌦️",
      81: "🌧️",
      82: "⛈️",
      85: "🌨️",
      86: "🌨️",
      95: "⛈️",
      96: "⛈️",
      99: "⛈️",
    };
    return map[c] != null ? map[c] : "🌤️";
  }

  function pm25GradeKo(pm25) {
    if (pm25 == null || isNaN(pm25)) {
      return { emoji: "❔", label: "정보 없음", sub: "" };
    }
    if (pm25 <= 15) return { emoji: "🌿", label: "좋음", sub: Math.round(pm25) + "㎍/㎥" };
    if (pm25 <= 35) return { emoji: "😐", label: "보통", sub: Math.round(pm25) + "㎍/㎥" };
    if (pm25 <= 75) return { emoji: "😷", label: "나쁨", sub: Math.round(pm25) + "㎍/㎥" };
    return { emoji: "🚨", label: "매우 나쁨", sub: Math.round(pm25) + "㎍/㎥" };
  }

  function nearestHourlyIndex(hourly) {
    if (!hourly || !hourly.time || !hourly.time.length) return -1;
    var now = Date.now();
    var best = 0;
    var bestDiff = Infinity;
    var i;
    for (i = 0; i < hourly.time.length; i++) {
      var t = new Date(hourly.time[i]).getTime();
      var d = Math.abs(t - now);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    return best;
  }

  function normalizeCalendarMemoEntry(raw) {
    if (raw == null || raw === "") return { items: [] };
    if (typeof raw === "string") {
      var lines = raw.split(/\r?\n/);
      var items = [];
      var i;
      for (i = 0; i < lines.length; i++) {
        items.push({ done: false, text: lines[i] });
      }
      return { items: items };
    }
    if (raw && typeof raw === "object" && Array.isArray(raw.items)) {
      return {
        items: raw.items.map(function (it) {
          if (typeof it === "string") return { done: false, text: it };
          return { done: !!it.done, text: String(it.text != null ? it.text : "") };
        }),
      };
    }
    return { items: [] };
  }

  function calendarMemoHasContent(memos, dateKey) {
    if (!memos || !dateKey) return false;
    var n = normalizeCalendarMemoEntry(memos[dateKey]);
    return n.items.some(function (it) {
      return String(it.text || "").trim();
    });
  }

  function migrateCalendarMemosIfNeeded(db) {
    if (!db || !db.digitalBoard) return;
    var cm = db.digitalBoard.calendarMemos;
    if (!cm || typeof cm !== "object") return;
    var changed = false;
    var k;
    for (k in cm) {
      if (!Object.prototype.hasOwnProperty.call(cm, k)) continue;
      var v = cm[k];
      if (typeof v === "string") {
        cm[k] = normalizeCalendarMemoEntry(v);
        changed = true;
      } else if (v && typeof v === "object" && !Array.isArray(v.items)) {
        cm[k] = normalizeCalendarMemoEntry(v);
        changed = true;
      }
    }
    if (changed) saveDb(db);
  }

  function oneCalMemoRowHtml(it, idx) {
    return (
      '<div class="board-cal-memo-row" data-idx="' +
      idx +
      '">' +
      '<input type="checkbox" class="js-cal-memo-done board-cal-memo-cb" ' +
      (it.done ? "checked" : "") +
      " />" +
      '<input type="text" class="board-cal-memo-input" value="' +
      escapeHtml(it.text) +
      '" maxlength="200" placeholder="할 일" />' +
      '<button type="button" class="board-cal-memo-del btn btn--ghost btn--xs" aria-label="줄 삭제">×</button>' +
      "</div>"
    );
  }

  function buildCalMemoListHtmlFromItems(items) {
    var list = items && items.length ? items.slice() : [{ done: false, text: "" }];
    return list
      .map(function (it, idx) {
        return oneCalMemoRowHtml(it, idx);
      })
      .join("");
  }

  function buildMiniCalendarHtml(now, memos) {
    var y = now.getFullYear();
    var m = now.getMonth();
    var first = new Date(y, m, 1);
    var startDow = first.getDay();
    var lastDate = new Date(y, m + 1, 0).getDate();
    var dowLabels = ["일", "월", "화", "수", "목", "금", "토"];
    var cells = [];
    var i;
    var ref = new Date();
    var todayY = ref.getFullYear();
    var todayM = ref.getMonth();
    var todayD = ref.getDate();
    for (i = 0; i < startDow; i++) {
      cells.push('<div class="board-cal__cell board-cal__cell--empty"></div>');
    }
    for (i = 1; i <= lastDate; i++) {
      var isToday = y === todayY && m === todayM && i === todayD;
      var dk = ymdFromDate(new Date(y, m, i));
      var hasMemo = calendarMemoHasContent(memos, dk);
      cells.push(
        '<button type="button" class="board-cal__cell board-cal__cell--day' +
          (isToday ? " board-cal__cell--today" : "") +
          (hasMemo ? " board-cal__cell--has-memo" : "") +
          '" data-date="' +
          escapeHtml(dk) +
          '" aria-label="' +
          escapeHtml(dk + (hasMemo ? " 메모 있음" : "")) +
          '">' +
          i +
          (hasMemo ? '<span class="board-cal__dot" aria-hidden="true"></span>' : "") +
          "</button>"
      );
    }
    return (
      '<div id="board-mini-calendar" class="board-cal">' +
      '<div class="board-cal__title">' +
      y +
      "년 " +
      (m + 1) +
      "월</div>" +
      '<div class="board-cal__dow">' +
      dowLabels
        .map(function (d) {
          return "<span>" + d + "</span>";
        })
        .join("") +
      "</div>" +
      '<div class="board-cal__grid">' +
      cells.join("") +
      "</div></div>"
    );
  }

  function buildLargeCalendarGridHtml(viewY, viewM, memos, selectedKey) {
    var first = new Date(viewY, viewM, 1);
    var startDow = first.getDay();
    var lastDate = new Date(viewY, viewM + 1, 0).getDate();
    var dowLabels = ["일", "월", "화", "수", "목", "금", "토"];
    var cells = [];
    var i;
    var ref = new Date();
    var todayY = ref.getFullYear();
    var todayM = ref.getMonth();
    var todayD = ref.getDate();
    for (i = 0; i < startDow; i++) {
      cells.push('<div class="board-cal-lg__cell board-cal-lg__cell--empty"></div>');
    }
    for (i = 1; i <= lastDate; i++) {
      var dk = ymdFromDate(new Date(viewY, viewM, i));
      var isToday = viewY === todayY && viewM === todayM && i === todayD;
      var isSel = selectedKey === dk;
      var hasMemo = calendarMemoHasContent(memos, dk);
      cells.push(
        '<button type="button" class="board-cal-lg__cell board-cal-lg__cell--day' +
          (isToday ? " board-cal-lg__cell--today" : "") +
          (isSel ? " board-cal-lg__cell--selected" : "") +
          (hasMemo ? " board-cal-lg__cell--has-memo" : "") +
          '" data-date="' +
          escapeHtml(dk) +
          '">' +
          '<span class="board-cal-lg__num">' +
          i +
          "</span>" +
          (hasMemo ? '<span class="board-cal-lg__dot" aria-hidden="true"></span>' : "") +
          "</button>"
      );
    }
    return (
      '<div class="board-cal-lg__dow">' +
      dowLabels
        .map(function (d) {
          return "<span>" + d + "</span>";
        })
        .join("") +
      "</div>" +
      '<div class="board-cal-lg__grid">' +
      cells.join("") +
      "</div>"
    );
  }

  function extractNeisMealRows(json) {
    var info = json.mealServiceDietInfo;
    if (!info || !info.length) return [];
    var i;
    for (i = 0; i < info.length; i++) {
      if (info[i].row) {
        var row = info[i].row;
        return Array.isArray(row) ? row : [row];
      }
    }
    return [];
  }

  function buildBoardTodoListInnerHtml(db) {
    ensureDigitalBoard(db);
    var todos = db.digitalBoard.todos;
    if (!todos.length) {
      return '<li class="board-todo-empty muted">할 일을 추가해 보세요.</li>';
    }
    return todos
      .map(function (t) {
        return (
          '<li class="board-todo-item" data-todo-id="' +
          escapeHtml(t.id) +
          '">' +
          '<label class="board-todo-label">' +
          '<input type="checkbox" class="js-board-todo-done" ' +
          (t.done ? "checked" : "") +
          " />" +
          '<span class="board-todo-text">' +
          escapeHtml(t.text) +
          "</span></label>" +
          '<button type="button" class="board-todo-del btn btn--ghost btn--xs" aria-label="삭제">×</button>' +
          "</li>"
        );
      })
      .join("");
  }

  function buildDigitalBoardHtml(db) {
    ensureDigitalBoard(db);
    var tt = db.digitalBoard.timetable;
    var sorted = db.students.slice().sort(function (a, b) {
      return Number(a.number) - Number(b.number);
    });
    var studentRows = sorted.length
      ? sorted
          .map(function (s) {
            var act = getStudentBoardActivity(db, s.id);
            return (
              '<div class="board-student-row" data-student-id="' +
              escapeHtml(s.id) +
              '">' +
              '<span class="board-student-row__meta">' +
              escapeHtml(String(s.number)) +
              ". " +
              escapeHtml(s.name) +
              "</span>" +
              '<span class="board-student-row__act js-board-act">' +
              act +
              "</span>" +
              '<button type="button" class="board-act-btn" data-delta="-1" aria-label="활동 1 감소">−</button>' +
              '<button type="button" class="board-act-btn" data-delta="1" aria-label="활동 1 증가">+</button>' +
              "</div>"
            );
          })
          .join("")
      : '<p class="muted board-student-list__empty">등록된 학생이 없습니다.</p>';

    var periodRows = BOARD_PERIODS.map(function (p) {
      var slot = normalizeTimetableSlot(tt[p.key]);
      var subj = slot.subject != null ? String(slot.subject) : "";
      var act = slot.activity != null ? String(slot.activity) : "";
      return (
        '<div class="board-period-row">' +
        '<div class="board-period-row__badge">' +
        escapeHtml(p.label) +
        "</div>" +
        '<input type="text" class="board-period-row__subject js-board-tt-sub" data-tt-key="' +
        escapeHtml(p.key) +
        '" value="' +
        escapeHtml(subj) +
        '" maxlength="4" placeholder="과목" title="과목(한글 약 4자)" />' +
        '<input type="text" class="board-period-row__activity js-board-tt-act" data-tt-key="' +
        escapeHtml(p.key) +
        '" value="' +
        escapeHtml(act) +
        '" placeholder="수업 및 활동 내용" />' +
        "</div>"
      );
    }).join("");

    var todoItems = buildBoardTodoListInnerHtml(db);

    var now = new Date();
    var calHtml = buildMiniCalendarHtml(now, db.digitalBoard.calendarMemos || {});
    var noticeFontPxDisplay = 28;
    var nfp = db.digitalBoard.noticeFontPx;
    if (typeof nfp === "number" && !isNaN(nfp)) {
      noticeFontPxDisplay = Math.max(16, Math.min(64, Math.round(nfp)));
    }

    return (
      '<div class="digital-board digital-board--tv">' +
      '<aside class="digital-board__left board-panel">' +
      '<h2 class="board-panel__title">학생 명단 · 활동</h2>' +
      '<p class="board-panel__microhint">활동 점수는 <strong>매일 07:00</strong>을 기준으로 새 집계일이 시작됩니다.</p>' +
      '<div class="board-student-list scroll-y">' +
      studentRows +
      "</div></aside>" +
      '<section class="digital-board__center">' +
      '<div class="board-clock-wrap">' +
      '<div id="board-clock" class="board-clock" aria-live="polite">--:--:--</div>' +
      '<div id="board-clock-date" class="board-clock-date"></div>' +
      "</div>" +
      '<div id="board-weather" class="board-weather"><div class="board-weather__loading">🌤️ 날씨 불러오는 중…</div></div>' +
      '<div class="board-timetable-wrap board-panel">' +
      '<p class="board-panel__microhint board-timetable-microhint">시간표(과목·활동)는 <strong>매일 07:00</strong>에 비워집니다.</p>' +
      '<div class="board-period-list">' +
      periodRows +
      "</div></div>" +
      '<div class="board-meal-wrap board-panel">' +
      '<div class="board-meal-head">' +
      '<h2 class="board-panel__title board-meal-head__title">오늘의 급식</h2>' +
      '<button type="button" class="board-settings-trigger" id="btn-board-open-settings" title="날씨·급식 API 설정" aria-label="날씨·급식 API 설정">' +
      '<svg class="board-gear-svg" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.52-.4-1.08-.73-1.69-.98l-.36-2.54a.484.484 0 0 0-.48-.42h-3.84c-.24 0-.43.17-.47.42l-.36 2.54c-.61.25-1.17.59-1.69.98l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.52.4 1.08.73 1.69.98l.36 2.54c.05.24.24.42.48.42h3.84c.24 0 .44-.17.48-.42l.36-2.54c.61-.25 1.17-.59 1.69-.98l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>' +
      "</svg></button></div>" +
      '<div id="board-meal" class="board-meal">오른쪽 톱니(⚙)에서 날씨·급식 API를 설정하면 메뉴가 표시됩니다.</div>' +
      "</div>" +
      '<div id="board-settings-modal" class="board-modal" hidden>' +
      '<div class="board-modal__backdrop" id="board-modal-backdrop"></div>' +
      '<div class="board-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="board-modal-title">' +
      '<div class="board-modal__head">' +
      '<h3 id="board-modal-title" class="board-modal__title">날씨 · 급식 API 설정</h3>' +
      '<button type="button" class="board-modal__close" id="board-modal-close" aria-label="닫기">×</button>' +
      "</div>" +
      '<div class="board-settings__grid">' +
      '<label>위도 <input type="number" step="0.0001" id="board-set-lat" value="' +
      escapeHtml(String(db.digitalBoard.weather.lat)) +
      '" /></label>' +
      '<label>경도 <input type="number" step="0.0001" id="board-set-lon" value="' +
      escapeHtml(String(db.digitalBoard.weather.lon)) +
      '" /></label>' +
      '<label class="board-settings__full">NEIS 인증키 <input type="password" id="board-set-neis-key" value="' +
      escapeHtml(db.digitalBoard.mealApi.neisKey) +
      '" autocomplete="off" /></label>' +
      '<label>시도교육청코드 <input type="text" id="board-set-atpt" placeholder="예: J10" value="' +
      escapeHtml(db.digitalBoard.mealApi.atptCode) +
      '" /></label>' +
      '<label>표준학교코드 <input type="text" id="board-set-school" placeholder="예: 7530075" value="' +
      escapeHtml(db.digitalBoard.mealApi.schoolCode) +
      '" /></label>' +
      "</div>" +
      '<p class="board-settings__note">급식은 <a href="https://open.neis.go.kr/portal/mainPage.do" target="_blank" rel="noopener">나이스 오픈API</a>에서 발급한 인증키와 학교 정보가 필요합니다. 브라우저 보안(CORS)으로 급식이 안 불러와질 수 있습니다.</p>' +
      '<div class="board-settings__actions">' +
      '<button type="button" class="btn btn--primary btn--sm" id="board-save-settings">설정 저장</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="board-refresh-meal">급식 다시 불러오기</button>' +
      "</div></div></div>" +
      "</section>" +
      '<aside class="digital-board__right">' +
      '<div class="board-panel board-panel--cal">' +
      '<h2 class="board-panel__title">이번 달</h2>' +
      calHtml +
      "</div>" +
      '<div class="board-panel board-todo-panel">' +
      '<h2 class="board-panel__title">To-do</h2>' +
      '<ul class="board-todo-list" id="board-todo-list">' +
      todoItems +
      "</ul>" +
      '<div class="board-todo-add">' +
      '<input type="text" id="board-todo-input" class="board-todo-input" placeholder="새 할 일" maxlength="200" />' +
      '<button type="button" class="btn btn--primary btn--sm" id="board-todo-add-btn">추가</button>' +
      "</div></div>" +
      '<div class="board-panel board-notice-panel">' +
      '<div class="board-notice-head">' +
      '<h2 class="board-panel__title board-notice-head__title">오늘의 알림장</h2>' +
      '<button type="button" class="board-settings-trigger board-notice-expand" id="btn-board-notice-expand" title="확대" aria-label="알림장 확대">' +
      '<svg class="board-gear-svg" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>' +
      "</svg></button></div>" +
      '<textarea id="board-notice" class="board-notice" rows="8" placeholder="가정과 공유할 알림을 적습니다.">' +
      escapeHtml(db.digitalBoard.notice || "") +
      "</textarea>" +
      "</div></aside>" +
      '<div id="board-calendar-modal" class="board-cal-modal" hidden>' +
      '<div class="board-cal-modal__backdrop" id="board-cal-modal-backdrop"></div>' +
      '<div class="board-cal-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="board-cal-modal-heading">' +
      '<div class="board-cal-modal__head">' +
      '<button type="button" class="btn btn--ghost btn--sm" id="board-cal-prev" aria-label="이전 달">←</button>' +
      '<h3 id="board-cal-modal-heading" class="board-cal-modal__title">달력</h3>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="board-cal-next" aria-label="다음 달">→</button>' +
      '<button type="button" class="board-cal-modal__close" id="board-cal-modal-close" aria-label="닫기">×</button>' +
      "</div>" +
      '<div id="board-cal-modal-cal" class="board-cal-modal__cal"></div>' +
      '<div class="board-cal-modal__memo">' +
      '<label class="board-cal-modal__memo-lbl" id="board-cal-selected-label">날짜를 선택하세요</label>' +
      '<div id="board-cal-memo-list" class="board-cal-memo-list"></div>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="board-cal-memo-add-line">+ 할 일 추가</button>' +
      '<p class="board-cal-memo-hint muted">각 줄 앞 체크박스로 완료 표시를 할 수 있습니다.</p>' +
      "</div>" +
      '<div class="board-cal-modal__foot">' +
      '<button type="button" class="btn btn--primary btn--sm" id="board-cal-memo-save">저장</button>' +
      '<span class="muted board-cal-modal__hint">내용이 없으면 메모가 삭제됩니다.</span>' +
      "</div></div></div>" +
      '<div id="board-notice-modal" class="board-notice-modal" hidden>' +
      '<div class="board-notice-modal__backdrop" id="board-notice-modal-backdrop"></div>' +
      '<div class="board-notice-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="board-notice-modal-title">' +
      '<div class="board-notice-modal__head">' +
      '<h3 id="board-notice-modal-title" class="board-notice-modal__title">오늘의 알림장</h3>' +
      '<button type="button" class="board-notice-modal__close" id="board-notice-modal-close" aria-label="닫기">×</button>' +
      "</div>" +
      '<div class="board-notice-modal__toolbar">' +
      '<span class="board-notice-modal__fs-label">글자 크기</span>' +
      '<button type="button" class="btn btn--ghost btn--sm" id="board-notice-fs-down" title="작게" aria-label="글자 작게">A−</button>' +
      '<span id="board-notice-fs-value" class="board-notice-modal__fs-value">' +
      noticeFontPxDisplay +
      "px</span>" +
      '<button type="button" class="btn btn--ghost btn--sm" id="board-notice-fs-up" title="크게" aria-label="글자 크게">A+</button>' +
      "</div>" +
      '<textarea id="board-notice-expanded" class="board-notice-expanded" rows="24" placeholder="가정과 공유할 알림을 적습니다."></textarea>' +
      '<div class="board-notice-modal__foot">' +
      '<button type="button" class="btn btn--primary" id="board-notice-modal-done">닫기</button>' +
      "</div></div></div>" +
      "</div>"
    );
  }

  function renderDigitalBoardChrome(mainHtml) {
    var studentModeBtn =
      window.opener == null
        ? '<button type="button" class="btn btn--ghost btn--iconish" id="btn-student-mode" title="학생 화면을 새 창에서 엽니다">학생 모드</button>'
        : "";
    return (
      '<header class="app-header app-header--board">' +
      '<div class="app-header__lead">' +
      '<a class="btn btn--ghost btn--sm" href="#/teacher">← 대시보드</a>' +
      '<h1 class="app-header__title">디지털 칠판</h1></div>' +
      '<div class="app-header__actions">' +
      '<button type="button" class="btn btn--ghost btn--sm" id="btn-board-fullscreen">전체화면</button>' +
      studentModeBtn +
      '<a class="btn btn--ghost btn--iconish" href="../index.html" id="btn-logout" title="로그아웃">로그아웃</a>' +
      "</div></header>" +
      '<main class="app-main app-main--board">' +
      mainHtml +
      "</main>"
    );
  }

  function bindDigitalBoard() {
    var timers = [];
    if (window.__digitalBoardCleanup) {
      try {
        window.__digitalBoardCleanup();
      } catch (e) {}
    }
    var baseBoardCleanup = function () {
      timers.forEach(function (id) {
        clearInterval(id);
      });
      timers = [];
    };
    window.__digitalBoardCleanup = baseBoardCleanup;

    var lastBoardKey = boardDateKey();
    function tickClock() {
      var el = document.getElementById("board-clock");
      var elD = document.getElementById("board-clock-date");
      if (!el) return;
      var n = new Date();
      var h = pad2(n.getHours());
      var mi = pad2(n.getMinutes());
      var s = pad2(n.getSeconds());
      el.textContent = h + ":" + mi + ":" + s;
      if (elD) {
        try {
          elD.textContent = n.toLocaleDateString("ko-KR", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });
        } catch (e) {
          elD.textContent = ymdFromDate(n);
        }
      }
      var bk = boardDateKey();
      if (bk !== lastBoardKey) {
        lastBoardKey = bk;
        var db = getDb();
        if (db) {
          if (runDailyBoardBoundaryPipeline(db)) {
            BOARD_PERIODS.forEach(function (p) {
              var sub = document.querySelector('.js-board-tt-sub[data-tt-key="' + p.key + '"]');
              var act = document.querySelector('.js-board-tt-act[data-tt-key="' + p.key + '"]');
              if (sub) sub.value = "";
              if (act) act.value = "";
            });
            var ta = document.getElementById("board-notice");
            var texp = document.getElementById("board-notice-expanded");
            if (ta) ta.value = "";
            if (texp) texp.value = "";
          }
          document.querySelectorAll(".board-student-row").forEach(function (row) {
            var sid = row.getAttribute("data-student-id");
            var actEl = row.querySelector(".js-board-act");
            if (sid && actEl) actEl.textContent = String(getStudentBoardActivity(db, sid));
          });
        }
      }
    }
    tickClock();
    timers.push(setInterval(tickClock, 1000));

    function fetchAndRenderWeather() {
      var db = getDb();
      if (!db) return;
      ensureDigitalBoard(db);
      var lat = Number(db.digitalBoard.weather.lat);
      var lon = Number(db.digitalBoard.weather.lon);
      if (isNaN(lat) || isNaN(lon)) return;
      var wUrl =
        "https://api.open-meteo.com/v1/forecast?latitude=" +
        lat +
        "&longitude=" +
        lon +
        "&current=temperature_2m,weather_code&hourly=precipitation_probability&forecast_days=1&timezone=Asia%2FSeoul";
      var aUrl =
        "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=" +
        lat +
        "&longitude=" +
        lon +
        "&current=pm2_5&timezone=Asia%2FSeoul";
      var elW = document.getElementById("board-weather");
      Promise.all([fetch(wUrl).then(function (r) {
        return r.json();
      }), fetch(aUrl).then(function (r) {
        return r.json();
      })])
        .then(function (pair) {
          var w = pair[0];
          var a = pair[1];
          var t = w.current && w.current.temperature_2m;
          var code = w.current && w.current.weather_code;
          var hi = nearestHourlyIndex(w.hourly);
          var pop =
            hi >= 0 && w.hourly && w.hourly.precipitation_probability
              ? w.hourly.precipitation_probability[hi]
              : null;
          var pm25 = a.current && a.current.pm2_5;
          var wEmoji = wmoWeatherEmoji(code);
          var wTxt = wmoWeatherLabelKo(code);
          var pm = pm25GradeKo(pm25);
          var tempStr = t != null ? Math.round(t) + "°C" : "—";
          var popStr = pop != null && !isNaN(pop) ? Math.round(pop) + "%" : "—";
          var html =
            '<div class="board-weather__grid">' +
            '<div class="board-weather__cell">' +
            '<span class="board-weather__emoji" aria-hidden="true">🌡️</span>' +
            '<div class="board-weather__text">' +
            '<span class="board-weather__lbl">기온</span>' +
            '<span class="board-weather__val">' +
            escapeHtml(tempStr) +
            "</span></div></div>" +
            '<div class="board-weather__cell">' +
            '<span class="board-weather__emoji" aria-hidden="true">' +
            wEmoji +
            "</span>" +
            '<div class="board-weather__text">' +
            '<span class="board-weather__lbl">날씨</span>' +
            '<span class="board-weather__val">' +
            escapeHtml(wTxt) +
            "</span></div></div>" +
            '<div class="board-weather__cell">' +
            '<span class="board-weather__emoji" aria-hidden="true">☔</span>' +
            '<div class="board-weather__text">' +
            '<span class="board-weather__lbl">강수확률</span>' +
            '<span class="board-weather__val">' +
            escapeHtml(popStr) +
            "</span></div></div>" +
            '<div class="board-weather__cell">' +
            '<span class="board-weather__emoji" aria-hidden="true">' +
            pm.emoji +
            "</span>" +
            '<div class="board-weather__text">' +
            '<span class="board-weather__lbl">미세먼지</span>' +
            '<span class="board-weather__val">' +
            escapeHtml(pm.label) +
            (pm.sub ? ' <span class="board-weather__sub">' + escapeHtml(pm.sub) + "</span>" : "") +
            "</span></div></div></div>";
          if (elW) elW.innerHTML = html;
        })
        .catch(function () {
          if (elW) {
            elW.innerHTML =
              '<div class="board-weather__err">⚠️ 위도·경도를 톱니 설정에서 확인해 주세요.</div>';
          }
        });
    }
    fetchAndRenderWeather();
    timers.push(setInterval(fetchAndRenderWeather, 600000));

    function fetchAndRenderMeal() {
      var db = getDb();
      if (!db) return;
      ensureDigitalBoard(db);
      var m = db.digitalBoard.mealApi;
      var key = (m.neisKey || "").trim();
      var atpt = (m.atptCode || "").trim();
      var sch = (m.schoolCode || "").trim();
      var el = document.getElementById("board-meal");
      if (!key || !atpt || !sch) {
        if (el) el.textContent = "톱니 설정에서 나이스 급식 API를 입력하면 여기에 표시됩니다.";
        return;
      }
      var d = new Date();
      var ymd = ymdCompactFromDate(d);
      var url =
        "https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=" +
        encodeURIComponent(key) +
        "&Type=json&pIndex=1&pSize=10&ATPT_OFCDC_SC_CODE=" +
        encodeURIComponent(atpt) +
        "&SD_SCHUL_CODE=" +
        encodeURIComponent(sch) +
        "&MLSV_YMD=" +
        ymd;
      if (el) el.textContent = "급식 불러오는 중…";
      fetch(url)
        .then(function (r) {
          return r.json();
        })
        .then(function (json) {
          if (json.RESULT && json.RESULT.CODE && String(json.RESULT.CODE).indexOf("ERROR") === 0) {
            if (el) el.textContent = "급식 API 오류: " + (json.RESULT.MESSAGE || json.RESULT.CODE);
            return;
          }
          var rows = extractNeisMealRows(json);
          if (!rows.length) {
            if (el) el.textContent = "오늘 등록된 급식 정보가 없습니다.";
            return;
          }
          var dish = rows[0].DDISH_NM || "";
          dish = String(dish)
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "");
          if (el) {
            el.innerHTML = "<pre class=\"board-meal-pre\">" + escapeHtml(dish) + "</pre>";
          }
        })
        .catch(function (err) {
          if (el) {
            el.innerHTML =
              "급식을 가져오지 못했습니다. (브라우저 CORS 제한일 수 있습니다) <span class=\"muted\">" +
              escapeHtml(err.message || "") +
              "</span>";
          }
        });
    }

    document.getElementById("board-refresh-meal") &&
      document.getElementById("board-refresh-meal").addEventListener("click", fetchAndRenderMeal);
    fetchAndRenderMeal();

    var root = document.querySelector(".digital-board--tv");
    if (root) {
      root.addEventListener("click", function (e) {
        var btn = e.target.closest(".board-act-btn");
        if (!btn || !root.contains(btn)) return;
        var row = btn.closest(".board-student-row");
        if (!row) return;
        var sid = row.getAttribute("data-student-id");
        var d = parseInt(btn.getAttribute("data-delta"), 10);
        if (!sid || isNaN(d)) return;
        var db = getDb();
        if (!db) return;
        incStudentBoardActivity(db, sid, d);
        var actEl = row.querySelector(".js-board-act");
        if (actEl) actEl.textContent = String(getStudentBoardActivity(db, sid));
      });
    }

    var _ttTimer = null;
    function flushTtSave() {
      if (_ttTimer) { clearTimeout(_ttTimer); _ttTimer = null; }
      var db = getDb();
      if (!db) return;
      ensureDigitalBoard(db);
      BOARD_PERIODS.forEach(function (p) {
        var sub = document.querySelector('.js-board-tt-sub[data-tt-key="' + p.key + '"]');
        var act = document.querySelector('.js-board-tt-act[data-tt-key="' + p.key + '"]');
        db.digitalBoard.timetable[p.key] = {
          subject: sub ? sub.value : "",
          activity: act ? act.value : "",
        };
      });
      saveDb(db);
    }
    var saveTt = function () {
      if (_ttTimer) clearTimeout(_ttTimer);
      _ttTimer = setTimeout(flushTtSave, 400);
    };
    document.querySelectorAll(".js-board-tt-sub, .js-board-tt-act").forEach(function (inp) {
      inp.addEventListener("input", saveTt);
      inp.addEventListener("blur", flushTtSave);
      inp.addEventListener("change", flushTtSave);
    });

    var _noticeTimer = null;
    function flushNoticeSave() {
      if (_noticeTimer) { clearTimeout(_noticeTimer); _noticeTimer = null; }
      var db = getDb();
      if (!db) return;
      var ta = document.getElementById("board-notice");
      ensureDigitalBoard(db);
      db.digitalBoard.notice = ta ? ta.value : "";
      saveDb(db);
    }
    var saveNotice = function () {
      if (_noticeTimer) clearTimeout(_noticeTimer);
      _noticeTimer = setTimeout(flushNoticeSave, 400);
    };
    var noticeEl = document.getElementById("board-notice");
    var noticeExpanded = document.getElementById("board-notice-expanded");
    if (noticeEl) {
      noticeEl.addEventListener("input", saveNotice);
      noticeEl.addEventListener("blur", flushNoticeSave);
      noticeEl.addEventListener("change", flushNoticeSave);
    }
    if (noticeExpanded) {
      noticeExpanded.addEventListener("input", function () {
        if (noticeEl) noticeEl.value = noticeExpanded.value;
        saveNotice();
      });
      noticeExpanded.addEventListener("blur", flushNoticeSave);
      noticeExpanded.addEventListener("change", flushNoticeSave);
    }

    var NOTICE_FS_MIN = 16;
    var NOTICE_FS_MAX = 64;
    var NOTICE_FS_STEP = 2;

    function getNoticeFontPx(db) {
      ensureDigitalBoard(db);
      var n = db.digitalBoard.noticeFontPx;
      if (typeof n !== "number" || isNaN(n)) return 28;
      return Math.max(NOTICE_FS_MIN, Math.min(NOTICE_FS_MAX, Math.round(n)));
    }

    function setNoticeFontPx(db, px) {
      ensureDigitalBoard(db);
      db.digitalBoard.noticeFontPx = Math.max(NOTICE_FS_MIN, Math.min(NOTICE_FS_MAX, Math.round(px)));
      saveDb(db);
    }

    function applyNoticeExpandedFontPx() {
      var db = getDb();
      if (!db) return;
      var px = getNoticeFontPx(db);
      var exp = document.getElementById("board-notice-expanded");
      var val = document.getElementById("board-notice-fs-value");
      var fsDown = document.getElementById("board-notice-fs-down");
      var fsUp = document.getElementById("board-notice-fs-up");
      if (exp) exp.style.fontSize = px + "px";
      if (val) val.textContent = px + "px";
      if (fsDown) fsDown.disabled = px <= NOTICE_FS_MIN;
      if (fsUp) fsUp.disabled = px >= NOTICE_FS_MAX;
    }

    function bumpNoticeFont(delta) {
      var db = getDb();
      if (!db) return;
      setNoticeFontPx(db, getNoticeFontPx(db) + delta);
      applyNoticeExpandedFontPx();
    }

    function openNoticeExpandModal() {
      var main = document.getElementById("board-notice");
      var exp = document.getElementById("board-notice-expanded");
      var mod = document.getElementById("board-notice-modal");
      if (exp && main) exp.value = main.value;
      applyNoticeExpandedFontPx();
      if (mod) {
        mod.hidden = false;
        document.body.style.overflow = "hidden";
      }
      if (exp) {
        setTimeout(function () {
          exp.focus();
        }, 80);
      }
    }

    function closeNoticeExpandModal() {
      var main = document.getElementById("board-notice");
      var exp = document.getElementById("board-notice-expanded");
      var mod = document.getElementById("board-notice-modal");
      if (main && exp) main.value = exp.value;
      saveNotice();
      if (mod) {
        mod.hidden = true;
        var cm = document.getElementById("board-calendar-modal");
        if (!cm || cm.hidden) document.body.style.overflow = "";
      }
    }

    var btnNoticeExpand = document.getElementById("btn-board-notice-expand");
    if (btnNoticeExpand) btnNoticeExpand.addEventListener("click", openNoticeExpandModal);
    var btnNoticeClose = document.getElementById("board-notice-modal-close");
    if (btnNoticeClose) btnNoticeClose.addEventListener("click", closeNoticeExpandModal);
    var btnNoticeDone = document.getElementById("board-notice-modal-done");
    if (btnNoticeDone) btnNoticeDone.addEventListener("click", closeNoticeExpandModal);
    var noticeBd = document.getElementById("board-notice-modal-backdrop");
    if (noticeBd) noticeBd.addEventListener("click", closeNoticeExpandModal);

    var fsDownBtn = document.getElementById("board-notice-fs-down");
    var fsUpBtn = document.getElementById("board-notice-fs-up");
    if (fsDownBtn) fsDownBtn.addEventListener("click", function () {
      bumpNoticeFont(-NOTICE_FS_STEP);
    });
    if (fsUpBtn) fsUpBtn.addEventListener("click", function () {
      bumpNoticeFont(NOTICE_FS_STEP);
    });
    applyNoticeExpandedFontPx();

    function onGlobalKeydownNoticeModal(e) {
      if (e.key !== "Escape") return;
      var nm = document.getElementById("board-notice-modal");
      if (nm && !nm.hidden) {
        e.preventDefault();
        closeNoticeExpandModal();
      }
    }
    document.addEventListener("keydown", onGlobalKeydownNoticeModal);

    function openBoardSettingsModal() {
      var m = document.getElementById("board-settings-modal");
      if (m) {
        m.hidden = false;
        document.body.style.overflow = "hidden";
      }
    }

    function closeBoardSettingsModal() {
      var m = document.getElementById("board-settings-modal");
      if (m) {
        m.hidden = true;
        document.body.style.overflow = "";
      }
    }

    var btnOpen = document.getElementById("btn-board-open-settings");
    if (btnOpen) btnOpen.addEventListener("click", openBoardSettingsModal);
    var btnClose = document.getElementById("board-modal-close");
    if (btnClose) btnClose.addEventListener("click", closeBoardSettingsModal);
    var bd = document.getElementById("board-modal-backdrop");
    if (bd) bd.addEventListener("click", closeBoardSettingsModal);

    function onBoardModalKey(e) {
      if (e.key !== "Escape") return;
      var cm = document.getElementById("board-calendar-modal");
      if (cm && !cm.hidden) return;
      var nm = document.getElementById("board-notice-modal");
      if (nm && !nm.hidden) return;
      closeBoardSettingsModal();
    }
    document.addEventListener("keydown", onBoardModalKey);
    window.__digitalBoardCleanup = function () {
      document.removeEventListener("keydown", onBoardModalKey);
      closeBoardSettingsModal();
      baseBoardCleanup();
    };

    var saveSettingsBtn = document.getElementById("board-save-settings");
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener("click", function () {
        var db = getDb();
        if (!db) return;
        ensureDigitalBoard(db);
        var la = document.getElementById("board-set-lat");
        var lo = document.getElementById("board-set-lon");
        var nk = document.getElementById("board-set-neis-key");
        var at = document.getElementById("board-set-atpt");
        var sc = document.getElementById("board-set-school");
        if (la) db.digitalBoard.weather.lat = parseFloat(la.value) || 0;
        if (lo) db.digitalBoard.weather.lon = parseFloat(lo.value) || 0;
        if (nk) db.digitalBoard.mealApi.neisKey = nk.value;
        if (at) db.digitalBoard.mealApi.atptCode = at.value.trim();
        if (sc) db.digitalBoard.mealApi.schoolCode = sc.value.trim();
        saveDb(db);
        fetchAndRenderWeather();
        fetchAndRenderMeal();
      });
    }

    function renderTodoList() {
      var db = getDb();
      if (!db) return;
      var ul = document.getElementById("board-todo-list");
      if (!ul) return;
      ul.innerHTML = buildBoardTodoListInnerHtml(db);
    }

    var todoListEl = document.getElementById("board-todo-list");
    if (todoListEl) {
      todoListEl.addEventListener("change", function (e) {
        var cb = e.target.closest(".js-board-todo-done");
        if (!cb) return;
        var li = cb.closest(".board-todo-item");
        if (!li) return;
        var tid = li.getAttribute("data-todo-id");
        var db = getDb();
        if (!db) return;
        ensureDigitalBoard(db);
        db.digitalBoard.todos.forEach(function (t) {
          if (t.id === tid) t.done = cb.checked;
        });
        saveDb(db);
      });
      todoListEl.addEventListener("click", function (e) {
        var del = e.target.closest(".board-todo-del");
        if (!del) return;
        var li = del.closest(".board-todo-item");
        if (!li) return;
        var tid = li.getAttribute("data-todo-id");
        var db = getDb();
        if (!db) return;
        ensureDigitalBoard(db);
        db.digitalBoard.todos = db.digitalBoard.todos.filter(function (t) {
          return t.id !== tid;
        });
        saveDb(db);
        renderTodoList();
      });
    }

    var todoAddBtn = document.getElementById("board-todo-add-btn");
    var todoInput = document.getElementById("board-todo-input");
    if (todoAddBtn && todoInput) {
      todoAddBtn.addEventListener("click", function () {
        var text = todoInput.value.trim();
        if (!text) return;
        var db = getDb();
        if (!db) return;
        ensureDigitalBoard(db);
        db.digitalBoard.todos.push({ id: C.uid(), text: text, done: false });
        saveDb(db);
        todoInput.value = "";
        renderTodoList();
      });
      todoInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") todoAddBtn.click();
      });
    }

    var fsBtn = document.getElementById("btn-board-fullscreen");
    if (fsBtn) {
      fsBtn.addEventListener("click", function () {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(function () {});
        } else {
          document.exitFullscreen();
        }
      });
    }

    var calModalY = new Date().getFullYear();
    var calModalM = new Date().getMonth();
    var calModalSelectedKey = "";

    function setCalendarMemoStruct(db, key, struct) {
      ensureDigitalBoard(db);
      if (!db.digitalBoard.calendarMemos) db.digitalBoard.calendarMemos = {};
      var n = normalizeCalendarMemoEntry(struct);
      var kept = n.items.filter(function (it) {
        return String(it.text || "").trim();
      });
      if (!kept.length) {
        delete db.digitalBoard.calendarMemos[key];
      } else {
        db.digitalBoard.calendarMemos[key] = { items: kept };
      }
      saveDb(db);
    }

    function collectCalMemoFromDom() {
      var list = document.getElementById("board-cal-memo-list");
      if (!list) return { items: [] };
      var rows = list.querySelectorAll(".board-cal-memo-row");
      var items = [];
      rows.forEach(function (row) {
        var cb = row.querySelector(".js-cal-memo-done");
        var inp = row.querySelector(".board-cal-memo-input");
        items.push({ done: cb && cb.checked, text: inp ? inp.value : "" });
      });
      return { items: items };
    }

    function renderCalMemoList(db, key) {
      var el = document.getElementById("board-cal-memo-list");
      if (!el) return;
      var raw = db && db.digitalBoard.calendarMemos ? db.digitalBoard.calendarMemos[key] : null;
      var data = normalizeCalendarMemoEntry(raw);
      var items = data.items.length ? data.items : [{ done: false, text: "" }];
      el.innerHTML = buildCalMemoListHtmlFromItems(items);
    }

    function parseDateKeyToParts(dk) {
      var p = String(dk).split("-");
      if (p.length !== 3) return null;
      var y = parseInt(p[0], 10);
      var mo = parseInt(p[1], 10) - 1;
      var d = parseInt(p[2], 10);
      if (isNaN(y) || isNaN(mo) || isNaN(d)) return null;
      return { y: y, m: mo, d: d };
    }

    function refreshModalCalendar() {
      var db = getDb();
      if (!db) return;
      ensureDigitalBoard(db);
      var memos = db.digitalBoard.calendarMemos || {};
      var el = document.getElementById("board-cal-modal-cal");
      var title = document.getElementById("board-cal-modal-heading");
      if (title) title.textContent = calModalY + "년 " + (calModalM + 1) + "월";
      if (el) el.innerHTML = buildLargeCalendarGridHtml(calModalY, calModalM, memos, calModalSelectedKey);
      var lbl = document.getElementById("board-cal-selected-label");
      if (calModalSelectedKey) {
        try {
          var parts = calModalSelectedKey.split("-");
          var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          if (lbl) {
            lbl.textContent = d.toLocaleDateString("ko-KR", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            });
          }
        } catch (e) {
          if (lbl) lbl.textContent = calModalSelectedKey;
        }
        renderCalMemoList(db, calModalSelectedKey);
      } else {
        if (lbl) lbl.textContent = "날짜를 선택하세요";
        var listEl = document.getElementById("board-cal-memo-list");
        if (listEl) listEl.innerHTML = "";
      }
    }

    function renderMiniCalendarFromDb() {
      var db = getDb();
      if (!db) return;
      var wrap = document.getElementById("board-mini-calendar");
      if (!wrap) return;
      ensureDigitalBoard(db);
      var memos = db.digitalBoard.calendarMemos || {};
      var now = new Date();
      wrap.outerHTML = buildMiniCalendarHtml(now, memos);
    }

    function openCalendarModal(dateKey) {
      var parts = parseDateKeyToParts(dateKey);
      if (!parts) return;
      calModalY = parts.y;
      calModalM = parts.m;
      calModalSelectedKey = dateKey;
      refreshModalCalendar();
      var mod = document.getElementById("board-calendar-modal");
      if (mod) {
        mod.hidden = false;
        document.body.style.overflow = "hidden";
      }
      var firstInp = document.querySelector("#board-cal-memo-list .board-cal-memo-input");
      if (firstInp) {
        setTimeout(function () {
          firstInp.focus();
        }, 100);
      }
    }

    function closeCalendarModal() {
      var mod = document.getElementById("board-calendar-modal");
      if (mod) {
        mod.hidden = true;
        var nm = document.getElementById("board-notice-modal");
        if (!nm || nm.hidden) document.body.style.overflow = "";
      }
      renderMiniCalendarFromDb();
    }

    function saveCalendarMemoForSelected() {
      var db = getDb();
      if (!db || !calModalSelectedKey) return;
      setCalendarMemoStruct(db, calModalSelectedKey, collectCalMemoFromDom());
      refreshModalCalendar();
      renderMiniCalendarFromDb();
    }

    var calPanel = document.querySelector(".board-panel--cal");
    if (calPanel) {
      calPanel.addEventListener("click", function (e) {
        var btn = e.target.closest(".board-cal__cell--day");
        if (!btn || !calPanel.contains(btn)) return;
        var dk = btn.getAttribute("data-date");
        if (dk) openCalendarModal(dk);
      });
    }

    var calModalCal = document.getElementById("board-cal-modal-cal");
    if (calModalCal) {
      calModalCal.addEventListener("click", function (e) {
        var btn = e.target.closest(".board-cal-lg__cell--day");
        if (!btn || !calModalCal.contains(btn)) return;
        var dk = btn.getAttribute("data-date");
        if (!dk) return;
        calModalSelectedKey = dk;
        var pr = parseDateKeyToParts(dk);
        if (pr) {
          calModalY = pr.y;
          calModalM = pr.m;
        }
        refreshModalCalendar();
      });
    }

    var calPrev = document.getElementById("board-cal-prev");
    if (calPrev) {
      calPrev.addEventListener("click", function () {
        calModalM -= 1;
        if (calModalM < 0) {
          calModalM = 11;
          calModalY -= 1;
        }
        if (calModalSelectedKey) {
          var pr = parseDateKeyToParts(calModalSelectedKey);
          if (!pr || pr.y !== calModalY || pr.m !== calModalM) {
            calModalSelectedKey = "";
          }
        }
        refreshModalCalendar();
      });
    }

    var calNext = document.getElementById("board-cal-next");
    if (calNext) {
      calNext.addEventListener("click", function () {
        calModalM += 1;
        if (calModalM > 11) {
          calModalM = 0;
          calModalY += 1;
        }
        if (calModalSelectedKey) {
          var pr = parseDateKeyToParts(calModalSelectedKey);
          if (!pr || pr.y !== calModalY || pr.m !== calModalM) {
            calModalSelectedKey = "";
          }
        }
        refreshModalCalendar();
      });
    }

    var calClose = document.getElementById("board-cal-modal-close");
    if (calClose) calClose.addEventListener("click", closeCalendarModal);
    var calBd = document.getElementById("board-cal-modal-backdrop");
    if (calBd) calBd.addEventListener("click", closeCalendarModal);

    var calSave = document.getElementById("board-cal-memo-save");
    if (calSave) calSave.addEventListener("click", saveCalendarMemoForSelected);

    var calMemoWrap = document.querySelector(".board-cal-modal__memo");
    if (calMemoWrap) {
      calMemoWrap.addEventListener("click", function (e) {
        var addBtn = e.target.closest("#board-cal-memo-add-line");
        if (addBtn) {
          var list = document.getElementById("board-cal-memo-list");
          if (list) {
            var n = list.querySelectorAll(".board-cal-memo-row").length;
            list.insertAdjacentHTML("beforeend", oneCalMemoRowHtml({ done: false, text: "" }, n));
          }
          return;
        }
        var del = e.target.closest(".board-cal-memo-del");
        if (del) {
          var row = del.closest(".board-cal-memo-row");
          var list = document.getElementById("board-cal-memo-list");
          if (row && list) {
            row.remove();
            if (!list.querySelectorAll(".board-cal-memo-row").length) {
              list.innerHTML = buildCalMemoListHtmlFromItems([{ done: false, text: "" }]);
            }
          }
        }
      });
    }

    function onGlobalKeydownCalModal(e) {
      if (e.key !== "Escape") return;
      var cm = document.getElementById("board-calendar-modal");
      if (cm && !cm.hidden) {
        e.preventDefault();
        closeCalendarModal();
      }
    }
    document.addEventListener("keydown", onGlobalKeydownCalModal);

    var prevBoardCleanupFinal = window.__digitalBoardCleanup;
    window.__digitalBoardCleanup = function () {
      document.removeEventListener("keydown", onGlobalKeydownCalModal);
      document.removeEventListener("keydown", onGlobalKeydownNoticeModal);
      closeCalendarModal();
      closeNoticeExpandModal();
      if (prevBoardCleanupFinal) prevBoardCleanupFinal();
    };
  }

  /**
   * Firestore/스토리지 동기화 시 route()로 칠판 전체를 다시 그리면 날씨 블록이 초기화되어
   * API가 반복 호출되고 화면이 깜빡입니다. 칠판 화면일 때는 DOM만 DB에 맞춥니다.
   */
  function refreshDigitalBoardDomFromDb() {
    var db = getDb();
    if (!db || !document.querySelector(".digital-board--tv")) return;
    ensureDigitalBoard(db);
    document.querySelectorAll(".board-student-row").forEach(function (row) {
      var sid = row.getAttribute("data-student-id");
      var actEl = row.querySelector(".js-board-act");
      if (sid && actEl) actEl.textContent = String(getStudentBoardActivity(db, sid));
    });
    BOARD_PERIODS.forEach(function (p) {
      var sub = document.querySelector('.js-board-tt-sub[data-tt-key="' + p.key + '"]');
      var act = document.querySelector('.js-board-tt-act[data-tt-key="' + p.key + '"]');
      var slot = normalizeTimetableSlot(db.digitalBoard.timetable[p.key]);
      if (sub && document.activeElement !== sub) sub.value = slot.subject != null ? String(slot.subject) : "";
      if (act && document.activeElement !== act) act.value = slot.activity != null ? String(slot.activity) : "";
    });
    var ta = document.getElementById("board-notice");
    if (ta && document.activeElement !== ta) ta.value = db.digitalBoard.notice || "";
    var texp = document.getElementById("board-notice-expanded");
    if (texp && document.activeElement !== texp) texp.value = db.digitalBoard.notice || "";
    var todoList = document.getElementById("board-todo-list");
    if (todoList) todoList.innerHTML = buildBoardTodoListInnerHtml(db);
  }

  function viewTeacherDigitalBoard(session) {
    var db = getDb();
    if (!db) return;
    runDailyBoardBoundaryPipeline(db);
    document.body.classList.add("app-body--digital-board");
    shell(renderDigitalBoardChrome(buildDigitalBoardHtml(db)));
    bindLogout();
    bindDigitalBoard();
  }

  function renderTeacherChrome(title, activeNav, mainHtml) {
    var studentModeBtn =
      window.opener == null
        ? '<button type="button" class="btn btn--ghost btn--iconish" id="btn-student-mode" title="학생 화면을 새 창에서 엽니다">학생 모드</button>'
        : "";
    var nav = [
      { href: "#/teacher", id: "dash", label: "대시보드" },
      { href: "#/teacher/board", id: "board", label: "디지털 칠판" },
      { href: "#/teacher/students", id: "students", label: "학생 목록" },
      { href: "#/teacher/title-shop", id: "titleshop", label: "칭호샵 관리" },
      { href: "#/teacher/coupon-shop", id: "couponshop", label: "쿠폰샵 관리" },
      { href: "#/teacher/store-shop", id: "storeshop", label: "매점 관리" },
      { href: "#/teacher/stock-market", id: "stockmarket", label: "모의투자 관리" },
      { href: "#/teacher/hall-of-fame-settings", id: "halloffame", label: "명예의 전당 설정" },
      { href: "#/teacher/bulk", id: "bulk", label: "일괄 조정" },
    ];
    var navHtml = nav
      .map(function (item) {
        var cls = item.id === activeNav ? " is-active" : "";
        return '<a href="' + item.href + '" class="' + cls + '">' + escapeHtml(item.label) + "</a>";
      })
      .join("");
    var jobrolesNavActive =
      activeNav === "bankroll" ||
      activeNav === "taxroll" ||
      activeNav === "statroll" ||
      activeNav === "postroll" ||
      activeNav === "cleanroll" ||
      activeNav === "recycler" ||
      activeNav === "env" ||
      activeNav === "dj";
    var bankItemCls = activeNav === "bankroll" ? " is-active" : "";
    var taxItemCls = activeNav === "taxroll" ? " is-active" : "";
    var statItemCls = activeNav === "statroll" ? " is-active" : "";
    var postItemCls = activeNav === "postroll" ? " is-active" : "";
    var cleanItemCls = activeNav === "cleanroll" ? " is-active" : "";
    var dropCls = jobrolesNavActive ? " app-nav__dropdown--active" : "";
    navHtml +=
      '<div class="app-nav__dropdown' +
      dropCls +
      '">' +
      '<button type="button" class="app-nav__drop-trigger" aria-haspopup="true" aria-expanded="false" id="nav-jobroles-trigger">' +
      '<span>1인1역관리</span>' +
      '<span class="app-nav__drop-caret" aria-hidden="true">▾</span>' +
      "</button>" +
      '<div class="app-nav__drop-panel" role="menu" aria-labelledby="nav-jobroles-trigger">' +
      '<a href="#/teacher/bank-payroll" role="menuitem" class="app-nav__drop-item' +
      bankItemCls +
      '">은행주급</a>' +
      '<a href="#/teacher/tax-collect" role="menuitem" class="app-nav__drop-item' +
      taxItemCls +
      '">국세청 세금</a>' +
      '<a href="#/teacher/statistics-checklist" role="menuitem" class="app-nav__drop-item' +
      statItemCls +
      '">통계청 체크리스트</a>' +
      '<a href="#/teacher/postman-errands" role="menuitem" class="app-nav__drop-item' +
      postItemCls +
      '">우체부 심부름 일지</a>' +
      '<a href="#/teacher/cleaning-checklist" role="menuitem" class="app-nav__drop-item' +
      cleanItemCls +
      '">청소부 청소 체크리스트</a>' +
      '<a href="#/teacher/recycler" role="menuitem" class="app-nav__drop-item' +
      (activeNav === "recycler" ? " is-active" : "") +
      '">분리수거부 승인 대기</a>' +
      '<a href="#/teacher/env" role="menuitem" class="app-nav__drop-item' +
      (activeNav === "env" ? " is-active" : "") +
      '">환경부 승인 대기</a>' +
      '<a href="#/teacher/dj" role="menuitem" class="app-nav__drop-item' +
      (activeNav === "dj" ? " is-active" : "") +
      '">DJ 신청곡 목록</a>' +
      "</div></div>";

    var years = window.classYears || [];
    var selectedYear = localStorage.getItem("currentClassYear") || window.activeClassYear || "";
    
    var yearSelectHtml = "";
    if (years.length > 0) {
      yearSelectHtml += '<select id="header-class-year-select" style="padding: 0.35rem 1.8rem 0.35rem 0.75rem; font-size: 0.9rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.15) url(\'data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23ffffff%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E\') no-repeat right 0.75rem center/8px 10px; -webkit-appearance: none; -moz-appearance: none; appearance: none; color: white; cursor: pointer; font-weight: bold; margin-right: 0.5rem; outline: none; transition: all 0.2s;">';
      
      for (var yi = 0; yi < years.length; yi++) {
        var yVal = years[yi];
        var isSel = yVal === selectedYear ? " selected" : "";
        var isAct = yVal === window.activeClassYear ? " (현재 활성)" : "";
        yearSelectHtml += '<option value="' + yVal + '"' + isSel + ' style="color: #333; font-weight: normal;">' + yVal + '학년도' + isAct + '</option>';
      }
      yearSelectHtml += '</select>';
    }

    var yearManageBtns = '';
    if (years.length > 0) {
      if (selectedYear && selectedYear !== window.activeClassYear) {
        yearManageBtns += '<button type="button" class="btn btn--accent btn--iconish" id="btn-activate-selected-year" title="이 학년도를 모든 학생들의 기본 접속 학년도로 설정합니다" style="margin-right: 0.5rem; font-size: 0.85rem; padding: 0.35rem 0.75rem;">기본 학년도로 지정</button>';
      }
    }
    yearManageBtns += '<button type="button" class="btn btn--ghost btn--iconish" id="btn-create-new-year" title="새 학년도 학급 추가" style="font-size: 0.85rem; padding: 0.35rem 0.75rem; border: 1px dashed rgba(255,255,255,0.4);"><span style="margin-right: 2px;">+</span>새 학년도</button>';

    var headerYearManageHtml = 
      '<div class="header-year-control" style="display: flex; align-items: center; background: rgba(0,0,0,0.15); padding: 0.35rem 0.5rem; border-radius: 8px; margin-right: 1rem; border: 1px solid rgba(255,255,255,0.08);">' +
      '<span style="font-size: 0.85rem; color: rgba(255,255,255,0.7); margin-right: 0.5rem; font-weight: bold;">학급 선택:</span>' +
      yearSelectHtml +
      yearManageBtns +
      '</div>';

    return (
      '<header class="app-header">' +
      '<div class="app-header__lead">' +
      '<div class="app-header__meta">선생님 모드</div>' +
      '<h1 class="app-header__title">' +
      escapeHtml(title) +
      "</h1></div>" +
      '<div class="app-header__actions">' +
      headerYearManageHtml +
      studentModeBtn +
      '<a class="btn btn--ghost btn--iconish" href="../index.html" id="btn-logout" title="로그아웃">로그아웃</a>' +
      "</div></header>" +
      '<div class="class-banner class-banner--teacher">' +
      '<span class="class-banner__ico" aria-hidden="true">🏰</span>' +
      '<div class="class-banner__text">' +
      '<div class="class-banner__title">학급 RPG · STATUS 서버</div>' +
      '<div class="class-banner__sub">위대한 모험가들을 위한 학급 운영 공간</div>' +
      "</div></div>" +
      '<nav class="app-nav" aria-label="선생님 메뉴">' +
      navHtml +
      "</nav>" +
      '<main class="app-main app-main--wide">' +
      mainHtml +
      "</main>"
    );
  }

  function buildStudentSubNavHtml(links) {
    if (!links || !links.length) return "";
    return (
      '<nav class="student-subnav" aria-label="학생 하위 메뉴">' +
      links
        .map(function (item) {
          var cls = item.active ? "student-subnav__link is-active" : "student-subnav__link";
          return (
            '<a href="' +
            escapeHtml(item.href) +
            '" class="' +
            cls +
            '">' +
            escapeHtml(item.label) +
            "</a>"
          );
        })
        .join("") +
      "</nav>"
    );
  }

  function renderStudentChrome(title, mainHtml, opts) {
    opts = opts || {};
    var subNavHtml = buildStudentSubNavHtml(opts.subNavLinks);

    var hash = window.location.hash || "";
    var bannerHtml = "";
    var db = getDb();
    if (hash.indexOf("#/teacher/preview/") === 0) {
      var parts = hash.split("/");
      var sid = decodeURIComponent(parts[3] || "");
      var qIdx = sid.indexOf("?");
      if (qIdx !== -1) {
        sid = sid.substring(0, qIdx);
      }
      var st = db ? getStudent(db, sid) : null;
      var name = st ? st.name : "";
      bannerHtml =
        '<div class="teacher-preview-banner">' +
        "<p><strong>학생 모드</strong> — <span class=\"teacher-preview-banner__name\">" +
        escapeHtml(name) +
        "</span> 학생이 로그인했을 때와 같은 화면입니다. (선생님 계정으로 보는 미리보기입니다.)</p>" +
        '<div class="row-actions row-actions--wrap">' +
        '<a class="btn btn--accent btn--sm" href="#/teacher/preview">다른 학생 선택</a> ' +
        '<a class="btn btn--ghost btn--sm" href="#/teacher">교사 대시보드</a>' +
        "</div></div>";
    } else if (hash.indexOf("#/teacher/student-jobs/") === 0) {
      var parts = hash.split("/");
      var sid = decodeURIComponent(parts[3] || "");
      var jid = decodeURIComponent(parts[4] || "");
      var qIdx = jid.indexOf("?");
      if (qIdx !== -1) {
        jid = jid.substring(0, qIdx);
      }
      var st = db ? getStudent(db, sid) : null;
      var name = st ? st.name : "";
      var job = getJobDef(jid);
      var jobLabel = job ? job.label : jid;
      bannerHtml =
        '<div class="teacher-preview-banner" style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, rgba(245, 158, 11, 0.1) 100%); border-color: rgba(239, 68, 68, 0.35);">' +
        "<p><strong>🚨 [교사 권한 우회 접속]</strong> — 지금 <span class=\"teacher-preview-banner__name\" style=\"color:#f87171;\">" +
        escapeHtml(name) +
        "</span> 학생의 <strong>" + escapeHtml(jobLabel) + "</strong> 장부에 교사 마스터 권한으로 강제 접속 중입니다.</p>" +
        '<div class="row-actions row-actions--wrap">' +
        '<a class="btn btn--accent btn--sm" href="#/teacher/students/' + encodeURIComponent(sid) + '" style="background-color: #ef4444; border-color: #ef4444;">학생 상세 정보</a> ' +
        '<a class="btn btn--ghost btn--sm" href="#/teacher">교사 대시보드</a>' +
        "</div></div>";
    }

    return (
      '<header class="app-header">' +
      '<div class="app-header__lead">' +
      '<div class="app-header__meta">학생 모드</div>' +
      '<h1 class="app-header__title">' +
      escapeHtml(title) +
      "</h1></div>" +
      '<div class="app-header__actions">' +
      '<a class="btn btn--ghost btn--iconish" href="../index.html" id="btn-logout" title="로그아웃">로그아웃</a>' +
      "</div></header>" +
      '<div class="class-banner class-banner--student">' +
      '<span class="class-banner__ico" aria-hidden="true">🏰</span>' +
      '<div class="class-banner__text">' +
      '<div class="class-banner__title">학급 RPG · STATUS 서버</div>' +
      '<div class="class-banner__sub">나만의 성장 기록을 확인해 보세요</div>' +
      "</div></div>" +
      bannerHtml +
      subNavHtml +
      '<main class="app-main app-main--wide">' +
      mainHtml +
      "</main>"
    );
  }

  function getStudentSubNavLinks(db, session, activeId) {
    if (!session || !session.studentId) return null;
    var st = getStudent(db, session.studentId);
    if (!st) return null;
    var prefix = "#/student";
    if (session.isOverride) { prefix = "#/teacher/student-jobs/" + encodeURIComponent(session.studentId) + "/" + escapeHtml(st.jobId) + "?sub="; }
    else if (session.preview) { prefix = "#/teacher/preview/" + encodeURIComponent(session.studentId); }
    var links = [{ href: (session.isOverride ? "#/teacher/student-jobs/" + encodeURIComponent(session.studentId) + "/" + escapeHtml(st.jobId) : prefix), label: "나의 STATUS", active: activeId === "status" }];
    if (st.jobId === "statistician") {
      links.push({
        href: prefix + "/statistics-checklist",
        label: "통계청 · 체크리스트",
        active: activeId === "stats",
      });
    } else if (isBankJobId(st.jobId)) {
      links.push({
        href: prefix + "/bank-payroll",
        label: "은행 · 주급",
        active: activeId === "bank",
      });
    } else if (isTaxJobId(st.jobId)) {
      links.push({
        href: prefix + "/tax-collect",
        label: "국세청 · 세금",
        active: activeId === "tax",
      });
    } else if (st.jobId === "postman") {
      links.push({
        href: prefix + "/postman-errands",
        label: "우체부 · 심부름 일지",
        active: activeId === "postman",
      });
    } else if (st.jobId === "cleaner") {
      links.push({
        href: prefix + "/cleaning-checklist",
        label: "청소부 · 청소 체크리스트",
        active: activeId === "cleaner",
      });
    }
    if (st.jobId === "coupon_merchant") {
      links.push({
        href: prefix + "/coupon-merchant",
        label: "쿠폰 상인 · 샵 관리",
        active: activeId === "coupon-merchant",
      });
    }
    if (st.jobId === "store_merchant") {
      links.push({
        href: prefix + "/store-merchant",
        label: "매점 상인 · 샵 관리",
        active: activeId === "store-merchant",
      });
    }
    if (st.jobId === "dj") {
      links.push({
        href: prefix + "/dj",
        label: "DJ · 신청곡 리스트",
        active: activeId === "dj",
      });
    }
    if (st.jobId === "recycler") {
      links.push({
        href: prefix + "/recycler",
        label: "분리수거부 · 슬기로운 분리수거",
        active: activeId === "recycler",
      });
    }
    if (st.jobId === "env") {
      links.push({
        href: prefix + "/env",
        label: "환경부 · 교실 관리 체크리스트",
        active: activeId === "env",
      });
    }
    links.push({ href: prefix + "/dj-request", label: "DJ 신청곡", active: activeId === "dj-request" });
    links.push({ href: prefix + "/title-shop", label: "칭호샵", active: activeId === "title-shop" });
    links.push({ href: prefix + "/coupon-shop", label: "쿠폰샵", active: activeId === "coupon-shop" });
    links.push({ href: prefix + "/store", label: "매점", active: activeId === "store" });
    if (db.stockMarket && db.stockMarket.enabled) {
      links.push({ href: prefix + "/stock-market", label: "모의투자", active: activeId === "stock-market" });
    }
    links.push({ href: prefix + "/peers", label: "우리반 친구들", active: activeId === "peers" });
    links.push({ href: prefix + "/hall-of-fame", label: "명예의 전당", active: activeId === "hall-of-fame" });
    return links;
  }

  /** 교사 미리보기: 학생과 동일한 하위 메뉴 + 쿠폰샵·매점 */
  function getTeacherPreviewSubNavLinks(db, studentId, activeId) {
    var st = getStudent(db, studentId);
    if (!st) return null;
    var enc = encodeURIComponent(studentId);
    var links = [{ href: "#/teacher/preview/" + enc, label: "나의 STATUS", active: activeId === "status" }];
    if (isBankJobId(st.jobId)) {
      links.push({
        href: "#/teacher/preview/" + enc + "/bank-payroll",
        label: "은행 · 주급",
        active: activeId === "bank",
      });
    } else if (isTaxJobId(st.jobId)) {
      links.push({
        href: "#/teacher/preview/" + enc + "/tax-collect",
        label: "국세청 · 세금",
        active: activeId === "tax",
      });
    } else if (st.jobId === "statistician") {
      links.push({
        href: "#/teacher/preview/" + enc + "/statistics-checklist",
        label: "통계청 · 체크리스트",
        active: activeId === "stats",
      });
    } else if (st.jobId === "postman") {
      links.push({
        href: "#/teacher/preview/" + enc + "/postman-errands",
        label: "우체부 · 심부름 일지",
        active: activeId === "postman",
      });
    } else if (st.jobId === "cleaner") {
      links.push({
        href: "#/teacher/preview/" + enc + "/cleaning-checklist",
        label: "청소부 · 청소 체크리스트",
        active: activeId === "cleaner",
      });
    }
    if (st.jobId === "coupon_merchant") {
      links.push({
        href: "#/teacher/preview/" + enc + "/coupon-merchant",
        label: "쿠폰 상인 · 샵 관리",
        active: activeId === "coupon-merchant",
      });
    }
    if (st.jobId === "store_merchant") {
      links.push({
        href: "#/teacher/preview/" + enc + "/store-merchant",
        label: "매점 상인 · 샵 관리",
        active: activeId === "store-merchant",
      });
    }
    if (st.jobId === "dj") {
      links.push({
        href: "#/teacher/preview/" + enc + "/dj",
        label: "DJ · 신청곡 리스트",
        active: activeId === "dj",
      });
    }
    if (st.jobId === "recycler") {
      links.push({
        href: "#/teacher/preview/" + enc + "/recycler",
        label: "분리수거부 · 슬기로운 분리수거",
        active: activeId === "recycler",
      });
    }
    if (st.jobId === "env") {
      links.push({
        href: "#/teacher/preview/" + enc + "/env",
        label: "환경부 · 교실 관리 체크리스트",
        active: activeId === "env",
      });
    }
    links.push({
      href: "#/teacher/preview/" + enc + "/dj-request",
      label: "DJ 신청곡",
      active: activeId === "dj-request",
    });
    links.push({
      href: "#/teacher/preview/" + enc + "/title-shop",
      label: "칭호샵",
      active: activeId === "title-shop",
    });
    links.push({
      href: "#/teacher/preview/" + enc + "/coupon-shop",
      label: "쿠폰샵",
      active: activeId === "coupon-shop",
    });
    links.push({
      href: "#/teacher/preview/" + enc + "/store",
      label: "매점",
      active: activeId === "store",
    });
    if (db.stockMarket && db.stockMarket.enabled) {
      links.push({
        href: "#/teacher/preview/" + enc + "/stock-market",
        label: "모의투자",
        active: activeId === "stock-market",
      });
    }
    links.push({
      href: "#/teacher/preview/" + enc + "/peers",
      label: "우리반 친구들",
      active: activeId === "peers",
    });
    links.push({
      href: "#/teacher/preview/" + enc + "/hall-of-fame",
      label: "명예의 전당",
      active: activeId === "hall-of-fame",
    });
    return links;
  }

  function showCreateYearModal() {
    var oldModal = document.getElementById("create-year-modal");
    if (oldModal) oldModal.remove();

    var modalHtml = 
      '<div id="create-year-modal" class="board-modal" style="display: flex; align-items: center; justify-content: center; z-index: 10000; position: fixed; top: 0; left: 0; width: 100%; height: 100%;">' +
      '<div class="board-modal__backdrop" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);"></div>' +
      '<div class="board-modal__dialog" role="dialog" aria-modal="true" style="position: relative; background: #ffffff; border-radius: 12px; max-width: 450px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); overflow: hidden; animation: modalFadeIn 0.3s ease-out; border: 1px solid rgba(0,0,0,0.05);">' +
      '<div class="board-modal__head" style="padding: 1.25rem 1.5rem; border-bottom: 1px solid #f3f4f6; display: flex; justify-content: space-between; align-items: center; background: #fafafa;">' +
      '<h3 class="board-modal__title" style="margin: 0; font-size: 1.2rem; font-weight: bold; color: #1f2937; display: flex; align-items: center; gap: 0.5rem;"><span style="font-size: 1.3rem;">🌱</span>새 학년도 학급 생성</h3>' +
      '<button type="button" class="board-modal__close" id="create-year-modal-close" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #9ca3af; line-height: 1;">&times;</button>' +
      '</div>' +
      '<div style="padding: 1.5rem;">' +
      '<form id="form-create-year" class="stack" style="display: flex; flex-direction: column; gap: 1.25rem;">' +
      '<p style="margin: 0; font-size: 0.9rem; color: #4b5563; line-height: 1.5;">' +
      '학년도별로 데이터를 완벽하게 분리하여 새로운 학급을 생성합니다.<br>' +
      '<span style="color: #6b7280; font-size: 0.85rem;">(선생님 계정 정보는 새 데이터베이스에 자동으로 복사됩니다.)</span>' +
      '</p>' +
      '<label class="field" style="display: flex; flex-direction: column; gap: 0.5rem; font-weight: bold; color: #374151; font-size: 0.95rem;">' +
      '생성할 학년도 (예: 2027)' +
      '<input type="number" name="newYear" required min="2020" max="2100" value="' + (new Date().getFullYear() + 1) + '" style="padding: 0.65rem 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1.1rem; text-align: center; font-weight: bold; width: 100%; box-sizing: border-box;" />' +
      '</label>' +
      '<p id="create-year-error" style="color: #ef4444; font-size: 0.85rem; margin: 0;" hidden></p>' +
      '<div style="display: flex; justify-content: flex-end; gap: 0.75rem; border-top: 1px solid #f3f4f6; padding-top: 1rem; margin-top: 0.5rem;">' +
      '<button type="button" class="btn btn--ghost" id="create-year-modal-cancel" style="padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer;">취소</button>' +
      '<button type="submit" class="btn btn--primary" style="padding: 0.5rem 1.25rem; border-radius: 6px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); border: none; color: white; font-weight: bold; cursor: pointer;">생성하기</button>' +
      '</div>' +
      '</form>' +
      '</div>' +
      '</div>' +
      '</div>';

    if (!document.getElementById("modal-anim-style")) {
      var style = document.createElement("style");
      style.id = "modal-anim-style";
      style.innerHTML = "@keyframes modalFadeIn { from { opacity: 0; transform: scale(0.95) translateY(-10px); } to { opacity: 1; transform: scale(1) translateY(0); } }";
      document.head.appendChild(style);
    }

    var div = document.createElement("div");
    div.innerHTML = modalHtml;
    var modalEl = div.firstChild;
    document.body.appendChild(modalEl);

    function closeModal() {
      modalEl.remove();
    }
    document.getElementById("create-year-modal-close").addEventListener("click", closeModal);
    document.getElementById("create-year-modal-cancel").addEventListener("click", closeModal);
    modalEl.querySelector(".board-modal__backdrop").addEventListener("click", closeModal);

    document.getElementById("form-create-year").addEventListener("submit", function (e) {
      e.preventDefault();
      var newYearVal = this.elements.newYear.value;
      if (!newYearVal || !/^\d{4}$/.test(newYearVal)) {
        var err = document.getElementById("create-year-error");
        err.textContent = "올바른 학년도(4자리 숫자)를 입력해 주세요.";
        err.hidden = false;
        return;
      }

      var submitBtn = this.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "생성 중...";

      window.ClassStatusServer.createYear(newYearVal)
        .then(function (data) {
          if (data.ok) {
            alert(newYearVal + "학년도 학급이 생성되었습니다! 새 학년도를 활성화하거나 선택하여 사용할 수 있습니다.");
            closeModal();
            window.ClassStatusServer.getYearsList().then(function (res) {
              if (res.ok) {
                window.classYears = res.years || [];
                window.activeClassYear = res.activeYear || "";
                route();
              }
            });
          }
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = "생성하기";
          var errEl = document.getElementById("create-year-error");
          errEl.textContent = err.message || "학년도 생성 중 에러가 발생했습니다.";
          errEl.hidden = false;
        });
    });
  }

  function handleActivateSelectedYear() {
    var selectedYear = localStorage.getItem("currentClassYear");
    if (!selectedYear) return;

    if (confirm(selectedYear + "학년도를 학생들의 기본 접속 학년도로 활성화하시겠습니까? 학생들은 로그인 시 자동으로 이 학년도의 학급 데이터에 접근하게 됩니다.")) {
      window.ClassStatusServer.setActiveYear(selectedYear)
        .then(function (data) {
          if (data.ok) {
            alert(selectedYear + "학년도가 기본 학년도로 성공적으로 지정되었습니다.");
            window.activeClassYear = selectedYear;
            route();
          }
        })
        .catch(function (err) {
          alert("활성화 중 오류가 발생했습니다: " + err.message);
        });
    }
  }

  function bindLogout() {
    var b = document.getElementById("btn-logout");
    if (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        if (window.name === "ClassStatusStudentMode" && window.opener) {
          try {
            window.close();
          } catch (err) {}
          return;
        }
        C.clearSession();
        window.location.href = "../index.html";
      });
    }
    var sm = document.getElementById("btn-student-mode");
    if (sm) {
      sm.addEventListener("click", function (e) {
        e.preventDefault();
        var base = window.location.href.split("#")[0];
        var url = base + "#/teacher/preview";
        var feat =
          "width=1100,height=800,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes";
        var w = window.open(url, "ClassStatusStudentMode", feat);
        if (w) {
          try {
            w.focus();
          } catch (err) {}
        } else {
          alert("팝업이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.");
        }
      });
    }

    var yearSelect = document.getElementById("header-class-year-select");
    if (yearSelect) {
      yearSelect.addEventListener("change", function () {
        var newYear = this.value;
        if (newYear) {
          localStorage.setItem("currentClassYear", newYear);
          window.ClassStatusServer.syncStudentsFromRemote().then(function () {
            C.ensureDb().then(function () {
              route();
            });
          });
        }
      });
    }

    var btnCreateYear = document.getElementById("btn-create-new-year");
    if (btnCreateYear) {
      btnCreateYear.addEventListener("click", function () {
        showCreateYearModal();
      });
    }

    var btnActivateYear = document.getElementById("btn-activate-selected-year");
    if (btnActivateYear) {
      btnActivateYear.addEventListener("click", function () {
        handleActivateSelectedYear();
      });
    }
  }

  function classAverageLevel(db) {
    if (!db || !db.students || !db.students.length) return null;
    var sum = 0;
    var i;
    for (i = 0; i < db.students.length; i++) {
      var lv = db.students[i].lv;
      sum += typeof lv === "number" && !isNaN(lv) ? lv : 0;
    }
    return sum / db.students.length;
  }

  function classMaxLevelInfo(db) {
    if (!db || !db.students || !db.students.length) return null;
    var maxLv = -Infinity;
    var holders = [];
    var i;
    for (i = 0; i < db.students.length; i++) {
      var s = db.students[i];
      var lv = typeof s.lv === "number" && !isNaN(s.lv) ? s.lv : 0;
      if (lv > maxLv) {
        maxLv = lv;
        holders = [s];
      } else if (lv === maxLv) {
        holders.push(s);
      }
    }
    if (maxLv === -Infinity) return null;
    return { lv: maxLv, students: holders };
  }

  /** 최근 days일 활동 로그 건수가 가장 많은 학생(동점 전원) */
  function bestRecentActivityPeers(db, days) {
    if (!db || !db.activityLogs) return null;
    var since = Date.now() - days * 86400000;
    var counts = {};
    var i;
    for (i = 0; i < db.activityLogs.length; i++) {
      var l = db.activityLogs[i];
      if (l.occurredAt >= since && l.studentId) {
        counts[l.studentId] = (counts[l.studentId] || 0) + 1;
      }
    }
    var best = 0;
    var sid;
    for (sid in counts) {
      if (counts[sid] > best) best = counts[sid];
    }
    if (best === 0) return null;
    var topIds = [];
    for (sid in counts) {
      if (counts[sid] === best) topIds.push(sid);
    }
    var studs = topIds
      .map(function (id) {
        return getStudent(db, id);
      })
      .filter(Boolean);
    studs.sort(function (a, b) {
      return Number(a.number) - Number(b.number);
    });
    return { students: studs, count: best };
  }

  function buildJobDashStudentOptionsHtml(db, selectedId) {
    var sorted = db.students.slice().sort(function (a, b) {
      return Number(a.number) - Number(b.number);
    });
    var opts =
      '<option value="">(이 자리 비우기)</option>' +
      sorted
        .map(function (st) {
          var sel = st.id === selectedId ? " selected" : "";
          return (
            '<option value="' +
            escapeHtml(st.id) +
            '"' +
            sel +
            ">" +
            escapeHtml(String(st.number) + "번 " + st.name) +
            "</option>"
          );
        })
        .join("");
    return opts;
  }

  function tryReassignClassJob(db, curStudentId, newStudentId, jobId) {
    var cur = getStudent(db, curStudentId);
    if (!cur) return { ok: false, msg: "학생 정보를 찾을 수 없습니다." };
    if (!newStudentId || newStudentId === curStudentId) return { ok: false, msg: null };

    var tgt = getStudent(db, newStudentId);
    if (!tgt) return { ok: false, msg: "선택한 학생을 찾을 수 없습니다." };

    var curHad = cur.jobId;
    var tgtHad = tgt.jobId;

    if (cur.jobId === jobId) delete cur.jobId;
    if (tgt.id !== cur.id && tgtHad && tgtHad !== jobId) delete tgt.jobId;

    if (!canAssignJob(db, newStudentId, jobId)) {
      cur.jobId = curHad;
      tgt.jobId = tgtHad;
      return { ok: false, msg: "해당 직업 인원 한도가 찼습니다. 대시보드에서 한도를 늘리거나 다른 직업을 비운 뒤 다시 시도해 주세요." };
    }
    tgt.jobId = jobId;
    return { ok: true, msg: null };
  }

  function tryUnassignClassJob(db, curStudentId, jobId) {
    var cur = getStudent(db, curStudentId);
    if (!cur) return false;
    if (cur.jobId === jobId) delete cur.jobId;
    return true;
  }

  function studentsWithoutJobSorted(db) {
    var out = [];
    var si;
    for (si = 0; si < db.students.length; si++) {
      if (!db.students[si].jobId) out.push(db.students[si]);
    }
    out.sort(function (a, b) {
      return Number(a.number) - Number(b.number);
    });
    return out;
  }

  function tryAssignUnassignedToJob(db, studentId, jobId) {
    if (!studentId || !jobId) return { ok: false, msg: null };
    var st = getStudent(db, studentId);
    if (!st) return { ok: false, msg: "학생을 찾을 수 없습니다." };
    if (st.jobId) return { ok: false, msg: "이미 다른 직업이 배정된 학생입니다." };
    if (!canAssignJob(db, studentId, jobId)) {
      return { ok: false, msg: "해당 직업 인원 한도가 찼습니다. 한도를 늘리거나 다른 직업을 비운 뒤 다시 시도해 주세요." };
    }
    st.jobId = jobId;
    return { ok: true, msg: null };
  }

  function buildClassJobsDashboardSection(db) {
    ensureClassJobSettings(db);
    var totalClass = db.students.length;
    var assignedCount = 0;
    var si0;
    for (si0 = 0; si0 < db.students.length; si0++) {
      if (db.students[si0].jobId) assignedCount++;
    }
    var rows = CLASS_JOBS.map(function (j) {
      var quota = getJobQuota(db, j.id);
      var assigned = [];
      var si;
      for (si = 0; si < db.students.length; si++) {
        if (db.students[si].jobId === j.id) assigned.push(db.students[si]);
      }
      assigned.sort(function (a, b) {
        return Number(a.number) - Number(b.number);
      });
      var overCap = assigned.length > quota;
      var slotsLeft = quota - assigned.length;
      var unassigned = studentsWithoutJobSorted(db);
      var namesCore = assigned.length
        ? assigned
            .map(function (s, idx) {
              var opts = buildJobDashStudentOptionsHtml(db, s.id);
              return (
                '<span class="job-dash-slot">' +
                '<select class="job-dash-reassign" data-job-id="' +
                escapeHtml(j.id) +
                '" data-current-student-id="' +
                escapeHtml(s.id) +
                '" title="' +
                escapeHtml(j.label + " — 다른 학생으로 바꾸기") +
                '" aria-label="' +
                escapeHtml(j.label + " 배정 학생 바꾸기") +
                '">' +
                opts +
                "</select>" +
                '<a class="job-dash-student-link" href="#/teacher/students/' +
                encodeURIComponent(s.id) +
                '">상세</a>' +
                (idx < assigned.length - 1 ? '<span class="job-dash-sep">,</span> ' : "") +
                "</span>"
              );
            })
            .join("")
        : '<span class="muted">—</span>';
      var addHtml = "";
      if (quota > 0 && slotsLeft > 0) {
        var addId = "jobdash-add-" + j.id;
        if (unassigned.length) {
          var addOpts =
            '<option value="">미배정 학생 선택…</option>' +
            unassigned
              .map(function (st) {
                return (
                  '<option value="' +
                  escapeHtml(st.id) +
                  '">' +
                  escapeHtml(String(st.number) + "번 " + st.name) +
                  "</option>"
                );
              })
              .join("");
          addHtml =
            ' <span class="job-dash-add-wrap">' +
            '<label class="job-dash-add-btn" for="' +
            escapeHtml(addId) +
            '" title="미배정 학생을 이 직업에 배정">+</label>' +
            '<select id="' +
            escapeHtml(addId) +
            '" class="job-dash-add-select" data-job-id="' +
            escapeHtml(j.id) +
            '" aria-label="' +
            escapeHtml(j.label + "에 미배정 학생 배정") +
            '">' +
            addOpts +
            "</select></span>";
        } else {
          addHtml =
            ' <span class="job-dash-add-wrap job-dash-add-wrap--empty">' +
            '<button type="button" class="job-dash-add-btn job-dash-add-btn--disabled" disabled title="미배정 학생이 없습니다">+</button>' +
            "</span>";
        }
      }
      var names = namesCore + addHtml;
      return (
        "<tr>" +
        '<td><span class="job-dash-ico" aria-hidden="true">' +
        j.icon +
        "</span> " +
        escapeHtml(j.label) +
        "</td>" +
        '<td><input type="number" class="input-job-quota" name="jobquota_' +
        escapeHtml(j.id) +
        '" min="0" max="99" value="' +
        quota +
        '" data-job-id="' +
        escapeHtml(j.id) +
        '" title="이 직업 최대 인원" /></td>' +
        '<td class="' +
        (overCap ? "job-dash-over" : "") +
        '">' +
        assigned.length +
        " / " +
        quota +
        (overCap ? " ⚠" : "") +
        "</td>" +
        '<td class="job-dash-names">' +
        names +
        "</td>" +
        "</tr>"
      );
    }).join("");
    var footerRow =
      "<tr class=\"job-dash-tfoot\">" +
      "<td><strong>합계</strong></td>" +
      "<td>—</td>" +
      '<td class="job-dash-total">' +
      "<strong>" +
      assignedCount +
      "</strong>명 배정" +
      (totalClass ? " · 학급 " + totalClass + "명" : "") +
      (totalClass && assignedCount < totalClass ? " · 미배정 " + (totalClass - assignedCount) + "명" : "") +
      "</td>" +
      '<td class="muted job-dash-tfoot-hint"><span class="job-dash-hint-ico" aria-hidden="true">💡</span>드롭다운·<strong>+</strong>로 미배정 학생을 바로 넣을 수 있어요.</td>' +
      "</tr>";
    return (
      '<section class="panel panel--class-jobs">' +
      '<h2 class="panel__title"><span class="panel__title-ico" aria-hidden="true">🎭</span>학급 1인 1역</h2>' +
      '<p class="panel__text">인원 한도 저장 후, 배정은 <strong>드롭다운</strong>·<strong>+</strong>로 바로 조정해요. 「상세」는 학생 페이지로 이동합니다.</p>' +
      '<form id="form-class-job-quotas" class="stack">' +
      '<div class="table-wrap"><table class="data job-dash-table"><thead><tr><th>직업</th><th>인원 한도</th><th>배정 현황</th><th>배정 학생</th></tr></thead><tbody>' +
      rows +
      footerRow +
      "</tbody></table></div>" +
      '<button type="submit" class="btn btn--primary">인원 한도 저장</button>' +
      "</form></section>"
    );
  }

  function viewTeacherDashboard(session) {
    var db = getDb();
    if (!db) return;
    ensureClassJobSettings(db);
    ensureTaxCollectionRequests(db);
    var taxDashTotal = getClassTaxTotalDisplay(db);
    var taxDashManual = isClassTaxManualActive(db);
    var n = db.students.length;
    var avgLv = classAverageLevel(db);
    var maxInfo = classMaxLevelInfo(db);
    var bestAct = bestRecentActivityPeers(db, 7);

    var cardBest;
    if (bestAct && bestAct.students.length) {
      var show = bestAct.students.slice(0, 4);
      var nameStr = show
        .map(function (s) {
          return escapeHtml(s.name);
        })
        .join(", ");
      if (bestAct.students.length > 4) {
        nameStr += " 외 " + (bestAct.students.length - 4) + "명";
      }
      cardBest =
        '<div class="stat-card stat-card--accent">' +
        '<div class="stat-card__label"><span class="stat-card__emoji" aria-hidden="true">🌟</span>최근 활동이 우수한 친구</div>' +
        '<div class="stat-card__value stat-card__value--names">' +
        nameStr +
        "</div>" +
        '<div class="stat-card__sub">최근 7일 · 활동 기록 ' +
        bestAct.count +
        "건 (가장 많음)</div></div>";
    } else {
      cardBest =
        '<div class="stat-card stat-card--accent">' +
        '<div class="stat-card__label"><span class="stat-card__emoji" aria-hidden="true">🌟</span>최근 활동이 우수한 친구</div>' +
        '<p class="stat-card__sub stat-card__sub--solo muted">활동 기록이 쌓이면, 가장 활발히 참여한 친구를 보여 드려요.</p></div>';
    }

    var cardAvg =
      n > 0 && avgLv != null
        ? '<div class="stat-card">' +
          '<div class="stat-card__label"><span class="stat-card__emoji" aria-hidden="true">📊</span>우리반 평균 레벨</div>' +
          '<div class="stat-card__value">' +
          avgLv.toFixed(1) +
          '<span class="stat-card__unit">Lv</span></div></div>'
        : '<div class="stat-card">' +
          '<div class="stat-card__label"><span class="stat-card__emoji" aria-hidden="true">📊</span>우리반 평균 레벨</div>' +
          '<p class="stat-card__sub stat-card__sub--solo muted">학생을 등록하면 표시됩니다.</p></div>';

    var cardMax =
      maxInfo && maxInfo.students.length
        ? (function () {
            var namesMax = maxInfo.students
              .slice(0, 5)
              .map(function (s) {
                return escapeHtml(s.name);
              })
              .join(", ");
            if (maxInfo.students.length > 5) {
              namesMax += " 외 " + (maxInfo.students.length - 5) + "명";
            }
            return (
              '<div class="stat-card">' +
              '<div class="stat-card__label"><span class="stat-card__emoji" aria-hidden="true">🏆</span>우리반 최고 레벨</div>' +
              '<div class="stat-card__value">' +
              maxInfo.lv +
              '<span class="stat-card__unit">Lv</span></div>' +
              '<div class="stat-card__sub">' +
              namesMax +
              "</div></div>"
            );
          })()
        : '<div class="stat-card">' +
          '<div class="stat-card__label"><span class="stat-card__emoji" aria-hidden="true">🏆</span>우리반 최고 레벨</div>' +
          '<p class="stat-card__sub stat-card__sub--solo muted">학생을 등록하면 표시됩니다.</p></div>';

    var cardTax =
      '<div class="stat-card stat-card--tax">' +
      '<div class="stat-card__label"><span class="stat-card__emoji" aria-hidden="true">🧾</span>우리반 세금 총액</div>' +
      '<div class="stat-card__value stat-card__value--tax">' +
      formatNum(taxDashTotal) +
      '<span class="stat-card__unit">Cal</span></div>' +
      '<div class="stat-card__sub">' +
      (taxDashManual ? "선생님 표시 기준" : "승인 징수 누적") +
      ' · <a href="#/teacher/tax-collect">국세청</a></div></div>';

    var shopShortcutsHtml =
      '<section class="panel">' +
      '<h2 class="panel__title"><span class="panel__title-ico" aria-hidden="true">🏪</span>학급 상점 및 쿠폰 관리</h2>' +
      '<p class="panel__text">직접 물건을 등록/삭제하고, 학생 상인의 신규 등록 및 가격 수정 제안을 승인할 수 있습니다.</p>' +
      '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem;">' +
      '<a href="#/teacher/store-shop" class="btn btn--accent" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem; text-decoration: none; border-radius: 8px; box-shadow: var(--shadow); height: auto; gap: 0.5rem; background: linear-gradient(135deg, #2dd4bf 0%, #0d9488 100%); border: none;">' +
      '<span style="font-size: 2rem;">🏪</span>' +
      '<strong style="font-size: 1.1rem; color: #fff;">매점 관리</strong>' +
      '<span style="font-size: 0.85rem; opacity: 0.85; font-weight: normal; color: #eee;">물품 직접 등록 · 가격 승인 및 삭제</span>' +
      '</a>' +
      '<a href="#/teacher/title-shop" class="btn btn--accent" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem; text-decoration: none; border-radius: 8px; box-shadow: var(--shadow); height: auto; gap: 0.5rem; background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%); border: none;">' +
      '<span style="font-size: 2rem;">👑</span>' +
      '<strong style="font-size: 1.1rem; color: #fff;">칭호샵 관리</strong>' +
      '<span style="font-size: 0.85rem; opacity: 0.85; font-weight: normal; color: #eee;">칭호 구매 신청 및 관리</span>' +
      '</a>' +
      '<a href="#/teacher/coupon-shop" class="btn btn--primary" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem; text-decoration: none; border-radius: 8px; box-shadow: var(--shadow); height: auto; gap: 0.5rem; background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); border: none;">' +
      '<span style="font-size: 2rem;">🎫</span>' +
      '<strong style="font-size: 1.1rem; color: #fff;">쿠폰샵 관리</strong>' +
      '<span style="font-size: 0.85rem; opacity: 0.85; font-weight: normal; color: #eee;">쿠폰 직접 등록 · 가격 승인 및 삭제</span>' +
      '</a>' +
      '</div></section>';

    var backupPanelHtml =
      '<section class="panel" style="margin-top: 1.5rem;">' +
      '<h2 class="panel__title"><span class="panel__title-ico" aria-hidden="true">💾</span>학급 데이터 안전 보존</h2>' +
      '<p class="panel__text">소중한 학급 운영 데이터를 언제든 파일로 내보내어 개인 저장소나 USB에 보관하실 수 있습니다.</p>' +
      '<div style="display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap;">' +
      '<button id="btn-download-db-backup" class="btn btn--accent" style="display: flex; align-items: center; justify-content: center; padding: 1rem 1.5rem; text-decoration: none; border-radius: 8px; box-shadow: var(--shadow); height: auto; gap: 0.5rem; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; cursor: pointer; color: white; font-weight: bold; font-size: 1rem;">' +
      '<span>💾</span>학급 데이터 백업 다운로드 (.json)' +
      '</button>' +
      '</div></section>';

    var main =
      '<div class="stat-grid">' +
      cardTax +
      '<div class="stat-card">' +
      '<div class="stat-card__label"><span class="stat-card__emoji" aria-hidden="true">👥</span>등록 학생</div>' +
      '<div class="stat-card__value">' +
      n +
      "<span class=\"stat-card__unit\">명</span></div></div>" +
      cardBest +
      cardAvg +
      cardMax +
      "</div>" +
      shopShortcutsHtml +
      backupPanelHtml +
      buildClassJobsDashboardSection(db) +
      '<p class="panel__hint panel__hint--dash"><span class="panel__hint-ico" aria-hidden="true">📌</span>데모 선생님: <code>teacher</code> / <code>demo123</code></p>';
    shell(renderTeacherChrome("대시보드", "dash", main));
    bindLogout();

    var btnDl = document.getElementById("btn-download-db-backup");
    if (btnDl) {
      btnDl.addEventListener("click", function () {
        var dbDl = getDb();
        if (!dbDl) return;
        var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dbDl, null, 2));
        var downloadAnchor = document.createElement("a");
        var d = new Date();
        var dateStr = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
        var fileName = "학급운영도구_백업_" + dateStr + ".json";
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", fileName);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      });
    }

    var fq = document.getElementById("form-class-job-quotas");
    if (fq) {
      fq.addEventListener("submit", function (e) {
        e.preventDefault();
        var db2 = getDb();
        if (!db2) return;
        ensureClassJobSettings(db2);
        var ji;
        for (ji = 0; ji < CLASS_JOBS.length; ji++) {
          var jid = CLASS_JOBS[ji].id;
          var inp = document.querySelector('input[name="jobquota_' + jid + '"]');
          var v = inp ? parseInt(inp.value, 10) : 0;
          if (isNaN(v) || v < 0) v = 0;
          db2.classJobQuotas[jid] = v;
        }
        saveDb(db2);
        alert("인원 한도를 저장했습니다.");
        route();
      });
      fq.addEventListener("change", function (e) {
        var sel = e.target;
        if (!sel || !sel.classList) return;
        if (sel.classList.contains("job-dash-add-select")) {
          var addJobId = sel.getAttribute("data-job-id");
          var addSid = String(sel.value || "");
          if (!addJobId || !addSid) return;
          var dbAdd = getDb();
          if (!dbAdd) return;
          var ra = tryAssignUnassignedToJob(dbAdd, addSid, addJobId);
          if (!ra.ok) {
            if (ra.msg) alert(ra.msg);
            sel.selectedIndex = 0;
            return;
          }
          saveDb(dbAdd);
          route();
          return;
        }
        if (!sel.classList.contains("job-dash-reassign")) return;
        var jobId = sel.getAttribute("data-job-id");
        var curId = sel.getAttribute("data-current-student-id");
        var newId = String(sel.value || "");
        if (!jobId || !curId) return;
        if (newId === curId) return;

        var db2 = getDb();
        if (!db2) return;

        if (!newId) {
          tryUnassignClassJob(db2, curId, jobId);
          saveDb(db2);
          route();
          return;
        }

        var r = tryReassignClassJob(db2, curId, newId, jobId);
        if (!r.ok) {
          if (r.msg) alert(r.msg);
          sel.value = curId;
          return;
        }
        saveDb(db2);
        route();
      });
    }
  }

  function viewTeacherStudents(session) {
    var db = getDb();
    if (!db) return;
    var sorted = db.students.slice().sort(function (a, b) {
      return Number(a.number) - Number(b.number);
    });
    var gridInner = sorted.length
      ? sorted.map(renderStudentCardHtml).join("")
      : '<p class="student-grid__empty">등록된 학생이 없습니다. 엑셀 또는 「학생 추가」로 등록해 보세요.</p>';

    var main =
      '<section class="panel panel--excel-tools">' +
      '<h2 class="panel__title"><span class="panel__title-ico" aria-hidden="true">📗</span>엑셀</h2>' +
      '<div class="excel-tools">' +
      '<div class="excel-tools__group">' +
      '<span class="excel-tools__name"><span class="excel-tools__ico" aria-hidden="true">➕</span>신규 일괄</span>' +
      '<div class="excel-tools__btns">' +
      '<button type="button" class="btn btn--primary" id="btn-excel-template">양식 받기</button>' +
      '<button type="button" class="btn btn--ghost" id="btn-excel-import">파일로 추가</button>' +
      '<input type="file" id="excel-import-input" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden />' +
      "</div></div>" +
      '<div class="excel-tools__group">' +
      '<span class="excel-tools__name"><span class="excel-tools__ico" aria-hidden="true">✏️</span>상세·칭호·직업</span>' +
      '<div class="excel-tools__btns">' +
      '<button type="button" class="btn btn--primary" id="btn-excel-export-detail">현황 내보내기</button>' +
      '<button type="button" class="btn btn--ghost" id="btn-excel-bulk-update">수정 반영</button>' +
      '<input type="file" id="excel-bulk-update-input" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden />' +
      "</div></div></div></section>" +
      '<div class="student-toolbar">' +
      '<div class="student-toolbar__actions">' +
      '<a class="btn btn--primary" href="#/teacher/students/new">학생 추가</a>' +
      '<button type="button" class="btn btn--accent" id="btn-go-bulk">선택 일괄 조정</button>' +
      '<button type="button" class="btn btn--danger btn--sm" id="btn-delete-selected">선택 삭제</button>' +
      "</div>" +
      '<div class="student-toolbar__meta">' +
      '<label class="check-all"><input type="checkbox" id="select-all-students" /> 전체 선택</label>' +
      '<span class="selected-count" id="selected-count">0명 선택</span>' +
      "</div></div>" +
      '<div class="student-grid" id="student-grid-root">' +
      gridInner +
      "</div>";

    shell(renderTeacherChrome("학생 관리", "students", main));
    bindLogout();

    function updateSelectedCount() {
      var n = document.querySelectorAll(".js-bulk:checked").length;
      var el = document.getElementById("selected-count");
      if (el) el.textContent = n + "명 선택";
      var all = document.querySelectorAll(".js-bulk");
      var sa = document.getElementById("select-all-students");
      if (sa && all.length) {
        sa.checked = n === all.length && n > 0;
        sa.indeterminate = n > 0 && n < all.length;
      }
    }

    var gridRoot = document.getElementById("student-grid-root");
    if (gridRoot) {
      gridRoot.addEventListener("change", function (e) {
        if (e.target && e.target.classList.contains("js-bulk")) updateSelectedCount();
      });
    }
    var selAll = document.getElementById("select-all-students");
    if (selAll) {
      selAll.addEventListener("change", function () {
        var on = selAll.checked;
        document.querySelectorAll(".js-bulk").forEach(function (el) {
          el.checked = on;
        });
        updateSelectedCount();
      });
    }
    updateSelectedCount();

    document.getElementById("btn-excel-template").addEventListener("click", function () {
      downloadStudentExcelTemplate();
    });
    document.getElementById("btn-excel-import").addEventListener("click", function () {
      document.getElementById("excel-import-input").click();
    });
    document.getElementById("excel-import-input").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (f) runExcelStudentImport(f);
    });

    document.getElementById("btn-excel-export-detail").addEventListener("click", function () {
      downloadStudentDetailExcelExport();
    });
    document.getElementById("btn-excel-bulk-update").addEventListener("click", function () {
      document.getElementById("excel-bulk-update-input").click();
    });
    document.getElementById("excel-bulk-update-input").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (f) runExcelStudentBulkUpdate(f);
    });

    document.getElementById("btn-go-bulk").addEventListener("click", function () {
      var ids = [];
      document.querySelectorAll(".js-bulk:checked").forEach(function (el) {
        ids.push(el.getAttribute("data-id"));
      });
      if (!ids.length) {
        alert("학생을 한 명 이상 선택해 주세요.");
        return;
      }
      sessionStorage.setItem("bulkStudentIds", JSON.stringify(ids));
      setHash("/teacher/bulk");
    });

    document.getElementById("btn-delete-selected").addEventListener("click", function () {
      var ids = [];
      document.querySelectorAll(".js-bulk:checked").forEach(function (el) {
        ids.push(el.getAttribute("data-id"));
      });
      if (!ids.length) {
        alert("삭제할 학생을 선택해 주세요.");
        return;
      }
      if (!confirm("선택한 " + ids.length + "명을 삭제할까요? 되돌릴 수 없습니다.")) return;
      var db2 = getDb();
      var j;
      for (j = 0; j < ids.length; j++) {
        removeStudentFromDb(db2, ids[j]);
      }
      saveDb(db2);
      route();
    });

    if (gridRoot) {
      gridRoot.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || !t.classList || !t.classList.contains("js-student-delete")) return;
        e.preventDefault();
        e.stopPropagation();
        var sid = t.getAttribute("data-id");
        var sname = t.getAttribute("data-name") || "";
        if (!sid) return;
        if (!confirm("「" + sname + "」 학생을 삭제할까요? 되돌릴 수 없습니다.")) return;
        var db2 = getDb();
        removeStudentFromDb(db2, sid);
        saveDb(db2);
        route();
      });
    }
  }

  function viewTeacherStudentNew(session) {
    var main =
      '<section class="panel">' +
      '<h2 class="panel__title">학생 추가</h2>' +
      '<form id="form-new-student" class="stack">' +
      '<div class="form-grid">' +
      '<label class="field">이름 *<input name="name" required autocomplete="name" /></label>' +
      '<label class="field">번호 *<input name="number" required inputmode="numeric" /></label>' +
      '<label class="field">성별 *<select name="gender" required>' +
      '<option value="female" selected>여학생</option>' +
      '<option value="male">남학생</option>' +
      "</select></label>" +
      '<label class="field">학급 직책<select name="classRole">' +
      '<option value="" selected>(없음)</option>' +
      '<option value="president">👑 회장</option>' +
      '<option value="vice_president">⚡ 부회장</option>' +
      "</select></label>" +
      '<label class="field">초기 LV<input name="lv" type="number" value="1" min="1" /></label>' +
      '<label class="field">초기 EXP (0~100%)<input name="exp" type="number" value="0" min="0" max="100" /></label>' +
      '<label class="field">초기 Calory<input name="calory" type="number" value="0" /></label>' +
      '<label class="field">소지 쿠폰<input name="coupons" type="number" value="0" min="0" /></label>' +
      "</div>" +
      '<p class="muted">학생 로그인 아이디는 <strong>이름</strong>이며, 초기 비밀번호는 <strong>0000</strong>입니다. 첫 로그인에서 학생이 다른 숫자 4자리로 바꿉니다.</p>' +
      '<div class="row-actions">' +
      '<button type="submit" class="btn btn--primary">저장</button>' +
      '<a class="btn btn--ghost" href="#/teacher/students">취소</a>' +
      "</div>" +
      '<p id="form-err" class="field-error" hidden></p>' +
      "</form></section>";

    shell(renderTeacherChrome("학생 추가", "students", main));
    bindLogout();

    document.getElementById("form-new-student").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var name = String(fd.get("name") || "").trim();
      var number = String(fd.get("number") || "").trim();
      var lv = parseInt(fd.get("lv"), 10) || 1;
      var expRaw = parseInt(fd.get("exp"), 10);
      var exp = isNaN(expRaw) ? 0 : clampExp(expRaw);
      var calory = parseInt(fd.get("calory"), 10);
      if (isNaN(calory)) calory = 0;
      var err = document.getElementById("form-err");

      if (studentByNumber(getDb(), number)) {
        err.textContent = "이미 같은 번호의 학생이 있습니다.";
        err.hidden = false;
        return;
      }
      if (findStudentUserByLoginId(getDb(), name)) {
        err.textContent = "이미 같은 이름(로그인 아이디)의 학생이 있습니다.";
        err.hidden = false;
        return;
      }

      var db = getDb();
      var sid = C.uid();
      var coupons = parseInt(fd.get("coupons"), 10);
      if (isNaN(coupons)) coupons = 0;
      var gender = normalizeGender(fd.get("gender"));
      var classRole = String(fd.get("classRole") || "").trim();

      db.students.push({
        id: sid,
        name: name,
        number: number,
        gender: gender,
        lv: lv,
        exp: exp,
        calory: calory,
        coupons: coupons,
        classRole: classRole,
      });

      db.users.push({
        id: C.uid(),
        loginId: normStudentLoginId(name),
        pinCode: "0000",
        pinMustChange: true,
        role: "student",
        displayName: name,
        studentId: sid,
      });
      addActivityLog(db, {
        studentId: sid,
        summary: "학급에 합류함 (등록)",
        expDelta: 0,
      });
      saveDb(db);
      window.location.hash = "#/teacher/students/" + encodeURIComponent(sid);
    });
  }

  function pixelFemaleSvg(uid) {
    var id = "pf" + uid;
    var hair = "#4a3224";
    var hairLight = "#5c4030";
    var skin = "#f2d4c2";
    var bg = "#c8daf0";
    return (
      '<svg class="pixel-avatar-svg" viewBox="0 0 64 64" role="img" aria-label="여학생 캐릭터">' +
      '<defs><linearGradient id="shirt-' +
      id +
      '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#8ec5ff"/><stop offset="100%" stop-color="#4a78b8"/></linearGradient></defs>' +
      '<rect width="64" height="64" rx="10" fill="' +
      bg +
      '"/>' +
      '<rect x="8" y="14" width="12" height="30" fill="' +
      hair +
      '"/>' +
      '<rect x="44" y="14" width="12" height="30" fill="' +
      hair +
      '"/>' +
      '<rect x="16" y="6" width="32" height="14" fill="' +
      hair +
      '"/>' +
      '<rect x="20" y="4" width="24" height="6" fill="' +
      hairLight +
      '"/>' +
      '<rect x="20" y="18" width="24" height="20" fill="' +
      skin +
      '"/>' +
      '<rect x="18" y="14" width="28" height="8" fill="' +
      hair +
      '"/>' +
      '<rect x="24" y="26" width="4" height="4" fill="#2a2430"/>' +
      '<rect x="36" y="26" width="4" height="4" fill="#2a2430"/>' +
      '<rect x="28" y="34" width="8" height="3" fill="#d08090"/>' +
      '<rect x="22" y="36" width="20" height="18" fill="url(#shirt-' +
      id +
      ')"/>' +
      '<rect x="18" y="40" width="8" height="14" fill="#eef4fc"/>' +
      '<rect x="38" y="40" width="8" height="14" fill="#eef4fc"/>' +
      '<rect x="26" y="52" width="12" height="6" fill="#3a4860"/>' +
      "</svg>"
    );
  }

  function pixelMaleSvg(uid) {
    var id = "pm" + uid;
    var hair = "#3a3028";
    var skin = "#e8c4a8";
    var bg = "#c8daf0";
    return (
      '<svg class="pixel-avatar-svg" viewBox="0 0 64 64" role="img" aria-label="남학생 캐릭터">' +
      '<defs><linearGradient id="shirt-' +
      id +
      '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#5cb0e8"/><stop offset="100%" stop-color="#2a70b0"/></linearGradient></defs>' +
      '<rect width="64" height="64" rx="10" fill="' +
      bg +
      '"/>' +
      '<rect x="18" y="8" width="28" height="14" fill="' +
      hair +
      '"/>' +
      '<rect x="16" y="12" width="8" height="14" fill="' +
      hair +
      '"/>' +
      '<rect x="40" y="12" width="8" height="14" fill="' +
      hair +
      '"/>' +
      '<rect x="22" y="6" width="20" height="8" fill="' +
      hair +
      '"/>' +
      '<rect x="20" y="18" width="24" height="20" fill="' +
      skin +
      '"/>' +
      '<rect x="24" y="26" width="4" height="4" fill="#2a2430"/>' +
      '<rect x="36" y="26" width="4" height="4" fill="#2a2430"/>' +
      '<rect x="28" y="34" width="8" height="3" fill="#a07050"/>' +
      '<rect x="22" y="36" width="20" height="18" fill="url(#shirt-' +
      id +
      ')"/>' +
      '<rect x="18" y="40" width="8" height="14" fill="#e0eaf5"/>' +
      '<rect x="38" y="40" width="8" height="14" fill="#e0eaf5"/>' +
      '<rect x="26" y="52" width="12" height="6" fill="#2a3548"/>' +
      "</svg>"
    );
  }

  function avatarSvgByGender(gender, studentId) {
    var uid = sanitizeAvatarId(studentId);
    return studentGender({ gender: gender }) === "male" ? pixelMaleSvg(uid) : pixelFemaleSvg(uid);
  }

  function isSafeAvatarDataUrl(url) {
    if (typeof url !== "string") return false;
    if (url.length < 30 || url.length > 1500000) return false;
    return /^data:image\/[a-zA-Z0-9\+\-\.]+;base64,/.test(url);
  }

  function renderAvatarInnerHtml(st) {
    if (!st) return "";
    var body = "";
    if (st.avatarCustom && isSafeAvatarDataUrl(st.avatarCustom)) {
      body = '<img src="' + escapeHtml(st.avatarCustom) + '" class="student-card__avatar-img" alt="avatar"/>';
    } else if (st.avatarDataUrl && isSafeAvatarDataUrl(st.avatarDataUrl)) {
      body = '<img src="' + escapeHtml(st.avatarDataUrl) + '" class="student-card__avatar-img" alt="avatar"/>';
    } else {
      var gender = studentGender(st);
      body = avatarSvgByGender(gender, st.id);
    }
    return (
      '<div class="student-card__avatar-wrapper">' +
      body +
      '</div>'
    );
  }

  function studentCardAvatar(s) {
    return renderAvatarInnerHtml(s);
  }

  function bindStatusBoardShopShortcuts() {
    var nav = document.querySelector(".status-shop-shortcuts");
    if (!nav) return;
    nav.addEventListener("click", function (e) {
      var a = e.target.closest("a.status-shop-shortcuts__btn");
      if (!a) return;
      var href = a.getAttribute("href");
      if (!href || href.indexOf("#/student/") !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (window.location.hash !== href) {
        window.location.hash = href;
      }
      route();
    });
  }

  function bindStudentAvatarUpload(studentId) {
    var input = document.getElementById("student-avatar-file");
    var reset = document.getElementById("student-avatar-reset");
    if (!input) return;
    input.addEventListener("change", function () {
      var f = input.files && input.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) {
        alert("이미지 파일만 선택할 수 있습니다.");
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        alert("10MB 이하의 이미지만 업로드 가능합니다.");
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var canvas = document.createElement("canvas");
          var maxDim = 128;
          var w = img.width;
          var h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          var base64 = canvas.toDataURL("image/png");

          var db = getDb();
          var st = getStudent(db, studentId);
          if (st) {
            st.avatarCustom = null;
            st.avatarDataUrl = base64;
            saveDb(db, true);
            if (window.ClassStatusServer && window.ClassStatusServer.isServerCloudEnabled()) {
              window.ClassStatusServer.uploadAvatar(studentId, base64, null)
                .catch(function (e) { console.warn("아바타 원격 업로드 실패:", e); });
            }
            alert("아바타가 성공적으로 최적화되어 업로드되었습니다.");
            route();
          }
        };
        img.onerror = function () {
          alert("이미지를 불러올 수 없습니다. 올바른 파일 형식인지 확인해 주세요.");
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(f);
    });
    if (reset) {
      reset.addEventListener("click", function () {
        if (!confirm("기본 아바타로 재설정할까요?")) return;
        var db = getDb();
        var st = getStudent(db, studentId);
        if (st) {
          st.avatarDataUrl = null;
          st.avatarCustom = null;
          saveDb(db, true);
          if (window.ClassStatusServer && window.ClassStatusServer.isServerCloudEnabled()) {
            window.ClassStatusServer.uploadAvatar(studentId, null, null)
              .catch(function (e) { console.warn("아바타 원격 초기화 실패:", e); });
          }
          alert("아바타가 초기화되었습니다.");
          route();
        }
      });
    }
  }

  function autoCompressLargeAvatars(db) {
    if (window.__avatarsCompressedThisSession) return;
    if (!db || !db.students || !Array.isArray(db.students)) return;

    var changed = false;
    var promises = [];

    db.students.forEach(function (st) {
      if (st.avatarDataUrl && st.avatarDataUrl.length > 40000) {
        var promise = new Promise(function (resolve) {
          var img = new Image();
          img.onload = function () {
            var canvas = document.createElement("canvas");
            var maxDim = 128;
            var w = img.width;
            var h = img.height;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            var resizedBase64 = canvas.toDataURL("image/png");

            st.avatarDataUrl = resizedBase64;
            changed = true;
            resolve();
          };
          img.onerror = function () {
            st.avatarDataUrl = null;
            changed = true;
            resolve();
          };
          img.src = st.avatarDataUrl;
        });
        promises.push(promise);
      }
    });

    if (promises.length > 0) {
      window.__avatarsCompressedThisSession = true;
      Promise.all(promises).then(function () {
        if (changed) {
          console.log("[ClassStatus] Automatically compressed bloated student avatars in the background.");
          saveDb(db, true);
          route();
        }
      });
    } else {
      window.__avatarsCompressedThisSession = true;
    }
  }

  function buildTeacherCanteenRevenueJournalHtml(db) {
    ensureCanteenShop(db);
    var logs = db.canteenShop.merchantLog || [];

    // 1. Group logs by date for Daily Summary
    var dailyTotals = {};
    var i;
    for (i = 0; i < logs.length; i++) {
      var e = logs[i];
      var ymd = e.dateYmd || todayYmdLocal();
      if (!dailyTotals[ymd]) {
        dailyTotals[ymd] = 0;
      }
      dailyTotals[ymd] += typeof e.priceCal === "number" ? e.priceCal : 0;
    }

    var sortedDates = Object.keys(dailyTotals).sort(function (a, b) {
      return b.localeCompare(a);
    });

    var dailyRows = sortedDates.length
      ? sortedDates.map(function (date) {
          var formattedDate = date;
          try {
            var parts = date.split("-");
            if (parts.length === 3) {
              formattedDate = parseInt(parts[0], 10) + "년 " + parseInt(parts[1], 10) + "월 " + parseInt(parts[2], 10) + "일";
            }
          } catch (err) {}
          return (
            '<tr>' +
              '<td>' + escapeHtml(formattedDate) + '</td>' +
              '<td class="td-num" style="font-weight: bold; color: var(--primary);">' + formatNum(dailyTotals[date]) + ' Cal</td>' +
            '</tr>'
          );
        }).join("")
      : '<tr><td colspan="2" class="empty-state" style="text-align: center;">매출 기록이 없습니다.</td></tr>';

    // 2. Detailed Transaction Logs
    var sortedLogs = logs.slice().sort(function (a, b) {
      return (b.occurredAt || 0) - (a.occurredAt || 0);
    });

    var detailedRows = sortedLogs.length
      ? sortedLogs.map(function (e) {
          var buyer = getStudent(db, e.buyerStudentId);
          var buyerName = buyer ? escapeHtml(buyer.name) + " (" + escapeHtml(String(buyer.number != null ? buyer.number : "?")) + ")" : "(알 수 없음)";
          var merchant = getStudent(db, e.merchantStudentId);
          var merchantName = merchant ? escapeHtml(merchant.name) : "교사 직접등록";
          var dateStr = fmtTime(e.occurredAt);
          return (
            '<tr>' +
              '<td>' + escapeHtml(dateStr) + '</td>' +
              '<td>' + escapeHtml(e.canteenName) + '</td>' +
              '<td>' + buyerName + '</td>' +
              '<td class="td-num">' + formatNum(e.priceCal) + ' Cal</td>' +
              '<td>' + merchantName + '</td>' +
              '<td>' +
                '<button type="button" class="btn btn--danger btn--xs js-teacher-canteen-cancel" data-order-id="' + escapeHtml(e.orderId || '') + '" data-log-id="' + escapeHtml(e.id) + '">취소</button>' +
              '</td>' +
            '</tr>'
          );
        }).join("")
      : '<tr><td colspan="6" class="empty-state" style="text-align: center;">상세 판매 기록이 없습니다.</td></tr>';

    var totalRevenue = db.canteenShop.treasuryTotal || 0;

    return (
      '<div class="canteen-journal-section stack">' +
        '<div class="journal-summary-cards" style="display: grid; grid-template-columns: 1fr; gap: 1rem; margin-bottom: 1rem;">' +
          '<div class="panel" style="background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: #fff;">' +
            '<h3 style="margin: 0; opacity: 0.9; font-size: 0.9rem;">🪙 매점 누적 총 수입 (국고 귀속)</h3>' +
            '<div style="font-size: 2rem; font-weight: bold; margin-top: 0.5rem;">' + formatNum(totalRevenue) + ' Cal</div>' +
            '<p style="margin: 0.5rem 0 0 0; font-size: 0.8rem; opacity: 0.85;">매점에서 판매 완료된 모든 금액은 자동으로 국고에 보관됩니다.</p>' +
          '</div>' +
        '</div>' +
        '<div style="display: grid; grid-template-columns: 1fr 2fr; gap: 1.5rem; align-items: start;">' +
          '<section class="panel">' +
            '<h2 class="panel__title">📅 일자별 매출 합계</h2>' +
            '<div class="table-wrap"><table class="data"><thead><tr><th>일자</th><th>수입 합계</th></tr></thead><tbody>' +
              dailyRows +
            '</tbody></table></div>' +
          '</section>' +
          '<section class="panel">' +
            '<h2 class="panel__title">📋 상세 판매 누가기록</h2>' +
            '<div class="table-wrap"><table class="data" style="font-size: 0.85rem;"><thead><tr><th>일시</th><th>상품명</th><th>구매자</th><th>판매가</th><th>담당 상인</th><th>작업</th></tr></thead><tbody>' +
              detailedRows +
            '</tbody></table></div>' +
          '</section>' +
        '</div>' +
      '</div>'
    );
  }

  function buildTeacherCanteenShopApprovalHtml(db) {
    ensureCanteenShop(db);

    var pendingOffers = db.canteenShop.pendingOffers.filter(function (o) {
      return o.status === "pending";
    });

    var cards = pendingOffers.length
      ? pendingOffers
          .map(function (o) {
            var m = getStudent(db, o.submittedByStudentId);
            var mn = m ? escapeHtml(m.name) + " (" + escapeHtml(String(m.number != null ? m.number : "?")) + ")" : "?";
            if (o.type === "price_change") {
              var prod = findCanteenProduct(db, o.targetProductId);
              var curPrice = prod ? prod.priceCal : 0;
              return (
                '<article class="bank-payroll-card postman-teacher-card" style="border-left: 4px solid var(--accent2);">' +
                '<div class="panel__text"><strong>[가격 수정] ' + escapeHtml(o.name) + '</strong></div>' +
                '<div class="panel__text">신청 상인: ' + mn + '</div>' +
                '<div class="panel__text">가격: <span style="text-decoration: line-through; color: var(--text-muted);">' + formatNum(curPrice) + ' Cal</span> -> <strong style="color: var(--accent2);">' + formatNum(o.newPriceCal) + ' Cal</strong></div>' +
                '<div class="postman-teacher-actions" style="margin-top: 0.5rem;">' +
                '<button type="button" class="btn btn--primary btn--sm js-canteen-approve" data-offer-id="' + escapeHtml(o.id) + '">승인</button>' +
                '<button type="button" class="btn btn--ghost btn--sm js-canteen-reject" data-offer-id="' + escapeHtml(o.id) + '">반려</button>' +
                '</div></article>'
              );
            } else {
              return (
                '<article class="bank-payroll-card postman-teacher-card">' +
                '<div class="panel__text"><strong>[신규 등록] ' + escapeHtml(o.name) + '</strong></div>' +
                '<div class="panel__text">신청 상인: ' + mn + '</div>' +
                '<div class="panel__text">가격: <strong>' + formatNum(o.priceCal) + ' Cal</strong> / 재고: <strong>' + o.totalStock + '</strong>개</div>' +
                '<div class="postman-teacher-actions" style="margin-top: 0.5rem;">' +
                '<button type="button" class="btn btn--primary btn--sm js-canteen-approve" data-offer-id="' + escapeHtml(o.id) + '">승인</button>' +
                '<button type="button" class="btn btn--ghost btn--sm js-canteen-reject" data-offer-id="' + escapeHtml(o.id) + '">반려</button>' +
                '</div></article>'
              );
            }
          })
          .join("")
      : '<p class="muted">대기 중인 상품 등록/가격 수정 신청이 없습니다.</p>';

    var pendingOrders = (db.canteenShop.orders || []).filter(function (o) {
      return o.status === "pending";
    });

    var pendingRows = pendingOrders.length
      ? pendingOrders.map(function (o) {
          var buyer = getStudent(db, o.buyerStudentId);
          var buyerLabel = buyer ? escapeHtml(buyer.name) + " (" + escapeHtml(String(buyer.number != null ? buyer.number : "?")) + ")" : "(알 수 없음)";
          var rejectBtn = '<button type="button" class="btn btn--ghost btn--xs js-canteen-teacher-reject-order" data-order-id="' + escapeHtml(o.id) + '" style="color: var(--danger); margin-left: 0.25rem;">반려 ❌</button>';
          var actionBtn = '<button type="button" class="btn btn--primary btn--xs js-canteen-teacher-approve-order" data-order-id="' + escapeHtml(o.id) + '">강제 승인 ⚡</button>';
          return (
            '<tr>' +
              '<td>' + buyerLabel + '</td>' +
              '<td>' + escapeHtml(o.productName) + '</td>' +
              '<td class="td-num">' + formatNum(o.priceCal) + ' Cal</td>' +
              '<td><span class="badge" style="background: rgba(255, 193, 7, 0.2); color: #ffc107; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">인도 대기</span></td>' +
              '<td><div style="display: flex; align-items: center;">' + actionBtn + rejectBtn + '</div></td>' +
            '</tr>'
          );
        }).join("")
      : '<tr><td colspan="5" class="empty-state" style="text-align: center;">인도 대기 중인 주문이 없습니다.</td></tr>';

    var pendingOrdersSection = 
      '<section class="panel" style="margin-top: 1.5rem;">' +
      '<h2 class="panel__title">⚡ 매점 주문 인도 대기 목록 (교사 강제 승인 가능)</h2>' +
      '<p class="panel__text">학생이 매점 상품을 주문하고 상인의 승인(실물 인도)을 대기 중인 주문입니다. 교사 권한으로 강제 승인하거나 주문을 반려(취소/환불)할 수 있습니다.</p>' +
      '<div class="table-wrap" style="margin-top: 1rem;"><table class="data" style="font-size: 0.85rem;"><thead><tr><th>구매 학생</th><th>상품</th><th>가격</th><th>상태</th><th>작업</th></tr></thead><tbody>' +
      pendingRows +
      '</tbody></table></div>' +
      '</section>';

    var products = db.canteenShop.products || [];
    var listedRows = products.length
      ? products
          .map(function (p) {
            var m = getStudent(db, p.merchantStudentId);
            var merchantLabel = m
              ? escapeHtml(m.name) + " (" + escapeHtml(String(m.number != null ? m.number : "?")) + ")"
              : "교사 직접등록";
            var remainingQty = p.remainingStock != null ? p.remainingStock : p.totalStock;
            return (
              "<tr><td>" +
              escapeHtml(p.name) +
              "</td><td>" +
              merchantLabel +
              "</td><td class=\"td-num\">" +
              formatNum(p.priceCal) +
              " Cal</td><td class=\"td-num\">" +
              remainingQty +
              " / " +
              p.totalStock +
              "</td><td>" +
              '<button type="button" class="btn btn--danger btn--xs js-canteen-delete" data-product-id="' + escapeHtml(p.id) + '">삭제</button>' +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="5" class="empty-state" style="text-align: center;">판매 중인 매점 상품이 없습니다.</td></tr>';

    var addForm = 
      '<form id="form-teacher-canteen-add" class="form" style="display: flex; gap: 0.6rem; align-items: flex-end; flex-wrap: wrap; margin-bottom: 1rem;">' +
      '<label class="field" style="flex: 2; min-width: 10rem;">상품명<input name="name" type="text" placeholder="예: 초코 우유" required /></label>' +
      '<label class="field" style="flex: 1; min-width: 5rem;">가격 (Cal)<input name="priceCal" type="number" min="1" max="999999" value="100" required /></label>' +
      '<label class="field" style="flex: 1; min-width: 5rem;">등록 수량<input name="totalStock" type="number" min="1" max="9999" value="10" required /></label>' +
      '<button type="submit" class="btn btn--primary" style="height: 2.4rem;">등록</button>' +
      '</form>';

    var journalSection = 
      '<section class="panel" style="margin-top: 1.5rem; grid-column: span 2;">' +
      '<h2 class="panel__title">📈 매점 판매 및 수입 누가기록 (일일 매출 대장)</h2>' +
      buildTeacherCanteenRevenueJournalHtml(db) +
      '</section>';

    return (
      '<div class="teacher-canteen-approval" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: start;">' +
      '<div class="left-section stack">' +
      '<section class="panel">' +
      '<h2 class="panel__title">📝 매점 상품 등록/수정 승인</h2>' +
      '<p class="panel__text">매점 상인이 등록 신청한 신규 상품 또는 가격 수정 요청 목록입니다.</p>' +
      '<div class="bank-payroll-stack" style="margin-top: 1rem;">' +
      cards +
      "</div></section>" +
      pendingOrdersSection +
      '</div>' +
      '<div class="right-section stack">' +
      '<section class="panel">' +
      '<h2 class="panel__title">🛒 현재 판매 중인 매점 상품 목록</h2>' +
      addForm +
      '<div class="table-wrap" style="margin-top: 1rem;"><table class="data"><thead><tr><th>상품명</th><th>등록 상인</th><th>가격</th><th>재고</th><th>작업</th></tr></thead><tbody>' +
      listedRows +
      "</tbody></table></div></section>" +
      '</div>' +
      journalSection +
      '</div>'
    );
  }

  function buildTeacherCouponRevenueJournalHtml(db) {
    ensureCouponShop(db);
    var logs = db.couponShop.merchantLog || [];

    // 1. Group logs by date for Daily Summary
    var dailyTotals = {};
    var i;
    for (i = 0; i < logs.length; i++) {
      var e = logs[i];
      var ymd = e.dateYmd || todayYmdLocal();
      if (!dailyTotals[ymd]) {
        dailyTotals[ymd] = 0;
      }
      dailyTotals[ymd] += typeof e.priceCal === "number" ? e.priceCal : 0;
    }

    var sortedDates = Object.keys(dailyTotals).sort(function (a, b) {
      return b.localeCompare(a);
    });

    var dailyRows = sortedDates.length
      ? sortedDates.map(function (date) {
          var formattedDate = date;
          try {
            var parts = date.split("-");
            if (parts.length === 3) {
              formattedDate = parseInt(parts[0], 10) + "년 " + parseInt(parts[1], 10) + "월 " + parseInt(parts[2], 10) + "일";
            }
          } catch (err) {}
          return (
            '<tr>' +
              '<td>' + escapeHtml(formattedDate) + '</td>' +
              '<td class="td-num" style="font-weight: bold; color: var(--primary);">' + formatNum(dailyTotals[date]) + ' Cal</td>' +
            '</tr>'
          );
        }).join("")
      : '<tr><td colspan="2" class="empty-state" style="text-align: center;">매출 기록이 없습니다.</td></tr>';

    // 2. Detailed Transaction Logs
    var sortedLogs = logs.slice().sort(function (a, b) {
      return (b.occurredAt || 0) - (a.occurredAt || 0);
    });

    var detailedRows = sortedLogs.length
      ? sortedLogs.map(function (e) {
          var buyer = getStudent(db, e.buyerStudentId);
          var buyerName = buyer ? escapeHtml(buyer.name) + " (" + escapeHtml(String(buyer.number != null ? buyer.number : "?")) + ")" : "(알 수 없음)";
          var dateStr = fmtTime(e.occurredAt);
          
          var mer = getStudent(db, e.merchantStudentId);
          var merchantName = mer ? escapeHtml(mer.name) : '<span style="color: var(--accent2); font-weight: bold;">선생님 직접 등록</span>';
          
          return (
            '<tr>' +
              '<td>' + escapeHtml(dateStr) + '</td>' +
              '<td>' + escapeHtml(e.couponName || "") + '</td>' +
              '<td>' + buyerName + '</td>' +
              '<td>' + merchantName + '</td>' +
              '<td class="td-num">' + formatNum(e.priceCal) + ' Cal</td>' +
              '<td>' +
                '<button type="button" class="btn btn--danger btn--xs js-teacher-coupon-cancel" data-rental-id="' + escapeHtml(e.rentalId || '') + '" data-log-id="' + escapeHtml(e.id) + '">취소</button>' +
              '</td>' +
            '</tr>'
          );
        }).join("")
      : '<tr><td colspan="6" class="empty-state" style="text-align: center;">상세 대여 기록이 없습니다.</td></tr>';

    var totalRevenue = db.couponShop.treasuryTotal || 0;

    return (
      '<div class="coupon-journal-section stack" style="margin-top: 1.5rem;">' +
        '<div class="journal-summary-cards" style="display: grid; grid-template-columns: 1fr; gap: 1rem; margin-bottom: 1rem;">' +
          '<div class="panel" style="background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); color: #fff;">' +
            '<h3 style="margin: 0; opacity: 0.9; font-size: 0.9rem;">🪙 쿠폰 누적 총 대여 수입</h3>' +
            '<div style="font-size: 2rem; font-weight: bold; margin-top: 0.5rem;">' + formatNum(totalRevenue) + ' Cal</div>' +
            '<p style="margin: 0.5rem 0 0 0; font-size: 0.8rem; opacity: 0.85;">쿠폰 대여로 발생한 누적 수입 금액입니다. (국고 적립)</p>' +
          '</div>' +
        '</div>' +
        '<div style="display: grid; grid-template-columns: 1fr 2fr; gap: 1.5rem; align-items: start;">' +
          '<section class="panel">' +
            '<h2 class="panel__title">📅 일자별 대여 수입 합계</h2>' +
            '<div class="table-wrap"><table class="data"><thead><tr><th>일자</th><th>수입 합계</th></tr></thead><tbody>' +
              dailyRows +
            '</tbody></table></div>' +
          '</section>' +
          '<section class="panel">' +
            '<h2 class="panel__title">📋 상세 대여 누가기록</h2>' +
            '<div class="table-wrap"><table class="data" style="font-size: 0.85rem;"><thead><tr><th>일시</th><th>쿠폰명</th><th>대여자</th><th>상인</th><th>대여료</th><th>작업</th></tr></thead><tbody>' +
              detailedRows +
            '</tbody></table></div>' +
          '</section>' +
        '</div>' +
      '</div>'
    );
  }

  function buildTeacherCouponShopApprovalHtml(db) {
    ensureCouponShop(db);

    var pendingOffers = db.couponShop.pendingOffers.filter(function (o) {
      return o.status === "pending";
    });

    var cards = pendingOffers.length
      ? pendingOffers
          .map(function (o) {
            var m = getStudent(db, o.submittedByStudentId);
            var mn = m ? escapeHtml(m.name) + " (" + escapeHtml(String(m.number != null ? m.number : "?")) + ")" : "?";
            if (o.type === "price_change") {
              var prod = findCouponProduct(db, o.targetProductId);
              var curPrice = prod ? prod.priceCal : 0;
              return (
                '<article class="bank-payroll-card postman-teacher-card" style="border-left: 4px solid var(--accent2);">' +
                '<div class="panel__text"><strong>[가격 수정] ' + escapeHtml(o.name) + '</strong></div>' +
                '<div class="panel__text">신청자: ' + mn + '</div>' +
                '<div class="panel__text">가격: <span style="text-decoration: line-through; color: var(--text-muted);">' + formatNum(curPrice) + ' Cal</span> -> <strong style="color: var(--accent2);">' + formatNum(o.newPriceCal) + ' Cal</strong></div>' +
                '<div class="postman-teacher-actions" style="margin-top: 0.5rem;">' +
                '<button type="button" class="btn btn--primary btn--sm js-coupon-approve" data-offer-id="' + escapeHtml(o.id) + '">승인</button>' +
                '<button type="button" class="btn btn--ghost btn--sm js-coupon-reject" data-offer-id="' + escapeHtml(o.id) + '">반려</button>' +
                '</div></article>'
              );
            } else {
              var groupText = o.isGroup ? ' <span class="badge" style="background: rgba(220, 53, 69, 0.2); color: #dc3545; border: 1px solid rgba(220,53,69,0.4); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.75rem;">단체권 (목표: ' + o.groupTargetCount + '명)</span>' : '';
              return (
                '<article class="bank-payroll-card postman-teacher-card">' +
                '<div class="panel__text"><strong>[신규 등록] ' + escapeHtml(o.name) + '</strong>' + groupText + '</div>' +
                '<div class="panel__text">신청자: ' + mn + '</div>' +
                '<div class="panel__text">가격: <strong>' + formatNum(o.priceCal) + ' Cal</strong>' + (o.isGroup ? ' (1인당 ' + formatNum(Math.ceil(o.priceCal / o.groupTargetCount)) + ' Cal)' : '') + ' / 수량: <strong>' + o.totalStock + '</strong>개</div>' +
                '<div class="postman-teacher-actions" style="margin-top: 0.5rem;">' +
                '<button type="button" class="btn btn--primary btn--sm js-coupon-approve" data-offer-id="' + escapeHtml(o.id) + '">승인</button>' +
                '<button type="button" class="btn btn--ghost btn--sm js-coupon-reject" data-offer-id="' + escapeHtml(o.id) + '">반려</button>' +
                '</div></article>'
              );
            }
          })
          .join("")
      : '<p class="muted">대기 중인 상품 등록/가격 수정 신청이 없습니다.</p>';

    var rentals = db.couponShop.rentals || [];
    
    var merchantApprovedUse = rentals.filter(function (r) {
      return r.status === "merchant_approved";
    });
    
    var pendingMerchantUse = rentals.filter(function (r) {
      return r.status === "use_requested";
    });

    var approvedRows = merchantApprovedUse.length
      ? merchantApprovedUse
          .map(function (r) {
            var s = getStudent(db, r.studentId);
            var sn = s ? escapeHtml(s.name) + " (" + escapeHtml(String(s.number != null ? s.number : "?")) + ")" : "?";
            var actionBtn = '<button type="button" class="btn btn--primary btn--xs js-coupon-teacher-approve-use" data-rental-id="' + escapeHtml(r.id) + '">최종 사용 승인 ✅</button>';
            var rejectBtn = '<button type="button" class="btn btn--ghost btn--xs js-coupon-teacher-reject-use" data-rental-id="' + escapeHtml(r.id) + '" style="color: var(--danger); margin-left: 0.25rem;">반려 ❌</button>';
            return (
              "<tr><td>" +
              sn +
              "</td><td>" +
              escapeHtml(r.couponName) +
              "</td><td>상인 승인완료</td><td>" +
              actionBtn + rejectBtn +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="4" class="empty-state" style="text-align: center;">승인 대기 중인 사용 요청이 없습니다.</td></tr>';

    var pendingRows = pendingMerchantUse.length
      ? pendingMerchantUse
          .map(function (r) {
            var s = getStudent(db, r.studentId);
            var sn = s ? escapeHtml(s.name) + " (" + escapeHtml(String(s.number != null ? s.number : "?")) + ")" : "?";
            var actionBtn = '<button type="button" class="btn btn--accent btn--xs js-coupon-teacher-approve-use" data-rental-id="' + escapeHtml(r.id) + '">강제 사용 승인 ⚡</button>';
            var rejectBtn = '<button type="button" class="btn btn--ghost btn--xs js-coupon-teacher-reject-use" data-rental-id="' + escapeHtml(r.id) + '" style="color: var(--danger); margin-left: 0.25rem;">반려 ❌</button>';
            return (
              "<tr><td>" +
              sn +
              "</td><td>" +
              escapeHtml(r.couponName) +
              "</td><td>상인 대기중</td><td>" +
              actionBtn + rejectBtn +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="4" class="empty-state" style="text-align: center;">강제 승인이 필요한 요청이 없습니다.</td></tr>';

    var approvedSection = 
      '<section class="panel" style="margin-top: 1.5rem;">' +
      '<h2 class="panel__title">✅ 최종 사용 승인 대기 목록 (상인 승인완료)</h2>' +
      '<p class="panel__text">쿠폰 상인이 1차 승인하여 최종 사용 승인을 기다리는 쿠폰입니다.</p>' +
      '<div class="table-wrap" style="margin-top: 1rem;"><table class="data" style="font-size: 0.85rem;"><thead><tr><th>학생</th><th>쿠폰명</th><th>상태</th><th>작업</th></tr></thead><tbody>' +
      approvedRows +
      '</tbody></table></div>' +
      '</section>';

    var pendingSection = 
      '<section class="panel" style="margin-top: 1.5rem;">' +
      '<h2 class="panel__title">⚡ 강제 사용 승인 대기 목록 (상인 대기중)</h2>' +
      '<p class="panel__text">학생이 사용을 신청했으나 쿠폰 상인이 아직 승인하지 않은 상태입니다. 교사가 직접 강제 승인할 수 있습니다.</p>' +
      '<div class="table-wrap" style="margin-top: 1rem;"><table class="data" style="font-size: 0.85rem;"><thead><tr><th>학생</th><th>쿠폰명</th><th>상태</th><th>작업</th></tr></thead><tbody>' +
      pendingRows +
      '</tbody></table></div>' +
      '</section>';

    var products = db.couponShop.products || [];
    var listedRows = products.length
      ? products
          .map(function (p) {
            var m = getStudent(db, p.merchantStudentId);
            var merchantLabel = m
              ? escapeHtml(m.name) + " (" + escapeHtml(String(m.number != null ? m.number : "?")) + ")"
              : "교사 등록";
            var remainingQty = p.remainingStock != null ? p.remainingStock : p.totalStock;
            return (
              "<tr><td>" +
              escapeHtml(p.name) +
              "</td><td>" +
              merchantLabel +
              "</td><td class=\"td-num\">" +
              formatNum(p.priceCal) +
              " Cal</td><td class=\"td-num\">" +
              remainingQty +
              " / " +
              p.totalStock +
              "</td><td>" +
              '<button type="button" class="btn btn--danger btn--xs js-coupon-delete" data-product-id="' + escapeHtml(p.id) + '">삭제</button>' +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="5" class="empty-state" style="text-align: center;">등록된 쿠폰 상품이 없습니다.</td></tr>';

    var addForm = 
      '<form id="form-teacher-coupon-add" class="form" style="display: flex; gap: 0.6rem; align-items: flex-end; flex-wrap: wrap; margin-bottom: 1rem;">' +
      '<label class="field" style="flex: 2; min-width: 10rem;">쿠폰 이름<input name="name" type="text" placeholder="예: 1인 1역 면제권" required /></label>' +
      '<label class="field" style="flex: 1; min-width: 5rem;">가격 (Cal)<input name="priceCal" type="number" min="1" max="999999" value="100" required /></label>' +
      '<label class="field" style="flex: 1; min-width: 5rem;">발행 수량<input name="totalStock" type="number" min="1" max="9999" value="10" required /></label>' +
      '<button type="submit" class="btn btn--primary" style="height: 2.4rem;">등록</button>' +
      '</form>';

    var holdersSection = 
      '<section class="panel" style="margin-top: 1.5rem;">' +
      '<h2 class="panel__title">👥 우리반 쿠폰 대여 현황판</h2>' +
      '<p class="panel__text">학급 학생들이 현재 보유(대여) 중인 쿠폰 목록과 사용 상태입니다.</p>' +
      buildCouponHoldersSectionHtml(db) +
      '</section>';

    return (
      '<div class="coupon-shop-teacher-root" style="display: flex; flex-direction: column; gap: 1.5rem;">' +
        '<div class="teacher-coupon-approval" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: start;">' +
          '<div class="left-section stack">' +
            '<section class="panel">' +
              '<h2 class="panel__title">📝 쿠폰 등록/가격 수정 승인</h2>' +
              '<p class="panel__text">상인이 등록을 신청한 쿠폰 또는 가격 수정 요청 대기 목록입니다.</p>' +
              '<div class="bank-payroll-stack" style="margin-top: 1rem;">' +
                cards +
              '</div>' +
            '</section>' +
            approvedSection +
            pendingSection +
          '</div>' +
          '<div class="right-section stack">' +
            '<section class="panel">' +
              '<h2 class="panel__title">🎟️ 현재 판매 중인 쿠폰 목록</h2>' +
              addForm +
              '<div class="table-wrap" style="margin-top: 1rem;">' +
                '<table class="data">' +
                  '<thead><tr><th>쿠폰 이름</th><th>등록자</th><th>가격</th><th>남은 수량</th><th>작업</th></tr></thead>' +
                  '<tbody>' + listedRows + '</tbody>' +
                '</table>' +
              '</div>' +
            '</section>' +
            holdersSection +
          '</div>' +
        '</div>' +
        buildTeacherCouponRevenueJournalHtml(db) +
      '</div>'
    );
  }

  function buildCanteenShopStudentHtml(db, viewerStudentId, opts) {
    opts = opts || {};
    if (!db) {
      return '<p class="panel__text">데이터를 불러올 수 없습니다.</p>';
    }
    ensureCanteenShop(db);
    var preview = opts.preview === true;
    var viewer = getStudent(db, viewerStudentId);
    var prevNote = preview
      ? '<p class="panel__text muted">미리보기에서는 구매할 수 없습니다.</p>'
      : "";
    var products = db.canteenShop.products.slice().sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    var cards = products.length
      ? products
          .map(function (p) {
            var mer = getStudent(db, p.merchantStudentId);
            var merN = mer ? escapeHtml(mer.name) : '<span style="color: var(--accent2); font-weight: bold;">선생님 직접 등록</span>';
            var dis = preview ? " disabled" : "";
            return (
              '<article class="coupon-product-card">' +
              '<div class="coupon-product-card__head">' +
              '<h3 class="coupon-product-card__name">' +
              escapeHtml(p.name) +
              "</h3>" +
              '<div class="coupon-product-card__stock">' +
              "남음 <strong>" +
              p.remainingStock +
              "</strong> / 총 <strong>" +
              p.totalStock +
              "</strong></div></div>" +
              '<p class="coupon-product-card__meta muted">가격 <strong>' +
              formatNum(p.priceCal) +
              " Cal</strong> · 상인 " +
              merN +
              "</p>" +
              '<button type="button" class="btn btn--primary btn--sm js-canteen-buy"' +
              dis +
              ' data-product-id="' +
              escapeHtml(p.id) +
              '"' +
              (p.remainingStock <= 0 ? " disabled" : "") +
              ">구매하기</button></article>"
            );
          })
          .join("")
      : '<p class="muted">판매 중인 매점 상품이 없습니다. 매점상인이 등록하고 선생님이 승인한 뒤 이용할 수 있습니다.</p>';

    var myOrders = [];
    if (viewerStudentId && !preview) {
      myOrders = (db.canteenShop.orders || []).filter(function (o) {
        return o.buyerStudentId === viewerStudentId;
      });
      myOrders.sort(function (a, b) {
        return (b.occurredAt || 0) - (a.occurredAt || 0);
      });
    }

    var orderListRows = myOrders.length
      ? myOrders.map(function (o) {
          var statusLabel = "";
          if (o.status === "pending") {
            statusLabel = '<span class="badge" style="background: rgba(255, 193, 7, 0.2); color: #ffc107;">인도 대기 중 ⏳</span>';
          } else if (o.status === "completed") {
            statusLabel = '<span class="badge" style="background: rgba(40, 167, 69, 0.2); color: #28a745;">인도 완료 ✅</span>';
          } else if (o.status === "cancelled") {
            statusLabel = '<span class="badge" style="background: rgba(220, 53, 69, 0.2); color: #dc3545;">주문 반려 (환불됨) ❌</span>';
          }
          return (
            '<tr>' +
              '<td>' + escapeHtml(o.productName) + '</td>' +
              '<td class="td-num">' + formatNum(o.priceCal) + ' Cal</td>' +
              '<td>' + fmtTime(o.occurredAt) + '</td>' +
              '<td>' + statusLabel + '</td>' +
            '</tr>'
          );
        }).join("")
      : '<tr><td colspan="4" class="empty-state">구매(주문) 내역이 없습니다.</td></tr>';

    var myOrdersSection = "";
    if (viewerStudentId && !preview) {
      myOrdersSection = 
        '<section class="panel">' +
        '<h2 class="panel__title">🛍️ 나의 매점 주문 내역</h2>' +
        '<p class="panel__text">매점에서 상품을 구매한 내역과 인도 상태를 확인할 수 있습니다.</p>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>상품명</th><th>가격</th><th>구매 일시</th><th>상태</th></tr></thead><tbody>' +
        orderListRows +
        '</tbody></table></div>' +
        '</section>';
    }

    return (
      '<div class="coupon-shop-root">' +
      prevNote +
      '<section class="panel">' +
      '<h2 class="panel__title">매점 상품 목록</h2>' +
      '<div class="coupon-product-grid">' +
      cards +
      "</div></section>" +
      myOrdersSection +
      (viewer
        ? '<p class="muted coupon-shop-foot">내 Calory: <strong>' +
          formatNum(studentCaloryBalance(viewer)) +
          " Cal</strong> · 매점 매출은 우리반 세금(국고) 총액에 더해집니다.</p>"
        : "") +
      "</div>"
    );
  }

  function formatNum(n) {
    var x = typeof n === "number" && !isNaN(n) ? n : 0;
    var parts = String(x).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function studentCaloryBalance(s) {
    if (!s) return 0;
    var c = s.calory;
    return typeof c === "number" && !isNaN(c) ? Math.floor(c) : 0;
  }

  /** 주급 요청 줄: 요청 시점에 저장한 잔액, 없으면 현재 DB 기준 */
  function payrollLineBalanceBefore(db, ln) {
    if (ln && typeof ln.balanceBefore === "number" && !isNaN(ln.balanceBefore)) {
      return Math.floor(ln.balanceBefore);
    }
    var s = ln && ln.studentId ? getStudent(db, ln.studentId) : null;
    return studentCaloryBalance(s);
  }

  function renderStudentCardHtml(s) {
    var seg = expPercentProgress(s.exp);
    var jd = getJobDef(s.jobId);
    var jobLine = jd
      ? '<div class="student-card__job" title="1인 1역"><span class="student-card__job-ico" aria-hidden="true">' +
        jd.icon +
        "</span> " +
        escapeHtml(jd.label) +
        "</div>"
      : '<div class="student-card__job student-card__job--empty muted">직업 미배정</div>';
    return (
      '<article class="student-card">' +
      '<label class="student-card__pick">' +
      '<input type="checkbox" class="js-bulk" data-id="' +
      escapeHtml(s.id) +
      '" />' +
      "</label>" +
      studentCardAvatar(s) +
      '<div class="student-card__lv">Lv. ' +
      s.lv +
      "</div>" +
      '<div class="student-card__id">' +
      escapeHtml(s.name) +
      (s.classRole === "president" ? ' <span class="role-badge role-badge--president" style="font-size:0.75rem; padding: 0.1rem 0.3rem; border-radius: 4px; background: #e53935; color: white; margin-left: 0.25rem; font-weight: bold; vertical-align: middle;">👑 회장</span>' :
       s.classRole === "vice_president" ? ' <span class="role-badge role-badge--vice-president" style="font-size:0.75rem; padding: 0.1rem 0.3rem; border-radius: 4px; background: #fb8c00; color: white; margin-left: 0.25rem; font-weight: bold; vertical-align: middle;">⚡ 부회장</span>' : "") +
      ' <span class="student-card__num">#' +
      escapeHtml(String(s.number)) +
      "</span></div>" +
      jobLine +
      '<div class="student-card__cal"><span class="student-card__cal-ico" aria-hidden="true">◆</span> ' +
      formatNum(s.calory) +
      " Cal</div>" +
      '<div class="student-card__expwrap">' +
      '<div class="student-card__exptxt">' +
      Math.round(seg.current) +
      "% EXP</div>" +
      '<div class="student-card__expbar"><div class="student-card__expfill" style="width:' +
      Math.min(100, Math.max(0, seg.pct)) +
      '%"></div></div></div>' +
      '<div class="student-card__links">' +
      '<a href="#/teacher/students/' +
      encodeURIComponent(s.id) +
      '/status">보드</a>' +
      '<a href="#/teacher/students/' +
      encodeURIComponent(s.id) +
      '">상세</a>' +
      '<button type="button" class="btn btn--ghost btn--sm student-card__del js-student-delete" data-id="' +
      escapeHtml(s.id) +
      '" data-name="' +
      escapeHtml(s.name) +
      '">삭제</button>' +
      "</div></article>"
    );
  }

  function buildCouponHoldersSectionHtml(db) {
    ensureCouponShop(db);
    var products = db.couponShop.products.slice().sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    if (!products.length) {
      return '<p class="muted">아직 판매 중인 쿠폰이 없습니다.</p>';
    }
    var blocks = [];
    var pi;
    for (pi = 0; pi < products.length; pi++) {
      var p = products[pi];
      var activeRentals = (db.couponShop.rentals || []).filter(function (r) {
        return r.productId === p.id && (r.status === "held" || r.status === "use_requested" || r.status === "merchant_approved");
      });
      var rows = activeRentals.map(function (r) {
        var st = getStudent(db, r.studentId);
        var numStr = st && st.number != null ? st.number : "—";
        var statusLabel = "";
        if (r.status === "held") statusLabel = '<span class="badge" style="background: rgba(40, 167, 69, 0.2); color: #28a745; font-size: 0.75rem;">보유 중</span>';
        else if (r.status === "use_requested") statusLabel = '<span class="badge" style="background: rgba(255, 193, 7, 0.2); color: #ffc107; font-size: 0.75rem;">상인 승인 대기</span>';
        else if (r.status === "merchant_approved") statusLabel = '<span class="badge" style="background: rgba(23, 162, 184, 0.2); color: #17a2b8; font-size: 0.75rem;">최종 승인 대기</span>';
        return (
          "<tr><td>" +
            escapeHtml(String(numStr)) +
            "</td><td>" +
            escapeHtml(r.studentName) +
            "</td><td>" +
            statusLabel +
            "</td></tr>"
        );
      });
      blocks.push(
        '<div class="coupon-holders-block">' +
          '<h4 class="coupon-holders-block__title">' +
          escapeHtml(p.name) +
          "</h4>" +
          (rows.length
            ? '<div class="table-wrap"><table class="data data--compact"><thead><tr><th>번호</th><th>이름</th><th>상태</th></tr></thead><tbody>' +
              rows.join("") +
              "</tbody></table></div>"
            : '<p class="muted coupon-holders-block__empty">아직 대여 중인 학생이 없습니다.</p>') +
          "</div>"
      );
    }
    return blocks.join("");
  }

  function buildMyCouponRentalsHtml(db, studentId) {
    ensureCouponShop(db);
    var myRentals = (db.couponShop.rentals || []).filter(function (r) {
      return r.studentId === studentId && (r.status === "held" || r.status === "use_requested" || r.status === "merchant_approved");
    });
    if (!myRentals.length) {
      return '<p class="muted">내가 현재 대여 중인 쿠폰이 없습니다.</p>';
    }

    var listHtml = myRentals.map(function (r) {
      var actionBtn = "";
      var statusLabel = "";
      if (r.status === "held") {
        actionBtn = '<button type="button" class="btn btn--sm btn--primary js-coupon-use-request" data-rental-id="' + escapeHtml(r.id) + '">사용 신청 🎫</button>';
        statusLabel = '<span class="badge" style="background: rgba(40, 167, 69, 0.2); color: #28a745; font-size: 0.85rem; padding: 0.2rem 0.5rem; border-radius: 4px;">보유 중 (미사용)</span>';
      } else if (r.status === "use_requested") {
        statusLabel = '<span class="badge" style="background: rgba(255, 193, 7, 0.2); color: #ffc107; font-size: 0.85rem; padding: 0.2rem 0.5rem; border-radius: 4px;">상인 승인 대기 중 ⏳</span>';
      } else if (r.status === "merchant_approved") {
        statusLabel = '<span class="badge" style="background: rgba(23, 162, 184, 0.2); color: #17a2b8; font-size: 0.85rem; padding: 0.2rem 0.5rem; border-radius: 4px;">선생님 최종 승인 대기 중 ⏳</span>';
      }

      return (
        '<div class="my-coupon-rental-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border: 1px solid rgba(255,255,255,0.1); border-radius: var(--radius); background: rgba(255,255,255,0.02);">' +
          '<div>' +
            '<strong style="font-size: 1rem; color: var(--accent2);">' + escapeHtml(r.couponName) + '</strong>' +
            '<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">대여일: ' + fmtTime(r.rentedAt) + '</div>' +
          '</div>' +
          '<div style="display: flex; align-items: center; gap: 0.5rem;">' +
            statusLabel +
            actionBtn +
          '</div>' +
        '</div>'
      );
    }).join('<div style="height: 0.5rem;"></div>');

    return '<div class="stack">' + listHtml + '</div>';
  }

  function buildCouponShopStudentHtml(db, viewerStudentId, opts) {

    opts = opts || {};

    if (!db) {

      return '<p class="panel__text">데이터를 불러올 수 없습니다.</p>';

    }

    ensureCouponShop(db);

    var preview = opts.preview === true;

    var viewer = getStudent(db, viewerStudentId);

    var prevNote = preview

      ? '<p class="panel__text muted">미리보기에서는 대여(구매)할 수 없습니다.</p>'

      : "";

    var products = db.couponShop.products.slice().sort(function (a, b) {

      return String(a.name || "").localeCompare(String(b.name || ""));

    });

    var cards = products.length
      ? products
          .map(function (p) {
            var mer = getStudent(db, p.merchantStudentId);
            var merN = mer ? mer.name : "—";
            var dis = preview ? " disabled" : "";

            var activeRentalsForProd = (db.couponShop.rentals || []).filter(function (r) {
              return r.productId === p.id && (r.status === "held" || r.status === "use_requested" || r.status === "merchant_approved");
            });
            var remainingQty = p.totalStock - activeRentalsForProd.length;
            if (remainingQty < 0) remainingQty = 0;

            var holdersText = "";
            if (activeRentalsForProd.length > 0) {
              holdersText = '<p class="coupon-product-card__meta muted" style="font-size: 0.8rem; margin: 0.35rem 0; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.35rem;">대여 중인 학생: ' +
                activeRentalsForProd.map(function (r) {
                  var statusLabel = "";
                  if (r.status === "held") statusLabel = "보유";
                  else if (r.status === "use_requested") statusLabel = "상인대기";
                  else if (r.status === "merchant_approved") statusLabel = "교사대기";
                  return '<strong>' + escapeHtml(r.studentName) + '</strong>(' + statusLabel + ')';
                }).join(", ") +
                '</p>';
            } else {
              holdersText = '<p class="coupon-product-card__meta muted" style="font-size: 0.8rem; margin: 0.35rem 0; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 0.35rem;">대여자: 없음</p>';
            }

            var descHtml = "";
            if (p.desc) {
              var fullDesc = p.desc;
              var isLong = fullDesc.length > 30;
              if (isLong) {
                var shortDesc = fullDesc.substring(0, 30) + "...";
                descHtml = '<div class="coupon-product-card__desc-wrapper" style="margin: 0.4rem 0; font-size: 0.85rem; line-height: 1.4; color: #ddd; background: rgba(255,255,255,0.05); padding: 0.4rem; border-radius: 4px;">' +
                  '소개: <span class="js-coupon-desc-text" data-full="' + escapeHtml(fullDesc) + '" data-short="' + escapeHtml(shortDesc) + '" data-expanded="false">' + escapeHtml(shortDesc) + '</span>' +
                  '<button type="button" class="js-coupon-desc-toggle" style="background:none; border:none; color:#10b981; padding:0; font-size:0.8rem; margin-left:0.35rem; cursor:pointer; text-decoration:underline;">더보기</button>' +
                  '</div>';
              } else {
                descHtml = '<div style="margin: 0.4rem 0; font-size: 0.85rem; line-height: 1.4; color: #ddd; background: rgba(255,255,255,0.05); padding: 0.4rem; border-radius: 4px;">' +
                  '소개: <span>' + escapeHtml(fullDesc) + '</span>' +
                  '</div>';
              }
            }

            var groupBadge = p.isGroup ? '<span class="badge" style="background: rgba(220, 53, 69, 0.2); color: #dc3545; border: 1px solid rgba(220,53,69,0.4); padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; margin-right: 0.35rem; vertical-align: middle;">단체권</span>' : "";
            var priceText = '가격 <strong>' + formatNum(p.priceCal) + ' Cal</strong>';
            var groupProgressHtml = "";
            var btnText = "구매(대여)하기";
            var btnDisabledAttr = "";

            if (p.isGroup) {
              var sharePrice = Math.ceil(p.priceCal / p.groupTargetCount);
              priceText = '가격 <strong>' + formatNum(p.priceCal) + ' Cal</strong> <span style="font-size: 0.8rem; color: #ffc107; font-weight: normal;">(1인당 ' + formatNum(sharePrice) + ' Cal)</span>';
              
              var contribCount = p.groupContributors ? p.groupContributors.length : 0;
              var contributorNames = "";
              if (contribCount > 0) {
                contributorNames = p.groupContributors.map(function (cid) {
                  var cs = getStudent(db, cid);
                  return cs ? cs.name : cid;
                }).join(", ");
              }
              
              groupProgressHtml = '<div style="margin: 0.5rem 0; font-size: 0.82rem; background: rgba(255,255,255,0.03); padding: 0.5rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">' +
                '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">' +
                  '<span style="color: #bbb; font-weight: 500;">👥 공동 구매 참여 현황</span>' +
                  '<strong style="color: var(--accent2);">' + contribCount + ' / ' + p.groupTargetCount + ' 명</strong>' +
                '</div>' +
                '<div style="height: 6px; background: rgba(0,0,0,0.3); border-radius: 3px; overflow: hidden; margin: 0.35rem 0;">' +
                  '<div style="height: 100%; width: ' + Math.min(100, Math.floor((contribCount / p.groupTargetCount) * 100)) + '%; background: var(--accent2); border-radius: 3px; transition: width 0.3s ease;"></div>' +
                '</div>' +
                (contribCount > 0 ? '<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; word-break: break-all;">참여자: ' + escapeHtml(contributorNames) + '</div>' : '<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; font-style: italic;">아직 참여자가 없습니다. 첫 번째 참여자가 되어보세요!</div>') +
              '</div>';

              var hasContributed = p.groupContributors && p.groupContributors.indexOf(viewerStudentId) !== -1;
              if (remainingQty <= 0) {
                btnText = "대여 중";
                btnDisabledAttr = " disabled";
              } else if (hasContributed) {
                btnText = "참여 완료 (모금 대기 중) ⏳";
                btnDisabledAttr = " disabled";
              } else {
                btnText = "공동 구매 참여 (" + formatNum(sharePrice) + " Cal)";
              }
            } else {
              if (remainingQty <= 0) {
                btnText = "대여 중";
                btnDisabledAttr = " disabled";
              }
            }

            return (
              '<article class="coupon-product-card">' +
              '<div class="coupon-product-card__head">' +
              '<h3 class="coupon-product-card__name">' +
              groupBadge +
              escapeHtml(p.name) +
              "</h3>" +
              '<div class="coupon-product-card__stock">' +
              "남음 <strong>" +
              remainingQty +
              "</strong> / 총 <strong>" +
              p.totalStock +
              "</strong></div></div>" +
              '<p class="coupon-product-card__meta muted">' + priceText + ' · 상인 ' + escapeHtml(merN) + "</p>" +
              descHtml +
              groupProgressHtml +
              holdersText +
              '<button type="button" class="btn btn--primary btn--sm js-coupon-buy"' +
              dis +
              ' data-product-id="' +
              escapeHtml(p.id) +
              '"' +
              btnDisabledAttr +
              ">" + btnText + "</button></article>"
            );
          })
          .join("")
      : '<p class="muted">판매 중인 쿠폰이 없습니다. 쿠폰상인이 등록하고 선생님이 승인한 뒤 이용할 수 있습니다.</p>';



    var myRentalsSection = "";

    if (viewer && !preview) {

      myRentalsSection =

        '<section class="panel">' +

        '<h2 class="panel__title">나의 대여 중인 쿠폰</h2>' +

        buildMyCouponRentalsHtml(db, viewerStudentId) +

        '</section>';

    }



    var holders = buildCouponHoldersSectionHtml(db);

    return (

      '<div class="coupon-shop-root stack">' +

      prevNote +

      '<section class="panel">' +

      '<h2 class="panel__title">쿠폰 목록 (대여 방식)</h2>' +

      '<p class="panel__text">쿠폰은 전체 수량이 정해져 있으며 대여해가는 개념입니다. 사용이 완료되면 대여 가능 수량이 복구됩니다.</p>' +

      '<div class="coupon-product-grid" style="margin-top: 1rem;">' +

      cards +

      "</div></section>" +

      myRentalsSection +

      '<section class="panel">' +

      '<h2 class="panel__title">우리반 쿠폰 대여 현황판</h2>' +

      holders +

      "</section>" +

      (viewer

        ? '<p class="muted coupon-shop-foot">내 Calory: <strong>' +

          formatNum(studentCaloryBalance(viewer)) +

          " Cal</strong> · 쿠폰 대여 Calory는 우리반 국고(세금 총액)에 적립됩니다.</p>"

        : "") +

      "</div>"

    );

  }



  function buildCouponMerchantLogTableHtml(db, merchantStudentId) {
    ensureCouponShop(db);
    var productIds = {};
    var i;
    for (i = 0; i < db.couponShop.products.length; i++) {
      var pr = db.couponShop.products[i];
      productIds[pr.id] = true; // Unified: Remove merchantStudentId constraint
    }

    var entries = db.couponShop.merchantLog.filter(function (e) {
      return e && productIds[e.productId];
    });

    entries.sort(function (a, b) {
      return (b.occurredAt || 0) - (a.occurredAt || 0);
    });

    var rows = entries.length
      ? entries
          .map(function (e) {
            var by = getStudent(db, e.buyerStudentId);
            var buyerLabel = by
              ? escapeHtml(by.name) + " (" + escapeHtml(String(by.number != null ? by.number : "—")) + ")"
              : "(알 수 없음)";
            var dLabel = e.dateYmd ? formatYmdLongKo(e.dateYmd) : "—";
            return (
              "<tr><td>" +
              escapeHtml(dLabel) +
              "</td><td>" +
              escapeHtml(e.couponName || "") +
              "</td><td>" +
              buyerLabel +
              "</td><td class=\"td-num\">" +
              formatNum(e.priceCal) +
              " Cal</td><td>" +
              '<button type="button" class="btn btn--danger btn--xs js-coupon-merchant-cancel" data-rental-id="' + escapeHtml(e.rentalId || '') + '" data-log-id="' + escapeHtml(e.id) + '">구매취소</button>' +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="5" class="empty-state">아직 판매 기록이 없습니다.</td></tr>';

    return (
      '<div class="coupon-merchant-journal">' +
      '<div class="coupon-merchant-journal__banner">' +
      '<h2 class="coupon-merchant-journal__title">쿠폰 상인의 쿠폰 정리</h2>' +
      "</div>" +
      '<div class="table-wrap">' +
      '<table class="data coupon-merchant-journal-table">' +
      "<thead><tr><th>날짜</th><th>구매 쿠폰</th><th>구매자</th><th>구입금액</th><th>작업</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div></div>"
    );
  }



  function buildCouponMerchantStudentHtml(db, merchantStudentId, opts) {
    opts = opts || {};
    var preview = opts.preview === true;
    ensureCouponShop(db);

    var pending = db.couponShop.pendingOffers.filter(function (o) {
      return o.status === "pending"; // Unified: view all pending offers
    });

    var myProducts = db.couponShop.products || []; // Unified: view all products

    var pendRows = pending.length
      ? pending
          .map(function (o) {
            var typeLabel = o.type === "price_change" ? '<span class="badge" style="background: rgba(255, 193, 7, 0.2); color: #ffc107;">가격변경 대기</span>' : '<span class="badge" style="background: rgba(0, 188, 212, 0.2); color: #00bcd4;">신규등록 대기</span>';
            var priceDisplay = o.type === "price_change" ? formatNum(o.newPriceCal) + " Cal" : formatNum(o.priceCal) + " Cal";
            var stockDisplay = o.type === "price_change" ? "—" : o.totalStock + "개";
            var groupBadge = o.isGroup ? ' <span class="badge" style="background: rgba(220, 53, 69, 0.2); color: #dc3545; border: 1px solid rgba(220,53,69,0.4); padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; vertical-align: middle;">단체권 (' + o.groupTargetCount + '명)</span>' : '';
            return (
              "<tr><td>" +
              escapeHtml(o.name) + groupBadge +
              "</td><td class=\"td-num\">" +
              priceDisplay +
              "</td><td class=\"td-num\">" +
              stockDisplay +
              "</td><td>" +
              typeLabel +
              "</td></tr>"
            );
          })
          .join("")
      : "";

    var prodRows = myProducts.length
      ? myProducts
          .map(function (p) {
            var dis = preview ? " disabled" : "";
            var priceChangeForm = preview
              ? '<span class="muted">미리보기</span>'
              : '<form class="js-coupon-price-change-form" style="display: inline-flex; gap: 0.2rem; align-items: center; margin: 0;">' +
                '<input type="hidden" name="productId" value="' + escapeHtml(p.id) + '" />' +
                '<input type="number" name="newPrice" min="1" max="999999" placeholder="가격" style="width: 5.5rem; padding: 0.1rem 0.3rem; font-size: 0.75rem; height: 1.6rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border); color: var(--text);" required />' +
                '<button type="submit" class="btn btn--primary btn--xs" style="padding: 0 0.3rem; height: 1.6rem; font-size: 0.75rem;">요청</button>' +
                '</form>';

            var activeRentals = (db.couponShop.rentals || []).filter(function (r) {
              return r.productId === p.id && (r.status === "held" || r.status === "use_requested" || r.status === "merchant_approved");
            });
            var remainingQty = p.totalStock - activeRentals.length;
            if (remainingQty < 0) remainingQty = 0;

            var descVal = p.desc || "";
            var descDisplay = descVal
              ? '<div class="coupon-desc-row" style="font-size: 0.8rem; color: #aaa; margin-top: 0.2rem; display: flex; align-items: center; gap: 0.3rem;">' +
                  '<span>소개: ' + escapeHtml(descVal) + '</span>' +
                  '<button type="button" class="js-coupon-edit-desc" data-product-id="' + escapeHtml(p.id) + '" data-desc="' + escapeHtml(descVal) + '" style="background: none; border: none; color: #10b981; padding: 0; font-size: 0.75rem; cursor: pointer; text-decoration: underline;">수정</button>' +
                '</div>'
              : '<div class="coupon-desc-row" style="font-size: 0.8rem; color: #777; margin-top: 0.2rem; display: flex; align-items: center; gap: 0.3rem;">' +
                  '<span>소개 없음</span>' +
                  '<button type="button" class="js-coupon-edit-desc" data-product-id="' + escapeHtml(p.id) + '" data-desc="" style="background: none; border: none; color: #10b981; padding: 0; font-size: 0.75rem; cursor: pointer; text-decoration: underline;">등록</button>' +
                '</div>';

            var groupBadge = p.isGroup ? ' <span class="badge" style="background: rgba(220, 53, 69, 0.2); color: #dc3545; border: 1px solid rgba(220,53,69,0.4); padding: 0.1rem 0.3rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; vertical-align: middle;">단체권 (' + p.groupTargetCount + '명)</span>' : '';

            return (
              "<tr><td>" +
              "<strong>" + escapeHtml(p.name) + "</strong>" + groupBadge +
              descDisplay +
              "</td><td class=\"td-num\">" +
              formatNum(p.priceCal) +
              " Cal</td><td class=\"td-num\">" +
              remainingQty +
              " / " +
              p.totalStock +
              "개</td><td>" +
              priceChangeForm +
              '</td><td><span class="bank-payroll-status bank-payroll-status--ok">판매 중</span></td></tr>'
            );
          })
          .join("")
      : "";

    var formBlock = preview
      ? '<p class="panel__text muted">미리보기에서는 등록할 수 없습니다.</p>'
      : '<form id="form-coupon-offer" class="stack">' +
        '<label class="field">쿠폰 이름<input name="name" type="text" required maxlength="80" placeholder="예: 과자 교환권"/></label>' +
        '<label class="field">가격 (Cal)<input name="priceCal" type="number" min="1" max="999999" value="100" required /></label>' +
        '<label class="field">총 판매 개수<input name="totalStock" type="number" min="1" max="9999" value="10" required /></label>' +
        '<div class="field">' +
          '<span style="font-weight: bold; margin-bottom: 0.3rem; display: block;">쿠폰 종류</span>' +
          '<div style="display: flex; gap: 1.5rem; align-items: center; margin-top: 0.2rem;">' +
            '<label style="display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; color: var(--text); font-weight: normal;">' +
              '<input type="radio" name="isGroup" value="false" checked style="cursor: pointer;" /> 개인권' +
            '</label>' +
            '<label style="display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; color: var(--text); font-weight: normal;">' +
              '<input type="radio" name="isGroup" value="true" style="cursor: pointer;" /> 단체권 (공동구매)' +
            '</label>' +
          '</div>' +
        '</div>' +
        '<div id="group-target-container" class="field" style="display: none;">' +
          '공동구매 목표 인원 (명)' +
          '<input name="groupTargetCount" type="number" min="2" max="50" value="10" placeholder="목표 인원 입력 (2명 ~ 50명)" />' +
          '<span class="muted" style="font-size: 0.8rem; color: #888; margin-top: 0.2rem; display: block;">설정한 목표 인원수가 동일하게 분담하여 금액을 지불하고, 인원이 모두 모여야 쿠폰이 지급됩니다.</span>' +
        '</div>' +
        '<label class="field">쿠폰 소개 (최대 300자)<textarea name="desc" maxlength="300" placeholder="쿠폰에 대한 간단한 소개를 적어주세요. (선택사항)" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border); color: var(--text); padding: 0.5rem; border-radius: 4px; resize: vertical; min-height: 3.5rem; font-family: inherit; font-size: 0.9rem;"></textarea></label>' +
        '<button type="submit" class="btn btn--primary">선생님께 승인 요청</button>' +
        '<p class="muted">승인 후 쿠폰숍에 올라가며, 판매 금액은 우리반 국고(세금 총액)에 누적됩니다.</p>' +
        "</form>";

    // Build Coupon Use Requests list
    var useRequests = (db.couponShop.rentals || []).filter(function (r) {
      if (r.status !== "use_requested") return false;
      var prod = findCouponProduct(db, r.productId);
      if (!prod) return false;
      return true; // Unified: remove merchant restriction
    });



    var useReqRows = useRequests.length

      ? useRequests.map(function (r) {

          var dis = preview ? " disabled" : "";

          return (

            '<tr>' +

              '<td>' + escapeHtml(r.studentName) + '</td>' +

              '<td>' + escapeHtml(r.couponName) + '</td>' +

              '<td>' + fmtTime(r.useRequestedAt || r.rentedAt) + '</td>' +

              '<td>' +

                '<button type="button" class="btn btn--primary btn--xs js-coupon-merchant-approve-use"' + dis + ' data-rental-id="' + escapeHtml(r.id) + '">사용 승인 🎫</button>' +

              '</td>' +

            '</tr>'

          );

        }).join("")

      : '<tr><td colspan="4" class="empty-state">사용 승인 요청 대기 건이 없습니다.</td></tr>';



    var useRequestsSection = 

      '<section class="panel">' +

      '<h2 class="panel__title">🎫 쿠폰 사용 승인 대기 (학생 ➡️ 상인)</h2>' +

      '<p class="panel__text">학생들이 쿠폰을 사용하겠다고 신청한 내역입니다. 승인하면 선생님 최종 승인 단계로 넘어갑니다.</p>' +

      '<div class="table-wrap"><table class="data"><thead><tr><th>학생 이름</th><th>쿠폰 이름</th><th>신청 시각</th><th>작업</th></tr></thead><tbody>' +

      useReqRows +

      '</tbody></table></div>' +

      '</section>';



    return (

      '<div class="coupon-merchant-root stack">' +

      '<section class="panel">' +

      '<h2 class="panel__title">새 쿠폰 등록 (선생님 승인)</h2>' +

      formBlock +

      "</section>" +

      useRequestsSection +

      '<section class="panel">' +

      '<h2 class="panel__title">내 쿠폰 · 재고</h2>' +

      '<div class="table-wrap"><table class="data"><thead><tr><th>이름</th><th>가격</th><th>남음/총</th><th>가격 변경 요청</th><th>상태</th></tr></thead><tbody>' +

      (prodRows || '<tr><td colspan="5" class="empty-state">승인된 쿠폰이 없습니다.</td></tr>') +

      "</tbody></table></div>" +

      (pendRows

        ? '<h3 class="panel__subhead" style="margin-top: 1.5rem; color: var(--accent2);">📥 승인 대기 목록</h3><div class="table-wrap"><table class="data"><thead><tr><th>이름</th><th>가격</th><th>총개수</th><th>구분</th></tr></thead><tbody>' +

          pendRows +

          "</tbody></table></div>"

        : "") +

      "</section>" +

      buildCouponMerchantLogTableHtml(db, merchantStudentId) +

      "</div>"

    );

  }



  function buildStorePlaceholderHtml() {

    return (

      '<div class="store-placeholder panel">' +

      '<h2 class="panel__title">🏪 매점</h2>' +

      '<p class="panel__text">매점 기능은 곧 열릴 예정입니다. 지금은 쿠폰샵을 이용해 주세요.</p>' +

      '<a class="btn btn--ghost" href="#/student">나의 STATUS로</a>' +

      "</div>"

    );

  }



  function buildCanteenMerchantLogTableHtml(db, merchantStudentId) {
    ensureCanteenShop(db);
    var productIds = {};
    var i;
    for (i = 0; i < db.canteenShop.products.length; i++) {
      var pr = db.canteenShop.products[i];
      productIds[pr.id] = true;
    }

    var entries = db.canteenShop.merchantLog.filter(function (e) {
      return e && productIds[e.productId];
    });

    entries.sort(function (a, b) {
      return (b.occurredAt || 0) - (a.occurredAt || 0);
    });

    var rows = entries.length
      ? entries
          .map(function (e) {
            var by = getStudent(db, e.buyerStudentId);
            var buyerLabel = by
              ? escapeHtml(by.name) + " (" + escapeHtml(String(by.number != null ? by.number : "—")) + ")"
              : "(알 수 없음)";
            var dLabel = e.dateYmd ? formatYmdLongKo(e.dateYmd) : "—";
            return (
              "<tr><td>" +
              escapeHtml(dLabel) +
              "</td><td>" +
              escapeHtml(e.canteenName || "") +
              "</td><td>" +
              buyerLabel +
              "</td><td class=\"td-num\">" +
              formatNum(e.priceCal) +
              " Cal</td><td>" +
              '<button type="button" class="btn btn--danger btn--xs js-canteen-merchant-cancel" data-order-id="' + escapeHtml(e.orderId || '') + '" data-log-id="' + escapeHtml(e.id) + '">구매취소</button>' +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="5" class="empty-state">아직 판매 기록이 없습니다.</td></tr>';

    return (
      '<div class="coupon-merchant-journal">' +
      '<div class="coupon-merchant-journal__banner" style="background: linear-gradient(135deg, #00796b, #004d40);">' +
      '<h2 class="coupon-merchant-journal__title">🏪 매점 상인의 판매 장부</h2>' +
      "</div>" +
      '<div class="table-wrap">' +
      '<table class="data coupon-merchant-journal-table">' +
      "<thead><tr><th>날짜</th><th>구매 상품</th><th>구매자</th><th>구입금액</th><th>작업</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div></div>"
    );
  }



  function buildCanteenMerchantStudentHtml(db, merchantStudentId, opts) {

    opts = opts || {};

    var preview = opts.preview === true;

    ensureCanteenShop(db);

    var pending = db.canteenShop.pendingOffers.filter(function (o) {

      return o.status === "pending";

    });

    var myProducts = db.canteenShop.products || [];

    var pendRows = pending.length

      ? pending

          .map(function (o) {

            var typeLabel = o.type === "price_change" ? '<span class="badge" style="background: rgba(255, 193, 7, 0.2); color: #ffc107;">가격변경 대기</span>' : '<span class="badge" style="background: rgba(0, 188, 212, 0.2); color: #00bcd4;">신규등록 대기</span>';

            var priceDisplay = o.type === "price_change" ? formatNum(o.newPriceCal) + " Cal" : formatNum(o.priceCal) + " Cal";

            var stockDisplay = o.type === "price_change" ? "—" : o.totalStock + "개";

            return (

              "<tr><td>" +

              escapeHtml(o.name) +

              "</td><td class=\"td-num\">" +

              priceDisplay +

              "</td><td class=\"td-num\">" +

              stockDisplay +

              "</td><td>" +

              typeLabel +

              "</td></tr>"

            );

          })

          .join("")

      : "";

    var prodRows = myProducts.length

      ? myProducts

          .map(function (p) {

            var dis = preview ? " disabled" : "";

            var priceChangeForm = preview

              ? '<span class="muted">미리보기</span>'

              : '<form class="js-canteen-price-change-form" style="display: inline-flex; gap: 0.2rem; align-items: center; margin: 0;">' +

                '<input type="hidden" name="productId" value="' + escapeHtml(p.id) + '" />' +

                '<input type="number" name="newPrice" min="1" max="999999" placeholder="가격" style="width: 5.5rem; padding: 0.1rem 0.3rem; font-size: 0.75rem; height: 1.6rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border); color: var(--text);" required />' +

                '<button type="submit" class="btn btn--primary btn--xs" style="padding: 0 0.3rem; height: 1.6rem; font-size: 0.75rem;">요청</button>' +

                '</form>';

            return (

              "<tr><td>" +

              escapeHtml(p.name) +

              "</td><td class=\"td-num\">" +

              formatNum(p.priceCal) +

              " Cal</td><td class=\"td-num\">" +

              p.remainingStock +

              " / " +

              p.totalStock +

              "개</td><td>" +

              priceChangeForm +

              '</td><td><span class="bank-payroll-status bank-payroll-status--ok">판매 중</span></td></tr>'

            );

          })

          .join("")

      : "";

    var formBlock = preview

      ? '<p class="panel__text muted">미리보기에서는 등록할 수 없습니다.</p>'

      : '<form id="form-canteen-offer" class="stack">' +

        '<label class="field">상품 이름<input name="name" type="text" required maxlength="80" placeholder="예: 쵸코우유"/></label>' +

        '<label class="field">가격 (Cal)<input name="priceCal" type="number" min="1" max="999999" value="100" required /></label>' +

        '<label class="field">총 판매 개수<input name="totalStock" type="number" min="1" max="9999" value="10" required /></label>' +

        '<button type="submit" class="btn btn--accent">선생님께 승인 요청</button>' +

        '<p class="muted">승인 후 매점에 올라가며, 판매 금액은 우리반 국고(세금 총액)에 누적됩니다.</p>' +

        "</form>";



    // Build Canteen Orders list for merchant

    var pendingOrders = (db.canteenShop.orders || []).filter(function (o) {

      return o.status === "pending";

    });



    var orderRows = pendingOrders.length

      ? pendingOrders.map(function (o) {

          var dis = preview ? " disabled" : "";

          return (

            '<tr>' +

              '<td>' + escapeHtml(o.buyerStudentName || "") + '</td>' +

              '<td>' + escapeHtml(o.productName) + '</td>' +

              '<td class="td-num">' + formatNum(o.priceCal) + ' Cal</td>' +

              '<td>' + fmtTime(o.occurredAt) + '</td>' +

              '<td>' +

                '<button type="button" class="btn btn--primary btn--xs js-canteen-merchant-approve-order"' + dis + ' data-order-id="' + escapeHtml(o.id) + '">인도 완료 (승인) ✅</button>' +

                '<button type="button" class="btn btn--ghost btn--xs js-canteen-merchant-reject-order"' + dis + ' data-order-id="' + escapeHtml(o.id) + '" style="color: var(--danger); margin-left: 0.25rem;">반려 ❌</button>' +

              '</td>' +

            '</tr>'

          );

        }).join("")

      : '<tr><td colspan="5" class="empty-state">구매 승인(인도 대기) 요청 건이 없습니다.</td></tr>';



    var ordersSection = 

      '<section class="panel">' +

      '<h2 class="panel__title">🏪 매점 상품 구매 승인 대기 (학생 ➡️ 상인)</h2>' +

      '<p class="panel__text">학생들이 구매한 내역입니다. 교실에서 실물 인도 후 <strong>인도 완료 (승인)</strong> 처리를 해주세요.</p>' +

      '<div class="table-wrap"><table class="data"><thead><tr><th>구매 학생</th><th>상품 이름</th><th>가격</th><th>구매 시각</th><th>작업</th></tr></thead><tbody>' +

      orderRows +

      '</tbody></table></div>' +

      '</section>';



    return (

      '<div class="coupon-merchant-root">' +

      '<section class="panel">' +

      '<h2 class="panel__title">🏪 새 매점 상품 등록 (선생님 승인)</h2>' +

      formBlock +

      "</section>" +

      '<section class="panel">' +

      '<h2 class="panel__title">📋 내 매점 상품 · 재고</h2>' +

      '<div class="table-wrap"><table class="data"><thead><tr><th>이름</th><th>가격</th><th>남음/총</th><th>가격 변경 요청</th><th>상태</th></tr></thead><tbody>' +

      (prodRows || '<tr><td colspan="5" class="empty-state">승인된 상품이 없습니다.</td></tr>') +

      "</tbody></table></div>" +

      (pendRows

        ? '<h3 class="panel__subhead" style="margin-top: 1.5rem; color: var(--accent2);">📥 승인 대기 목록</h3><div class="table-wrap"><table class="data"><thead><tr><th>이름</th><th>가격</th><th>총개수</th><th>구분</th></tr></thead><tbody>' +

          pendRows +

          "</tbody></table></div>"

        : "") +

      "</section>" +

      ordersSection +

      buildCanteenMerchantLogTableHtml(db, merchantStudentId) +

      "</div>"

    );

  }



  function renderStudentAssetChart(db, studentId) {
    var canvas = document.getElementById("statusAssetChart");
    if (!canvas) return;
    
    var st = getStudent(db, studentId);
    if (!st) return;
    ensureStudentStockPortfolio(st);
    
    var cashVal = typeof st.calory === "number" && !isNaN(st.calory) ? st.calory : 0;
    var stockVal = 0;
    var holdings = st.stockPortfolio.holdings || {};
    var codes = Object.keys(holdings);
    var legendEl = document.getElementById("status-asset-legend");
    
    function drawDoughnutChart(cash, stock) {
      var total = cash + stock;
      var cashPct = total > 0 ? Math.round((cash / total) * 100) : 100;
      var stockPct = total > 0 ? Math.round((stock / total) * 100) : 0;
      
      if (legendEl) {
        legendEl.innerHTML = 
          '<div style="margin-bottom:0.4rem; display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.2rem;">' +
          '<span>총자산:</span><strong>' + formatNum(Math.round(total * 100) / 100) + ' Cal</strong>' +
          '</div>' +
          '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.2rem;">' +
          '<span><span style="display:inline-block; width:8px; height:8px; background-color:#36A2EB; margin-right:5px; border-radius:50%;"></span>현금:</span>' +
          '<span>' + formatNum(cash) + ' Cal (' + cashPct + '%)</span>' +
          '</div>' +
          '<div style="display:flex; align-items:center; justify-content:space-between;">' +
          '<span><span style="display:inline-block; width:8px; height:8px; background-color:#FF6384; margin-right:5px; border-radius:50%;"></span>주식:</span>' +
          '<span>' + formatNum(stock) + ' Cal (' + stockPct + '%)</span>' +
          '</div>';
      }
      
      if (window.Chart) {
        try {
          new Chart(canvas, {
            type: 'doughnut',
            data: {
              labels: ['현금', '주식'],
              datasets: [{
                data: [cash, stock],
                backgroundColor: ['#36A2EB', '#FF6384'],
                borderWidth: 0
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: function(context) {
                      return context.label + ': ' + formatNum(context.raw) + ' Cal';
                    }
                  }
                }
              },
              cutout: '70%'
            }
          });
          return;
        } catch (e) {
          console.error("Chart.js init failed", e);
        }
      }
      
      var ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var cx = canvas.width / 2;
        var cy = canvas.height / 2;
        var r = Math.min(cx, cy) - 5;
        
        var cashAngle = total > 0 ? (cash / total) * 2 * Math.PI : 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, cashAngle);
        ctx.lineWidth = 10;
        ctx.strokeStyle = "#36A2EB";
        ctx.stroke();
        
        if (stock > 0) {
          ctx.beginPath();
          ctx.arc(cx, cy, r, cashAngle, 2 * Math.PI);
          ctx.lineWidth = 10;
          ctx.strokeStyle = "#FF6384";
          ctx.stroke();
        }
      }
    }
    
    if (codes.length === 0) {
      drawDoughnutChart(cashVal, 0);
      return;
    }
    
    if (window.currentStockPrices) {
      for (var i = 0; i < codes.length; i++) {
        var code = codes[i];
        var holding = holdings[code];
        var priceInfo = window.currentStockPrices[code];
        if (holding && priceInfo && typeof priceInfo.price === "number") {
          var priceKcal = priceInfo.price / 10000;
          stockVal += holding.amount * priceKcal;
        }
      }
      stockVal = Math.round(stockVal * 100) / 100;
      drawDoughnutChart(cashVal, stockVal);
    } else {
      fetchRealtimePrices(db, function(res) {
        if (res.ok) {
          window.currentStockPrices = res.data;
        } else if (res.data && Object.keys(res.data).length > 0) {
          window.currentStockPrices = res.data;
        }

        if (window.currentStockPrices) {
          for (var i = 0; i < codes.length; i++) {
            var code = codes[i];
            var holding = holdings[code];
            var priceInfo = window.currentStockPrices[code];
            if (holding && priceInfo && typeof priceInfo.price === "number") {
              var priceKcal = priceInfo.price / 10000;
              stockVal += holding.amount * priceKcal;
            }
          }
          stockVal = Math.round(stockVal * 100) / 100;
          drawDoughnutChart(cashVal, stockVal);
          if (!res.ok && legendEl) {
            legendEl.innerHTML += '<p style="color:#ffae19; font-size:0.72rem; margin-top:0.2rem;">* 시세 동기화 실패 (과거 시세 기준)</p>';
          }
        } else {
          drawDoughnutChart(cashVal, 0);
          if (legendEl) {
            legendEl.innerHTML += '<p style="color:#ff4d4d; font-size:0.75rem; margin-top:0.2rem;">* 시세 동기화 실패</p>';
          }
        }
      });
    }
  }

  function buildStockMarketStudentHtml(db, studentId, opts) {
    opts = opts || {};
    var preview = opts.preview === true;
    ensureStockMarket(db);
    var st = getStudent(db, studentId);
    if (!st) return '<p class="panel__text">학생 정보를 찾을 수 없습니다.</p>';
    ensureStudentStockPortfolio(st);

    var marketEnabled = db.stockMarket.enabled;
    var disabledAttr = (preview || !marketEnabled) ? ' disabled' : '';

    var cash = typeof st.calory === "number" && !isNaN(st.calory) ? st.calory : 0;
    
    var totalStockVal = 0;
    var holdings = st.stockPortfolio.holdings || {};
    var codes = Object.keys(holdings);
    
    if (window.currentStockPrices) {
      var k;
      for (k = 0; k < codes.length; k++) {
        var code = codes[k];
        var holding = holdings[code];
        var priceInfo = window.currentStockPrices[code];
        if (holding && priceInfo && typeof priceInfo.price === "number") {
          var priceKcal = priceInfo.price / 10000;
          totalStockVal += holding.amount * priceKcal;
        }
      }
    }
    totalStockVal = Math.round(totalStockVal * 100) / 100;
    var totalAssets = Math.round((cash + totalStockVal) * 100) / 100;

    var pricesFetching = window.isFetchingStockPrices === true;
    var pricesError = window.stockPricesError || null;

    var totalStockValHtml = "";
    var totalAssetsHtml = "";
    if (!window.currentStockPrices) {
      if (pricesFetching) {
        totalStockValHtml = '<span style="font-size:1rem; color:#94a3b8; font-weight:normal;">조회 중...</span>';
        totalAssetsHtml = '<span style="font-size:1.2rem; color:#94a3b8; font-weight:normal;">계산 중...</span>';
      } else {
        totalStockValHtml = '<span style="font-size:1rem; color:#ef4444; font-weight:normal;">조회 실패</span>';
        totalAssetsHtml = '<span style="font-size:1.2rem; color:#ef4444; font-weight:normal;">계산 불가</span>';
      }
    } else {
      totalStockValHtml = formatNum(totalStockVal) + ' <span style="font-size:0.9rem; font-weight:normal;">Cal</span>';
      totalAssetsHtml = formatNum(totalAssets) + ' <span style="font-size:1rem; font-weight:normal;">Cal</span>';
    }

    var inlineStyles = 
      '<style>' +
      '  @keyframes spin-loading {' +
      '    0% { transform: rotate(0deg); }' +
'    100% { transform: rotate(360deg); }' +
      '  }' +
      '</style>';

    var accountHtml = 
      '<div class="stock-account-card panel" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 1.5rem; color: #fff; margin-bottom: 1.5rem;">' +
      '  <div class="stock-account-card__grid">' +
      '    <div>' +
      '      <h3 style="margin-top:0; margin-bottom:1rem; font-size:1.2rem; color:var(--accent2); display:flex; align-items:center; gap:0.5rem;">💳 나의 투자 계좌</h3>' +
      '      <div style="display:flex; flex-direction:column; gap:0.8rem;">' +
      '        <div>' +
      '          <span style="font-size:0.85rem; color:#94a3b8;">예수금 (보유 현금)</span>' +
      '          <div style="font-size:1.3rem; font-weight:600; color:#38bdf8;">' + formatNum(cash) + ' Cal</div>' +
      '        </div>' +
      '        <div>' +
      '          <span style="font-size:0.85rem; color:#94a3b8;">주식 평가액</span>' +
      '          <div style="font-size:1.3rem; font-weight:600; color:#f43f5e;">' + totalStockValHtml + '</div>' +
      '        </div>' +
      '        <div>' +
      '          <span style="font-size:0.85rem; color:#94a3b8;">총 자산</span>' +
      '          <div style="font-size:1.6rem; font-weight:700; color:#10b981;">' + totalAssetsHtml + '</div>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="portfolio-chart-section" style="display:flex; flex-direction:row; align-items:center; justify-content:center; gap:1.2rem; flex-wrap:wrap; width:100%;">' +
      '      <div class="portfolio-chart-container" style="position:relative; width:120px; height:120px; flex-shrink:0;">' +
      '        <canvas id="portfolio-doughnut-chart"></canvas>' +
      '      </div>' +
      '      <div id="portfolio-top-assets" style="display:flex; flex-direction:column; gap:0.4rem; min-width:130px; justify-content:center; border-left:1px solid rgba(255,255,255,0.08); padding-left:1rem;">' +
      '        <!-- 핵심 비중 Top 3 주입 영역 -->' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    var connectionStatusHtml = "";
    if (pricesError) {
      connectionStatusHtml = 
        '<div class="alert alert--danger" style="margin-bottom: 1.5rem; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fecaca; padding: 1rem; border-radius: 8px; font-size: 0.9rem;">' +
        '  <strong>⚠️ 실시간 주가 동기화 실패:</strong> ' + pricesError +
        '</div>';
    } else if (pricesFetching && !window.currentStockPrices) {
      connectionStatusHtml = 
        '<div class="alert alert--info" style="margin-bottom: 1.5rem; background: rgba(59, 130, 246, 0.15); border: 1px solid #3b82f6; color: #dbeafe; padding: 1rem; border-radius: 8px; font-size: 0.9rem; display: flex; align-items: center; gap: 0.5rem;">' +
        '  <span style="display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.3); border-radius:50%; border-top-color:#fff; animation:spin-loading 0.8s linear infinite; margin-right:4px; box-sizing:border-box;"></span>' +
        '  <span>🔄 <strong>실시간 시세를 불러오는 중입니다...</strong> 잠시만 기다려 주세요.</span>' +
        '</div>';
    }

    var statusAlertHtml = "";
    if (!marketEnabled) {
      statusAlertHtml = 
        '<div class="alert alert--warn" style="margin-bottom: 1.5rem; background: rgba(234, 179, 8, 0.15); border: 1px solid #eab308; color: #fef08a; padding: 1rem; border-radius: 8px;">' +
        '  <strong>⚠️ 모의투자 시장이 닫혀 있습니다.</strong> 현재는 조회만 가능하며 매수/매도 주문을 제출할 수 없습니다.' +
        '</div>';
    }

    var stockListRows = "";
    var stocks = db.stockMarket.stocks || [];
    
    if (stocks.length === 0) {
      stockListRows = '<tr><td colspan="7" class="empty-state" style="text-align:center; padding:2rem; color:#94a3b8;">등록된 주식 종목이 없습니다.</td></tr>';
    } else {
      var i;
      for (i = 0; i < stocks.length; i++) {
        var s = stocks[i];
        var code = s.code;
        var name = s.name;
        
        var priceInfo = window.currentStockPrices && window.currentStockPrices[code];
        var priceHtml = "—";
        var changeText = "—";
        var changeStyle = "color:#94a3b8;";
        
        if (priceInfo && typeof priceInfo.price === "number" && priceInfo.price > 0) {
          var priceCal = priceInfo.price / 10000;
          var priceKrwStr = formatNum(priceInfo.price) + "원";
          var priceCalStr = formatNum(Math.round(priceCal * 100) / 100) + " Cal";
          priceHtml = '<strong>' + priceCalStr + '</strong><br/><span style="font-size:0.75rem; color:#94a3b8;">(' + priceKrwStr + ')</span>';
          
          if (priceInfo.compareSign === "1" || priceInfo.compareSign === "2") {
            changeText = "▲ " + formatNum(priceInfo.changePrice) + " (" + priceInfo.changeRate + "%)";
            changeStyle = "color:#ef4444; font-weight:600;";
          } else if (priceInfo.compareSign === "4" || priceInfo.compareSign === "5") {
            changeText = "▼ " + formatNum(priceInfo.changePrice) + " (" + priceInfo.changeRate + "%)";
            changeStyle = "color:#3b82f6; font-weight:600;";
          } else {
            changeText = "0 (0.00%)";
            changeStyle = "color:#94a3b8;";
          }
        } else {
          if (pricesFetching) {
            priceHtml = '<strong>조회 중...</strong><br/><span style="font-size:0.75rem; color:#94a3b8;">(조회 중...)</span>';
            changeText = '<span style="font-size:0.8rem; color:#94a3b8;">조회 중...</span>';
          } else if (pricesError || window.stockPricesConfigured === false) {
            priceHtml = '<strong>설정 필요</strong><br/><span style="font-size:0.75rem; color:#ef4444;">(미연동)</span>';
            changeText = '<span style="font-size:0.8rem; color:#ef4444;">미연동</span>';
          }
        }
        
        var holding = holdings[code];
        var hasHolding = holding && holding.amount > 0;
        var holdingQtyStr = hasHolding ? formatNum(holding.amount) + "주" : "0주";
        var avgPriceStr = hasHolding ? formatNum(holding.avgPriceKcal) + " Cal" : "—";
        var profitLossStr = "—";
        var profitLossStyle = "color:#94a3b8;";
        
        if (hasHolding) {
          if (priceInfo && typeof priceInfo.price === "number" && priceInfo.price > 0) {
            var curPriceKcal = priceInfo.price / 10000;
            var valuation = holding.amount * curPriceKcal;
            var cost = holding.amount * holding.avgPriceKcal;
            var pl = valuation - cost;
            var plRate = cost > 0 ? (pl / cost) * 100 : 0;
            if (typeof plRate !== 'number' || isNaN(plRate) || !isFinite(plRate)) {
              plRate = 0;
            }
            var plSign = pl >= 0 ? "+" : "";
            profitLossStr = plSign + formatNum(Math.round(pl * 100) / 100) + " Cal (" + plSign + plRate.toFixed(2) + "%)";
            if (pl > 0) profitLossStyle = "color:#ef4444; font-weight:600;";
            else if (pl < 0) profitLossStyle = "color:#3b82f6; font-weight:600;";
          } else {
            if (pricesFetching) {
              profitLossStr = '<span style="font-size:0.8rem; color:#94a3b8;">계산 중...</span>';
            } else if (pricesError || window.stockPricesConfigured === false) {
              profitLossStr = '<span style="font-size:0.8rem; color:#ef4444;">계산 불가</span>';
            }
          }
        }
        
        var tradeButtons = "";
        if (!preview && marketEnabled) {
          var isPriceAvailable = priceInfo && typeof priceInfo.price === "number" && priceInfo.price > 0;
          if (isPriceAvailable) {
            tradeButtons = 
              '<button type="button" class="btn btn--primary btn--xs js-stock-trade-btn" data-action="buy" data-code="' + code + '" data-name="' + escapeHtml(name) + '">매수</button> ' +
              (hasHolding ? '<button type="button" class="btn btn--ghost btn--xs js-stock-trade-btn" data-action="sell" data-code="' + code + '" data-name="' + escapeHtml(name) + '" style="color:#f43f5e; border-color:rgba(244,63,94,0.3); margin-left:4px;">매도</button>' : '');
          } else {
            var buyDisabled = ' disabled style="opacity:0.5; cursor:not-allowed;" title="실시간 시세가 조회되지 않아 매수할 수 없습니다."';
            var sellDisabled = ' disabled style="opacity:0.5; cursor:not-allowed; color:#f43f5e; border-color:rgba(244,63,94,0.3); margin-left:4px;" title="실시간 시세가 조회되지 않아 매도할 수 없습니다."';
            tradeButtons = 
              '<button type="button" class="btn btn--primary btn--xs js-stock-trade-btn"' + buyDisabled + ' data-action="buy" data-code="' + code + '" data-name="' + escapeHtml(name) + '">매수</button> ' +
              (hasHolding ? '<button type="button" class="btn btn--ghost btn--xs js-stock-trade-btn"' + sellDisabled + ' data-action="sell" data-code="' + code + '" data-name="' + escapeHtml(name) + '">매도</button>' : '');
          }
        } else {
          tradeButtons = '<span class="muted" style="font-size:0.8rem;">거래 불가</span>';
        }
        
        stockListRows += 
          '<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">' +
          '  <td style="padding:10px 8px;"><strong><span class="stock-name-link js-stock-detail-trigger" data-code="' + code + '" data-name="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span></strong><br/><span style="font-size:0.75rem; color:#94a3b8;">' + code + '</span></td>' +
          '  <td class="td-num" style="padding:10px 8px; text-align:right;">' + priceHtml + '</td>' +
          '  <td class="td-num" style="padding:10px 8px; text-align:right; ' + changeStyle + '">' + changeText + '</td>' +
          '  <td class="td-num" style="padding:10px 8px; text-align:right; color:#e2e8f0;">' + holdingQtyStr + '</td>' +
          '  <td class="td-num" style="padding:10px 8px; text-align:right; color:#94a3b8;">' + avgPriceStr + '</td>' +
          '  <td class="td-num" style="padding:10px 8px; text-align:right; ' + profitLossStyle + '">' + profitLossStr + '</td>' +
          '  <td style="padding:10px 8px; text-align:center;">' + tradeButtons + '</td>' +
          '</tr>';
      }
    }
    
    var tradePanelHtml = 
      '<div id="stock-trade-panel" class="panel" style="display:none; margin-top:1.5rem; background:rgba(30,41,59,0.5); border:1px solid var(--border); border-radius:12px; padding:1.2rem;">' +
      '  <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:0.8rem; margin-bottom:1rem;">' +
      '    <h3 style="margin:0; font-size:1.2rem; color:#f1f5f9;"><span id="trade-stock-name"></span> (<span id="trade-stock-code"></span>) 거래</h3>' +
      '    <button type="button" id="btn-close-trade" style="background:none; border:none; color:#94a3b8; font-size:1.5rem; cursor:pointer;">&times;</button>' +
      '  </div>' +
      '  <div style="display:flex; gap:1.5rem; flex-wrap:wrap;">' +
      '    <div style="flex:1; min-width:280px;">' +
      '      <div style="display:flex; gap:0.5rem; margin-bottom:1rem; border-bottom:2px solid rgba(255,255,255,0.05); padding-bottom:2px;">' +
      '        <button type="button" id="tab-trade-buy" class="trade-tab active" style="flex:1; padding:0.5rem; border:none; background:none; color:#ef4444; font-weight:700; border-bottom:3px solid #ef4444; cursor:pointer;">매수 (칼로리로 사기)</button>' +
      '        <button type="button" id="tab-trade-sell" class="trade-tab" style="flex:1; padding:0.5rem; border:none; background:none; color:#94a3b8; font-weight:500; cursor:pointer;">매도 (주식 팔기)</button>' +
      '      </div>' +
      '      <form id="form-stock-trade" class="stack" style="gap:1rem;">' +
      '        <input type="hidden" name="code" id="trade-input-code" />' +
      '        <input type="hidden" name="action" id="trade-input-action" value="buy" />' +
      '        <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">' +
      '          <label style="flex:1; background:rgba(0,0,0,0.2); border:1px solid var(--border); padding:0.5rem; border-radius:6px; text-align:center; cursor:pointer;">' +
      '            <input type="radio" name="tradeMode" value="kcal" checked style="margin-right:5px;"/>Cal 단위 입력' +
      '          </label>' +
      '          <label style="flex:1; background:rgba(0,0,0,0.2); border:1px solid var(--border); padding:0.5rem; border-radius:6px; text-align:center; cursor:pointer;">' +
      '            <input type="radio" name="tradeMode" value="shares" style="margin-right:5px;"/>주 수 단위 입력' +
      '          </label>' +
      '        </div>' +
      '        <label class="field" style="margin:0;">' +
      '          <span id="trade-amount-label">매수 금액 (Cal)</span>' +
      '          <input type="number" id="trade-amount-input" name="amount" min="0.0001" step="any" placeholder="예: 10" style="width:100%; height:2.5rem; background:rgba(0,0,0,0.2); border:1px solid var(--border); color:#fff; border-radius:4px; padding:0 0.5rem;" required />' +
      '        </label>' +
      '        <div style="background:rgba(0,0,0,0.2); padding:0.8rem; border-radius:6px; font-size:0.85rem; line-height:1.5;">' +
      '          <div style="display:flex; justify-content:space-between; margin-bottom:0.2rem;">' +
      '            <span class="muted">실시간 현재가 (1주):</span>' +
      '            <span id="trade-curr-price" style="font-weight:600; color:#38bdf8;">0 Cal</span>' +
      '          </div>' +
      '          <div style="display:flex; justify-content:space-between; margin-bottom:0.2rem;">' +
      '            <span class="muted">계산 결과:</span>' +
      '            <span id="trade-est-result" style="font-weight:600; color:#e2e8f0;">0주</span>' +
      '          </div>' +
      '        </div>' +
      '        <button type="submit" id="btn-submit-trade" class="btn btn--accent" style="width:100%; height:2.5rem; font-weight:700;">매수 주문 제출</button>' +
      '      </form>' +
      '    </div>' +
      '    <div style="width:250px; background:rgba(0,0,0,0.15); border-radius:8px; padding:0.8rem; font-size:0.85rem; display:flex; flex-direction:column; gap:0.5rem;">' +
      '      <h4 style="margin:0 0 0.2rem 0; color:#94a3b8; font-weight:600; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.3rem;">보유 정보</h4>' +
      '      <div style="display:flex; justify-content:space-between;">' +
      '        <span class="muted">보유 수량:</span>' +
      '        <span id="trade-hold-qty" style="color:#fff;">0주</span>' +
      '      </div>' +
      '      <div style="display:flex; justify-content:space-between;">' +
      '        <span class="muted">평균 단가:</span>' +
      '        <span id="trade-hold-avg" style="color:#fff;">0 Cal</span>' +
      '      </div>' +
      '      <div style="display:flex; justify-content:space-between;">' +
      '        <span class="muted">평가 손익:</span>' +
      '        <span id="trade-hold-pl" style="color:#fff;">0 Cal</span>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    var myLogs = db.stockMarket.tradeLog.filter(function(l) { return l.studentId === studentId; });
    var tradeLogRows = "";
    if (myLogs.length === 0) {
      tradeLogRows = '<tr><td colspan="5" class="empty-state" style="text-align:center; padding:1.5rem; color:#94a3b8;">최근 거래 기록이 없습니다.</td></tr>';
    } else {
      var j;
      for (j = 0; j < Math.min(myLogs.length, 10); j++) {
        var log = myLogs[j];
        var typeText = log.type === "buy" ? "매수" : "매도";
        var typeColor = log.type === "buy" ? "#ef4444" : "#3b82f6";
        tradeLogRows += 
          '<tr style="border-bottom:1px solid rgba(255,255,255,0.03);">' +
          '  <td style="padding:8px; font-size:0.8rem; color:#94a3b8;">' + fmtTime(log.occurredAt) + '</td>' +
          '  <td style="padding:8px;"><strong>' + escapeHtml(log.name) + '</strong></td>' +
          '  <td style="padding:8px; color:' + typeColor + '; font-weight:600;">' + typeText + '</td>' +
          '  <td class="td-num" style="padding:8px; text-align:right;">' + formatNum(log.shares) + '주</td>' +
          '  <td class="td-num" style="padding:8px; text-align:right; font-weight:600;">' + formatNum(log.totalKcal) + ' Cal</td>' +
          '</tr>';
      }
    }

    var logSectionHtml = 
      '<section class="panel" style="margin-top:1.5rem;">' +
      '  <h2 class="panel__title">📋 최근 모의투자 거래 내역 (최대 10건)</h2>' +
      '  <div class="table-wrap">' +
      '    <table class="data" style="width:100%; border-collapse:collapse;">' +
      '      <thead>' +
      '        <tr style="border-bottom:2px solid var(--border); text-align:left;">' +
      '          <th style="padding:8px; font-weight:600; color:#94a3b8;">시각</th>' +
      '          <th style="padding:8px; font-weight:600; color:#94a3b8;">종목명</th>' +
      '          <th style="padding:8px; font-weight:600; color:#94a3b8;">구분</th>' +
      '          <th style="padding:8px; text-align:right; font-weight:600; color:#94a3b8;">체결 수량</th>' +
      '          <th style="padding:8px; text-align:right; font-weight:600; color:#94a3b8;">거래 금액</th>' +
      '        </tr>' +
      '      </thead>' +
      '      <tbody>' +
      tradeLogRows +
      '      </tbody>' +
      '    </table>' +
      '  </div>' +
      '</section>';

    var headerButtons = "";
    if (preview) {
      headerButtons = '<p class="muted" style="text-align:right; margin:0 0 1rem 0;">* 교사 미리보기 모드입니다. 거래 주문은 제출할 수 없습니다.</p>';
    }

    return (
      inlineStyles +
      '<div class="stock-market-root stack" style="gap:1rem;">' +
      '  <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem; margin-bottom:1rem;">' +
      '    <h2 class="panel__title" style="margin:0; font-size:1.5rem; display:flex; align-items:center; gap:0.5rem;">📈 실시간 주식 모의투자 거래소</h2>' +
      '    <button type="button" id="btn-refresh-prices" class="btn btn--ghost btn--sm">🔄 시세 새로고침</button>' +
      '  </div>' +
      headerButtons +
      connectionStatusHtml +
      statusAlertHtml +
      accountHtml +
      '  <section class="panel">' +
      '    <h2 class="panel__title" style="margin-bottom:0.8rem;">🏛️ 주식 종목 시세 및 보유 현황</h2>' +
      '    <p class="panel__text" style="font-size:0.85rem; color:#94a3b8; margin-bottom:1rem;">' +
      '      실제 한국투자증권 Open API를 통해 거래소 시세를 실시간 연동합니다. 환율은 <strong>1 Cal = 10,000원 고정</strong>입니다.' +
      '    </p>' +
      '    <div class="table-wrap">' +
      '      <table class="data" style="width:100%; border-collapse:collapse;">' +
      '        <thead>' +
      '          <tr style="border-bottom:2px solid var(--border); text-align:left;">' +
      '            <th style="padding:10px 8px; font-weight:600; color:#94a3b8;">종목명</th>' +
      '            <th style="padding:10px 8px; text-align:right; font-weight:600; color:#94a3b8;">현재가</th>' +
      '            <th style="padding:10px 8px; text-align:right; font-weight:600; color:#94a3b8;">전일대비</th>' +
      '            <th style="padding:10px 8px; text-align:right; font-weight:600; color:#94a3b8;">보유수량</th>' +
      '            <th style="padding:10px 8px; text-align:right; font-weight:600; color:#94a3b8;">평균단가</th>' +
      '            <th style="padding:10px 8px; text-align:right; font-weight:600; color:#94a3b8;">평가손익</th>' +
      '            <th style="padding:10px 8px; text-align:center; font-weight:600; color:#94a3b8;">주문</th>' +
      '          </tr>' +
      '        </thead>' +
      '        <tbody>' +
      stockListRows +
        '        </tbody>' +
        '      </table>' +
        '    </div>' +
        '  </section>' +
        tradePanelHtml +
        logSectionHtml +
        '</div>'
      );
    }

    function viewStudentStockMarket(session) {
      if (window.activeStockInterval) {
        clearInterval(window.activeStockInterval);
        window.activeStockInterval = null;
      }
      
      var db = getDb();
      if (!session.studentId) {
        shell(renderStudentChrome("오류", '<p class="panel__text">학생 정보가 없습니다.</p>'));
        bindLogout();
        return;
      }

      ensureStockMarket(db);
      if (db.stockMarket.currentPrices && Object.keys(db.stockMarket.currentPrices).length > 0) {
        window.currentStockPrices = db.stockMarket.currentPrices;
      }
      
      // 학생 화면에서는 API 호출을 직접 날리지 않으므로 조회 중 플래그 해제
      window.isFetchingStockPrices = false;
      window.stockPricesError = null;
      
      function drawPage() {
        var innerDb = getDb();
        var main = buildStockMarketStudentHtml(innerDb, session.studentId, { preview: false });
        shell(
          renderStudentChrome("실시간 모의투자 거래소", main, {
            subNavLinks: getStudentSubNavLinks(innerDb, session, "stock-market"),
          })
        );
        bindLogout();
        bindStockMarketStudentEvents(innerDb, session.studentId, false);
      }
      
      drawPage();
      
      // 10초마다 로컬 DB를 다시 감시하여 시세 정보 변경 감지 시 차트 히스토리 및 화면 리렌더링
      var lastLoggedPricesUpdatedAt = db.stockMarket.lastPricesUpdatedAt || 0;
      window.activeStockInterval = setInterval(function() {
        var pollingDb = getDb();
        var currentUpdate = pollingDb.stockMarket.lastPricesUpdatedAt || 0;
        
        if (pollingDb.stockMarket.currentPrices && Object.keys(pollingDb.stockMarket.currentPrices).length > 0) {
          window.currentStockPrices = pollingDb.stockMarket.currentPrices;
          window.stockPricesError = null;
        }
        
        if (currentUpdate !== lastLoggedPricesUpdatedAt) {
          lastLoggedPricesUpdatedAt = currentUpdate;
          
          if (window.currentStockPrices) {
            // 상세 모달이 열려 있는 경우에만 차트 히스토리 갱신
            if (window.activeStockDetailCode && window.activeStockDetailChart) {
              var code = window.activeStockDetailCode;
              var priceInfo = window.currentStockPrices[code];
              if (priceInfo && typeof priceInfo.price === "number") {
                var priceCal = priceInfo.price / 10000;
                window.stockPriceHistories = window.stockPriceHistories || {};
                var hist = window.stockPriceHistories[code] || [];
                hist.push(priceCal);
                if (hist.length > 10) {
                  hist.shift();
                }
                
                var labels = [];
                for (var idx = 0; idx < hist.length; idx++) {
                  labels.push(idx === hist.length - 1 ? "현재" : (hist.length - 1 - idx) + "회 전");
                }
                
                window.activeStockDetailChart.data.labels = labels;
                window.activeStockDetailChart.data.datasets[0].data = hist;
                window.activeStockDetailChart.update();
              }
            }
          }
          
          var tradePanel = document.getElementById("stock-trade-panel");
          if (!window.activeStockDetailCode) {
            if (tradePanel && tradePanel.style.display === "none") {
              drawPage();
            }
          }
        }
      }, 10000);
    }

    function bindStockMarketStudentEvents(db, studentId, isPreview) {
      var root = document.getElementById("app");
      if (!root) return;
      
      var st = getStudent(db, studentId);
      if (!st) return;
      ensureStudentStockPortfolio(st);

      // Initialize portfolio doughnut chart
      (function() {
        var canvas = document.getElementById("portfolio-doughnut-chart");
        if (!canvas) return;
        
        if (window.activePortfolioChart) {
          window.activePortfolioChart.destroy();
          window.activePortfolioChart = null;
        }
        
        var labels = ["보유 현금"];
      var data = [st.calory || 0];
      var colors = ["#3b82f6"]; // Neon Blue for Cash
      
      var holdingCodes = Object.keys(st.stockPortfolio.holdings || {});
      var neonPalettes = [
        "rgba(244, 63, 94, 0.85)",  // Neon Pink
        "rgba(16, 185, 129, 0.85)",  // Emerald Green
        "rgba(245, 158, 11, 0.85)",  // Vivid Orange
        "rgba(168, 85, 247, 0.85)",  // Vibrant Purple
        "rgba(236, 72, 153, 0.85)",  // Hot Pink
        "rgba(20, 184, 166, 0.85)"   // Bright Teal
      ];
      
      var neonColorIdx = 0;
      for (var idx = 0; idx < holdingCodes.length; idx++) {
        var hCode = holdingCodes[idx];
        var holding = st.stockPortfolio.holdings[hCode];
        if (holding && holding.amount > 0) {
          var stockObj = db.stockMarket.stocks.find(function(s) { return s.code === hCode; });
          var stockName = stockObj ? stockObj.name : hCode;
          
          var curPriceKcal = 0;
          if (window.currentStockPrices && window.currentStockPrices[hCode] && typeof window.currentStockPrices[hCode].price === "number") {
            curPriceKcal = window.currentStockPrices[hCode].price / 10000;
          } else {
            curPriceKcal = holding.avgPriceKcal || 0;
          }
          
          var stockVal = holding.amount * curPriceKcal;
          if (stockVal > 0) {
            labels.push(stockName);
            data.push(Math.round(stockVal * 100) / 100);
            colors.push(neonPalettes[neonColorIdx % neonPalettes.length]);
            neonColorIdx++;
          }
        }
      }
      
      try {
        var ctx = canvas.getContext("2d");
        window.activePortfolioChart = new Chart(ctx, {
          type: "doughnut",
          data: {
            labels: labels,
            datasets: [{
              data: data,
              backgroundColor: colors,
              borderWidth: 1,
              borderColor: "rgba(15, 23, 42, 0.6)"
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    var label = context.label || "";
                    var val = context.raw || 0;
                    return " " + label + ": " + formatNum(val) + " Cal";
                  }
                }
              }
            },
            cutout: "65%"
          }
        });

        // Calculate and render top 3 asset distribution in Korean text
        (function() {
          var totalVal = 0;
          for (var i = 0; i < data.length; i++) {
            totalVal += data[i];
          }
          
          var assetsList = [];
          for (var i = 0; i < data.length; i++) {
            assetsList.push({
              label: labels[i],
              val: data[i],
              color: colors[i],
              pct: totalVal > 0 ? (data[i] / totalVal * 100) : 0
            });
          }
          
          assetsList.sort(function(a, b) {
            return b.val - a.val;
          });
          
          var top3 = assetsList.slice(0, 3);
          var topAssetsContainer = document.getElementById("portfolio-top-assets");
          if (topAssetsContainer) {
            var topHtml = '<div style="font-size: 0.72rem; color: var(--accent2); font-weight: 700; margin-bottom: 0.35rem; letter-spacing: -0.02em;">📊 자산 비중 TOP 3</div>';
            if (totalVal === 0) {
              topHtml += '<div style="font-size: 0.7rem; color: #64748b;">보유 자산 없음</div>';
            } else {
              for (var k = 0; k < top3.length; k++) {
                var asset = top3[k];
                topHtml += 
                  '<div style="display:flex; align-items:center; justify-content:space-between; gap:0.4rem; font-size:0.7rem; line-height:1.4; padding: 0.1rem 0;">' +
                  '  <div style="display:flex; align-items:center; gap:0.35rem; overflow:hidden; flex-shrink:0;">' +
                  '    <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background-color:' + asset.color + '; box-shadow:0 0 4px ' + asset.color + '; flex-shrink:0;"></span>' +
                  '    <span style="color:#e2e8f0; font-weight:500; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:80px;" title="' + asset.label + '">' + asset.label + '</span>' +
                  '  </div>' +
                  '  <span style="color:#38bdf8; font-weight:600; font-family:monospace; flex-shrink:0; margin-left: auto;">' + asset.pct.toFixed(1) + '%</span>' +
                  '</div>';
              }
            }
            topAssetsContainer.innerHTML = topHtml;
          }
        })();
      } catch (err) {
        console.error("Doughnut chart generation failed:", err);
      }
    })();
    
    // Auto-fetch in preview mode if prices aren't loaded and not currently fetching
    if (isPreview && !window.currentStockPrices && !window.isFetchingStockPrices) {
      window.isFetchingStockPrices = true;
      window.stockPricesError = null;
      
      var updatePreviewDOM = function() {
        var refreshDb = getDb();
        var main = buildStockMarketStudentHtml(refreshDb, studentId, { preview: true });
        var wrapper = root.querySelector(".stock-market-root");
        if (wrapper) {
          var parent = wrapper.parentNode;
          var banner = parent.querySelector(".teacher-preview-banner");
          var subNav = parent.querySelector(".app-sub-nav");
          parent.innerHTML = (banner ? banner.outerHTML : "") + (subNav ? subNav.outerHTML : "") + main;
          bindStockMarketStudentEvents(refreshDb, studentId, true);
        }
      };
      
      updatePreviewDOM();
      
      fetchRealtimePrices(db, function(res) {
        window.isFetchingStockPrices = false;
        if (res.ok) {
          window.currentStockPrices = res.data;
          window.stockPricesError = null;
        } else {
          window.stockPricesError = res.msg;
          if (res.data && Object.keys(res.data).length > 0) {
            window.currentStockPrices = res.data;
          }
        }
        updatePreviewDOM();
      });
    }

    var buyBtn = document.getElementById("tab-trade-buy");
    var sellBtn = document.getElementById("tab-trade-sell");
    var tradeActionInput = document.getElementById("trade-input-action");
    var submitBtn = document.getElementById("btn-submit-trade");
    var closeBtn = document.getElementById("btn-close-trade");
    var tradePanel = document.getElementById("stock-trade-panel");
    var tradeAmountInput = document.getElementById("trade-amount-input");
    var tradeModeRadios = root.querySelectorAll('input[name="tradeMode"]');
    var tradeAmountLabel = document.getElementById("trade-amount-label");
    var tradeEstResult = document.getElementById("trade-est-result");
    
    function updateEstimation() {
      var code = document.getElementById("trade-input-code").value;
      if (!code) return;
      
      var priceInfo = window.currentStockPrices && window.currentStockPrices[code];
      if (!priceInfo || typeof priceInfo.price !== "number" || priceInfo.price <= 0) {
        tradeEstResult.innerText = "시세 조회 불가";
        return;
      }
      
      var priceCal = priceInfo.price / 10000;
      var amount = parseFloat(tradeAmountInput.value);
      var action = tradeActionInput.value;
      
      var modeVal = "kcal";
      var i;
      for (i = 0; i < tradeModeRadios.length; i++) {
        if (tradeModeRadios[i].checked) {
          modeVal = tradeModeRadios[i].value;
          break;
        }
      }
      
      if (isNaN(amount) || amount <= 0) {
        tradeEstResult.innerText = modeVal === "kcal" ? "0주" : "0 Cal";
        return;
      }
      
      if (action === "buy") {
        if (modeVal === "kcal") {
          var estShares = amount / priceCal;
          tradeEstResult.innerText = formatNum(Math.round(estShares * 10000) / 10000) + "주";
        } else {
          var estCost = amount * priceCal;
          tradeEstResult.innerText = formatNum(Math.round(estCost * 100) / 100) + " Cal";
        }
      } else {
        if (modeVal === "kcal") {
          var estShares = amount / priceCal;
          tradeEstResult.innerText = formatNum(Math.round(estShares * 10000) / 10000) + "주";
        } else {
          var estProceeds = amount * priceCal;
          tradeEstResult.innerText = formatNum(Math.round(estProceeds * 100) / 100) + " Cal";
        }
      }
    }
    
    var tradeBtns = root.querySelectorAll(".js-stock-trade-btn");
    var j;
    for (j = 0; j < tradeBtns.length; j++) {
      (function(btn) {
        btn.addEventListener("click", function() {
          if (btn.disabled) return;
          var action = btn.getAttribute("data-action");
          var code = btn.getAttribute("data-code");
          var name = btn.getAttribute("data-name");
          
          var priceInfo = window.currentStockPrices && window.currentStockPrices[code];
          var priceCal = (priceInfo && typeof priceInfo.price === "number" && priceInfo.price > 0) ? priceInfo.price / 10000 : 0;
          if (priceCal <= 0) {
            alert("실시간 시세가 조회되지 않았거나 가격이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.");
            if (tradePanel) tradePanel.style.display = "none";
            return;
          }
          
          document.getElementById("trade-input-code").value = code;
          document.getElementById("trade-input-action").value = action;
          document.getElementById("trade-stock-name").innerText = name;
          document.getElementById("trade-stock-code").innerText = code;
          
          document.getElementById("trade-curr-price").innerText = formatNum(Math.round(priceCal * 100) / 100) + " Cal";
          
          var holding = st.stockPortfolio.holdings[code];
          var holdQty = holding ? holding.amount : 0;
          var holdAvg = holding ? holding.avgPriceKcal : 0;
          
          var holdPlVal = 0;
          var plPercent = 0;
          if (holdQty > 0 && priceCal > 0) {
            holdPlVal = holdQty * (priceCal - holdAvg);
            plPercent = (holdQty * holdAvg) > 0 ? (holdPlVal / (holdQty * holdAvg)) * 100 : 0;
            if (typeof plPercent !== 'number' || isNaN(plPercent) || !isFinite(plPercent)) {
              plPercent = 0;
            }
          }
          
          document.getElementById("trade-hold-qty").innerText = formatNum(holdQty) + "주";
          document.getElementById("trade-hold-avg").innerText = formatNum(holdAvg) + " Cal";
          
          var plSign = holdPlVal >= 0 ? "+" : "";
          var plText = plSign + formatNum(Math.round(holdPlVal * 100) / 100) + " Cal (" + plSign + plPercent.toFixed(2) + "%)";
          var plEl = document.getElementById("trade-hold-pl");
          plEl.innerText = plText;
          if (holdPlVal > 0) plEl.style.color = "#ef4444";
          else if (holdPlVal < 0) plEl.style.color = "#3b82f6";
          else plEl.style.color = "#fff";
          
          if (action === "buy") {
            buyBtn.classList.add("active");
            buyBtn.style.color = "#ef4444";
            buyBtn.style.borderBottom = "3px solid #ef4444";
            sellBtn.classList.remove("active");
            sellBtn.style.color = "#94a3b8";
            sellBtn.style.borderBottom = "none";
            submitBtn.innerText = "매수 주문 제출";
            submitBtn.className = "btn btn--accent";
          } else {
            sellBtn.classList.add("active");
            sellBtn.style.color = "#f43f5e";
            sellBtn.style.borderBottom = "3px solid #f43f5e";
            buyBtn.classList.remove("active");
            buyBtn.style.color = "#94a3b8";
            buyBtn.style.borderBottom = "none";
            submitBtn.innerText = "매도 주문 제출";
            submitBtn.className = "btn btn--danger";
          }
          
          tradePanel.style.display = "block";
          tradePanel.scrollIntoView({ behavior: 'smooth' });
          
          tradeAmountInput.value = "";
          updateEstimation();
        });
      })(tradeBtns[j]);
    }
    
    if (buyBtn && sellBtn) {
      buyBtn.addEventListener("click", function() {
        tradeActionInput.value = "buy";
        buyBtn.classList.add("active");
        buyBtn.style.color = "#ef4444";
        buyBtn.style.borderBottom = "3px solid #ef4444";
        sellBtn.classList.remove("active");
        sellBtn.style.color = "#94a3b8";
        sellBtn.style.borderBottom = "none";
        submitBtn.innerText = "매수 주문 제출";
        submitBtn.className = "btn btn--accent";
        var curMode = "kcal";
        var i;
        for (i = 0; i < tradeModeRadios.length; i++) {
          if (tradeModeRadios[i].checked) curMode = tradeModeRadios[i].value;
        }
        tradeAmountLabel.innerText = curMode === "kcal" ? "매수 금액 (Cal)" : "매수 수량 (주)";
        updateEstimation();
      });
      
      sellBtn.addEventListener("click", function() {
        tradeActionInput.value = "sell";
        sellBtn.classList.add("active");
        sellBtn.style.color = "#f43f5e";
        sellBtn.style.borderBottom = "3px solid #f43f5e";
        buyBtn.classList.remove("active");
        buyBtn.style.color = "#94a3b8";
        buyBtn.style.borderBottom = "none";
        submitBtn.innerText = "매도 주문 제출";
        submitBtn.className = "btn btn--danger";
        var curMode = "kcal";
        var i;
        for (i = 0; i < tradeModeRadios.length; i++) {
          if (tradeModeRadios[i].checked) curMode = tradeModeRadios[i].value;
        }
        tradeAmountLabel.innerText = curMode === "kcal" ? "매도 금액 (Cal)" : "매도 수량 (주)";
        updateEstimation();
      });
    }
    
    var k;
    for (k = 0; k < tradeModeRadios.length; k++) {
      tradeModeRadios[k].addEventListener("change", function(e) {
        var modeVal = e.target.value;
        var act = tradeActionInput.value;
        if (act === "buy") {
          tradeAmountLabel.innerText = modeVal === "kcal" ? "매수 금액 (Cal)" : "매수 수량 (주)";
        } else {
          tradeAmountLabel.innerText = modeVal === "kcal" ? "매도 금액 (Cal)" : "매도 수량 (주)";
        }
        updateEstimation();
      });
    }
    
    if (tradeAmountInput) {
      tradeAmountInput.addEventListener("input", updateEstimation);
    }
    
    if (closeBtn) {
      closeBtn.addEventListener("click", function() {
        tradePanel.style.display = "none";
      });
    }
    
    var refreshBtn = document.getElementById("btn-refresh-prices");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function() {
        var refreshDb = getDb();
        refreshBtn.disabled = true;
        refreshBtn.innerText = "🔄 조회 중...";
        
        window.isFetchingStockPrices = true;
        window.stockPricesError = null;
        
        fetchRealtimePrices(refreshDb, function(res) {
          window.isFetchingStockPrices = false;
          refreshBtn.disabled = false;
          refreshBtn.innerText = "🔄 시세 새로고침";
          
          if (res.ok) {
            window.currentStockPrices = res.data;
            window.stockPricesError = null;
            if (isPreview) {
              var main = buildStockMarketStudentHtml(refreshDb, studentId, { preview: true });
              var wrapper = root.querySelector(".stock-market-root");
              if (wrapper) {
                var parent = wrapper.parentNode;
                var banner = parent.querySelector(".teacher-preview-banner");
                var subNav = parent.querySelector(".app-sub-nav");
                parent.innerHTML = (banner ? banner.outerHTML : "") + (subNav ? subNav.outerHTML : "") + main;
                bindStockMarketStudentEvents(refreshDb, studentId, true);
              }
            } else {
              viewStudentStockMarket({ studentId: studentId });
            }
          } else {
            window.stockPricesError = res.msg;
            if (res.data && Object.keys(res.data).length > 0) {
              window.currentStockPrices = res.data;
            }
            alert(res.msg);
            if (isPreview) {
              var main = buildStockMarketStudentHtml(refreshDb, studentId, { preview: true });
              var wrapper = root.querySelector(".stock-market-root");
              if (wrapper) {
                var parent = wrapper.parentNode;
                var banner = parent.querySelector(".teacher-preview-banner");
                var subNav = parent.querySelector(".app-sub-nav");
                parent.innerHTML = (banner ? banner.outerHTML : "") + (subNav ? subNav.outerHTML : "") + main;
                bindStockMarketStudentEvents(refreshDb, studentId, true);
              }
            } else {
              viewStudentStockMarket({ studentId: studentId });
            }
          }
        }, true);
      });
    }
    
    var form = document.getElementById("form-stock-trade");
    if (form) {
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        if (isPreview) {
          alert("미리보기 모드에서는 주식을 구매하거나 판매할 수 없습니다.");
          return;
        }
        
        var code = document.getElementById("trade-input-code").value;
        var action = tradeActionInput.value;
        var amount = parseFloat(tradeAmountInput.value);
        
        var modeVal = "kcal";
        var i;
        for (i = 0; i < tradeModeRadios.length; i++) {
          if (tradeModeRadios[i].checked) {
            modeVal = tradeModeRadios[i].value;
            break;
          }
        }
        
        if (isNaN(amount) || amount <= 0) {
          alert("올바른 수량을 입력해 주세요.");
          return;
        }
        
        var confirmMsg = "";
        if (action === "buy") {
          confirmMsg = "선택하신 종목을 정말 매수하시겠습니까?";
        } else {
          confirmMsg = "선택하신 종목을 정말 매도하시겠습니까?";
        }
        
        if (!confirm(confirmMsg)) return;
        
        var tradeDb = getDb();
        var res;
        if (action === "buy") {
          res = buyStock(tradeDb, studentId, code, modeVal, amount);
        } else {
          res = sellStock(tradeDb, studentId, code, modeVal, amount);
        }
        
        Promise.resolve(res).then(function (tradeRes) {
          if (tradeRes.ok) {
            alert(tradeRes.msg);
            viewStudentStockMarket({ studentId: studentId });
          } else {
            alert(tradeRes.msg);
          }
        }).catch(function (err) {
          console.error("[StockMarket] 거래 실행 에러:", err);
          alert("주식 거래 처리 중 예기치 못한 오류가 발생했습니다.");
        });
      });
    }

    // Detail Modal click binding
    var detailTriggers = root.querySelectorAll(".js-stock-detail-trigger");
    var dIdx;
    for (dIdx = 0; dIdx < detailTriggers.length; dIdx++) {
      (function(trig) {
        trig.addEventListener("click", function() {
          var code = trig.getAttribute("data-code");
          var name = trig.getAttribute("data-name");
          
          var priceInfo = window.currentStockPrices && window.currentStockPrices[code];
          var priceCal = (priceInfo && typeof priceInfo.price === "number" && priceInfo.price > 0) ? priceInfo.price / 10000 : 0;
          if (priceCal <= 0) {
            alert("실시간 시세가 아직 조회되지 않았습니다. 잠시 후 다시 시도해 주세요.");
            return;
          }
          
          // Lazy-init price history for this stock if not exists
          window.stockPriceHistories = window.stockPriceHistories || {};
          if (!window.stockPriceHistories[code]) {
            var priceHistory = [];
            var basePrice = priceCal;
            // Generate 9 historical walk points back in time (10 seconds intervals)
            for (var k = 8; k >= 0; k--) {
              var noise = (Math.random() - 0.5) * 0.02 * basePrice;
              priceHistory.unshift(basePrice + noise);
              basePrice = basePrice + noise;
            }
            priceHistory.push(priceCal); // Current price
            window.stockPriceHistories[code] = priceHistory;
          }
          
          var hist = window.stockPriceHistories[code];
          
          // Build the detailed line chart modal
          var modalHtml =
            '<div class="peer-modal__backdrop" id="stock-detail-backdrop"></div>' +
            '<div class="peer-modal__dialog" style="max-width: 750px; text-align: left; padding: 2.2rem 2rem;">' +
              '<button class="peer-modal__close-btn" id="stock-detail-close" aria-label="닫기">&times;</button>' +
              '<div style="margin-bottom: 1.2rem;">' +
                '<span style="font-size: 0.8rem; color: var(--accent2); font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">종목 상세분석</span>' +
                '<h3 style="margin: 0.2rem 0; font-size: 1.6rem; font-weight: 800; color: #fff;">' + escapeHtml(name) + ' <span style="font-size:1.1rem; color:#94a3b8; font-weight:normal;">' + code + '</span></h3>' +
              '</div>' +
              
              // Key Metrics Row
              '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; background: rgba(0,0,0,0.2); border: 1px solid var(--border); border-radius: 8px; padding: 0.8rem 1.2rem;">' +
                '<div>' +
                  '<div style="font-size: 0.8rem; color: #94a3b8;">현재가</div>' +
                  '<div style="font-size: 1.2rem; font-weight: 700; color: #38bdf8;">' + formatNum(Math.round(priceCal * 100) / 100) + ' Cal</div>' +
                '</div>' +
                '<div>' +
                  '<div style="font-size: 0.8rem; color: #94a3b8;">전일대비</div>' +
                  '<div style="font-size: 1.1rem; font-weight: 700; ' + (priceInfo.compareSign === "1" || priceInfo.compareSign === "2" ? "color:#ef4444;" : priceInfo.compareSign === "4" || priceInfo.compareSign === "5" ? "color:#3b82f6;" : "color:#94a3b8;") + '">' + 
                    (priceInfo.compareSign === "1" || priceInfo.compareSign === "2" ? "▲ " : priceInfo.compareSign === "4" || priceInfo.compareSign === "5" ? "▼ " : "") + 
                    formatNum(priceInfo.changePrice) + ' (' + priceInfo.changeRate + '%)' +
                  '</div>' +
                '</div>' +
                '<div>' +
                  '<div style="font-size: 0.8rem; color: #94a3b8;">나의 보유량</div>' +
                  '<div style="font-size: 1.2rem; font-weight: 700; color: #fff;">' + formatNum(st.stockPortfolio.holdings[code] ? st.stockPortfolio.holdings[code].amount : 0) + ' 주</div>' +
                '</div>' +
              '</div>' +
              
              // Chart Area
              '<div style="position: relative; height: 260px; margin-bottom: 1.5rem; background: rgba(15, 23, 42, 0.4); border: 1px solid var(--border); border-radius: 8px; padding: 1rem;">' +
                '<canvas id="stock-detail-chart-canvas"></canvas>' +
              '</div>' +
              
              // Actions
              '<div style="display:flex; justify-content:flex-end; gap:0.8rem;">' +
                '<button type="button" id="stock-detail-action-buy" class="btn btn--accent" style="padding: 0.5rem 1.5rem; font-weight: 700;">매수 주문하기</button>' +
                '<button type="button" id="stock-detail-action-sell" class="btn btn--danger" style="padding: 0.5rem 1.5rem; font-weight: 700;">매도 주문하기</button>' +
              '</div>' +
            '</div>';
            
          var modalEl = document.createElement("div");
          modalEl.className = "peer-modal";
          modalEl.innerHTML = modalHtml;
          document.body.appendChild(modalEl);
          
          window.activeStockDetailCode = code;
          
          if (window.activeStockDetailChart) {
            window.activeStockDetailChart.destroy();
            window.activeStockDetailChart = null;
          }
          
          try {
            var ctx = document.getElementById("stock-detail-chart-canvas").getContext("2d");
            var labels = [];
            for (var idx = 0; idx < hist.length; idx++) {
              labels.push(idx === hist.length - 1 ? "현재" : (hist.length - 1 - idx) + "분 전");
            }
            
            var glowColor = priceInfo.compareSign === "4" || priceInfo.compareSign === "5" ? "rgba(59, 130, 246, 0.2)" : "rgba(239, 68, 68, 0.2)";
            var lineColor = priceInfo.compareSign === "4" || priceInfo.compareSign === "5" ? "#3b82f6" : "#ef4444";
            
            window.activeStockDetailChart = new Chart(ctx, {
              type: "line",
              data: {
                labels: labels,
                datasets: [{
                  label: name + " 가격 흐름",
                  data: hist,
                  borderColor: lineColor,
                  backgroundColor: glowColor,
                  borderWidth: 3,
                  fill: true,
                  tension: 0.35,
                  pointRadius: 4,
                  pointBackgroundColor: lineColor,
                  pointHoverRadius: 6
                }]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false }
                },
                scales: {
                  x: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: { color: "#94a3b8", font: { size: 10 } }
                  },
                  y: {
                    grid: { color: "rgba(255, 255, 255, 0.05)" },
                    ticks: {
                      color: "#94a3b8",
                      font: { size: 10 },
                      callback: function(val) { return formatNum(Math.round(val * 100) / 100) + " Cal"; }
                    }
                  }
                }
              }
            });
          } catch (e) {
            console.error("Line chart generation failed:", e);
          }
          
          var closeModal = function() {
            if (window.activeStockDetailChart) {
              window.activeStockDetailChart.destroy();
              window.activeStockDetailChart = null;
            }
            window.activeStockDetailCode = null;
            if (modalEl.parentNode) {
              modalEl.parentNode.removeChild(modalEl);
            }
          };
          
          document.getElementById("stock-detail-backdrop").addEventListener("click", closeModal);
          document.getElementById("stock-detail-close").addEventListener("click", closeModal);
          
          var triggerTradeAction = function(action) {
            closeModal();
            var tradeBtn = root.querySelector('.js-stock-trade-btn[data-code="' + code + '"][data-action="' + action + '"]');
            if (tradeBtn) {
              tradeBtn.click();
            }
          };
          
          document.getElementById("stock-detail-action-buy").addEventListener("click", function() {
            triggerTradeAction("buy");
          });
          
          var sellActBtn = document.getElementById("stock-detail-action-sell");
          var hasQty = st.stockPortfolio.holdings[code] && st.stockPortfolio.holdings[code].amount > 0;
          if (!hasQty) {
            sellActBtn.style.opacity = "0.5";
            sellActBtn.style.cursor = "not-allowed";
            sellActBtn.disabled = true;
          } else {
            sellActBtn.addEventListener("click", function() {
              triggerTradeAction("sell");
            });
          }
        });
      })(detailTriggers[dIdx]);
    }
  }
function buildStockMarketTeacherStocksTableRows(db) {
    var stocksTableRows = "";
    var stocks = db.stockMarket.stocks || [];
    if (stocks.length === 0) {
      stocksTableRows = '<tr><td colspan="5" class="empty-state" style="text-align:center; padding:1.5rem; color:#94a3b8;">등록된 종목이 없습니다.</td></tr>';
    } else {
      var i;
      for (i = 0; i < stocks.length; i++) {
        var s = stocks[i];
        var priceHtml = '<span style="color:#94a3b8; font-size:0.9rem;">시세 없음</span>';
        var changeHtml = '-';
        if (window.currentStockPrices && window.currentStockPrices[s.code]) {
          var pInfo = window.currentStockPrices[s.code];
          if (typeof pInfo.price === 'number' && pInfo.price > 0) {
            var pKcal = pInfo.price / 10000;
            priceHtml = '<strong>' + formatNum(pKcal) + ' Cal</strong><br/><span style="font-size:0.75rem; color:#94a3b8;">(' + formatNum(pInfo.price) + '원)</span>';
            
            if (pInfo.compareSign && pInfo.comparePrice) {
              var sign = pInfo.compareSign === "1" || pInfo.compareSign === "2" ? "▲" : pInfo.compareSign === "4" || pInfo.compareSign === "5" ? "▼" : "";
              var color = pInfo.compareSign === "1" || pInfo.compareSign === "2" ? "#ef4444" : pInfo.compareSign === "4" || pInfo.compareSign === "5" ? "#3b82f6" : "#94a3b8";
              var compPriceKcal = parseFloat(pInfo.comparePrice) / 10000;
              changeHtml = '<span style="color:' + color + '; font-weight:600;">' + sign + ' ' + formatNum(compPriceKcal) + ' Cal</span><br/>' +
                           '<span style="font-size:0.75rem; color:' + color + ';">(' + sign + ' ' + formatNum(pInfo.comparePrice) + '원)</span>';
            }
          }
        }
        
        stocksTableRows += 
          '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '  <td style="padding:10px 8px;"><strong>' + escapeHtml(s.name) + '</strong></td>' +
          '  <td style="padding:10px 8px; font-family:monospace;">' + s.code + '</td>' +
          '  <td style="padding:10px 8px; text-align:right;">' + priceHtml + '</td>' +
          '  <td style="padding:10px 8px; text-align:right;">' + changeHtml + '</td>' +
          '  <td style="padding:10px 8px; text-align:center;">' +
          '    <button type="button" class="btn btn--ghost btn--xs js-btn-delete-stock" data-code="' + s.code + '" data-name="' + escapeHtml(s.name) + '" style="color:#ef4444; border-color:rgba(239,68,68,0.3);">종목 삭제</button>' +
          '  </td>' +
          '</tr>';
      }
    }
    return stocksTableRows;
  }

  function buildStockMarketTeacherStudentPortfolioRows(db) {
    var studentPortfolioRows = "";
    var students = studentsSortedByNumber(db);
    if (students.length === 0) {
      studentPortfolioRows = '<tr><td colspan="7" class="empty-state" style="text-align:center; padding:1.5rem; color:#94a3b8;">등록된 학생이 없습니다.</td></tr>';
    } else {
      var i;
      for (i = 0; i < students.length; i++) {
        var st = students[i];
        ensureStudentStockPortfolio(st);
        
        var holdingsStr = "";
        var totalEvaluationKcal = 0;
        var totalPurchaseCostKcal = 0;
        
        var holdingCodes = Object.keys(st.stockPortfolio.holdings || {});
        if (holdingCodes.length === 0) {
          holdingsStr = '<span style="color:#94a3b8; font-size:0.85rem;">보유 주식 없음</span>';
        } else {
          var holdingItems = [];
          var hIdx;
          for (hIdx = 0; hIdx < holdingCodes.length; hIdx++) {
            var hCode = holdingCodes[hIdx];
            var holding = st.stockPortfolio.holdings[hCode];
            var stockObj = db.stockMarket.stocks.find(function(s) { return s.code === hCode; });
            var stockName = stockObj ? stockObj.name : hCode;
            
            var curPriceKcal = 0;
            if (window.currentStockPrices && window.currentStockPrices[hCode] && typeof window.currentStockPrices[hCode].price === 'number' && window.currentStockPrices[hCode].price > 0) {
              curPriceKcal = window.currentStockPrices[hCode].price / 10000;
            }
            
            var evalVal = holding.amount * curPriceKcal;
            totalEvaluationKcal += evalVal;
            totalPurchaseCostKcal += holding.amount * holding.avgPriceKcal;
            
            holdingItems.push(
              '<span class="status-pill" style="margin-right:4px; margin-bottom:4px; font-size:0.75rem; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#fff; display:inline-block; padding:2px 6px; border-radius:4px;">' +
              escapeHtml(stockName) + ' (' + formatNum(holding.amount) + '주)' +
              '</span>'
            );
          }
          holdingsStr = holdingItems.join("");
        }
        
        var cashKcal = st.calory || 0;
        totalEvaluationKcal = Math.round(totalEvaluationKcal * 100) / 100;
        var totalAssetsKcal = Math.round((cashKcal + totalEvaluationKcal) * 100) / 100;
        
        var roiHtml = "-";
        if (totalPurchaseCostKcal > 0) {
          if (!window.currentStockPrices) {
            roiHtml = '<span style="color:#94a3b8; font-weight:600;">준비중</span>';
          } else {
            var roi = ((totalEvaluationKcal - totalPurchaseCostKcal) / totalPurchaseCostKcal) * 100;
            if (typeof roi !== 'number' || isNaN(roi) || !isFinite(roi)) {
              roiHtml = '<span style="color:#94a3b8; font-weight:600;">준비중</span>';
            } else {
              var roiColor = roi > 0 ? "#ef4444" : roi < 0 ? "#3b82f6" : "#94a3b8";
              var roiSign = roi > 0 ? "+" : "";
              roiHtml = '<span style="color:' + roiColor + '; font-weight:600;">' + roiSign + roi.toFixed(2) + '%</span>';
            }
          }
        }
        
        studentPortfolioRows +=
          '<tr style="border-bottom:1px solid rgba(255,255,255,0.03);">' +
          '  <td style="padding:10px 8px; text-align:center;">' + (st.number != null ? st.number : "-") + '번</td>' +
          '  <td style="padding:10px 8px;"><strong>' + escapeHtml(st.name) + '</strong></td>' +
          '  <td style="padding:10px 8px; max-width:250px; white-space:normal; word-break:break-all;">' + holdingsStr + '</td>' +
          '  <td style="padding:10px 8px; text-align:right; font-weight:600; color:#e2e8f0;">' + formatNum(cashKcal) + ' Cal</td>' +
          '  <td style="padding:10px 8px; text-align:right; font-weight:600; color:#38bdf8;">' + formatNum(totalEvaluationKcal) + ' Cal</td>' +
          '  <td style="padding:10px 8px; text-align:right; font-weight:600; color:#34d399;">' + formatNum(totalAssetsKcal) + ' Cal</td>' +
          '  <td style="padding:10px 8px; text-align:center;">' + roiHtml + '</td>' +
          '</tr>';
      }
    }
    return studentPortfolioRows;
  }

  function buildStockMarketTeacherTradeLogRows(db) {
    var tradeLogRows = "";
    var logs = db.stockMarket.tradeLog || [];
    if (logs.length === 0) {
      tradeLogRows = '<tr><td colspan="6" class="empty-state" style="text-align:center; padding:1.5rem; color:#94a3b8;">체결 내역이 없습니다.</td></tr>';
    } else {
      var j;
      for (j = 0; j < Math.min(logs.length, 30); j++) {
        var log = logs[j];
        var typeText = log.type === "buy" ? "매수" : "매도";
        var typeColor = log.type === "buy" ? "#ef4444" : "#3b82f6";
        tradeLogRows += 
          '<tr style="border-bottom:1px solid rgba(255,255,255,0.03);">' +
          '  <td style="padding:8px; font-size:0.8rem; color:#94a3b8;">' + fmtTime(log.occurredAt) + '</td>' +
          '  <td style="padding:8px;">' + escapeHtml(log.studentName || "") + '</td>' +
          '  <td style="padding:8px;"><strong>' + escapeHtml(log.name) + '</strong><br/><span style="font-size:0.75rem; color:#94a3b8;">' + log.code + '</span></td>' +
          '  <td style="padding:8px; color:' + typeColor + '; font-weight:600;">' + typeText + '</td>' +
          '  <td class="td-num" style="padding:8px; text-align:right;">' + formatNum(log.shares) + '주<br/><span style="font-size:0.75rem; color:#94a3b8;">@' + formatNum(log.priceKcal) + ' Cal</span></td>' +
          '  <td class="td-num" style="padding:8px; text-align:right; font-weight:600; color:#e2e8f0;">' + formatNum(log.totalKcal) + ' Cal</td>' +
          '</tr>';
      }
    }
    return tradeLogRows;
  }

  function buildStockMarketTeacherHtml(db) {
    ensureStockMarket(db);
    
    var enabledChecked = db.stockMarket.enabled ? " checked" : "";
    var gasUrls = db.stockMarket.gasUrls || ["", "", ""];
    var gasUrlVal1 = gasUrls[0] || "";
    var gasUrlVal2 = gasUrls[1] || "";
    var gasUrlVal3 = gasUrls[2] || "";
    
    var stocksTableRows = buildStockMarketTeacherStocksTableRows(db);
    var tradeLogRows = buildStockMarketTeacherTradeLogRows(db);
    var studentPortfolioRows = buildStockMarketTeacherStudentPortfolioRows(db);

    var apiStatusHtml = "";
    if (window.stockPricesConfigured === true) {
      apiStatusHtml = 
        '<div style="display:flex; align-items:center; gap:0.5rem; background:rgba(16,185,129,0.15); border:1px solid #10b981; padding:0.8rem; border-radius:6px; color:#a7f3d0; margin-bottom:0.5rem;">' +
        '  <span style="font-size:1.2rem;">🟢</span>' +
        '  <div>' +
        '    <strong style="font-size:0.9rem;">한국투자증권(KIS) API 연동 완료</strong>' +
        '    <div style="font-size:0.75rem; color:#6ee7b7; margin-top:0.1rem;">Express 서버에서 직접 실시간 주가를 가져옵니다. (5분 주기 자동 갱신)</div>' +
        '  </div>' +
        '</div>';
    } else if (window.stockPricesConfigured === false) {
      apiStatusHtml = 
        '<div style="display:flex; align-items:center; gap:0.5rem; background:rgba(239,68,68,0.15); border:1px solid #ef4444; padding:0.8rem; border-radius:6px; color:#fecaca; margin-bottom:0.5rem;">' +
        '  <span style="font-size:1.2rem;">🔴</span>' +
        '  <div>' +
        '    <strong style="font-size:0.9rem;">한국투자증권(KIS) API 미설정</strong>' +
        '    <div style="font-size:0.75rem; color:#fca5a5; margin-top:0.1rem;">서버의 .env 파일에 KIS_APP_KEY 및 KIS_APP_SECRET 설정을 완료해 주세요.</div>' +
        '  </div>' +
        '</div>';
    } else {
      apiStatusHtml = 
        '<div style="display:flex; align-items:center; gap:0.5rem; background:rgba(255,255,255,0.05); border:1px solid var(--border); padding:0.8rem; border-radius:6px; color:#94a3b8; margin-bottom:0.5rem;">' +
        '  <span style="display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,0.3); border-radius:50%; border-top-color:#fff; animation:spin-loading 0.8s linear infinite; margin-right:4px; box-sizing:border-box;"></span>' +
        '  <div>' +
        '    <strong style="font-size:0.9rem;">KIS API 연동 상태 확인 중...</strong>' +
        '  </div>' +
        '</div>';
    }

    return (
      '<div class="stock-market-teacher-root stack" style="gap:1.5rem;">' +
      '  <h2 class="panel__title" style="margin:0; font-size:1.5rem;">⚙️ 주식 모의투자 시스템 설정 및 종목 관리</h2>' +
      '  <p class="panel__text" style="color:#94a3b8;">학생들이 반 화폐(Cal)로 실제 한국 주식을 모의 투자할 수 있는 기능입니다. 고정 환율은 1 Cal = 10,000원입니다.</p>' +
      '  <div style="display:flex; gap:1.5rem; flex-wrap:wrap;">' +
      '    <section class="panel" style="flex:1; min-width:300px;">' +
      '      <h3 class="panel__title">🛠️ 시장 기본 설정</h3>' +
      '      <form id="form-stock-settings" class="stack" style="gap:1rem; margin-top:1rem;">' +
      apiStatusHtml +
      '        <label style="display:flex; align-items:center; gap:0.5rem; background:rgba(0,0,0,0.1); padding:0.8rem; border-radius:6px; cursor:pointer;">' +
      '          <input type="checkbox" name="enabled" id="stock-setting-enabled"' + enabledChecked + ' />' +
      '          <strong>모의투자 가상 주식시장 개장 (학생 거래 활성화)</strong>' +
      '        </label>' +
      '        <label class="field">' +
      '          <span>주가 변동성 배율 (레버리지)</span>' +
      '          <select id="stock-setting-multiplier" style="width:100%; height:2.5rem; background:rgba(0,0,0,0.2); border:1px solid var(--border); color:#fff; border-radius:4px; padding:0 0.5rem;">' +
      '            <option value="1"' + (db.stockMarket.multiplier === 1 ? ' selected' : '') + '>1배 (실제 주가와 동일)</option>' +
      '            <option value="1.5"' + (db.stockMarket.multiplier === 1.5 ? ' selected' : '') + '>1.5배</option>' +
      '            <option value="2"' + (db.stockMarket.multiplier === 2 ? ' selected' : '') + '>2배 (변동폭 2배 확대)</option>' +
      '            <option value="3"' + (db.stockMarket.multiplier === 3 ? ' selected' : '') + '>3배 (변동폭 3배 확대)</option>' +
      '            <option value="5"' + (db.stockMarket.multiplier === 5 ? ' selected' : '') + '>5배 (변동폭 5배 극대화)</option>' +
      '          </select>' +
      '        </label>' +
      '        <div style="background:rgba(255,255,255,0.02); border:1px dashed var(--border); padding:0.8rem; border-radius:6px; font-size:0.85rem;">' +
      '          <div style="margin-bottom:0.5rem; color:#94a3b8;">' +
      '            💡 <strong>변동성 배율</strong>은 기준가 대비 등락폭을 배가하여 아이들이 더 드라마틱하게 주가 변동을 느끼도록 돕습니다.<br/>' +
      '            (수식: 표시주가 = 기준가 + (실제주가 - 기준가) * 배율)' +
      '          </div>' +
      '          <button type="button" id="btn-reset-stock-base" class="btn btn--secondary" style="height:2.2rem; font-size:0.8rem; width:100%;">⚙️ 모든 종목의 기준가를 현재가로 재설정</button>' +
      '        </div>' +
      '        <!-- Legacy GAS URLs Hidden -->' +
      '        <div style="display:none;">' +
      '          <input type="url" id="stock-setting-gasurl-1" value="' + escapeHtml(gasUrlVal1) + '" />' +
      '          <input type="url" id="stock-setting-gasurl-2" value="' + escapeHtml(gasUrlVal2) + '" />' +
      '          <input type="url" id="stock-setting-gasurl-3" value="' + escapeHtml(gasUrlVal3) + '" />' +
      '          <button type="button" id="btn-test-gas-connection">시세 연동 테스트</button>' +
      '        </div>' +
      '        <div style="display:flex; gap:0.5rem;">' +
      '          <button type="submit" class="btn btn--accent" style="width:100%; height:2.5rem;">설정 저장</button>' +
      '        </div>' +
      '      </form>' +
      '    </section>' +
      '    <section class="panel" style="flex:1; min-width:300px;">' +
      '      <h3 class="panel__title">➕ 투자 가능 종목 추가</h3>' +
      '      <form id="form-stock-add" class="stack" style="gap:1rem; margin-top:1rem;">' +
      '        <label class="field">' +
      '          <span>종목 6자리 코드</span>' +
      '          <input type="text" name="code" id="stock-add-code" maxlength="6" placeholder="예: 삼성전자 005930" style="width:100%; height:2.5rem; background:rgba(0,0,0,0.2); border:1px solid var(--border); color:#fff; border-radius:4px; padding:0 0.5rem;" required />' +
      '        </label>' +
      '        <label class="field">' +
      '          <span>종목 이름</span>' +
      '          <input type="text" name="name" id="stock-add-name" placeholder="예: 삼성전자" style="width:100%; height:2.5rem; background:rgba(0,0,0,0.2); border:1px solid var(--border); color:#fff; border-radius:4px; padding:0 0.5rem;" required />' +
      '        </label>' +
      '        <button type="submit" class="btn btn--primary" style="height:2.5rem; width:100%;">종목 추가</button>' +
      '      </form>' +
      '    </section>' +
      '  </div>' +
      '  ' +
      '  <section class="panel" style="width:100%;">' +
      '    <h3 class="panel__title">📊 학급 학생별 주식 투자 현황 대시보드</h3>' +
      '    <p class="panel__text" style="color:#94a3b8; font-size:0.85rem; margin-bottom:1rem;">' +
      '      학급 학생들의 실시간 평가 자산과 종목별 보유 수량 및 수익률을 한눈에 확인할 수 있는 대시보드입니다.' +
      '    </p>' +
      '    <div class="table-wrap">' +
      '      <table class="data" style="width:100%; border-collapse:collapse;">' +
      '        <thead>' +
      '          <tr style="border-bottom:2px solid var(--border); text-align:left;">' +
      '            <th style="padding:10px 8px; font-weight:600; color:#94a3b8; text-align:center; width:60px;">번호</th>' +
      '            <th style="padding:10px 8px; font-weight:600; color:#94a3b8; width:100px;">학생명</th>' +
      '            <th style="padding:10px 8px; font-weight:600; color:#94a3b8;">보유 종목 및 수량</th>' +
      '            <th style="padding:10px 8px; font-weight:600; color:#94a3b8; text-align:right; width:120px;">예수금 (현금)</th>' +
      '            <th style="padding:10px 8px; font-weight:600; color:#94a3b8; text-align:right; width:140px;">주식 평가액</th>' +
      '            <th style="padding:10px 8px; font-weight:600; color:#94a3b8; text-align:right; width:140px;">총 자산</th>' +
      '            <th style="padding:10px 8px; font-weight:600; color:#94a3b8; text-align:center; width:90px;">수익률 (ROI)</th>' +
      '          </tr>' +
      '        </thead>' +
      '        <tbody id="student-portfolio-tbody">' +
      studentPortfolioRows +
      '        </tbody>' +
      '      </table>' +
      '    </div>' +
      '  </section>' +
      '  ' +
      '  <div style="display:flex; gap:1.5rem; flex-wrap:wrap;">' +
      '    <section class="panel" style="flex:1; min-width:300px;">' +
      '      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;">' +
      '        <h3 class="panel__title" style="margin:0;">🏛️ 현재 거래 가능 종목 목록</h3>' +
      '        <div style="display:flex; align-items:center; gap:0.5rem;">' +
      '          <span id="stock-last-update-time" style="font-size:0.8rem; color:#94a3b8;">' + (db.stockMarket.lastPricesUpdatedAt ? '갱신: ' + fmtTime(db.stockMarket.lastPricesUpdatedAt) : '미갱신') + '</span>' +
      '          <button type="button" id="btn-refresh-stock-prices" class="btn btn--primary" style="padding:0.25rem 0.75rem; font-size:0.85rem; height:auto; display:flex; align-items:center; gap:0.25rem;">' +
      '            🔄 시세 갱신' +
      '          </button>' +
      '        </div>' +
      '      </div>' +
      '      <div class="table-wrap">' +
      '        <table class="data" style="width:100%; border-collapse:collapse;">' +
      '          <thead>' +
      '            <tr style="border-bottom:2px solid var(--border); text-align:left;">' +
      '              <th style="padding:10px 8px; font-weight:600; color:#94a3b8;">종목명</th>' +
      '              <th style="padding:10px 8px; font-weight:600; color:#94a3b8;">종목코드</th>' +
      '              <th style="padding:10px 8px; text-align:right; font-weight:600; color:#94a3b8;">현재가</th>' +
      '              <th style="padding:10px 8px; text-align:right; font-weight:600; color:#94a3b8;">전일대비</th>' +
      '              <th style="padding:10px 8px; text-align:center; font-weight:600; color:#94a3b8;">작업</th>' +
      '            </tr>' +
      '          </thead>' +
      '          <tbody id="stock-list-tbody">' +
      stocksTableRows +
      '          </tbody>' +
      '        </table>' +
      '      </div>' +
      '    </section>' +
      '    <section class="panel" style="flex:1; min-width:300px;">' +
      '      <h3 class="panel__title">📜 학급 모의투자 거래 감사 로그 (최근 30건)</h3>' +
      '      <div class="table-wrap" style="margin-top:1rem;">' +
      '        <table class="data" style="width:100%; border-collapse:collapse;">' +
      '          <thead>' +
      '            <tr style="border-bottom:2px solid var(--border); text-align:left;">' +
      '              <th style="padding:8px; font-weight:600; color:#94a3b8;">일시</th>' +
      '              <th style="padding:8px; font-weight:600; color:#94a3b8;">학생</th>' +
      '              <th style="padding:8px; font-weight:600; color:#94a3b8;">종목</th>' +
      '              <th style="padding:8px; font-weight:600; color:#94a3b8;">구분</th>' +
      '              <th style="padding:8px; text-align:right; font-weight:600; color:#94a3b8;">수량/단가</th>' +
      '              <th style="padding:8px; text-align:right; font-weight:600; color:#94a3b8;">총 금액</th>' +
      '            </tr>' +
      '          </thead>' +
      '          <tbody id="audit-log-tbody">' +
      tradeLogRows +
      '          </tbody>' +
      '        </table>' +
      '      </div>' +
      '    </section>' +
      '  </div>' +
      '</div>'
    );
  }

  function viewTeacherStockMarket(session) {
    if (window.activeStockInterval) {
      clearInterval(window.activeStockInterval);
      window.activeStockInterval = null;
    }
    
    var db = getDb();
    ensureStockMarket(db);
    if (db.stockMarket.currentPrices && Object.keys(db.stockMarket.currentPrices).length > 0) {
      window.currentStockPrices = db.stockMarket.currentPrices;
    }
    
    var initialized = false;
    function drawPage() {
      if (initialized) return;
      initialized = true;
      var innerDb = getDb();
      var main = buildStockMarketTeacherHtml(innerDb);
      shell(renderTeacherChrome("모의투자 관리", "stockmarket", main));
      bindLogout();
      bindStockMarketTeacherEvents(innerDb);
    }
    
    // Draw the page first with current data
    drawPage();
    
    function refreshDataOnly() {
      var innerDb = getDb();
      
      var stockListTbody = document.getElementById("stock-list-tbody");
      if (stockListTbody) {
        stockListTbody.innerHTML = buildStockMarketTeacherStocksTableRows(innerDb);
        // Re-bind delete buttons to ensure they work after rows replacement
        var root = document.getElementById("app");
        if (root) {
          var delBtns = root.querySelectorAll(".js-btn-delete-stock");
          var i;
          for (i = 0; i < delBtns.length; i++) {
            (function(btn) {
              btn.addEventListener("click", function() {
                var code = btn.getAttribute("data-code");
                var name = btn.getAttribute("data-name");
                if (!confirm("정말로 " + name + " (" + code + ") 종목을 삭제하시겠습니까? 관련 보유 주식 평가는 현재 시세 기준 0 Cal로 바뀝니다.")) return;
                
                var actionDb = getDb();
                actionDb.stockMarket.stocks = actionDb.stockMarket.stocks.filter(function(s) { return s.code !== code; });
                saveDb(actionDb);
                alert("종목이 삭제되었습니다.");
                viewTeacherStockMarket();
              });
            })(delBtns[i]);
          }
        }
      }
      
      var portfolioTbody = document.getElementById("student-portfolio-tbody");
      if (portfolioTbody) {
        portfolioTbody.innerHTML = buildStockMarketTeacherStudentPortfolioRows(innerDb);
      }
      
      var auditTbody = document.getElementById("audit-log-tbody");
      if (auditTbody) {
        auditTbody.innerHTML = buildStockMarketTeacherTradeLogRows(innerDb);
      }
    }
    
    // Fetch KIS status and latest prices from server, then redraw to update status badge
    fetchRealtimePrices(db, function(res) {
      if (res.ok) {
        window.currentStockPrices = res.data;
      }
      initialized = false;
      drawPage();
    });
    
    if (db.stockMarket && db.stockMarket.stocks && db.stockMarket.stocks.length > 0) {
      var lastLoggedPricesUpdatedAt = db.stockMarket.lastPricesUpdatedAt || 0;
      window.activeStockInterval = setInterval(function() {
        var pollingDb = getDb();
        var currentUpdate = pollingDb.stockMarket.lastPricesUpdatedAt || 0;
        
        if (pollingDb.stockMarket.currentPrices && Object.keys(pollingDb.stockMarket.currentPrices).length > 0) {
          window.currentStockPrices = pollingDb.stockMarket.currentPrices;
        }
        
        if (currentUpdate !== lastLoggedPricesUpdatedAt) {
          lastLoggedPricesUpdatedAt = currentUpdate;
          refreshDataOnly();
          
          var timeSpan = document.getElementById("stock-last-update-time");
          if (timeSpan) {
            timeSpan.innerText = currentUpdate ? '갱신: ' + fmtTime(currentUpdate) : '미갱신';
          }
        }
      }, 10000); // 10초마다 로컬 DB 정보 갱신 검사
    }
  }

  function bindStockMarketTeacherEvents(db) {
    var root = document.getElementById("app");
    if (!root) return;
    
    var settingsForm = document.getElementById("form-stock-settings");
    if (settingsForm) {
      settingsForm.addEventListener("submit", function(e) {
        e.preventDefault();
        var enabled = document.getElementById("stock-setting-enabled").checked;
        var multiplier = parseFloat(document.getElementById("stock-setting-multiplier").value);
        if (isNaN(multiplier)) multiplier = 1;
        var gasUrl1 = document.getElementById("stock-setting-gasurl-1").value.trim();
        var gasUrl2 = document.getElementById("stock-setting-gasurl-2").value.trim();
        var gasUrl3 = document.getElementById("stock-setting-gasurl-3").value.trim();
        
        db.stockMarket.enabled = enabled;
        db.stockMarket.multiplier = multiplier;
        db.stockMarket.gasUrls = [gasUrl1, gasUrl2, gasUrl3];
        // 하위 호환성을 위해 단일 gasUrl도 첫 번째 유효 URL로 채워둠
        db.stockMarket.gasUrl = gasUrl1 || gasUrl2 || gasUrl3 || "";
        
        saveDb(db);
        alert("설정이 저장되었습니다.");
        viewTeacherStockMarket();
      });
    }

    var resetBaseBtn = document.getElementById("btn-reset-stock-base");
    if (resetBaseBtn) {
      resetBaseBtn.addEventListener("click", function() {
        if (!confirm("모든 종목의 기준 가격을 현재 시세로 재설정하시겠습니까?\n이후 발생하는 등락폭은 현재 가격을 기준으로 증폭되어 계산됩니다.")) return;
        
        var actionDb = getDb();
        if (Array.isArray(actionDb.stockMarket.stocks)) {
          var sIdx;
          for (sIdx = 0; sIdx < actionDb.stockMarket.stocks.length; sIdx++) {
            actionDb.stockMarket.stocks[sIdx].basePrice = undefined;
          }
        }
        
        resetBaseBtn.disabled = true;
        var originalText = resetBaseBtn.innerHTML;
        resetBaseBtn.innerHTML = "⏳ 기준가 재설정 중...";
        
        saveDb(actionDb);
        
        fetchRealtimePrices(actionDb, function(res) {
          resetBaseBtn.disabled = false;
          resetBaseBtn.innerHTML = originalText;
          if (res.ok) {
            alert("기준 가격이 성공적으로 재설정되었습니다!");
            viewTeacherStockMarket();
          } else {
            alert("기준 가격 재설정 중 시세 갱신 실패: " + res.msg);
            viewTeacherStockMarket();
          }
        }, true);
      });
    }
    
    var testBtn = document.getElementById("btn-test-gas-connection");
    if (testBtn) {
      testBtn.addEventListener("click", function() {
        var url1 = document.getElementById("stock-setting-gasurl-1").value.trim();
        var url2 = document.getElementById("stock-setting-gasurl-2").value.trim();
        var url3 = document.getElementById("stock-setting-gasurl-3").value.trim();
        
        var targets = [
          { name: "URL 1 (기본)", url: url1 },
          { name: "URL 2 (예비 1)", url: url2 },
          { name: "URL 3 (예비 2)", url: url3 }
        ];
        
        var validTargets = targets.filter(function(t) { return !!t.url; });
        if (!validTargets.length) {
          alert("테스트할 GAS 프록시 URL이 최소 1개 이상 입력되어야 합니다.");
          return;
        }
        
        testBtn.disabled = true;
        testBtn.innerText = "종합 연결 테스트 중...";
        
        var codes = db.stockMarket.stocks.map(function(s) { return s.code; });
        if (!codes.length) codes = ["005930"];
        
        var results = [];
        
        function checkTarget(index) {
          if (index >= targets.length) {
            testBtn.disabled = false;
            testBtn.innerText = "시세 연동 테스트";
            
            var report = "📢 [3중 GAS URL 종합 연결 테스트 결과]\n\n";
            var i;
            for (i = 0; i < results.length; i++) {
              var r = results[i];
              report += "● " + r.name + ":\n";
              if (!r.configured) {
                report += "   ➡️ 설정되지 않음 (미등록)\n";
              } else if (r.ok) {
                report += "   🟢 연결 성공! (" + r.count + "개 종목 수신 완료)\n";
              } else {
                report += "   🔴 연결 실패! (원인: " + r.msg + ")\n";
              }
              report += "\n";
            }
            alert(report);
            return;
          }
          
          var t = targets[index];
          if (!t.url) {
            results.push({ name: t.name, configured: false });
            checkTarget(index + 1);
            return;
          }
          
          var testUrl = t.url + "?action=prices&codes=" + encodeURIComponent(codes.join(","));
          fetch(testUrl)
            .then(function(r) {
              if (!r.ok) throw new Error("HTTP 오류 " + r.status);
              return r.json();
            })
            .then(function(res) {
              if (res && res.ok) {
                var count = Object.keys(res.data || {}).length;
                var errMsgs = [];
                if (res.data) {
                  var keys = Object.keys(res.data);
                  var kIdx;
                  for (kIdx = 0; kIdx < keys.length; kIdx++) {
                    var k = keys[kIdx];
                    if (res.data[k] && res.data[k].error) {
                      errMsgs.push(res.data[k].error);
                    }
                  }
                }
                if (errMsgs.length > 0) {
                  results.push({ name: t.name, configured: true, ok: false, msg: "일부 종목 조회 오류 - " + errMsgs[0] });
                } else {
                  results.push({ name: t.name, configured: true, ok: true, count: count });
                }
              } else {
                results.push({ name: t.name, configured: true, ok: false, msg: (res && res.error) || "Apps Script 내부 오류" });
              }
              checkTarget(index + 1);
            })
            .catch(function(err) {
              results.push({ name: t.name, configured: true, ok: false, msg: err.message });
              checkTarget(index + 1);
            });
        }
        
        checkTarget(0);
      });
    }
    
    var addForm = document.getElementById("form-stock-add");
    if (addForm) {
      addForm.addEventListener("submit", function(e) {
        e.preventDefault();
        var code = document.getElementById("stock-add-code").value.trim();
        var name = document.getElementById("stock-add-name").value.trim();
        
        if (!/^\d{6}$/.test(code)) {
          alert("주식 코드는 6자리 숫자여야 합니다. (예: 005930)");
          return;
        }
        
        var exists = db.stockMarket.stocks.some(function(s) { return s.code === code; });
        if (exists) {
          alert("이미 등록된 주식 코드입니다.");
          return;
        }
        
        db.stockMarket.stocks.push({ code: code, name: name });
        saveDb(db);
        alert("종목이 추가되었습니다.");
        viewTeacherStockMarket();
      });
    }
    
    var delBtns = root.querySelectorAll(".js-btn-delete-stock");
    var i;
    for (i = 0; i < delBtns.length; i++) {
      (function(btn) {
        btn.addEventListener("click", function() {
          var code = btn.getAttribute("data-code");
          var name = btn.getAttribute("data-name");
          if (!confirm("정말로 " + name + " (" + code + ") 종목을 삭제하시겠습니까? 관련 보유 주식 평가는 현재 시세 기준 0 Cal로 바뀝니다.")) return;
          
          db.stockMarket.stocks = db.stockMarket.stocks.filter(function(s) { return s.code !== code; });
          saveDb(db);
          alert("종목이 삭제되었습니다.");
          viewTeacherStockMarket();
        });
      })(delBtns[i]);
    }

    var refreshBtn = document.getElementById("btn-refresh-stock-prices");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function() {
        var actionDb = getDb();
        
        // 시세 갱신 전, 입력 폼에 적혀있는 최신 설정을 DB에 즉시 자동 저장
        var enabledEl = document.getElementById("stock-setting-enabled");
        var multiplierEl = document.getElementById("stock-setting-multiplier");
        var gasUrl1El = document.getElementById("stock-setting-gasurl-1");
        var gasUrl2El = document.getElementById("stock-setting-gasurl-2");
        var gasUrl3El = document.getElementById("stock-setting-gasurl-3");
        if (gasUrl1El) {
          var enabled = enabledEl ? enabledEl.checked : false;
          var multiplier = multiplierEl ? parseFloat(multiplierEl.value) : 1;
          if (isNaN(multiplier)) multiplier = 1;
          var gasUrl1 = gasUrl1El.value.trim();
          var gasUrl2 = gasUrl2El ? gasUrl2El.value.trim() : "";
          var gasUrl3 = gasUrl3El ? gasUrl3El.value.trim() : "";
          
          actionDb.stockMarket.enabled = enabled;
          actionDb.stockMarket.multiplier = multiplier;
          actionDb.stockMarket.gasUrls = [gasUrl1, gasUrl2, gasUrl3];
          actionDb.stockMarket.gasUrl = gasUrl1 || gasUrl2 || gasUrl3 || "";
          saveDb(actionDb);
        }
        
        refreshBtn.disabled = true;
        var originalText = refreshBtn.innerHTML;
        refreshBtn.innerHTML = "🔄 갱신 중...";
        
        fetchRealtimePrices(actionDb, function(res) {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = originalText;
          if (res.ok) {
            alert("주식 시세가 실시간으로 성공적으로 갱신되었습니다! (학생 화면에도 즉시 반영됩니다)");
            viewTeacherStockMarket();
          } else {
            alert("시세 갱신 실패: " + res.msg);
            viewTeacherStockMarket();
          }
        }, true);
      });
    }
  }

  function buildStatusBoardHtml(db, st, opts) {
    opts = opts || {};
    ensureClassJobSettings(db);
    ensureTaxCollectionRequests(db);
    var classTaxBoardDisplay = getClassTaxTotalDisplay(db);
    var classTaxBoardHint = isClassTaxManualActive(db)
      ? "선생님 표시 기준"
      : "승인 징수 + 쿠폰샵 매출 누적";
    var mode = opts.mode === "student" ? "student" : "teacher";
    var seg = expPercentProgress(st.exp);
    var jobDef = getJobDef(st.jobId);
    var jobLedgerPath = "";
    if (st.jobId) {
      if (st.jobId === "bank_m" || st.jobId === "bank_f") jobLedgerPath = "bank-payroll";
      else if (st.jobId === "tax_m" || st.jobId === "tax_f") jobLedgerPath = "tax-collect";
      else if (st.jobId === "statistician") jobLedgerPath = "statistics-checklist";
      else if (st.jobId === "postman") jobLedgerPath = "postman-errands";
      else if (st.jobId === "cleaner") jobLedgerPath = "cleaning-checklist";
      else if (st.jobId === "coupon_merchant") jobLedgerPath = "coupon-merchant";
      else if (st.jobId === "store_merchant") jobLedgerPath = "store-merchant";
      else if (st.jobId === "dj") jobLedgerPath = "dj";
      else if (st.jobId === "recycler") jobLedgerPath = "recycler";
      else if (st.jobId === "env") jobLedgerPath = "env";
    }

    var jobLink = "";
    if (jobLedgerPath) {
      var session = C.getSession();
      if (session && session.isOverride) {
        jobLink = "#/teacher/student-jobs/" + encodeURIComponent(st.id) + "/" + escapeHtml(st.jobId) + "?sub=" + jobLedgerPath;
      } else if (opts.mode === "preview") {
        jobLink = "#/teacher/preview/" + encodeURIComponent(st.id) + "/" + jobLedgerPath;
      } else if (opts.mode === "student") {
        jobLink = "#/student/" + jobLedgerPath;
      }
    }

    var jobHeroHtml = jobDef
      ? (jobLink
          ? '<a class="status-job-hero status-job-hero--link" href="' + jobLink + '" title="' + escapeHtml(jobDef.label) + ' 장부로 바로가기">'
          : '<div class="status-job-hero" title="1인 1역">') +
        '<span class="status-job-hero__ico" aria-hidden="true">' +
        jobDef.icon +
        '</span><span class="status-job-hero__label">' +
        escapeHtml(jobDef.label) +
        "</span>" +
        (jobLink ? "</a>" : "</div>")
      : '<div class="status-job-hero status-job-hero--empty"><span class="muted">직업 미배정</span></div>';
    var logsAll = activityLogsForStudent(db, st.id);
    var logs =
      mode === "student"
        ? logsAll.filter(function (l) {
            return (
              l.expDelta > 0 ||
              (typeof l.caloryDelta === "number" && l.caloryDelta > 0)
            );
          })
        : logsAll;
    var lastGain =
      mode === "student"
        ? lastExpGainLog(logsAll.filter(function (l) { return l.expDelta > 0; }))
        : lastExpGainLog(logsAll);
    var titles = titlesForStudent(db, st.id);
    var coupons = studentCouponDisplayTotal(db, st);

    var actSlice = logs.slice(0, mode === "student" ? 20 : 15);

    var lastGainHtml = lastGain
      ? '<div class="status-mini">' +
        '<span class="status-mini__label">최근 EXP 변동</span>' +
        '<span class="status-mini__val">' +
        (lastGain.expDelta > 0 ? "+" : "") +
        lastGain.expDelta +
        "%</span><span class=\"status-mini__sub\">" +
        fmtDateShort(lastGain.occurredAt) +
        "</span></div>"
      : '<div class="status-mini status-mini--dim"><span class="status-mini__label">최근 EXP 변동</span> 없음</div>';

    var navHtml =
      mode === "teacher"
        ? '<div class="status-board__nav row-actions">' +
          '<a class="muted" href="#/teacher/students">← 학생 목록</a>' +
          '<a class="btn btn--ghost" href="#/teacher/students/' +
          encodeURIComponent(st.id) +
          '">데이터 편집</a>' +
          "</div>"
        : '<div class="status-board__nav row-actions"><p class="status-board__tagline muted">2026 학급 · 나의 STATUS</p></div>';

    var actFoot =
      mode === "teacher"
        ? "시간순으로 표시됩니다. 오른쪽 ×를 누르면 해당 줄을 삭제할 수 있으며, 기록에 적힌 EXP·Calory 변화도 함께 되돌립니다."
        : "경험치가 오르거나 Calory가 오른 활동만 표시됩니다.";

    var actTitle = mode === "student" ? "최근 주요 활동 (경험치·Calory)" : "주요 활동 내역";

    var remain = expRemainToFull(st.exp);
    var profileHeading = mode === "student" ? "내 캐릭터 정보" : "캐릭터 정보";

    var titlePills = titles.length
      ? titles
          .slice(0, 12)
          .map(function (t) {
            var styleAttr = "";
            if (t.textColor && t.bgColor) {
              styleAttr = ' style="color: ' + escapeHtml(t.textColor) + '; background-color: ' + escapeHtml(t.bgColor) + '; border-color: ' + escapeHtml(t.bgColor) + ';"';
            } else if (t.textColor) {
              styleAttr = ' style="color: ' + escapeHtml(t.textColor) + '; border-color: ' + escapeHtml(t.textColor) + ';"';
            }
            return (
              '<span class="status-pill"' + styleAttr + ' title="' +
              fmtDateShort(t.acquiredAt) +
              '">' +
              escapeHtml(t.titleText) +
              "</span>"
            );
          })
          .join("")
      : '<p class="status-pills__empty">아직 획득한 칭호가 없습니다.</p>';

    var logItems = actSlice.length
      ? actSlice
          .map(function (l) {
            var line =
              "[" +
              fmtDateShort(l.occurredAt) +
              "] " +
              escapeHtml(l.summary);
            var tags = [];
            if (l.expDelta !== 0) {
              tags.push(
                '<span class="status-log__tag">' +
                  (l.expDelta > 0 ? "+" : "") +
                  l.expDelta +
                  "%</span>"
              );
            }
            if (typeof l.caloryDelta === "number" && l.caloryDelta !== 0) {
              tags.push(
                '<span class="status-log__tag status-log__tag--cal">' +
                  (l.caloryDelta > 0 ? "+" : "") +
                  formatNum(l.caloryDelta) +
                  " Cal</span>"
              );
            }
            var tag = tags.join("");
            var mod =
              l.expDelta > 0 || (typeof l.caloryDelta === "number" && l.caloryDelta > 0)
                ? " status-log__item--exp"
                : l.expDelta < 0
                  ? " status-log__item--neg"
                  : " status-log__item--neutral";
            var bodyHtml =
              mode === "teacher" && l.id
                ? '<div class="status-log__row">' +
                  '<div class="status-log__line">' +
                  line +
                  "</div>" +
                  '<button type="button" class="status-log__del js-status-log-del" data-log-id="' +
                  escapeHtml(l.id) +
                  '" data-student-id="' +
                  escapeHtml(st.id) +
                  '" title="이 활동 기록 삭제" aria-label="이 활동 기록 삭제">×</button>' +
                  "</div>" +
                  tag
                : '<div class="status-log__line">' +
                  line +
                  "</div>" +
                  tag;
            return '<li class="status-log__item' + mod + '">' + bodyHtml + "</li>";
          })
          .join("")
        : '<li class="status-log__item status-log__item--empty">' +
        (mode === "student" ? "표시할 활동이 아직 없습니다." : "활동 기록이 없습니다.") +
        "</li>";

    var avatarUploadHint =
      mode === "teacher"
        ? "PNG·JPG·GIF·WebP. 이 학생 캐릭터로 저장되며, 가로·세로 최대 128px로 줄입니다."
        : "PNG·JPG·GIF·WebP. 가로·세로 최대 128px로 줄여 저장됩니다.";
    var avatarUploadBlock =
      opts.avatarUpload === true
        ? '<div class="status-avatar-upload">' +
          '<p class="status-avatar-upload__title">캐릭터 아이콘</p>' +
          '<div class="status-avatar-upload__row">' +
          '<label class="btn btn--ghost btn--sm status-avatar-upload__pick">' +
          '이미지 올리기<input type="file" id="student-avatar-file" class="status-avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" /></label>' +
          '<button type="button" class="btn btn--ghost btn--sm" id="student-avatar-reset">기본 캐릭터로</button>' +
          "</div>" +
          '<p class="muted status-avatar-upload__hint">' +
          escapeHtml(avatarUploadHint) +
          "</p>" +
          "</div>"
        : "";

    return (
      '<div class="status-board">' +
      navHtml +
      '<div class="status-layout">' +
      '<section class="status-profile-card">' +
      '<h3 class="status-block-title">' +
      escapeHtml(profileHeading) +
      "</h3>" +
      '<div class="status-profile-card__inner">' +
      '<div class="status-avatar status-avatar--lg">' +
      renderAvatarInnerHtml(st) +
      '<div class="status-lv-badge">Lv. ' +
      st.lv +
      "</div></div>" +
      '<div class="status-profile-meta">' +
      '<div class="status-profile-name">' +
      escapeHtml(st.name) +
      (st.classRole === "president" ? ' <span class="role-badge role-badge--president" style="font-size:0.8rem; margin-left:0.4rem; padding: 0.15rem 0.35rem; border-radius: 4px; background: #e53935; color: white; font-weight: bold; vertical-align: middle;">👑 회장</span>' :
       st.classRole === "vice_president" ? ' <span class="role-badge role-badge--vice-president" style="font-size:0.8rem; margin-left:0.4rem; padding: 0.15rem 0.35rem; border-radius: 4px; background: #fb8c00; color: white; font-weight: bold; vertical-align: middle;">⚡ 부회장</span>' : "") +
      "</div>" +
      '<div class="status-profile-gender muted">' +
      genderLabelKo(studentGender(st)) +
      "</div>" +
      '<div class="status-profile-mission">임무 번호: ' +
      escapeHtml(String(st.number)) +
      "번</div>" +
      jobHeroHtml +
      '<div class="status-profile-wallet"><span class="status-profile-wallet__ico" aria-hidden="true">◆</span> 보유 화폐 <strong>' +
      formatNum(st.calory) +
      ' Cal</strong></div>' +
      '<div class="status-profile-coupon muted">소지 쿠폰(샵·기록 합산): ' +
      (coupons > 0 ? coupons : "—") +
      "</div></div></div>" +
      avatarUploadBlock +
      "</section>" +
      '<div class="status-col">' +
      '<div class="status-growth-tax-row">' +
      (mode === "student" || mode === "preview"
        ? '<nav class="status-shop-shortcuts" aria-label="상점 바로가기">' +
          '<a class="status-shop-shortcuts__btn" href="' + (mode === "preview" ? '#/teacher/preview/' + encodeURIComponent(st.id) + '/store' : '#/student/store') + '">' +
          '<span class="status-shop-shortcuts__ico" aria-hidden="true">🏪</span>' +
          '<span class="status-shop-shortcuts__txt">매점</span></a>' +
          '<a class="status-shop-shortcuts__btn" href="' + (mode === "preview" ? '#/teacher/preview/' + encodeURIComponent(st.id) + '/title-shop' : '#/student/title-shop') + '">' +
          '<span class="status-shop-shortcuts__ico" aria-hidden="true">🏷️</span>' +
          '<span class="status-shop-shortcuts__txt">칭호샵</span></a>' +
          '<a class="status-shop-shortcuts__btn" href="' + (mode === "preview" ? '#/teacher/preview/' + encodeURIComponent(st.id) + '/coupon-shop' : '#/student/coupon-shop') + '">' +
          '<span class="status-shop-shortcuts__ico" aria-hidden="true">🎟️</span>' +
          '<span class="status-shop-shortcuts__txt">쿠폰샵</span></a>' +
          '<a class="status-shop-shortcuts__btn" href="' + (mode === "preview" ? '#/teacher/preview/' + encodeURIComponent(st.id) + '/dj-request' : '#/student/dj-request') + '">' +
          '<span class="status-shop-shortcuts__ico" aria-hidden="true">🎧</span>' +
          '<span class="status-shop-shortcuts__txt">음악신청</span></a>' +
          "</nav>"
        : "") +
      '<section class="status-growth-card">' +
      '<h3 class="status-block-title">성장 레벨 (경험치)</h3>' +
      '<p class="status-next-exp">경험치 <strong>' +
      Math.round(seg.current) +
      "%</strong> · 최대(100%)까지 <strong>" +
      Math.round(remain) +
      "%</strong> 남음</p>" +
      '<div class="status-growth-bar" aria-label="경험치 진행">' +
      '<div class="status-growth-bar__fill" style="width:' +
      Math.min(100, Math.max(0, seg.pct)) +
      '%"></div>' +
      '<span class="status-growth-bar__txt">' +
      Math.round(seg.current) +
      "% / " +
      EXP_MAX +
      "%</span></div>" +
      '<div class="status-exp-total">경험치(최대 100%) <strong>' +
      Math.round(clampExp(st.exp)) +
      "%</strong></div>" +
      lastGainHtml +
      "</section>" +
      '<aside class="status-class-tax-aside" aria-label="우리반 세금 총액">' +
      '<div class="status-class-tax-aside__head">' +
      '<span class="status-class-tax-aside__ico" aria-hidden="true">🧾</span>' +
      '<span class="status-class-tax-aside__title">우리반 세금 총액</span>' +
      "</div>" +
      '<div class="status-class-tax-aside__value">' +
      formatNum(classTaxBoardDisplay) +
      " Cal</div>" +
      '<p class="status-class-tax-aside__hint muted">' +
      escapeHtml(classTaxBoardHint) +
      "</p>" +
      "</aside></div>" +
      '<section class="status-titles-card">' +
      '<h3 class="status-block-title">획득한 칭호 <span class="status-count">총 ' +
      titles.length +
      "개</span></h3>" +
      '<div class="status-pills">' +
      titlePills +
      "</div></section>" +
      '<section class="status-log-card">' +
      '<h3 class="status-block-title">' +
      escapeHtml(actTitle) +
      "</h3>" +
      "<ul class=\"status-log\">" +
      logItems +
      "</ul>" +
      '<p class="status-card__foot muted">' +
      escapeHtml(actFoot) +
      "</p></section></div></div></div>"
    );
  }

  function viewTeacherStudentStatusBoard(session, studentId) {
    var db = getDb();
    var st = getStudent(db, studentId);
    if (!st) {
      shell(renderTeacherChrome("학생 없음", "students", '<p class="panel__text">학생을 찾을 수 없습니다.</p>'));
      bindLogout();
      return;
    }

    shell(
      renderTeacherChrome(
        st.name + " · STATUS 보드",
        "students",
        buildStatusBoardHtml(db, st, { mode: "teacher", avatarUpload: true })
      )
    );
    bindLogout();
    bindStudentAvatarUpload(st.id);
    bindTeacherStatusBoardLogDelete(st.id);
    renderStudentAssetChart(db, studentId);
  }

  function bindTeacherStatusBoardLogDelete(studentId) {
    var root = document.getElementById("app");
    if (!root) return;
    var btns = root.querySelectorAll(".js-status-log-del");
    var bi;
    for (bi = 0; bi < btns.length; bi++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var lid = btn.getAttribute("data-log-id");
          var sid = btn.getAttribute("data-student-id");
          if (!lid || sid !== studentId) return;
          if (
            !confirm(
              "이 활동 기록을 삭제할까요? 기록에 적힌 EXP·Calory 변화도 함께 되돌립니다."
            )
          )
            return;
          var r = removeActivityLogEntry(getDb(), lid, studentId);
          if (!r.ok) alert(r.msg || "삭제할 수 없습니다.");
          else route();
        });
      })(btns[bi]);
    }
  }

  function viewTeacherStudentDetail(session, studentId) {
    var db = getDb();
    var st = getStudent(db, studentId);
    if (!st) {
      shell(renderTeacherChrome("학생 없음", "students", '<p class="panel__text">학생을 찾을 수 없습니다.</p>'));
      bindLogout();
      return;
    }

    ensureClassJobSettings(db);

    var userForStudent = null;
    for (var u = 0; u < db.users.length; u++) {
      if (db.users[u].studentId === st.id) {
        userForStudent = db.users[u];
        break;
      }
    }

    var titles = titlesForStudent(db, st.id);
    var titlesHtml = titles.length
      ? "<ul>" +
        titles
          .map(function (t) {
            var styleAttr = "";
            if (t.textColor && t.bgColor) {
              styleAttr = ' style="color: ' + escapeHtml(t.textColor) + '; background-color: ' + escapeHtml(t.bgColor) + '; border-color: ' + escapeHtml(t.bgColor) + '; padding: 0.15rem 0.4rem; border-radius: 4px;"';
            } else if (t.textColor) {
              styleAttr = ' style="color: ' + escapeHtml(t.textColor) + '; border-color: ' + escapeHtml(t.textColor) + '; padding: 0.15rem 0.4rem; border-radius: 4px;"';
            }
            return (
              "<li>" +
              '<span class="status-pill"' + styleAttr + '>' + escapeHtml(t.titleText) + '</span>' +
              " <span class=\"muted\">(" +
              fmtTime(t.acquiredAt) +
              ")</span></li>"
            );
          })
          .join("") +
        "</ul>"
      : '<p class="muted">없음</p>';

    var logs = activityLogsForStudent(db, st.id).slice(0, 40);
    var logsHtml = logs.length
      ?       '<div class="table-wrap"><table class="data"><thead><tr><th>일시</th><th>활동</th><th>EXP(%)</th></tr></thead><tbody>' +
        logs
          .map(function (l) {
            return (
              "<tr><td>" +
              fmtTime(l.occurredAt) +
              "</td><td>" +
              escapeHtml(l.summary) +
              "</td><td>" +
              (l.expDelta > 0 ? "+" : "") +
              l.expDelta +
              "%</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>"
      : '<p class="muted">기록 없음</p>';

    var couponsVal = studentCoupons(st);
    var gSel = studentGender(st);
    var genderSelect =
      '<label class="field">성별<select name="gender">' +
      '<option value="female"' +
      (gSel === "female" ? " selected" : "") +
      ">여학생</option>" +
      '<option value="male"' +
      (gSel === "male" ? " selected" : "") +
      ">남학생</option>" +
      "</select></label>";

    var roleSel = st.classRole || "";
    var classRoleSelect =
      '<label class="field">학급 직책<select name="classRole">' +
      '<option value=""' + (roleSel === "" ? " selected" : "") + '>(없음)</option>' +
      '<option value="president"' + (roleSel === "president" ? " selected" : "") + '>👑 회장</option>' +
      '<option value="vice_president"' + (roleSel === "vice_president" ? " selected" : "") + '>⚡ 부회장</option>' +
      "</select></label>";

    var jobOptions = '<option value="">(미배정)</option>';
    var ji;
    for (ji = 0; ji < CLASS_JOBS.length; ji++) {
      var jj = CLASS_JOBS[ji];
      var jsel = st.jobId === jj.id ? " selected" : "";
      jobOptions +=
        '<option value="' +
        escapeHtml(jj.id) +
        '"' +
        jsel +
        ">" +
        jj.icon +
        " " +
        escapeHtml(jj.label) +
        "</option>";
    }
    var jobSelectHtml =
      '<label class="field">1인 1역 (직업)<select name="jobId">' +
      jobOptions +
      "</select></label>" +
      '<p class="field-hint muted">직업별 인원 한도는 <a href="#/teacher">대시보드</a>에서 조정합니다.</p>';

    var loginHint =
      userForStudent && typeof userForStudent.pinCode === "string" && /^\d{4}$/.test(userForStudent.pinCode)
        ? '<p class="panel__text student-login-hint"><strong>현재 로그인</strong> · 아이디: <code>' +
          escapeHtml(normStudentLoginId(userForStudent.loginId || st.name)) +
          "</code> · 비밀번호: <code>" +
          escapeHtml(userForStudent.pinCode) +
          "</code> (숫자 4자리)</p>"
        : userForStudent
          ? '<p class="panel__text muted">아이디는 학생 이름(공백 없이)과 같습니다. 아래에서 숫자 4자리 비밀번호를 새로 정할 수 있습니다.</p>'
          : "";

    var studentLoginPinSection =
      '<section class="panel panel--nested">' +
      '<h3 class="panel__title">학생 로그인·비밀번호 (선생님 변경)</h3>' +
      (userForStudent
        ? '<p class="field-hint muted">새 비밀번호만 입력해도 되며, LV·EXP 등 다른 항목과 함께 <strong>한 번에 저장</strong>됩니다.</p>' +
          loginHint +
          '<label class="field">새 비밀번호 (숫자 4자리)<input name="newPassword" type="password" inputmode="numeric" maxlength="4" autocomplete="off" spellcheck="false" placeholder="바꿀 때만 입력" /></label>' +
          '<p class="field-hint muted">비워 두면 기존 비밀번호를 유지합니다. 저장 후 학생이 새 PIN으로 로그인합니다.</p>'
        : '<p class="panel__text muted">이 학생에 연결된 로그인 계정이 없습니다. 학생 추가·데이터를 확인해 주세요.</p>') +
      "</section>";

    var main =
      '<p class="muted row-actions"><a href="#/teacher/students">← 목록</a>' +
      '<a href="#/teacher/students/' +
      encodeURIComponent(st.id) +
      '/status">STATUS 보드</a>' +
      '</p>' +
      '<section class="panel">' +
      '<h2 class="panel__title">' +
      escapeHtml(st.name) +
      " (" +
      escapeHtml(String(st.number)) +
      "번)</h2>" +
      '<form id="form-profile" class="stack" autocomplete="off">' +
      '<div class="form-grid">' +
      genderSelect +
      classRoleSelect +
      jobSelectHtml +
      '<label class="field">LV<input name="lv" type="number" min="1" value="' +
      st.lv +
      '" /></label>' +
      '<label class="field">EXP (0~100%)<input name="exp" type="number" min="0" max="100" value="' +
      st.exp +
      '" /></label>' +
      '<label class="field">Calory<input name="calory" type="number" value="' +
      st.calory +
      '" /></label>' +
      '<label class="field">소지 쿠폰<input name="coupons" type="number" min="0" value="' +
      couponsVal +
      '" /></label>' +
      "</div>" +
      studentLoginPinSection +
      '<div class="row-actions"><button type="submit" class="btn btn--primary">상태 저장</button></div>' +
      "</form></section>" +
      '<section class="panel">' +
      '<h3 class="panel__title">칭호 추가</h3>' +
      '<form id="form-title" class="stack">' +
      '<label class="field">칭호 내용<input name="titleText" required /></label>' +
      '<button type="submit" class="btn btn--primary" style="align-self:flex-start">칭호 부여</button>' +
      "</form>" +
      "<h4 class=\"panel__title\" style=\"margin-top:1rem;font-size:1rem\">보유 칭호</h4>" +
      titlesHtml +
      "</section>" +
      '<section class="panel">' +
      '<h3 class="panel__title">경험치 조정 (사유 기록)</h3>' +
      '<form id="form-exp" class="stack">' +
      '<div class="form-grid">' +
      '<label class="field">EXP 변화량 (±%p, 0~100 범위로 반영)<input name="expDelta" type="number" required value="5" /></label>' +
      '<label class="field">활동 요약<input name="summary" required placeholder="예: 학급 깃발 활동" /></label>' +
      "</div>" +
      '<button type="submit" class="btn btn--primary" style="align-self:flex-start">적용 및 기록</button>' +
      "</form></section>" +
      '<section class="panel">' +
      '<h3 class="panel__title">활동 기록 (EXP 연동)</h3>' +
      logsHtml +
      "</section>" +
      '<section class="panel">' +
      '<h3 class="panel__title">위험 구역</h3>' +
      '<p class="panel__text">학생 데이터와 로그인 계정을 삭제합니다.</p>' +
      '<button type="button" class="btn btn--danger" id="btn-delete-student">이 학생 삭제</button>' +
      "</section>";

    shell(renderTeacherChrome("학생 상세", "students", main));
    bindLogout();

    var prevLv = st.lv;
    var prevExp = st.exp;
    var prevCal = st.calory;

    document.getElementById("form-profile").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var nlv = parseInt(fd.get("lv"), 10) || 1;
      var nexpRaw = parseInt(fd.get("exp"), 10);
      var nexp = isNaN(nexpRaw) ? 0 : clampExp(nexpRaw);
      var ncal = parseInt(fd.get("calory"), 10);
      if (isNaN(ncal)) ncal = 0;
      var ncoupons = parseInt(fd.get("coupons"), 10);
      if (isNaN(ncoupons)) ncoupons = 0;
      if (ncoupons < 0) ncoupons = 0;
      var newPw = String(fd.get("newPassword") || "").trim();
      var nGender = normalizeGender(fd.get("gender"));
      var nJobId = String(fd.get("jobId") || "").trim();
      var nClassRole = String(fd.get("classRole") || "").trim();

      var db2 = getDb();
      var s2 = getStudent(db2, studentId);
      if (!canAssignJob(db2, studentId, nJobId)) {
        alert("해당 직업 인원이 가득 찼습니다. 대시보드에서 한도를 늘리거나 다른 직업을 선택하세요.");
        return;
      }
      s2.gender = nGender;
      s2.classRole = nClassRole;
      s2.lv = nlv;
      s2.exp = nexp;
      s2.calory = ncal;
      s2.coupons = ncoupons;
      if (nJobId) {
        s2.jobId = nJobId;
      } else {
        delete s2.jobId;
      }

      if (nexp !== prevExp) {
        addActivityLog(db2, {
          studentId: s2.id,
          summary: "EXP 수정 (선생님)",
          expDelta: nexp - prevExp,
        });
      }
      if (nlv !== prevLv) {
        addActivityLog(db2, {
          studentId: s2.id,
          summary: "LV 조정 (" + prevLv + " → " + nlv + ")",
          expDelta: 0,
        });
      }

      if (userForStudent && newPw) {
        var np = normalizePinDigits(newPw);
        if (!/^\d{4}$/.test(np)) {
          alert("학생 비밀번호는 숫자 4자리로 입력해 주세요.");
          return;
        }
        userForStudent.pinCode = np;
        userForStudent.pinMustChange = false;
        userForStudent.loginId = normStudentLoginId(s2.name);
        delete userForStudent.passwordHash;
        delete userForStudent.salt;
        prevLv = nlv;
        prevExp = nexp;
        prevCal = ncal;
        saveDb(db2);
        alert("저장했습니다. 학생 비밀번호가 변경되었습니다.");
        var npEl = document.querySelector('#form-profile [name="newPassword"]');
        if (npEl) npEl.value = "";
        route();
        return;
      } else {
        prevLv = nlv;
        prevExp = nexp;
        prevCal = ncal;
        saveDb(db2);
        alert("저장했습니다.");
      }
    });

    document.getElementById("form-title").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var text = String(fd.get("titleText") || "").trim();
      if (!text) return;
      var db2 = getDb();
      db2.titleGrants.push({
        id: C.uid(),
        studentId: st.id,
        titleText: text,
        acquiredAt: Date.now(),
      });
      saveDb(db2);
      e.target.reset();
      route();
    });

    document.getElementById("form-exp").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var delta = parseInt(fd.get("expDelta"), 10);
      if (isNaN(delta)) return;
      var summary = String(fd.get("summary") || "").trim();
      if (!summary) return;
      var db2 = getDb();
      var s2 = getStudent(db2, studentId);
      s2.exp = clampExp(s2.exp) + delta;
      if (s2.exp < 0) s2.exp = 0;
      autoLevelUp(s2, db2);
      addActivityLog(db2, {
        studentId: s2.id,
        summary: summary,
        expDelta: delta,
      });
      saveDb(db2);
      e.target.reset();
      route();
    });

    document.getElementById("btn-delete-student").addEventListener("click", function () {
      if (!confirm("정말 삭제할까요? 되돌릴 수 없습니다.")) return;
      var db2 = getDb();
      removeStudentFromDb(db2, studentId);
      saveDb(db2);
      window.location.hash = "#/teacher/students";
    });
  }

  function viewTeacherBulk(session) {
    var raw = sessionStorage.getItem("bulkStudentIds");
    var pre = [];
    try {
      pre = raw ? JSON.parse(raw) : [];
    } catch (e) {
      pre = [];
    }

    var db = getDb();
    var rows = db.students
      .slice()
      .sort(function (a, b) {
        return Number(a.number) - Number(b.number);
      })
      .map(function (s) {
        var checked = pre.indexOf(s.id) >= 0 ? " checked" : "";
        return (
          "<tr>" +
          '<td class="checkbox-cell"><input type="checkbox" class="js-bulk2" data-id="' +
          escapeHtml(s.id) +
          '"' +
          checked +
          " /></td>" +
          "<td>" +
          escapeHtml(String(s.number)) +
          "</td>" +
          "<td>" +
          escapeHtml(s.name) +
          "</td>" +
          "<td>" +
          s.lv +
          "</td>" +
          "<td>" +
          Math.round(clampExp(s.exp)) +
          "%</td>" +
          "</tr>"
        );
      })
      .join("");

    var main =
      '<p class="muted"><a href="#/teacher/students">← 학생 목록</a></p>' +
      '<section class="panel">' +
      '<h2 class="panel__title">일괄 조정</h2>' +
      '<p class="panel__text">선택한 학생에게 동일한 EXP·LV 조정을 적용합니다. 사유는 활동 기록에 남습니다.</p>' +
      '<form id="form-bulk" class="stack">' +
      '<div class="table-wrap"><table class="data"><thead><tr><th class="checkbox-cell"><label class="check-all check-all--bulk"><input type="checkbox" id="bulk-select-all" /> 전체</label></th><th>번호</th><th>이름</th><th>LV</th><th>EXP(%)</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<label class="field">활동 사유 / 라벨 *<input name="reason" required placeholder="예: 모둠 활동 보너스" /></label>' +
      '<div class="form-grid">' +
      '<label class="field">EXP 가감 (+/-)<input name="expDelta" type="number" value="0" /></label>' +
      '<label class="field">LV 조정 방식<select name="lvMode"><option value="none">변경 없음</option><option value="delta">LV 가감</option><option value="set">LV 지정</option></select></label>' +
      '<label class="field">LV 값 (가감 또는 지정)<input name="lvValue" type="number" value="0" /></label>' +
      "</div>" +
      '<button type="submit" class="btn btn--primary">선택 학생에 적용</button>' +
      "</form>" +
      '<div class="bulk-log-clear">' +
      '<h3 class="bulk-log-clear__title">활동 기록 일괄 삭제</h3>' +
      '<p class="panel__text bulk-log-clear__text">위 표에서 선택한 학생의 <strong>주요 활동 내역을 모두 삭제</strong>합니다. 각 기록에 반영된 EXP·Calory 변화도 함께 되돌립니다.</p>' +
      '<button type="button" class="btn btn--danger" id="btn-bulk-clear-logs">선택 학생의 활동 기록 일괄 삭제</button>' +
      "</div></section>" +
      '<section class="panel stack" style="margin-top: 1.5rem;">' +
      '<h2 class="panel__title">👑 선택 학생 칭호 일괄 지급</h2>' +
      '<p class="panel__text">위 표에서 선택한 학생들에게 커스텀 디자인 칭호를 칼로리 소모 없이 즉시 지급합니다.</p>' +
      '<form id="form-bulk-title" class="stack">' +
      '<div class="form-grid">' +
      '<label class="field">칭호명 (12글자 이하) *' +
      '<input name="bulkTitleText" id="bulk-title-text" required placeholder="예: 우수 도우미" maxlength="12" />' +
      '</label>' +
      '<label class="field">스타일 옵션' +
      '<select name="bulkTitleStyleMode" id="bulk-title-style-mode">' +
      '<option value="base">기본형 (스타일 없음)</option>' +
      '<option value="color">글자 색상 지정 (+50Cal 상당)</option>' +
      '<option value="full">글자 및 배경 색상 지정 (+100Cal 상당)</option>' +
      '</select>' +
      '</label>' +
      '</div>' +
      '<div class="form-grid" id="bulk-title-pickers" style="display: none; gap: 1rem;">' +
      '<label class="field" id="bulk-title-text-color-wrapper" style="display: none;">글자 색상' +
      '<input type="color" name="bulkTitleTextColor" id="bulk-title-text-color" value="#ffffff" style="height: 40px; padding: 2px; cursor: pointer;" />' +
      '</label>' +
      '<label class="field" id="bulk-title-bg-color-wrapper" style="display: none;">배경 색상' +
      '<input type="color" name="bulkTitleBgColor" id="bulk-title-bg-color" value="#1a237e" style="height: 40px; padding: 2px; cursor: pointer;" />' +
      '</label>' +
      '</div>' +
      '<div class="preview-box" style="padding: 1rem; background: rgba(255,255,255,0.03); border: 1px dashed rgba(255,255,255,0.1); border-radius: 6px; display: flex; align-items: center; gap: 1rem;">' +
      '<span class="muted" style="font-size: 0.9rem;">칭호 실시간 프리뷰:</span>' +
      '<div id="bulk-title-preview-container">' +
      '<span class="status-pill" id="bulk-title-preview-badge">칭호명</span>' +
      '</div>' +
      '</div>' +
      '<button type="submit" class="btn btn--accent" style="align-self: flex-start;">칭호 일괄 지급</button>' +
      '</form>' +
      '</section>';

    shell(renderTeacherChrome("일괄 조정", "bulk", main));
    bindLogout();

    function updateBulkSelectAllState() {
      var all = document.querySelectorAll(".js-bulk2");
      var n = document.querySelectorAll(".js-bulk2:checked").length;
      var sa = document.getElementById("bulk-select-all");
      if (sa && all.length) {
        sa.checked = n === all.length && n > 0;
        sa.indeterminate = n > 0 && n < all.length;
      } else if (sa) {
        sa.checked = false;
        sa.indeterminate = false;
      }
    }

    var formBulk = document.getElementById("form-bulk");
    if (formBulk) {
      formBulk.addEventListener("change", function (e) {
        if (e.target && e.target.classList.contains("js-bulk2")) updateBulkSelectAllState();
      });
    }
    var bulkSelectAll = document.getElementById("bulk-select-all");
    if (bulkSelectAll) {
      bulkSelectAll.addEventListener("change", function () {
        var on = bulkSelectAll.checked;
        document.querySelectorAll(".js-bulk2").forEach(function (el) {
          el.checked = on;
        });
        bulkSelectAll.indeterminate = false;
      });
    }
    updateBulkSelectAllState();

    document.getElementById("form-bulk").addEventListener("submit", function (e) {
      e.preventDefault();
      var ids = [];
      document.querySelectorAll(".js-bulk2:checked").forEach(function (el) {
        ids.push(el.getAttribute("data-id"));
      });
      if (!ids.length) {
        alert("학생을 한 명 이상 선택해 주세요.");
        return;
      }
      var fd = new FormData(e.target);
      var reason = String(fd.get("reason") || "").trim();
      var expDelta = parseInt(fd.get("expDelta"), 10);
      if (isNaN(expDelta)) expDelta = 0;
      var lvMode = String(fd.get("lvMode") || "none");
      var lvValue = parseInt(fd.get("lvValue"), 10);
      if (isNaN(lvValue)) lvValue = 0;

      if (!reason) return;

      if (expDelta === 0 && lvMode === "none") {
        alert("EXP 가감 또는 LV 조정 중 하나 이상 입력해 주세요.");
        return;
      }

      var db2 = getDb();
      var bulkId = C.uid();
      db2.bulkAdjustments.push({
        id: bulkId,
        createdAt: Date.now(),
        createdByUserId: session.userId,
        type: "mixed",
        summary: reason + " | EXP:" + expDelta + " LV:" + lvMode + "/" + lvValue,
      });

      ids.forEach(function (sid) {
        var s2 = getStudent(db2, sid);
        if (!s2) return;
        if (expDelta !== 0) {
          s2.exp = clampExp(s2.exp) + expDelta;
          if (s2.exp < 0) s2.exp = 0;
          autoLevelUp(s2, db2);
          addActivityLog(db2, {
            studentId: sid,
            summary: "[일괄] " + reason,
            expDelta: expDelta,
            bulkJobId: bulkId,
          });
        }
        if (lvMode === "delta" && lvValue !== 0) {
          s2.lv = Math.max(1, s2.lv + lvValue);
          addActivityLog(db2, {
            studentId: sid,
            summary: "[일괄] LV 가감 (" + reason + ")",
            expDelta: 0,
            bulkJobId: bulkId,
          });
        } else if (lvMode === "set" && lvValue >= 1) {
          s2.lv = lvValue;
          addActivityLog(db2, {
            studentId: sid,
            summary: "[일괄] LV 지정 (" + reason + ")",
            expDelta: 0,
            bulkJobId: bulkId,
          });
        }
      });

      saveDb(db2);
      sessionStorage.removeItem("bulkStudentIds");
      alert("적용했습니다.");
      window.location.hash = "#/teacher/students";
    });

    var btnBulkClearLogs = document.getElementById("btn-bulk-clear-logs");
    if (btnBulkClearLogs) {
      btnBulkClearLogs.addEventListener("click", function () {
        var idsClear = [];
        document.querySelectorAll(".js-bulk2:checked").forEach(function (el) {
          idsClear.push(el.getAttribute("data-id"));
        });
        if (!idsClear.length) {
          alert("학생을 한 명 이상 선택해 주세요.");
          return;
        }
        if (
          !confirm(
            "선택한 " +
              idsClear.length +
              "명의 주요 활동 내역을 모두 삭제할까요? 각 기록에 반영된 EXP·Calory 변화도 함께 되돌립니다. 되돌릴 수 없습니다."
          )
        )
          return;
        var db3 = getDb();
        var totalRemoved = 0;
        var ci;
        for (ci = 0; ci < idsClear.length; ci++) {
          totalRemoved += clearAllActivityLogsForStudent(db3, idsClear[ci]);
        }
        saveDb(db3);
        sessionStorage.removeItem("bulkStudentIds");
        if (totalRemoved === 0) {
          alert("선택한 학생 중 삭제할 활동 기록이 없었습니다.");
        } else {
          alert(
            "활동 기록 " + totalRemoved + "건을 삭제하고 EXP·Calory를 되돌렸습니다."
          );
        }
        window.location.hash = "#/teacher/students";
      });
    }

    // 칭호 일괄 지급 컬러 피커 및 프리뷰 바인딩
    var bulkTitleText = document.getElementById("bulk-title-text");
    var bulkTitleStyleMode = document.getElementById("bulk-title-style-mode");
    var bulkTitlePickers = document.getElementById("bulk-title-pickers");
    var bulkTitleTextColorWrapper = document.getElementById("bulk-title-text-color-wrapper");
    var bulkTitleBgColorWrapper = document.getElementById("bulk-title-bg-color-wrapper");
    var bulkTitleTextColor = document.getElementById("bulk-title-text-color");
    var bulkTitleBgColor = document.getElementById("bulk-title-bg-color");
    var bulkTitlePreviewBadge = document.getElementById("bulk-title-preview-badge");

    var defaultBadgeStyle = {
      color: bulkTitlePreviewBadge ? bulkTitlePreviewBadge.style.color || "" : "",
      background: bulkTitlePreviewBadge ? bulkTitlePreviewBadge.style.background || "" : "",
      borderColor: bulkTitlePreviewBadge ? bulkTitlePreviewBadge.style.borderColor || "" : ""
    };

    function updateBulkTitlePreview() {
      if (!bulkTitlePreviewBadge) return;
      var text = (bulkTitleText ? bulkTitleText.value : "").trim();
      bulkTitlePreviewBadge.textContent = text || "칭호명";

      var mode = bulkTitleStyleMode ? bulkTitleStyleMode.value : "base";
      if (mode === "base") {
        if (bulkTitlePickers) bulkTitlePickers.style.display = "none";
        if (bulkTitleTextColorWrapper) bulkTitleTextColorWrapper.style.display = "none";
        if (bulkTitleBgColorWrapper) bulkTitleBgColorWrapper.style.display = "none";

        bulkTitlePreviewBadge.style.color = defaultBadgeStyle.color;
        bulkTitlePreviewBadge.style.background = defaultBadgeStyle.background;
        bulkTitlePreviewBadge.style.borderColor = defaultBadgeStyle.borderColor;
      } else if (mode === "color") {
        if (bulkTitlePickers) bulkTitlePickers.style.display = "flex";
        if (bulkTitleTextColorWrapper) bulkTitleTextColorWrapper.style.display = "block";
        if (bulkTitleBgColorWrapper) bulkTitleBgColorWrapper.style.display = "none";

        var tColor = bulkTitleTextColor ? bulkTitleTextColor.value : "#ffffff";
        bulkTitlePreviewBadge.style.color = tColor;
        bulkTitlePreviewBadge.style.borderColor = tColor;
        bulkTitlePreviewBadge.style.background = defaultBadgeStyle.background;
      } else if (mode === "full") {
        if (bulkTitlePickers) bulkTitlePickers.style.display = "flex";
        if (bulkTitleTextColorWrapper) bulkTitleTextColorWrapper.style.display = "block";
        if (bulkTitleBgColorWrapper) bulkTitleBgColorWrapper.style.display = "block";

        var tColor2 = bulkTitleTextColor ? bulkTitleTextColor.value : "#ffffff";
        var bgColor2 = bulkTitleBgColor ? bulkTitleBgColor.value : "#1a237e";
        bulkTitlePreviewBadge.style.color = tColor2;
        bulkTitlePreviewBadge.style.background = bgColor2;
        bulkTitlePreviewBadge.style.borderColor = bgColor2;
      }
    }

    if (bulkTitleText) bulkTitleText.addEventListener("input", updateBulkTitlePreview);
    if (bulkTitleStyleMode) bulkTitleStyleMode.addEventListener("change", updateBulkTitlePreview);
    if (bulkTitleTextColor) bulkTitleTextColor.addEventListener("input", updateBulkTitlePreview);
    if (bulkTitleBgColor) bulkTitleBgColor.addEventListener("input", updateBulkTitlePreview);

    var formBulkTitle = document.getElementById("form-bulk-title");
    if (formBulkTitle) {
      formBulkTitle.addEventListener("submit", function (e) {
        e.preventDefault();
        var ids = [];
        document.querySelectorAll(".js-bulk2:checked").forEach(function (el) {
          ids.push(el.getAttribute("data-id"));
        });
        if (!ids.length) {
          alert("학생을 한 명 이상 선택해 주세요.");
          return;
        }

        var text = (bulkTitleText ? bulkTitleText.value : "").trim();
        if (!text) {
          alert("칭호명을 입력해 주세요.");
          return;
        }
        if (text.length > 12) {
          alert("칭호명은 12글자 이하이어야 합니다.");
          return;
        }

        var mode = bulkTitleStyleMode ? bulkTitleStyleMode.value : "base";
        var textColorVal = null;
        var bgColorVal = null;

        if (mode === "color") {
          textColorVal = bulkTitleTextColor ? bulkTitleTextColor.value : "#ffffff";
        } else if (mode === "full") {
          textColorVal = bulkTitleTextColor ? bulkTitleTextColor.value : "#ffffff";
          bgColorVal = bulkTitleBgColor ? bulkTitleBgColor.value : "#1a237e";
        }

        if (!confirm("선택한 " + ids.length + "명의 학생에게 칭호 '" + text + "'을(를) 일괄 지급하시겠습니까?")) {
          return;
        }

        var db4 = getDb();
        var addedCount = 0;
        ids.forEach(function (sid) {
          var alreadyHas = db4.titleGrants.some(function (tg) {
            return tg.studentId === sid && tg.titleText === text;
          });
          if (alreadyHas) return;

          db4.titleGrants.push({
            id: C.uid(),
            studentId: sid,
            titleText: text,
            textColor: textColorVal,
            bgColor: bgColorVal,
            acquiredAt: Date.now()
          });

          addActivityLog(db4, {
            studentId: sid,
            summary: "👑 [칭호 획득] " + text + " (일괄 지급)",
            expDelta: 0
          });
          addedCount++;
        });

        if (addedCount === 0) {
          alert("선택한 학생들이 이미 해당 칭호를 모두 보유하고 있습니다.");
          return;
        }

        saveDb(db4);
        sessionStorage.removeItem("bulkStudentIds");
        alert(addedCount + "명의 학생에게 칭호를 성공적으로 지급했습니다!");
        window.location.hash = "#/teacher/students";
      });
    }
  }



  function viewTeacherPreviewPicker(session) {
    var db = getDb();
    if (!db) return;
    var sorted = db.students.slice().sort(function (a, b) {
      return Number(a.number) - Number(b.number);
    });
    var rows = sorted.length
      ? sorted
          .map(function (s) {
            return (
              "<tr><td>" +
              escapeHtml(String(s.number)) +
              "</td><td>" +
              escapeHtml(s.name) +
              '</td><td><a class="btn btn--primary btn--sm" href="#/teacher/preview/' +
              encodeURIComponent(s.id) +
              '">이 학생으로 보기</a></td></tr>'
            );
          })
          .join("")
      : '<tr><td colspan="3" class="empty-state">등록된 학생이 없습니다.</td></tr>';
    var main =
      '<div class="teacher-preview-banner">' +
      "<p><strong>학생 모드</strong> — 아래에서 학생을 고르면 해당 학생 입장의 나의 STATUS 화면을 새 창에서 볼 수 있습니다.</p>" +
      '<div class="row-actions">' +
      '<a class="btn btn--ghost btn--sm" href="#/teacher">교사 대시보드로</a>' +
      "</div></div>" +
      '<section class="panel panel--preview-picker">' +
      '<h2 class="panel__title">학생 선택</h2>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>번호</th><th>이름</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div></section>";
    shell(renderTeacherChrome("학생 모드", "preview", main));
    bindLogout();
  }

  function viewTeacherStudentPreview(session, studentIdRaw, subPath) {
    var db = getDb();
    if (!db) return;
    var sid = decodeURIComponent(String(studentIdRaw || ""));
    var st = getStudent(db, sid);
    if (!st) {
      var mainErr =
        '<div class="teacher-preview-banner teacher-preview-banner--warn">' +
        "<p>학생을 찾을 수 없습니다.</p>" +
        '<div class="row-actions">' +
        '<a class="btn btn--accent btn--sm" href="#/teacher/preview">다시 선택</a> ' +
        '<a class="btn btn--ghost btn--sm" href="#/teacher">대시보드</a>' +
        "</div></div>";
      shell(renderTeacherChrome("학생 모드 오류", "preview", mainErr));
      bindLogout();
      return;
    }
    var sub = String(subPath || "").trim();
    if (sub === "bank-payroll") {
      if (!isBankJobId(st.jobId)) {
        window.location.hash = "#/teacher/preview/" + encodeURIComponent(sid);
        route();
        return;
      }
    } else if (sub === "tax-collect") {
      if (!isTaxJobId(st.jobId)) {
        window.location.hash = "#/teacher/preview/" + encodeURIComponent(sid);
        route();
        return;
      }
    } else if (sub === "statistics-checklist") {
      if (st.jobId !== "statistician") {
        window.location.hash = "#/teacher/preview/" + encodeURIComponent(sid);
        route();
        return;
      }
    } else if (sub === "postman-errands") {
      if (st.jobId !== "postman") {
        window.location.hash = "#/teacher/preview/" + encodeURIComponent(sid);
        route();
        return;
      }
    } else if (sub === "cleaning-checklist") {
      if (st.jobId !== "cleaner") {
        window.location.hash = "#/teacher/preview/" + encodeURIComponent(sid);
        route();
        return;
      }
    } else if (sub === "coupon-merchant") {
      if (st.jobId !== "coupon_merchant") {
        window.location.hash = "#/teacher/preview/" + encodeURIComponent(sid);
        route();
        return;
      }
    } else if (sub === "store-merchant") {
      if (st.jobId !== "store_merchant") {
        window.location.hash = "#/teacher/preview/" + encodeURIComponent(sid);
        route();
        return;
      }
    } else if (sub === "coupon-shop" || sub === "title-shop" || sub === "store" || sub === "store-merchant" || sub === "dj-request" || sub === "dj" || sub === "dj-log" || sub === "recycler" || sub === "recycling" || sub === "env-checklist" || sub === "env" || sub === "stock-market" || sub === "peers" || sub === "hall-of-fame") {
      /* ok */
    } else if (sub) {
      window.location.hash = "#/teacher/preview/" + encodeURIComponent(sid);
      route();
      return;
    }

    var banner =
      '<div class="teacher-preview-banner">' +
      "<p><strong>학생 모드</strong> — <span class=\"teacher-preview-banner__name\">" +
      escapeHtml(st.name) +
      "</span> 학생이 로그인했을 때와 같은 화면입니다. (선생님 계정으로 보는 미리보기입니다.)</p>" +
      '<div class="row-actions row-actions--wrap">' +
      '<a class="btn btn--accent btn--sm" href="#/teacher/preview">다른 학생 선택</a>' +
      '<a class="btn btn--ghost btn--sm" href="#/teacher">교사 대시보드</a>' +
      "</div></div>";

    var activeNav =
      sub === "bank-payroll"
        ? "bank"
        : sub === "tax-collect"
          ? "tax"
          : sub === "statistics-checklist"
            ? "stats"
            : sub === "postman-errands"
              ? "postman"
              : sub === "cleaning-checklist"
                ? "cleaner"
                : sub === "coupon-merchant"
                  ? "coupon-merchant"
                  : sub === "store-merchant"
                    ? "store-merchant"
                    : sub === "coupon-shop"
                      ? "coupon-shop"
                      : sub === "title-shop"
                        ? "title-shop"
                        : sub === "store"
                          ? "store"
                          : sub === "dj"
                            ? "dj"
                            : sub === "dj-request"
                              ? "dj-request"
                              : sub === "recycler"
                                ? "recycler"
                                : sub === "env"
                                  ? "env"
                                  : sub === "peers"
                                    ? "peers"
                                    : sub === "hall-of-fame"
                                      ? "hall-of-fame"
                                      : "status";
    var subNavHtml = buildStudentSubNavHtml(getTeacherPreviewSubNavLinks(db, sid, activeNav));

    var body;
    var pageTitle = "학생 모드 · " + st.name;
    if (sub === "bank-payroll") {
      body =
        buildBankPayrollStudentFormHtml(db, { studentId: sid }, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 은행 주급";
    } else if (sub === "tax-collect") {
      body = buildTaxCollectStudentFormHtml(db, { studentId: sid }, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 국세청 세금";
    } else if (sub === "statistics-checklist") {
      body = buildStatisticsChecklistHtml(db, { preview: true, role: "preview" });
      pageTitle = "학생 모드 · " + st.name + " · 통계청";
    } else if (sub === "postman-errands") {
      body = buildPostmanErrandStudentHtml(db, { studentId: st.id }, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 우체부 심부름";
    } else if (sub === "cleaning-checklist") {
      body = buildCleaningChecklistStudentHtml(db, { studentId: st.id }, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 청소 체크리스트";
    } else if (sub === "coupon-shop") {
      body = buildCouponShopStudentHtml(db, sid, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 쿠폰샵";
    } else if (sub === "title-shop") {
      body = buildTitleShopStudentHtml(db, sid, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 칭호샵";
    } else if (sub === "store") {
      body = buildCanteenShopStudentHtml(db, sid, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 매점";
    } else if (sub === "coupon-merchant") {
      body = buildCouponMerchantStudentHtml(db, sid, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 쿠폰 상인";
    } else if (sub === "store-merchant") {
      body = buildCanteenMerchantStudentHtml(db, sid, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 매점 상인";
    } else if (sub === "dj-request") {
      viewStudentDjRequest({ role: "teacher", studentId: sid, preview: true }); return;
    } else if (sub === "dj-log" || sub === "dj") {
      viewStudentDj({ role: "teacher", studentId: sid, preview: true }); return;
    } else if (sub === "recycler" || sub === "recycling") {
      viewStudentRecycler({ role: "teacher", studentId: sid, preview: true }); return;
    } else if (sub === "env" || sub === "env-checklist") {
      viewStudentEnv({ role: "teacher", studentId: sid, preview: true }); return;
    } else if (sub === "stock-market") {
      body = buildStockMarketStudentHtml(db, sid, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 모의투자";
    } else if (sub === "peers") {
      body = buildPeersGalleryHtml(db, sid, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 우리반 친구들";
    } else if (sub === "hall-of-fame") {
      body = buildHallOfFameHtml(db, sid, { preview: true });
      pageTitle = "학생 모드 · " + st.name + " · 명예의 전당";
    } else {
      body = buildStatusBoardHtml(db, st, { mode: "preview" });
    }

    var main = banner + subNavHtml + body;
    shell(renderTeacherChrome(pageTitle, "preview", main));
    bindLogout();
    if (sub === "title-shop") {
      bindTitleShopStudent(sid, true);
    }
    if (sub === "tax-collect" && isTaxJobId(st.jobId)) {
      var rootPv = document.getElementById("app");
      var formPv = document.getElementById("form-tax-collect");
      if (formPv && rootPv) {
        formPv.addEventListener("input", function (e) {
          if (e.target && e.target.classList.contains("js-tax-base")) {
            syncTaxCollectRowDisplays(rootPv);
          }
        });
        syncTaxCollectRowDisplays(rootPv);
      }
    }
    if (!sub) {
      renderStudentAssetChart(db, sid);
    }
    if (sub === "stock-market") {
      bindStockMarketStudentEvents(db, sid, true);
    }
    if (sub === "coupon-shop") {
      bindCouponShopDescToggle();
    }
    if (sub === "peers") {
      bindPeersModalClicks(db);
    }
  }

  function studentsSortedByNumber(db) {
    if (!db || !db.students) return [];
    return db.students.slice().sort(function (a, b) {
      var na = parseInt(String(a.number != null ? a.number : 0), 10);
      var nb = parseInt(String(b.number != null ? b.number : 0), 10);
      if (na !== nb) return na - nb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function bankPayrollRequestTotalCal(r) {
    if (r && r.status === "undone") return 0;
    var sum = 0;
    var lines = r.lines || [];
    var i;
    for (i = 0; i < lines.length; i++) {
      var a = lines[i].amount;
      sum += typeof a === "number" && !isNaN(a) ? Math.floor(a) : 0;
    }
    return sum;
  }

  function bankPayrollYmdFromTs(ts) {
    if (ts == null || !isFinite(Number(ts))) return ymdFromDate(new Date());
    return ymdFromDate(new Date(Number(ts)));
  }

  function bankPayrollDayHeadingKo(ymdKey) {
    try {
      var p = String(ymdKey).split("-");
      if (p.length !== 3) return ymdKey;
      var y = parseInt(p[0], 10);
      var m = parseInt(p[1], 10);
      var d = parseInt(p[2], 10);
      if (isNaN(y) || isNaN(m) || isNaN(d)) return ymdKey;
      return y + "년 " + m + "월 " + d + "일";
    } catch (e) {
      return ymdKey;
    }
  }

  function groupBankRequestsByDayKeys(requests, getTsForRecord) {
    var byDay = {};
    var i;
    for (i = 0; i < requests.length; i++) {
      var r = requests[i];
      var ts = getTsForRecord(r);
      var key = bankPayrollYmdFromTs(ts);
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(r);
    }
    return byDay;
  }

  /** YYYY-MM-DD 키 — 최신 날짜가 앞(위) */
  function bankPayrollDayKeysNewestFirst(byDay) {
    return Object.keys(byDay).sort(function (a, b) {
      return b.localeCompare(a);
    });
  }

  function renderBankPayrollHistoryOneRequest(db, r) {
    var stLabel =
      r.status === "pending"
        ? '<span class="bank-payroll-status bank-payroll-status--pending">승인 대기</span>'
        : r.status === "approved"
          ? '<span class="bank-payroll-status bank-payroll-status--ok">승인됨</span>'
          : r.status === "undone"
            ? '<span class="bank-payroll-status bank-payroll-status--undo">실행취소(선생님)</span>'
            : '<span class="bank-payroll-status bank-payroll-status--no">거절됨</span>';
    var lines = (r.lines || [])
      .map(function (ln) {
        var s = getStudent(db, ln.studentId);
        var nm = s ? s.name : "(알 수 없음)";
        var balSnap = payrollLineBalanceBefore(db, ln);
        return (
          escapeHtml(nm) +
          " (잔액 " +
          formatNum(balSnap) +
          ") +" +
          formatNum(ln.amount) +
          " Cal"
        );
      })
      .join(", ");
    return (
      '<li class="bank-payroll-history__item">' +
      '<div class="bank-payroll-history__meta">' +
      fmtTime(r.createdAt) +
      " · " +
      stLabel +
      "</div>" +
      '<div class="bank-payroll-history__lines">' +
      lines +
      "</div>" +
      "</li>"
    );
  }

  function buildBankPayrollHistoryHtml(db, session) {
    ensureBankPayrollRequests(db);
    var mine = db.bankPayrollRequests.filter(function (r) {
      return r.submittedByStudentId === session.studentId;
    });
    if (!mine.length) {
      return '<p class="muted bank-payroll__empty">아직 보낸 주급 요청이 없습니다.</p>';
    }
    var byDay = groupBankRequestsByDayKeys(mine, function (r) {
      return r.createdAt;
    });
    var days = bankPayrollDayKeysNewestFirst(byDay);
    var html = '<div class="bank-payroll-history-by-day">';
    var di;
    for (di = 0; di < days.length; di++) {
      var dayKey = days[di];
      var dayList = byDay[dayKey].slice().sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
      var dayTotal = 0;
      var j;
      for (j = 0; j < dayList.length; j++) {
        dayTotal += bankPayrollRequestTotalCal(dayList[j]);
      }
      html +=
        '<details class="bank-payroll-day">' +
        '<summary class="bank-payroll-day__summary">' +
        '<span class="bank-payroll-day__date">' +
        escapeHtml(bankPayrollDayHeadingKo(dayKey)) +
        "</span>" +
        '<span class="bank-payroll-day__meta">' +
        escapeHtml(String(dayList.length)) +
        "건 · 합계 " +
        formatNum(dayTotal) +
        " Cal</span>" +
        "</summary>" +
        '<div class="bank-payroll-day__body">' +
        '<ul class="bank-payroll-history">' +
        dayList
          .map(function (r) {
            return renderBankPayrollHistoryOneRequest(db, r);
          })
          .join("") +
        "</ul></div></details>";
    }
    html += "</div>";
    html +=
      '<p class="muted bank-payroll-history__hint">요청한 뒤에는 학생이 직접 취소할 수 없습니다. 선생님만 조정할 수 있어요.</p>';
    return html;
  }

  function buildBankPayrollStudentFormHtml(db, session, opts) {
    opts = opts || {};
    ensureClassJobSettings(db);
    var preview = opts.preview === true;
    var me = getStudent(db, session.studentId);
    if (!me) return '<p class="panel__text">학생 정보를 찾을 수 없습니다.</p>';
    if (!bankPayrollTargetGenderForJob(me.jobId)) {
      return '<p class="panel__text">은행(남)·은행(여) 직업이 아닙니다.</p>';
    }
    var scopeHintHtml =
      me.jobId === "bank_f"
        ? "여학생 친구와 <strong>은행(남)</strong> 은행원"
        : "남학생 친구와 <strong>은행(여)</strong> 은행원";
    var rows = studentsSortedByNumber(db)
      .filter(function (s) {
        return isPayrollRecipientForBanker(db, me, s);
      })
      .map(function (s) {
        var bal = formatNum(studentCaloryBalance(s));
        var inpDisabled = preview ? " disabled" : "";
        return (
          '<tr>' +
          "<td>" +
          escapeHtml(String(s.number != null ? s.number : "—")) +
          "</td>" +
          "<td>" +
          escapeHtml(s.name || "") +
          "</td>" +
          '<td class="td-num">' +
          bal +
          "</td>" +
          '<td><input class="bank-payroll-amt" type="number" min="0" max="9999" step="1" placeholder="0" data-student-id="' +
          escapeHtml(s.id) +
          '" aria-label="' +
          escapeHtml(s.name || "") +
          ' 주급 Calory"' +
          inpDisabled +
          " /></td>" +
          "</tr>"
        );
      })
      .join("");
    if (!rows) {
      return (
        '<section class="panel bank-payroll-panel">' +
        '<h2 class="panel__title">🏦 친구에게 주급 부여</h2>' +
        (preview
          ? '<p class="panel__text muted bank-payroll-preview-note">※ <strong>미리보기</strong>에서는 주급 요청을 보낼 수 없습니다. 학생이 직접 로그인할 때만 요청합니다.</p>'
          : "") +
        '<p class="panel__text muted bank-payroll-scope-hint">' +
        scopeHintHtml +
        "에게 주급을 요청할 수 있습니다.</p>" +
        '<p class="panel__text">주급을 줄 수 있는 대상이 없습니다. (본인 제외)</p>' +
        "</section>" +
        '<section class="panel bank-payroll-panel">' +
        '<h2 class="panel__title">내가 보낸 요청</h2>' +
        '<p class="panel__text muted bank-payroll-student-hint">요청한 날짜별로 접어 두었습니다. 날짜를 눌러 그날 보낸 내용을 확인하세요.</p>' +
        buildBankPayrollHistoryHtml(db, session) +
        "</section>"
      );
    }
    var previewNote = preview
      ? '<p class="panel__text muted bank-payroll-preview-note">※ <strong>미리보기</strong>에서는 주급 요청을 보낼 수 없습니다. 학생이 직접 로그인할 때만 요청합니다.</p>'
      : "";
    var actions = preview
      ? '<div class="bank-payroll-actions"><p class="muted">미리보기에서는 요청을 보낼 수 없습니다.</p></div>'
      : '<div class="bank-payroll-actions">' +
        '<button type="submit" class="btn btn--primary">선생님께 승인 요청 보내기</button>' +
        "</div>";
    var formTag =
      '<form id="form-bank-payroll" class="bank-payroll-form' +
      (preview ? " bank-payroll-form--preview" : "") +
      '"' +
      (preview ? ' onsubmit="return false"' : "") +
      ">" +
      '<div class="table-wrap"><table class="data bank-payroll-table">' +
      "<thead><tr><th>번호</th><th>이름</th><th>기존 잔액</th><th>주급 Calory</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      actions +
      "</form>";
    return (
      '<section class="panel bank-payroll-panel">' +
      '<h2 class="panel__title">🏦 친구에게 주급 부여</h2>' +
      previewNote +
      '<p class="panel__text muted bank-payroll-scope-hint">' +
      scopeHintHtml +
      "에게 주급을 요청할 수 있습니다. (은행원끼리 서로 주급을 맡깁니다.)</p>" +
      '<p class="panel__text">아래에 <strong>Calory</strong>를 입력하고 <strong>선생님께 승인 요청</strong>을 보내세요. 선생님이 승인하면 친구들의 Calory가 올라갑니다. 요청한 뒤에는 <strong>학생이 취소할 수 없습니다. 선생님만</strong> 승인·거절·수정할 수 있어요.</p>' +
      formTag +
      "</section>" +
      '<section class="panel bank-payroll-panel">' +
      '<h2 class="panel__title">내가 보낸 요청</h2>' +
      '<p class="panel__text muted bank-payroll-student-hint">요청한 날짜별로 접어 두었습니다. 날짜를 눌러 그날 보낸 내용을 확인하세요.</p>' +
      buildBankPayrollHistoryHtml(db, session) +
      "</section>"
    );
  }

  function bindStudentBankPayroll(session) {
    var form = document.getElementById("form-bank-payroll");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var db = getDb();
      if (!db) return;
      var me = getStudent(db, session.studentId);
      if (!me || !isBankJobId(me.jobId)) {
        alert("은행(남)·은행(여) 직업이 아닙니다.");
        window.location.hash = "#/student";
        route();
        return;
      }
      if (!bankPayrollTargetGenderForJob(me.jobId)) {
        alert("은행 직업 정보가 올바르지 않습니다.");
        return;
      }
      var inputs = form.querySelectorAll(".bank-payroll-amt");
      var lines = [];
      var i;
      for (i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var sid = inp.getAttribute("data-student-id");
        var n = parseInt(String(inp.value || "").trim(), 10);
        if (isNaN(n) || n <= 0) continue;
        if (n > 9999) {
          alert("한 친구에게는 9999 Calory 이하로만 입력할 수 있습니다.");
          return;
        }
        if (sid === session.studentId) continue;
        var recv = getStudent(db, sid);
        if (!recv || !isPayrollRecipientForBanker(db, me, recv)) {
          alert("주급을 줄 수 없는 친구가 포함되어 있습니다.");
          return;
        }
        lines.push({
          studentId: sid,
          amount: n,
          balanceBefore: studentCaloryBalance(recv),
        });
      }
      if (!lines.length) {
        alert("주급을 줄 친구를 한 명 이상 입력해 주세요. (0보다 큰 숫자)");
        return;
      }
      ensureBankPayrollRequests(db);
      db.bankPayrollRequests.push({
        id: C.uid(),
        createdAt: Date.now(),
        submittedByStudentId: session.studentId,
        lines: lines,
        status: "pending",
        resolvedAt: null,
      });
      saveDb(db);
      alert("선생님께 승인 요청을 보냈습니다. 선생님이 승인하면 Calory가 반영됩니다.");
      route();
    });
  }

  function viewStudentBankPayroll(session) {
    var db = getDb();
    if (!db) return;
    ensureBankPayrollRequests(db);
    var st = getStudent(db, session.studentId);
    if (!st || !isBankJobId(st.jobId)) {
      window.location.hash = "#/student";
      route();
      return;
    }
    var main = buildBankPayrollStudentFormHtml(db, session);
    shell(
      renderStudentChrome("은행 · 주급 부여", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "bank"),
      })
    );
    bindLogout();
    bindStudentBankPayroll(session);
  }

  function approveBankPayrollRequest(db, reqId) {
    ensureBankPayrollRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.bankPayrollRequests.length; i++) {
      if (db.bankPayrollRequests[i].id === reqId) {
        req = db.bankPayrollRequests[i];
        break;
      }
    }
    if (!req || (req.status !== "pending" && req.status !== "undone" && req.status !== "rejected")) {
      return { ok: false, msg: "처리할 수 없는 상태의 요청입니다." };
    }
    var banker = getStudent(db, req.submittedByStudentId);
    var bankerName = banker && banker.name ? banker.name : "은행";
    if (!banker || !isBankJobId(banker.jobId) || !bankPayrollTargetGenderForJob(banker.jobId)) {
      return { ok: false, msg: "은행원 직업(은행(남)/은행(여))이 올바르지 않습니다." };
    }
    var lines = req.lines || [];
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var tgt = getStudent(db, ln.studentId);
      var amt = typeof ln.amount === "number" && !isNaN(ln.amount) ? Math.floor(ln.amount) : 0;
      if (amt <= 0) continue;
      if (!tgt) {
        return { ok: false, msg: "주급 대상 학생을 찾을 수 없습니다." };
      }
      if (!isPayrollRecipientForBanker(db, banker, tgt)) {
        return {
          ok: false,
          msg: "주급 대상이 이 은행원의 담당(남학생·여학생·상대 은행원)과 맞지 않습니다.",
        };
      }
      tgt.calory = (typeof tgt.calory === "number" && !isNaN(tgt.calory) ? tgt.calory : 0) + amt;
      addActivityLog(db, {
        studentId: tgt.id,
        summary: "은행 주급 +" + amt + " Cal (요청: " + bankerName + " · 선생님 승인)",
        expDelta: 0,
        caloryDelta: amt,
      });
    }
    req.status = "approved";
    req.resolvedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function rejectBankPayrollRequest(db, reqId) {
    ensureBankPayrollRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.bankPayrollRequests.length; i++) {
      if (db.bankPayrollRequests[i].id === reqId) {
        req = db.bankPayrollRequests[i];
        break;
      }
    }
    if (!req || (req.status !== "pending" && req.status !== "undone" && req.status !== "rejected")) {
      return { ok: false, msg: "처리할 수 없는 상태의 요청입니다." };
    }
    req.status = "rejected";
    req.resolvedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  /** 승인된 주급만: 지급했던 Calory를 되돌리고 요청을 실행취소 상태로 둠 */
  function revokeApprovedBankPayrollRequest(db, reqId) {
    ensureBankPayrollRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.bankPayrollRequests.length; i++) {
      if (db.bankPayrollRequests[i].id === reqId) {
        req = db.bankPayrollRequests[i];
        break;
      }
    }
    if (!req || req.status !== "approved") {
      return { ok: false, msg: "승인된 주급만 실행취소할 수 있습니다." };
    }
    var banker = getStudent(db, req.submittedByStudentId);
    var bankerName = banker && banker.name ? banker.name : "은행";
    var lines = req.lines || [];
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var tgt = getStudent(db, ln.studentId);
      if (!tgt) continue;
      var amt = typeof ln.amount === "number" && !isNaN(ln.amount) ? Math.floor(ln.amount) : 0;
      if (amt <= 0) continue;
      var cur = typeof tgt.calory === "number" && !isNaN(tgt.calory) ? tgt.calory : 0;
      tgt.calory = Math.max(0, cur - amt);
      addActivityLog(db, {
        studentId: tgt.id,
        summary: "은행 주급 취소 -" + amt + " Cal (요청: " + bankerName + " · 선생님 실행취소)",
        expDelta: 0,
        caloryDelta: -amt,
      });
    }
    req.status = "undone";
    req.undoneAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function buildTeacherBankPayrollDayStack(db, requests, getTsForDay, cardHtmlFn) {
    if (!requests.length) return "";
    var byDay = groupBankRequestsByDayKeys(requests, getTsForDay);
    var days = bankPayrollDayKeysNewestFirst(byDay);
    var html = '<div class="bank-payroll-history-by-day bank-payroll-history-by-day--teacher">';
    var di;
    for (di = 0; di < days.length; di++) {
      var dayKey = days[di];
      var dayList = byDay[dayKey].slice().sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
      var dayTotal = 0;
      var j;
      for (j = 0; j < dayList.length; j++) {
        dayTotal += bankPayrollRequestTotalCal(dayList[j]);
      }
      html +=
        '<details class="bank-payroll-day">' +
        '<summary class="bank-payroll-day__summary">' +
        '<span class="bank-payroll-day__date">' +
        escapeHtml(bankPayrollDayHeadingKo(dayKey)) +
        "</span>" +
        '<span class="bank-payroll-day__meta">' +
        escapeHtml(String(dayList.length)) +
        "건 · 합계 " +
        formatNum(dayTotal) +
        " Cal</span>" +
        "</summary>" +
        '<div class="bank-payroll-day__body bank-payroll-stack">' +
        dayList.map(cardHtmlFn).join("") +
        "</div></details>";
    }
    html += "</div>";
    return html;
  }

  function buildTeacherBankPayrollHtml(db) {
    ensureClassJobSettings(db);
    ensureBankPayrollRequests(db);
    var list = db.bankPayrollRequests.slice().sort(function (a, b) {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;
      return b.createdAt - a.createdAt;
    });
    var pending = list.filter(function (r) {
      return r.status === "pending";
    });
    var rest = list.filter(function (r) {
      return r.status !== "pending";
    });

    function cardHtml(r) {
      var banker = getStudent(db, r.submittedByStudentId);
      var bJob = banker && getJobDef(banker.jobId);
      var bname = banker
        ? escapeHtml(banker.name) +
          " (" +
          escapeHtml(String(banker.number != null ? banker.number : "—")) +
          ")" +
          (bJob && isBankJobId(banker.jobId) ? " · " + escapeHtml(bJob.label) : "")
        : "(알 수 없음)";
      var linesRows = (r.lines || [])
        .map(function (ln) {
          var s = getStudent(db, ln.studentId);
          var nm = s ? s.name : "(삭제됨)";
          var num = s && s.number != null ? s.number : "—";
          var balBefore = payrollLineBalanceBefore(db, ln);
          var val = typeof ln.amount === "number" && !isNaN(ln.amount) ? ln.amount : 0;
          var amtCol = '<input type="number" class="js-bank-payroll-amt-input" data-req-id="' + escapeHtml(r.id) + '" data-student-id="' + escapeHtml(ln.studentId) + '" value="' + val + '" style="width: 80px; text-align: right;" min="0" max="9999" /> Cal';
          return (
            "<tr><td>" +
            escapeHtml(String(num)) +
            "</td><td>" +
            escapeHtml(nm) +
            "</td><td class=\"td-num\">" +
            formatNum(balBefore) +
            "</td><td>" +
            amtCol +
            "</td></tr>"
          );
        })
        .join("");
      var statusBadge =
        r.status === "pending"
          ? '<span class="bank-payroll-status bank-payroll-status--pending">대기</span>'
          : r.status === "approved"
            ? '<span class="bank-payroll-status bank-payroll-status--ok">승인됨</span>'
            : r.status === "undone"
              ? '<span class="bank-payroll-status bank-payroll-status--undo">실행취소됨</span>'
              : '<span class="bank-payroll-status bank-payroll-status--no">거절됨</span>';
      var actions =
        (r.status === "pending" || r.status === "undone" || r.status === "rejected")
          ? '<div class="bank-payroll-card__actions">' +
            '<button type="button" class="btn btn--primary btn--sm js-bank-save" data-req-id="' +
            escapeHtml(r.id) +
            '">수정 저장</button> ' +
            '<button type="button" class="btn btn--primary btn--sm js-bank-approve" data-req-id="' +
            escapeHtml(r.id) +
            '">승인</button> ' +
            '<button type="button" class="btn btn--ghost btn--sm js-bank-reject" data-req-id="' +
            escapeHtml(r.id) +
            '">거절</button> ' +
            '<button type="button" class="btn btn--danger btn--sm js-bank-delete" data-req-id="' +
            escapeHtml(r.id) +
            '">삭제</button>' +
            "</div>" +
            (r.status !== "pending"
              ? '<p class="muted bank-payroll-card__done">' +
                (r.status === "undone"
                  ? (function () {
                      var parts = [];
                      if (r.resolvedAt) parts.push(fmtDateShort(r.resolvedAt) + " 승인");
                      if (r.undoneAt) parts.push(fmtDateShort(r.undoneAt) + " 실행취소");
                      return parts.join(" · ");
                    })()
                  : r.resolvedAt
                    ? fmtDateShort(r.resolvedAt) + " 처리"
                    : "") +
                "</p>"
              : "")
          : '<div class="bank-payroll-card__actions">' +
            '<button type="button" class="btn btn--primary btn--sm js-bank-save" data-req-id="' +
            escapeHtml(r.id) +
            '">수정 저장</button> ' +
            '<button type="button" class="btn btn--ghost btn--sm js-bank-revoke-approved" data-req-id="' +
            escapeHtml(r.id) +
            '">실행취소</button> ' +
            '<button type="button" class="btn btn--danger btn--sm js-bank-delete" data-req-id="' +
            escapeHtml(r.id) +
            '">삭제</button>' +
            "</div>" +
            '<p class="muted bank-payroll-card__done">' +
            (r.resolvedAt ? fmtDateShort(r.resolvedAt) + " 승인" : "") +
            "</p>";
      return (
        '<article class="bank-payroll-card">' +
        '<div class="bank-payroll-card__head">' +
        "<div>" +
        "<strong>은행원(요청)</strong> " +
        bname +
        "</div>" +
        "<div>" +
        fmtDateShort(r.createdAt) +
        " · " +
        statusBadge +
        "</div></div>" +
        '<div class="table-wrap"><table class="data bank-payroll-table bank-payroll-table--teacher"><thead><tr><th>번호</th><th>이름</th><th>기존 잔액</th><th>주급</th></tr></thead><tbody>' +
        linesRows +
        "</tbody></table></div>" +
        actions +
        "</article>"
      );
    }

    var pendingBlock =
      pending.length > 0
        ? buildTeacherBankPayrollDayStack(
            db,
            pending,
            function (r) {
              return r.createdAt;
            },
            cardHtml
          )
        : '<p class="muted">승인 대기 중인 주급 요청이 없습니다.</p>';
    var restBlock =
      rest.length > 0
        ? buildTeacherBankPayrollDayStack(
            db,
            rest,
            function (r) {
              if (r.status === "undone" && r.undoneAt != null) return r.undoneAt;
              return r.resolvedAt != null ? r.resolvedAt : r.createdAt;
            },
            cardHtml
          )
        : "";

    return (
      '<section class="panel">' +
      '<h2 class="panel__title">승인 대기</h2>' +
      '<p class="panel__text muted bank-payroll-teacher-hint">날짜를 눌러 그날 요청만 펼쳐 볼 수 있습니다. (요청일 기준)</p>' +
      pendingBlock +
      "</section>" +
      (restBlock
        ? '<section class="panel"><h2 class="panel__title">처리 내역</h2>' +
          '<p class="panel__text muted bank-payroll-teacher-hint">승인·거절·실행취소한 날짜별로 묶여 있습니다. (실행취소는 실행한 날짜 기준)</p>' +
          restBlock +
          "</section>"
        : "")
    );
  }

  function viewTeacherBankPayroll(session) {
    var db = getDb();
    if (!db) return;
    ensureBankPayrollRequests(db);
    var main = buildTeacherBankPayrollHtml(db);
    shell(renderTeacherChrome("은행 주급 승인", "bankroll", main));
    bindLogout();
    var root = document.getElementById("app");
    if (!root) return;
    var approves = root.querySelectorAll(".js-bank-approve");
    var ai;
    for (ai = 0; ai < approves.length; ai++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id1 = btn.getAttribute("data-req-id");
          if (!id1) return;
          var db = getDb();
          var req = db.bankPayrollRequests.find(function (x) { return x.id === id1; });
          if (req && (req.status === "pending" || req.status === "undone" || req.status === "rejected")) {
            var card = btn.closest(".bank-payroll-card");
            var inputs = card.querySelectorAll(".js-bank-payroll-amt-input");
            var lineMap = {};
            var ii;
            for (ii = 0; ii < inputs.length; ii++) {
              var inp = inputs[ii];
              var sid = inp.getAttribute("data-student-id");
              var val = parseInt(inp.value, 10);
              if (!isNaN(val) && val >= 0) {
                lineMap[sid] = val;
              }
            }
            req.lines.forEach(function (ln) {
              if (lineMap[ln.studentId] !== undefined) {
                ln.amount = lineMap[ln.studentId];
              }
            });
            saveDb(db);
          }
          if (!confirm("이 주급 요청을 승인하시겠습니까? 친구들의 Calory가 즉시 증가합니다.")) return;
          var r1 = approveBankPayrollRequest(getDb(), id1);
          if (!r1.ok) alert(r1.msg || "처리할 수 없습니다.");
          else route();
        });
      })(approves[ai]);
    }
    var rejects = root.querySelectorAll(".js-bank-reject");
    var ri;
    for (ri = 0; ri < rejects.length; ri++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id2 = btn.getAttribute("data-req-id");
          if (!id2 || !confirm("이 요청을 거절하시겠습니까? (Calory는 오르지 않습니다.)")) return;
          var r2 = rejectBankPayrollRequest(getDb(), id2);
          if (!r2.ok) alert(r2.msg || "처리할 수 없습니다.");
          else route();
        });
      })(rejects[ri]);
    }
    var revokes = root.querySelectorAll(".js-bank-revoke-approved");
    var vi;
    for (vi = 0; vi < revokes.length; vi++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id3 = btn.getAttribute("data-req-id");
          if (
            !id3 ||
            !confirm(
              "이 승인을 실행취소하시겠습니까? 당시 지급한 Calory만큼 친구들 잔액에서 빼고, 되돌릴 수 없습니다."
            )
          )
            return;
          var r3 = revokeApprovedBankPayrollRequest(getDb(), id3);
          if (!r3.ok) alert(r3.msg || "처리할 수 없습니다.");
          else route();
        });
      })(revokes[vi]);
    }
    var saveApproveds = root.querySelectorAll(".js-bank-save");
    var sai;
    for (sai = 0; sai < saveApproveds.length; sai++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-req-id");
          if (!id) return;
          var db = getDb();
          var req = db.bankPayrollRequests.find(function (x) { return x.id === id; });
          if (!req) return;
          
          if (req.status === "approved") {
            if (!confirm("이 이미 승인된 주급의 금액을 수정하시겠습니까? 학생들의 Calory 잔액과 관련 세금 내역이 자동으로 보정됩니다.")) return;
            
            var card = btn.closest(".bank-payroll-card");
            var inputs = card.querySelectorAll(".js-bank-payroll-amt-input");
            var lineMap = {};
            var ii;
            for (ii = 0; ii < inputs.length; ii++) {
              var inp = inputs[ii];
              var sid = inp.getAttribute("data-student-id");
              var val = parseInt(inp.value, 10);
              if (!isNaN(val) && val >= 0) {
                lineMap[sid] = val;
              }
            }

            req.lines.forEach(function (ln) {
              var newAmt = lineMap[ln.studentId];
              if (newAmt !== undefined && newAmt !== ln.amount) {
                var oldAmt = ln.amount;
                var diff = newAmt - oldAmt;
                var tgt = getStudent(db, ln.studentId);
                if (tgt) {
                  tgt.calory = Math.max(0, (tgt.calory || 0) + diff);
                  addActivityLog(db, {
                    studentId: ln.studentId,
                    summary: "주급 수정 반영: " + oldAmt + " -> " + newAmt + " Cal (" + (diff > 0 ? "+" : "") + diff + " Cal)",
                    expDelta: 0,
                    caloryDelta: diff
                  });
                }
                adjustCorrespondingTaxForStudent(db, ln.studentId, req.createdAt, oldAmt, newAmt);
                ln.amount = newAmt;
              }
            });

            saveDb(db);
            alert("주급 및 연관된 세금이 성공적으로 수정되었습니다.");
            route();
          } else {
            if (!confirm("이 주급 내역을 수정하여 저장하시겠습니까?")) return;
            
            var card = btn.closest(".bank-payroll-card");
            var inputs = card.querySelectorAll(".js-bank-payroll-amt-input");
            var lineMap = {};
            var ii;
            for (ii = 0; ii < inputs.length; ii++) {
              var inp = inputs[ii];
              var sid = inp.getAttribute("data-student-id");
              var val = parseInt(inp.value, 10);
              if (!isNaN(val) && val >= 0) {
                lineMap[sid] = val;
              }
            }

            req.lines.forEach(function (ln) {
              var newAmt = lineMap[ln.studentId];
              if (newAmt !== undefined) {
                ln.amount = newAmt;
              }
            });

            saveDb(db);
            alert("주급 내역이 성공적으로 수정 저장되었습니다.");
            route();
          }
        });
      })(saveApproveds[sai]);
    }
    var deletes = root.querySelectorAll(".js-bank-delete");
    var di;
    for (di = 0; di < deletes.length; di++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id4 = btn.getAttribute("data-req-id");
          if (!id4) return;
          var db = getDb();
          var req = db.bankPayrollRequests.find(function (x) { return x.id === id4; });
          if (!req) return;
          var msg = req.status === "approved"
            ? "이미 승인된 주급입니다. 삭제하면 이미 지급된 Calory가 회수됩니다. 정말 삭제하시겠습니까?"
            : "이 주급 요청을 정말로 삭제하시겠습니까?";
          if (!confirm(msg)) return;
          var r4 = deleteBankPayrollRequest(db, id4);
          if (!r4.ok) alert(r4.msg || "처리할 수 없습니다.");
          else route();
        });
      })(deletes[di]);
    }
  }

  function renderTaxCollectHistoryOneRequest(db, r) {
    var stLabel =
      r.status === "pending"
        ? '<span class="bank-payroll-status bank-payroll-status--pending">승인 대기</span>'
        : r.status === "approved"
          ? '<span class="bank-payroll-status bank-payroll-status--ok">승인됨</span>'
          : r.status === "undone"
            ? '<span class="bank-payroll-status bank-payroll-status--undo">실행취소(선생님)</span>'
            : '<span class="bank-payroll-status bank-payroll-status--no">거절됨</span>';
    var lines = (r.lines || [])
      .map(function (ln) {
        var s = getStudent(db, ln.studentId);
        var nm = s ? s.name : "(알 수 없음)";
        var base = typeof ln.baseAmount === "number" && !isNaN(ln.baseAmount) ? ln.baseAmount : 0;
        var tx = typeof ln.taxAmount === "number" && !isNaN(ln.taxAmount) ? ln.taxAmount : taxFromPayrollBase(base);
        return (
          escapeHtml(nm) +
          " 주급 " +
          formatNum(base) +
          " → 세금 " +
          formatNum(tx) +
          " Cal"
        );
      })
      .join(", ");
    return (
      '<li class="bank-payroll-history__item">' +
      '<div class="bank-payroll-history__meta">' +
      fmtTime(r.createdAt) +
      " · " +
      stLabel +
      "</div>" +
      '<div class="bank-payroll-history__lines">' +
      lines +
      "</div>" +
      "</li>"
    );
  }

  function buildTaxCollectHistoryHtml(db, session) {
    ensureTaxCollectionRequests(db);
    var mine = db.taxCollectionRequests.filter(function (r) {
      return r.submittedByStudentId === session.studentId;
    });
    if (!mine.length) {
      return '<p class="muted bank-payroll__empty">아직 보낸 세금 징수 요청이 없습니다.</p>';
    }
    var byDay = groupBankRequestsByDayKeys(mine, function (r) {
      return r.createdAt;
    });
    var days = bankPayrollDayKeysNewestFirst(byDay);
    var html = '<div class="bank-payroll-history-by-day">';
    var di;
    for (di = 0; di < days.length; di++) {
      var dayKey = days[di];
      var dayList = byDay[dayKey].slice().sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
      var dayTotal = 0;
      var j;
      for (j = 0; j < dayList.length; j++) {
        dayTotal += taxCollectionRequestTotalTax(dayList[j]);
      }
      html +=
        '<details class="bank-payroll-day">' +
        '<summary class="bank-payroll-day__summary">' +
        '<span class="bank-payroll-day__date">' +
        escapeHtml(bankPayrollDayHeadingKo(dayKey)) +
        "</span>" +
        '<span class="bank-payroll-day__meta">' +
        escapeHtml(String(dayList.length)) +
        "건 · 세금 합계 " +
        formatNum(dayTotal) +
        " Cal</span>" +
        "</summary>" +
        '<div class="bank-payroll-day__body">' +
        '<ul class="bank-payroll-history">' +
        dayList
          .map(function (r) {
            return renderTaxCollectHistoryOneRequest(db, r);
          })
          .join("") +
        "</ul></div></details>";
    }
    html += "</div>";
    html +=
      '<p class="muted bank-payroll-history__hint">요청한 뒤에는 학생이 직접 취소할 수 없습니다. 선생님만 조정할 수 있어요.</p>';
    return html;
  }

  function buildTaxCollectStudentFormHtml(db, session, opts) {
    opts = opts || {};
    ensureClassJobSettings(db);
    ensureTaxCollectionRequests(db);
    var preview = opts.preview === true;
    var me = getStudent(db, session.studentId);
    if (!me) return '<p class="panel__text">학생 정보를 찾을 수 없습니다.</p>';
    if (!isTaxJobId(me.jobId)) {
      return '<p class="panel__text">국세직원(남)·국세직원(여) 직업이 아닙니다.</p>';
    }
    var taxScopeHintHtml =
      me.jobId === "tax_f"
        ? "<strong>여학생</strong> 친구와 <strong>국세직원(남)</strong>"
        : "<strong>남학생</strong> 친구와 <strong>국세직원(여)</strong>";
    var classTotal = getClassTaxTotalDisplay(db);
    var taxTotalHint = isClassTaxManualActive(db)
      ? '<span class="muted">(선생님이 표시 금액을 조정함)</span>'
      : '<span class="muted">(선생님 승인 징수 누적)</span>';
    var rows = studentsSortedByNumber(db)
      .filter(function (s) {
        return isTaxRecipientForCollector(db, me, s);
      })
      .map(function (s) {
        var bal = formatNum(studentCaloryBalance(s));
        var inpDisabled = preview ? " disabled" : "";
        return (
          '<tr data-tax-row="1">' +
          "<td>" +
          escapeHtml(String(s.number != null ? s.number : "—")) +
          "</td>" +
          "<td>" +
          escapeHtml(s.name || "") +
          "</td>" +
          '<td class="td-num">' +
          bal +
          "</td>" +
          '<td><input class="tax-collect-base js-tax-base" type="number" min="0" max="99999" step="1" placeholder="0" data-student-id="' +
          escapeHtml(s.id) +
          '" aria-label="' +
          escapeHtml(s.name || "") +
          ' 주급(기준)"' +
          inpDisabled +
          " /></td>" +
          '<td class="td-num tax-collect-tax-cell"><span class="js-tax-display">0</span></td>' +
          "</tr>"
        );
      })
      .join("");
    if (!rows) {
      return (
        '<div class="tax-collect-total-banner">' +
        '<div class="tax-collect-total-banner__line"><strong>우리반 세금 총액</strong> ' +
        '<span class="tax-collect-total-banner__num">' +
        formatNum(classTotal) +
        "</span> Cal " +
        taxTotalHint +
        "</div></div>" +
        '<section class="panel bank-payroll-panel">' +
        '<h2 class="panel__title">🧾 세금 징수 입력</h2>' +
        (preview
          ? '<p class="panel__text muted bank-payroll-preview-note">※ <strong>미리보기</strong>에서는 요청을 보낼 수 없습니다.</p>'
          : "") +
        '<p class="panel__text muted bank-payroll-scope-hint">' +
        taxScopeHintHtml +
        "에게 세금을 징수할 수 있습니다.</p>" +
        '<p class="panel__text">징수할 대상이 없습니다. (본인 제외)</p>' +
        "</section>" +
        '<section class="panel bank-payroll-panel">' +
        '<h2 class="panel__title">내가 보낸 요청</h2>' +
        '<p class="panel__text muted bank-payroll-student-hint">요청일별로 접어 두었습니다.</p>' +
        buildTaxCollectHistoryHtml(db, session) +
        "</section>"
      );
    }
    var previewNote = preview
      ? '<p class="panel__text muted bank-payroll-preview-note">※ <strong>미리보기</strong>에서는 요청을 보낼 수 없습니다.</p>'
      : "";
    var actions = preview
      ? '<div class="bank-payroll-actions"><p class="muted">미리보기에서는 요청을 보낼 수 없습니다.</p></div>'
      : '<div class="bank-payroll-actions">' +
        '<button type="submit" class="btn btn--primary">선생님께 승인 요청 보내기</button>' +
        "</div>";
    var formTag =
      '<form id="form-tax-collect" class="bank-payroll-form' +
      (preview ? " bank-payroll-form--preview" : "") +
      '"' +
      (preview ? ' onsubmit="return false"' : "") +
      ">" +
      '<div class="table-wrap"><table class="data bank-payroll-table tax-collect-table">' +
      "<thead><tr><th>번호</th><th>이름</th><th>보유 Calory</th><th>주급(기준)</th><th>세금 (10%)</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      actions +
      "</form>";
    return (
      '<div class="tax-collect-total-banner">' +
      '<div class="tax-collect-total-banner__line"><strong>우리반 세금 총액</strong> ' +
      '<span class="tax-collect-total-banner__num js-class-tax-total">' +
      formatNum(classTotal) +
      "</span> Cal " +
      taxTotalHint +
      "</div>" +
      '<div class="tax-collect-total-banner__line muted tax-collect-total-banner__sub">' +
      "이번 요청 예상 세금 합: <strong><span class=\"js-tax-request-sum\">0</span></strong> Cal" +
      "</div></div>" +
      '<section class="panel bank-payroll-panel">' +
      '<h2 class="panel__title">🧾 세금 징수 입력</h2>' +
      previewNote +
      '<p class="panel__text muted bank-payroll-scope-hint">' +
      taxScopeHintHtml +
      "에게 세금을 징수할 수 있습니다. (국세직원끼리 서로 세금을 징수할 수 있습니다.)</p>" +
      '<p class="panel__text">각 친구의 <strong>주급(기준)</strong>을 입력하면 <strong>세금</strong> 칸에 10%가 자동으로 맞춰집니다. 확인한 뒤 선생님께 승인을 요청하세요. 승인되면 친구들의 Calory에서 세금만큼 차감됩니다.</p>' +
      formTag +
      "</section>" +
      '<section class="panel bank-payroll-panel">' +
      '<h2 class="panel__title">내가 보낸 요청</h2>' +
      '<p class="panel__text muted bank-payroll-student-hint">요청일별로 접어 두었습니다.</p>' +
      buildTaxCollectHistoryHtml(db, session) +
      "</section>"
    );
  }

  function syncTaxCollectRowDisplays(root) {
    if (!root) return;
    var inputs = root.querySelectorAll(".js-tax-base");
    var sum = 0;
    var i;
    for (i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var tr = inp.closest("tr");
      var disp = tr ? tr.querySelector(".js-tax-display") : null;
      var n = parseInt(String(inp.value || "").trim(), 10);
      if (isNaN(n) || n < 0) n = 0;
      var tx = taxFromPayrollBase(n);
      sum += tx;
      if (disp) disp.textContent = formatNum(tx);
    }
    var sumEl = root.querySelector(".js-tax-request-sum");
    if (sumEl) sumEl.textContent = formatNum(sum);
  }

  function bindStudentTaxCollect(session) {
    var form = document.getElementById("form-tax-collect");
    var root = document.getElementById("app");
    if (form && root) {
      form.addEventListener("input", function (e) {
        if (e.target && e.target.classList.contains("js-tax-base")) {
          syncTaxCollectRowDisplays(root);
        }
      });
    }
    if (!form || !root) return;
    syncTaxCollectRowDisplays(root);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var db = getDb();
      if (!db) return;
      var me = getStudent(db, session.studentId);
      if (!me || !isTaxJobId(me.jobId)) {
        alert("국세직원(남)·국세직원(여) 직업이 아닙니다.");
        window.location.hash = "#/student";
        route();
        return;
      }
      var inputs = form.querySelectorAll(".js-tax-base");
      var lines = [];
      var i;
      for (i = 0; i < inputs.length; i++) {
        var inp = inputs[i];
        var sid = inp.getAttribute("data-student-id");
        var n = parseInt(String(inp.value || "").trim(), 10);
        if (isNaN(n) || n <= 0) continue;
        if (n > 99999) {
          alert("주급(기준)은 99999 이하로 입력해 주세요.");
          return;
        }
        if (sid === session.studentId) continue;
        var recv = getStudent(db, sid);
        if (!recv) continue;
        if (!isTaxRecipientForCollector(db, me, recv)) {
          alert("세금을 징수할 수 없는 친구가 포함되어 있습니다.");
          return;
        }
        var tx = taxFromPayrollBase(n);
        if (tx <= 0) continue;
        lines.push({
          studentId: sid,
          baseAmount: n,
          taxAmount: tx,
          balanceBefore: studentCaloryBalance(recv),
        });
      }
      if (!lines.length) {
        alert("세금이 0보다 큰 친구를 한 명 이상 입력해 주세요. (주급을 입력해야 세금이 잡힙니다.)");
        return;
      }
      ensureTaxCollectionRequests(db);
      db.taxCollectionRequests.push({
        id: C.uid(),
        createdAt: Date.now(),
        submittedByStudentId: session.studentId,
        lines: lines,
        status: "pending",
        resolvedAt: null,
      });
      saveDb(db);
      alert("선생님께 승인 요청을 보냈습니다. 승인 시 친구들의 Calory에서 세금이 차감됩니다.");
      route();
    });
  }

  function viewStudentTaxCollect(session) {
    var db = getDb();
    if (!db) return;
    var st = getStudent(db, session.studentId);
    if (!st || !isTaxJobId(st.jobId)) {
      window.location.hash = "#/student";
      route();
      return;
    }
    var main = buildTaxCollectStudentFormHtml(db, session);
    shell(
      renderStudentChrome("국세청 · 세금 징수", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "tax"),
      })
    );
    bindLogout();
    bindStudentTaxCollect(session);
  }

  function approveTaxCollectionRequest(db, reqId) {
    ensureTaxCollectionRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.taxCollectionRequests.length; i++) {
      if (db.taxCollectionRequests[i].id === reqId) {
        req = db.taxCollectionRequests[i];
        break;
      }
    }
    if (!req || (req.status !== "pending" && req.status !== "undone" && req.status !== "rejected")) {
      return { ok: false, msg: "처리할 수 없는 상태의 요청입니다." };
    }
    var collector = getStudent(db, req.submittedByStudentId);
    if (!collector || !isTaxJobId(collector.jobId)) {
      return { ok: false, msg: "국세 직원(남·여) 정보가 올바르지 않습니다." };
    }
    var cname = collector.name ? collector.name : "국세";
    var lines = req.lines || [];
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var tgt = getStudent(db, ln.studentId);
      var base = typeof ln.baseAmount === "number" && !isNaN(ln.baseAmount) ? Math.floor(ln.baseAmount) : 0;
      var tax = taxFromPayrollBase(base);
      if (tax <= 0) continue;
      if (!tgt) {
        return { ok: false, msg: "대상 학생을 찾을 수 없습니다." };
      }
      if (!isTaxRecipientForCollector(db, collector, tgt)) {
        return {
          ok: false,
          msg: "세금 징수 대상이 이 국세 직원의 담당(남학생·여학생·상대 국세 직원)과 맞지 않습니다.",
        };
      }
      var cur = studentCaloryBalance(tgt);
      if (cur < tax) {
        return {
          ok: false,
          msg:
            String(tgt.name || "") +
            " 학생의 Calory(" +
            formatNum(cur) +
            ")가 세금(" +
            formatNum(tax) +
            ")보다 적습니다.",
        };
      }
      tgt.calory = Math.max(0, studentCaloryBalance(tgt) - tax);
      addActivityLog(db, {
        studentId: tgt.id,
        summary: "국세 세금 -" + tax + " Cal (징수: " + cname + " · 선생님 승인)",
        expDelta: 0,
        caloryDelta: -tax,
      });
    }
    req.status = "approved";
    req.resolvedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function rejectTaxCollectionRequest(db, reqId) {
    ensureTaxCollectionRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.taxCollectionRequests.length; i++) {
      if (db.taxCollectionRequests[i].id === reqId) {
        req = db.taxCollectionRequests[i];
        break;
      }
    }
    if (!req || (req.status !== "pending" && req.status !== "undone" && req.status !== "rejected")) {
      return { ok: false, msg: "처리할 수 없는 상태의 요청입니다." };
    }
    req.status = "rejected";
    req.resolvedAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function revokeApprovedTaxCollectionRequest(db, reqId) {
    ensureTaxCollectionRequests(db);
    var req = null;
    var i;
    for (i = 0; i < db.taxCollectionRequests.length; i++) {
      if (db.taxCollectionRequests[i].id === reqId) {
        req = db.taxCollectionRequests[i];
        break;
      }
    }
    if (!req || req.status !== "approved") {
      return { ok: false, msg: "승인된 징수만 실행취소할 수 있습니다." };
    }
    var collector = getStudent(db, req.submittedByStudentId);
    var cname = collector && collector.name ? collector.name : "국세";
    var lines = req.lines || [];
    for (i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var tgt = getStudent(db, ln.studentId);
      var base = typeof ln.baseAmount === "number" && !isNaN(ln.baseAmount) ? Math.floor(ln.baseAmount) : 0;
      var tax = taxFromPayrollBase(base);
      if (tax <= 0 || !tgt) continue;
      tgt.calory = Math.max(0, studentCaloryBalance(tgt) + tax);
      addActivityLog(db, {
        studentId: tgt.id,
        summary: "국세 세금 환급 +" + tax + " Cal (징수: " + cname + " · 선생님 실행취소)",
        expDelta: 0,
        caloryDelta: tax,
      });
    }
    req.status = "undone";
    req.undoneAt = Date.now();
    saveDb(db);
    return { ok: true, msg: null };
  }

  function buildTeacherTaxCollectDayStack(db, requests, getTsForDay, cardHtmlFn) {
    if (!requests.length) return "";
    var byDay = groupBankRequestsByDayKeys(requests, getTsForDay);
    var days = bankPayrollDayKeysNewestFirst(byDay);
    var html = '<div class="bank-payroll-history-by-day bank-payroll-history-by-day--teacher">';
    var di;
    for (di = 0; di < days.length; di++) {
      var dayKey = days[di];
      var dayList = byDay[dayKey].slice().sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
      var dayTotal = 0;
      var j;
      for (j = 0; j < dayList.length; j++) {
        dayTotal += taxCollectionRequestTotalTax(dayList[j]);
      }
      html +=
        '<details class="bank-payroll-day">' +
        '<summary class="bank-payroll-day__summary">' +
        '<span class="bank-payroll-day__date">' +
        escapeHtml(bankPayrollDayHeadingKo(dayKey)) +
        "</span>" +
        '<span class="bank-payroll-day__meta">' +
        escapeHtml(String(dayList.length)) +
        "건 · 세금 합계 " +
        formatNum(dayTotal) +
        " Cal</span>" +
        "</summary>" +
        '<div class="bank-payroll-day__body bank-payroll-stack">' +
        dayList.map(cardHtmlFn).join("") +
        "</div></details>";
    }
    html += "</div>";
    return html;
  }

  function buildTeacherTaxCollectHtml(db) {
    ensureTaxCollectionRequests(db);

    var taxSum = 0;
    var couponSum = 0;
    var canteenSum = 0;
    var titleSum = 0;
    var totalActual = 0;
    var classTotal = 0;
    var manualActive = false;

    if (!taxFilterStart && !taxFilterEnd) {
      taxSum = sumClassApprovedTaxCollected(db);
      couponSum = sumCouponShopTreasury(db);
      canteenSum = sumCanteenShopTreasury(db);
      titleSum = sumTitleShopTreasury(db);
      totalActual = taxSum + couponSum + canteenSum + titleSum;
      classTotal = getClassTaxTotalDisplay(db);
      manualActive = isClassTaxManualActive(db);
    } else {
      var reqs = db.taxCollectionRequests || [];
      for (var i = 0; i < reqs.length; i++) {
        var r = reqs[i];
        if (r.status === "approved") {
          if (isTimestampInRange(r.resolvedAt || r.createdAt, taxFilterStart, taxFilterEnd)) {
            taxSum += taxCollectionRequestTotalTax(r);
          }
        }
      }

      var couponLogs = (db.couponShop && db.couponShop.merchantLog) || [];
      for (var i = 0; i < couponLogs.length; i++) {
        var item = couponLogs[i];
        if (isTimestampInRange(item.occurredAt, taxFilterStart, taxFilterEnd)) {
          couponSum += typeof item.price === "number" ? item.price : 0;
        }
      }

      var canteenLogs = (db.canteenShop && db.canteenShop.merchantLog) || [];
      for (var i = 0; i < canteenLogs.length; i++) {
        var item = canteenLogs[i];
        if (isTimestampInRange(item.occurredAt, taxFilterStart, taxFilterEnd)) {
          canteenSum += typeof item.price === "number" ? item.price : 0;
        }
      }

      var titleLogs = (db.titleShop && db.titleShop.purchaseLog) || [];
      for (var i = 0; i < titleLogs.length; i++) {
        var item = titleLogs[i];
        if (isTimestampInRange(item.occurredAt, taxFilterStart, taxFilterEnd)) {
          var amt = item.treasuryAmount != null ? item.treasuryAmount : (item.priceCal != null ? item.priceCal : 0);
          titleSum += amt;
        }
      }

      totalActual = taxSum + couponSum + canteenSum + titleSum;
      classTotal = totalActual;
      manualActive = false;
    }

    function getPct(val) {
      if (totalActual === 0) return "0.0%";
      return ((val / totalActual) * 100).toFixed(1) + "%";
    }

    var barSegmentsHtml = "";
    if (totalActual === 0) {
      barSegmentsHtml = '<div style="width: 100%; background: #4b5563; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 0.75rem; font-weight: bold; padding: 4px 0;">누적 수입 없음</div>';
    } else {
      if (taxSum > 0) {
        barSegmentsHtml += '<div style="width: ' + ((taxSum / totalActual) * 100) + '%; background: #3b82f6; transition: width 0.3s;" title="세금 징수: ' + getPct(taxSum) + '"></div>';
      }
      if (couponSum > 0) {
        barSegmentsHtml += '<div style="width: ' + ((couponSum / totalActual) * 100) + '%; background: #10b981; transition: width 0.3s;" title="쿠폰 대여: ' + getPct(couponSum) + '"></div>';
      }
      if (canteenSum > 0) {
        barSegmentsHtml += '<div style="width: ' + ((canteenSum / totalActual) * 100) + '%; background: #f59e0b; transition: width 0.3s;" title="매점 판매: ' + getPct(canteenSum) + '"></div>';
      }
      if (titleSum > 0) {
        barSegmentsHtml += '<div style="width: ' + ((titleSum / totalActual) * 100) + '%; background: #8b5cf6; transition: width 0.3s;" title="칭호 구매: ' + getPct(titleSum) + '"></div>';
      }
    }

    var warningBlock = "";
    if (manualActive && !db.classTaxTotalManualConfirmed) {
      warningBlock = 
        '<div id="manual-tax-warning" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 0.75rem; margin-top: 1rem; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; color: #f87171; flex-wrap: wrap;">' +
          '<div style="display: flex; align-items: center; gap: 0.5rem;">' +
            '<span>⚠️</span>' +
            '<span><strong>주의:</strong> 현재 표시 국고 총액이 교사에 의해 수동 조정되었습니다. (실제 자동 계산 총합: <strong>' + formatNum(totalActual) + ' Cal</strong> / 현재 표시 금액: <strong>' + formatNum(classTotal) + ' Cal</strong>)</span>' +
          '</div>' +
          '<label style="display: inline-flex; align-items: center; gap: 0.35rem; font-weight: bold; cursor: pointer; color: #60a5fa; user-select: none;">' +
            '<input type="checkbox" id="chk-confirm-manual-tax" style="cursor: pointer; width: auto;" /> 그래도 이대로 반영하겠습니까?' +
          '</label>' +
        '</div>';
    }

    var inflowSummaryPanel =
      '<section class="panel" style="margin-bottom: 1.5rem;">' +
      '<h2 class="panel__title">🏛️ 국고 수입 유입 경로 및 현황</h2>' +
      '<p class="panel__text muted">학급 국고에 누적된 수입원의 원천과 비율을 실시간으로 확인합니다.</p>' +
      '<div style="background: rgba(0,0,0,0.25); height: 20px; border-radius: 10px; display: flex; overflow: hidden; margin: 1.25rem 0; border: 1px solid var(--border);">' +
      barSegmentsHtml +
      '</div>' +
      '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; width: 100%;">' +
        // Tax card
        '<div style="background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">' +
          '<div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">' +
              '<span style="font-weight: bold; color: #60a5fa; font-size: 0.95rem;">🏛️ 일반 세금 징수</span>' +
              '<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; font-size: 0.75rem; padding: 0.15rem 0.45rem; border-radius: 9999px; font-weight: bold;">' + getPct(taxSum) + '</span>' +
            '</div>' +
            '<p style="font-size: 0.85rem; margin: 0; color: var(--text-muted); line-height: 1.4;">국세직원이 징수하여 선생님이 승인한 세금 금액입니다.</p>' +
          '</div>' +
          '<div style="margin-top: 1rem; font-size: 1.25rem; font-weight: 800; color: #fff; text-align: right;">' + formatNum(taxSum) + ' <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-muted);">Cal</span></div>' +
        '</div>' +
        // Coupon card
        '<div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">' +
          '<div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">' +
              '<span style="font-weight: bold; color: #34d399; font-size: 0.95rem;">🎫 쿠폰 대여 수입</span>' +
              '<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 0.75rem; padding: 0.15rem 0.45rem; border-radius: 9999px; font-weight: bold;">' + getPct(couponSum) + '</span>' +
            '</div>' +
            '<p style="font-size: 0.85rem; margin: 0; color: var(--text-muted); line-height: 1.4;">학생들이 쿠폰샵에서 쿠폰 대여 시 납부한 금액입니다.</p>' +
          '</div>' +
          '<div style="margin-top: 1rem; font-size: 1.25rem; font-weight: 800; color: #fff; text-align: right;">' + formatNum(couponSum) + ' <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-muted);">Cal</span></div>' +
        '</div>' +
        // Canteen card
        '<div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">' +
          '<div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">' +
              '<span style="font-weight: bold; color: #fbbf24; font-size: 0.95rem;">🏪 매점 판매 수입</span>' +
              '<span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-size: 0.75rem; padding: 0.15rem 0.45rem; border-radius: 9999px; font-weight: bold;">' + getPct(canteenSum) + '</span>' +
            '</div>' +
            '<p style="font-size: 0.85rem; margin: 0; color: var(--text-muted); line-height: 1.4;">학생들이 매점 상품 구매 인도 완료(승인) 시 국고로 귀속된 금액입니다.</p>' +
          '</div>' +
          '<div style="margin-top: 1rem; font-size: 1.25rem; font-weight: 800; color: #fff; text-align: right;">' + formatNum(canteenSum) + ' <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-muted);">Cal</span></div>' +
        '</div>' +
        // Title card
        '<div style="background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; justify-content: space-between;">' +
          '<div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">' +
              '<span style="font-weight: bold; color: #a78bfa; font-size: 0.95rem;">👑 칭호 상점 수입</span>' +
              '<span style="background: rgba(139, 92, 246, 0.15); color: #a78bfa; font-size: 0.75rem; padding: 0.15rem 0.45rem; border-radius: 9999px; font-weight: bold;">' + getPct(titleSum) + '</span>' +
            '</div>' +
            '<p style="font-size: 0.85rem; margin: 0; color: var(--text-muted); line-height: 1.4;">학생들이 칭호를 구입할 때 납부한 금액입니다.</p>' +
          '</div>' +
          '<div style="margin-top: 1rem; font-size: 1.25rem; font-weight: 800; color: #fff; text-align: right;">' + formatNum(titleSum) + ' <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-muted);">Cal</span></div>' +
        '</div>' +
      '</div>' +
      warningBlock +
      '</section>';

    var list = db.taxCollectionRequests.slice();

    // Apply date range filter to the requests list
    if (taxFilterStart || taxFilterEnd) {
      list = list.filter(function (r) {
        var ts = r.resolvedAt || r.createdAt;
        return isTimestampInRange(ts, taxFilterStart, taxFilterEnd);
      });
    }

    list.sort(function (a, b) {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;
      return b.createdAt - a.createdAt;
    });

    var pending = list.filter(function (r) {
      return r.status === "pending";
    });
    var rest = list.filter(function (r) {
      return r.status !== "pending";
    });

    function cardHtml(r) {
      var collector = getStudent(db, r.submittedByStudentId);
      var cname = collector
        ? escapeHtml(collector.name) +
          " (" +
          escapeHtml(String(collector.number != null ? collector.number : "—")) +
          ")"
        : "(알 수 없음)";
      var linesRows = (r.lines || [])
        .map(function (ln) {
          var s = getStudent(db, ln.studentId);
          var nm = s ? s.name : "(삭제됨)";
          var num = s && s.number != null ? s.number : "—";
          var balBefore = payrollLineBalanceBefore(db, ln);
          var base = typeof ln.baseAmount === "number" && !isNaN(ln.baseAmount) ? ln.baseAmount : 0;
          var tx =
            typeof ln.taxAmount === "number" && !isNaN(ln.taxAmount)
              ? ln.taxAmount
              : taxFromPayrollBase(base);
          var taxCol = '<input type="number" class="js-tax-collect-amt-input" data-req-id="' + escapeHtml(r.id) + '" data-student-id="' + escapeHtml(ln.studentId) + '" value="' + tx + '" style="width: 80px; text-align: right;" min="0" max="9999" /> Cal';
          return (
            "<tr><td>" +
            escapeHtml(String(num)) +
            "</td><td>" +
            escapeHtml(nm) +
            "</td><td class=\"td-num\">" +
            formatNum(balBefore) +
            "</td><td class=\"td-num\">" +
            formatNum(base) +
            "</td><td>" +
            taxCol +
            "</td></tr>"
          );
        })
        .join("");
      var statusBadge =
        r.status === "pending"
          ? '<span class="bank-payroll-status bank-payroll-status--pending">대기</span>'
          : r.status === "approved"
            ? '<span class="bank-payroll-status bank-payroll-status--ok">승인됨</span>'
            : r.status === "undone"
              ? '<span class="bank-payroll-status bank-payroll-status--undo">실행취소됨</span>'
              : '<span class="bank-payroll-status bank-payroll-status--no">거절됨</span>';
      var actions =
        (r.status === "pending" || r.status === "undone" || r.status === "rejected")
          ? '<div class="bank-payroll-card__actions">' +
            '<button type="button" class="btn btn--primary btn--sm js-tax-approve" data-req-id="' +
            escapeHtml(r.id) +
            '">승인</button> ' +
            '<button type="button" class="btn btn--ghost btn--sm js-tax-reject" data-req-id="' +
            escapeHtml(r.id) +
            '">거절</button> ' +
            '<button type="button" class="btn btn--danger btn--sm js-tax-delete" data-req-id="' +
            escapeHtml(r.id) +
            '">삭제</button>' +
            "</div>" +
            (r.status !== "pending"
              ? '<p class="muted bank-payroll-card__done">' +
                (r.status === "undone"
                  ? (function () {
                      var parts = [];
                      if (r.resolvedAt) parts.push(fmtDateShort(r.resolvedAt) + " 승인");
                      if (r.undoneAt) parts.push(fmtDateShort(r.undoneAt) + " 실행취소");
                      return parts.join(" · ");
                    })()
                  : r.resolvedAt
                    ? fmtDateShort(r.resolvedAt) + " 처리"
                    : "") +
                "</p>"
              : "")
          : '<div class="bank-payroll-card__actions">' +
            '<button type="button" class="btn btn--primary btn--sm js-tax-save-approved" data-req-id="' +
            escapeHtml(r.id) +
            '">수정 저장</button> ' +
            '<button type="button" class="btn btn--ghost btn--sm js-tax-revoke-approved" data-req-id="' +
            escapeHtml(r.id) +
            '">실행취소</button> ' +
            '<button type="button" class="btn btn--danger btn--sm js-tax-delete" data-req-id="' +
            escapeHtml(r.id) +
            '">삭제</button>' +
            "</div>" +
            '<p class="muted bank-payroll-card__done">' +
            (r.resolvedAt ? fmtDateShort(r.resolvedAt) + " 승인" : "") +
            "</p>";
      return (
        '<article class="bank-payroll-card">' +
        '<div class="bank-payroll-card__head">' +
        "<div>" +
        "<strong>국세직원(요청)</strong> " +
        cname +
        "</div>" +
        "<div>" +
        fmtDateShort(r.createdAt) +
        " · " +
        statusBadge +
        "</div></div>" +
        '<div class="table-wrap"><table class="data bank-payroll-table bank-payroll-table--teacher"><thead><tr><th>번호</th><th>이름</th><th>기존 잔액</th><th>주급(기준)</th><th>세금</th></tr></thead><tbody>' +
        linesRows +
        "</tbody></table></div>" +
        actions +
        "</article>"
      );
    }

    var pendingBlock =
      pending.length > 0
        ? buildTeacherTaxCollectDayStack(
            db,
            pending,
            function (r) {
              return r.createdAt;
            },
            cardHtml
          )
        : '<p class="muted">승인 대기 중인 세금 징수 요청이 없습니다.</p>';
    var restBlock =
      rest.length > 0
        ? buildTeacherTaxCollectDayStack(
            db,
            rest,
            function (r) {
              if (r.status === "undone" && r.undoneAt != null) return r.undoneAt;
              return r.resolvedAt != null ? r.resolvedAt : r.createdAt;
            },
            cardHtml
          )
        : "";

    var filterPanel =
      '<section class="panel" style="margin-bottom: 1.5rem;">' +
      '<h2 class="panel__title">📅 국고 조회 및 정산 기간 설정</h2>' +
      '<p class="panel__text muted">특정 기간을 설정하여 국고 수입 비율 및 상세 내역을 필터링해 봅니다.</p>' +
      '<div class="row-actions row-actions--wrap" style="align-items: center; gap: 1rem; margin-top: 1rem;">' +
        '<div style="display: flex; align-items: center; gap: 0.5rem;">' +
          '<span style="font-size: 0.85rem; font-weight: bold; color: var(--text-muted);">시작일:</span>' +
          '<input type="date" id="tax-filter-start-input" class="input" style="width: 140px; padding: 4px 8px;" value="' + escapeHtml(taxFilterStart) + '" />' +
        '</div>' +
        '<div style="display: flex; align-items: center; gap: 0.5rem;">' +
          '<span style="font-size: 0.85rem; font-weight: bold; color: var(--text-muted);">종료일:</span>' +
          '<input type="date" id="tax-filter-end-input" class="input" style="width: 140px; padding: 4px 8px;" value="' + escapeHtml(taxFilterEnd) + '" />' +
        '</div>' +
        '<div style="display: flex; gap: 0.35rem;">' +
          '<button type="button" class="btn btn--ghost btn--sm js-quick-date" data-range="today">오늘</button>' +
          '<button type="button" class="btn btn--ghost btn--sm js-quick-date" data-range="week">이번 주</button>' +
          '<button type="button" class="btn btn--ghost btn--sm js-quick-date" data-range="month">이번 달</button>' +
          '<button type="button" class="btn btn--ghost btn--sm js-quick-date" data-range="all">전체</button>' +
        '</div>' +
      '</div>' +
      (taxFilterStart || taxFilterEnd
        ? '<p style="margin: 0.75rem 0 0 0; font-size: 0.85rem; color: #60a5fa; font-weight: bold; display: flex; align-items: center; gap: 0.25rem;">' +
          '<span>💡</span> 현재 <strong>' + (taxFilterStart ? taxFilterStart : '최초') + '</strong> ~ <strong>' + (taxFilterEnd ? taxFilterEnd : '현재') + '</strong> 기간의 국고 내역을 조회 중입니다.' +
          '</p>'
        : '') +
      '</section>';

    var syncPeriodBtn = "";
    if (taxFilterStart || taxFilterEnd) {
      syncPeriodBtn = '<button type="button" class="btn btn--ghost" id="btn-class-tax-sync-period" data-period-sum="' + totalActual + '">선택 기간 합계로 맞추기 (' + formatNum(totalActual) + ' Cal)</button>';
    }

    return (
      '<div class="tax-collect-total-banner tax-collect-total-banner--teacher">' +
      '<div class="tax-collect-total-banner__line"><strong>우리반 세금 총액</strong> ' +
      '<span class="tax-collect-total-banner__num">' +
      formatNum(classTotal) +
      "</span> Cal " +
      (taxFilterStart || taxFilterEnd
        ? '<span class="muted">(조회 기간 합계)</span>'
        : (manualActive
          ? '<span class="muted">(교사 지정)</span>'
          : '<span class="muted">(승인 징수 합계)</span>')) +
      "</div></div>" +
      filterPanel +
      inflowSummaryPanel +
      '<section class="panel tax-class-total-edit">' +
      '<h2 class="panel__title">우리반 세금 총액 조정</h2>' +
      '<p class="panel__text muted">자동 계산된 실제 수입 총합(세금+상점): <strong>' +
      formatNum(totalActual) +
      "</strong> Cal (일반세금: " + formatNum(taxSum) + " Cal)</p>" +
      '<p class="panel__text">아래에 숫자를 넣고 저장하면 <strong>학생 국세청 화면</strong>에 보이는 총액이 그 값으로 바뀝니다. 다시 징수 기록만 반영하려면 「징수 합계로 맞추기」를 누르세요.</p>' +
      '<form id="form-class-tax-total" class="stack">' +
      '<div class="form-grid">' +
      '<label class="field">표시할 총액 (Cal)<input name="manualTotal" type="number" min="0" step="1" required value="' +
      String(classTotal) +
      '" /></label>' +
      "</div>" +
      '<div class="row-actions row-actions--wrap" style="width: 100%; display: flex; align-items: center;">' +
      '<button type="submit" class="btn btn--primary">저장</button>' +
      '<button type="button" class="btn btn--ghost" id="btn-class-tax-sync-auto">징수 합계로 맞추기 (자동)</button>' +
      syncPeriodBtn +
      '<button type="button" class="btn btn--danger" id="btn-class-tax-reset-all" style="margin-left: auto;">국고 및 징수 현황 전체 리셋</button>' +
      "</div></form></section>" +
      '<section class="panel">' +
      '<h2 class="panel__title">승인 대기</h2>' +
      '<p class="panel__text muted bank-payroll-teacher-hint">요청일 기준으로 묶여 있습니다.</p>' +
      pendingBlock +
      "</section>" +
      (restBlock
        ? '<section class="panel"><h2 class="panel__title">처리 내역</h2>' +
          '<p class="panel__text muted bank-payroll-teacher-hint">승인·거절·실행취소한 날짜별로 묶여 있습니다.</p>' +
          restBlock +
          "</section>"
        : "")
    );
  }

  function viewTeacherTaxCollect(session) {
    var db = getDb();
    if (!db) return;
    ensureTaxCollectionRequests(db);
    var main = buildTeacherTaxCollectHtml(db);
    shell(renderTeacherChrome("국세청 세금 징수", "taxroll", main));
    bindLogout();
    var root = document.getElementById("app");
    if (!root) return;
    var approves = root.querySelectorAll(".js-tax-approve");
    var ai;
    for (ai = 0; ai < approves.length; ai++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id1 = btn.getAttribute("data-req-id");
          if (!id1) return;
          var db = getDb();
          var req = db.taxCollectionRequests.find(function (x) { return x.id === id1; });
          if (req && (req.status === "pending" || req.status === "undone" || req.status === "rejected")) {
            var card = btn.closest(".bank-payroll-card");
            var inputs = card.querySelectorAll(".js-tax-collect-amt-input");
            var lineMap = {};
            var ii;
            for (ii = 0; ii < inputs.length; ii++) {
              var inp = inputs[ii];
              var sid = inp.getAttribute("data-student-id");
              var val = parseInt(inp.value, 10);
              if (!isNaN(val) && val >= 0) {
                lineMap[sid] = val;
              }
            }
            req.lines.forEach(function (ln) {
              if (lineMap[ln.studentId] !== undefined) {
                ln.taxAmount = lineMap[ln.studentId];
              }
            });
            saveDb(db);
          }
          if (!confirm("이 세금 징수를 승인하시겠습니까? 친구들의 Calory에서 세금만큼 차감됩니다.")) return;
          var r1 = approveTaxCollectionRequest(getDb(), id1);
          if (!r1.ok) alert(r1.msg || "처리할 수 없습니다.");
          else route();
        });
      })(approves[ai]);
    }
    var rejects = root.querySelectorAll(".js-tax-reject");
    var ri;
    for (ri = 0; ri < rejects.length; ri++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id2 = btn.getAttribute("data-req-id");
          if (!id2 || !confirm("이 요청을 거절하시겠습니까? (Calory는 변하지 않습니다.)")) return;
          var r2 = rejectTaxCollectionRequest(getDb(), id2);
          if (!r2.ok) alert(r2.msg || "처리할 수 없습니다.");
          else route();
        });
      })(rejects[ri]);
    }
    var revokes = root.querySelectorAll(".js-tax-revoke-approved");
    var vi;
    for (vi = 0; vi < revokes.length; vi++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id3 = btn.getAttribute("data-req-id");
          if (
            !id3 ||
            !confirm(
              "이 승인을 실행취소하시겠습니까? 당시 징수한 세금만큼 친구들에게 Calory를 돌려줍니다."
            )
          )
            return;
          var r3 = revokeApprovedTaxCollectionRequest(getDb(), id3);
          if (!r3.ok) alert(r3.msg || "처리할 수 없습니다.");
          else route();
        });
      })(revokes[vi]);
    }
    var saveApproveds = root.querySelectorAll(".js-tax-save");
    var sai;
    for (sai = 0; sai < saveApproveds.length; sai++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-req-id");
          if (!id) return;
          var db = getDb();
          var req = db.taxCollectionRequests.find(function (x) { return x.id === id; });
          if (!req) return;

          if (req.status === "approved") {
            if (!confirm("이 이미 승인된 세금의 금액을 수정하시겠습니까? 학생들의 Calory 잔액과 국고 총액이 자동으로 보정됩니다.")) return;

            var card = btn.closest(".bank-payroll-card");
            var inputs = card.querySelectorAll(".js-tax-collect-amt-input");
            var lineMap = {};
            var ii;
            for (ii = 0; ii < inputs.length; ii++) {
              var inp = inputs[ii];
              var sid = inp.getAttribute("data-student-id");
              var val = parseInt(inp.value, 10);
              if (!isNaN(val) && val >= 0) {
                lineMap[sid] = val;
              }
            }

            req.lines.forEach(function (ln) {
              var newTax = lineMap[ln.studentId];
              if (newTax !== undefined && newTax !== ln.taxAmount) {
                var oldTax = ln.taxAmount;
                var diff = newTax - oldTax;
                var tgt = getStudent(db, ln.studentId);
                if (tgt) {
                  tgt.calory = Math.max(0, (tgt.calory || 0) - diff);
                  addActivityLog(db, {
                    studentId: ln.studentId,
                    summary: "세금 수정 반영: " + oldTax + " -> " + newTax + " Cal (" + (diff > 0 ? "-" : "+") + Math.abs(diff) + " Cal)",
                    expDelta: 0,
                    caloryDelta: -diff
                  });
                }
                ln.taxAmount = newTax;
              }
            });

            saveDb(db);
            alert("세금 징수 내역이 성공적으로 수정되었습니다.");
            route();
          } else {
            if (!confirm("이 세금 내역을 수정하여 저장하시겠습니까?")) return;

            var card = btn.closest(".bank-payroll-card");
            var inputs = card.querySelectorAll(".js-tax-collect-amt-input");
            var lineMap = {};
            var ii;
            for (ii = 0; ii < inputs.length; ii++) {
              var inp = inputs[ii];
              var sid = inp.getAttribute("data-student-id");
              var val = parseInt(inp.value, 10);
              if (!isNaN(val) && val >= 0) {
                lineMap[sid] = val;
              }
            }

            req.lines.forEach(function (ln) {
              var newTax = lineMap[ln.studentId];
              if (newTax !== undefined) {
                ln.taxAmount = newTax;
              }
            });

            saveDb(db);
            alert("세금 내역이 성공적으로 수정 저장되었습니다.");
            route();
          }
        });
      })(saveApproveds[sai]);
    }
    var deletes = root.querySelectorAll(".js-tax-delete");
    var di;
    for (di = 0; di < deletes.length; di++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var id4 = btn.getAttribute("data-req-id");
          if (!id4) return;
          var db = getDb();
          var req = db.taxCollectionRequests.find(function (x) { return x.id === id4; });
          if (!req) return;
          var msg = req.status === "approved"
            ? "이미 승인된 세금 징수입니다. 삭제하면 징수했던 Calory가 다시 환급됩니다. 정말 삭제하시겠습니까?"
            : "이 세금 징수 요청을 정말로 삭제하시겠습니까?";
          if (!confirm(msg)) return;
          var r4 = deleteTaxCollectionRequest(db, id4);
          if (!r4.ok) alert(r4.msg || "처리할 수 없습니다.");
          else route();
        });
      })(deletes[di]);
    }
    var formClassTax = document.getElementById("form-class-tax-total");
    if (formClassTax) {
      formClassTax.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(e.target);
        var v = parseInt(String(fd.get("manualTotal") || ""), 10);
        if (isNaN(v) || v < 0) {
          alert("0 이상의 숫자를 입력해 주세요.");
          return;
        }
        var dbT = getDb();
        dbT.classTaxTotalManual = v;
        delete dbT.classTaxTotalManualConfirmed;
        saveDb(dbT);
        alert("표시 총액을 저장했습니다.");
        route();
      });
    }
    var btnTaxAuto = document.getElementById("btn-class-tax-sync-auto");
    if (btnTaxAuto) {
      btnTaxAuto.addEventListener("click", function () {
        if (
          !confirm(
            "표시 총액을 「승인 징수 합계」로만 맞출까요? 이후에는 징수가 승인될 때마다 자동으로 바뀝니다."
          )
        )
          return;
        var dbA = getDb();
        delete dbA.classTaxTotalManual;
        delete dbA.classTaxTotalManualConfirmed;
        saveDb(dbA);
        alert("징수 합계(자동) 기준으로 바꿨습니다.");
        route();
      });
    }

    // 1. Date Filter start change
    var filterStart = document.getElementById("tax-filter-start-input");
    if (filterStart) {
      filterStart.addEventListener("change", function () {
        taxFilterStart = this.value;
        route();
      });
    }

    // 2. Date Filter end change
    var filterEnd = document.getElementById("tax-filter-end-input");
    if (filterEnd) {
      filterEnd.addEventListener("change", function () {
        taxFilterEnd = this.value;
        route();
      });
    }

    // 3. Quick Range Buttons
    var quickDates = root.querySelectorAll(".js-quick-date");
    var qdi;
    for (qdi = 0; qdi < quickDates.length; qdi++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var range = btn.getAttribute("data-range");
          var now = new Date();
          if (range === "today") {
            taxFilterStart = tsToYmd(now);
            taxFilterEnd = tsToYmd(now);
          } else if (range === "week") {
            var currentDay = now.getDay();
            var distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
            var monday = new Date(now.getTime() - distanceToMonday * 24 * 60 * 60 * 1000);
            taxFilterStart = tsToYmd(monday);
            taxFilterEnd = tsToYmd(now);
          } else if (range === "month") {
            var y = now.getFullYear();
            var m = now.getMonth() + 1;
            taxFilterStart = y + "-" + (m < 10 ? "0" + m : m) + "-01";
            taxFilterEnd = tsToYmd(now);
          } else {
            taxFilterStart = "";
            taxFilterEnd = "";
          }
          route();
        });
      })(quickDates[qdi]);
    }

    // 4. Sync Period button
    var btnTaxSyncPeriod = document.getElementById("btn-class-tax-sync-period");
    if (btnTaxSyncPeriod) {
      btnTaxSyncPeriod.addEventListener("click", function () {
        var sum = parseInt(btnTaxSyncPeriod.getAttribute("data-period-sum"), 10);
        if (isNaN(sum)) return;
        if (!confirm("선택한 조회 기간의 실제 수입 합계(" + formatNum(sum) + " Cal)로 표시 총액을 조정하시겠습니까?")) return;
        var dbP = getDb();
        dbP.classTaxTotalManual = sum;
        delete dbP.classTaxTotalManualConfirmed;
        saveDb(dbP);
        alert("선택 기간의 합계(" + formatNum(sum) + " Cal)로 표시 총액을 설정했습니다.");
        route();
      });
    }

    // 5. Reset All Treasury and History button
    var btnTaxResetAll = document.getElementById("btn-class-tax-reset-all");
    if (btnTaxResetAll) {
      btnTaxResetAll.addEventListener("click", function () {
        if (!confirm("정말로 모든 국고 수입 내역(세금 징수 기록 및 상점 누적 매출)을 리셋하시겠습니까?\n(이 작업은 취소할 수 없으며, 이미 학생들에게서 차감된 Calory나 지급된 물품은 회수되지 않고 통계만 리셋됩니다.)")) return;
        if (!confirm("한 번 더 확인합니다. 정말로 리셋하시겠습니까? 모든 징수 이력과 매출 기록이 완전히 지워집니다.")) return;
        var dbR = getDb();
        resetTreasuryAndTaxHistory(dbR);
        taxFilterStart = "";
        taxFilterEnd = "";
        alert("국고 및 세금 징수 현황이 모두 초기화되었습니다.");
        route();
      });
    }

    // 6. Confirm Manual Tax Warning Suppress Checkbox
    var chkConfirmManualTax = document.getElementById("chk-confirm-manual-tax");
    if (chkConfirmManualTax) {
      chkConfirmManualTax.addEventListener("change", function () {
        if (this.checked) {
          var dbC = getDb();
          dbC.classTaxTotalManualConfirmed = true;
          saveDb(dbC);
          alert("반영하였습니다!");
          route();
        }
      });
    }
  }

  function viewStudentPinChange(session) {
    var db = getDb();
    if (!db) {
      shell(
        renderStudentChrome("오류", '<section class="panel"><p class="panel__text">학급 데이터를 불러오지 못했습니다. 잠시 후 새로고침하거나 다시 로그인해 주세요.</p></section>')
      );
      bindLogout();
      return;
    }
    var u = getUser(db, session.userId);
    if (!u || u.role !== "student") {
      window.location.hash = "#/student";
      route();
      return;
    }
    var main =
      '<section class="panel">' +
      '<h2 class="panel__title">비밀번호 변경</h2>' +
      '<p class="panel__text">첫 로그인입니다. 초기 비밀번호(0000) 대신 사용할 <strong>새 비밀번호 4자리 숫자</strong>를 정해 주세요. (0000은 사용할 수 없습니다.)</p>' +
      '<form id="form-pin-change" class="stack" autocomplete="off">' +
      '<label class="field">새 비밀번호 (4자리)<input type="password" name="pin1" inputmode="numeric" maxlength="4" required autocomplete="off" spellcheck="false" /></label>' +
      '<label class="field">한 번 더 입력<input type="password" name="pin2" inputmode="numeric" maxlength="4" required autocomplete="off" spellcheck="false" /></label>' +
      '<button type="submit" class="btn btn--primary">저장하고 시작하기</button>' +
      "</form></section>";

    shell(renderStudentChrome("비밀번호 설정", main));
    bindLogout();

    document.getElementById("form-pin-change").addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var p1 = normalizePinDigits(fd.get("pin1"));
      var p2 = normalizePinDigits(fd.get("pin2"));
      if (p1 !== p2) {
        alert("두 입력이 서로 다릅니다. 같은 숫자 4자리를 두 번 입력해 주세요.");
        return;
      }
      if (p1 === "0000") {
        alert("0000은 사용할 수 없습니다. 다른 숫자 4자리를 정해 주세요.");
        return;
      }
      var db2 = getDb();
      var u2 = getUser(db2, session.userId);
      if (!u2) return;
      u2.pinCode = p1;
      u2.pinMustChange = false;
      delete u2.passwordHash;
      delete u2.salt;
      saveDb(db2);
      window.location.hash = "#/student";
      route();
    });
  }

  function bindCouponShopBuy() {
    var root = document.getElementById("app");
    if (!root) return;
    var btns = root.querySelectorAll(".js-coupon-buy");
    var bi;
    for (bi = 0; bi < btns.length; bi++) {
      btns[bi].addEventListener("click", function (e) {
        var btn = e.currentTarget || this;
        var id = btn.getAttribute("data-product-id");
        if (!id || btn.disabled) return;
        
        var currentSession = requireSession();
        if (!currentSession || currentSession.role !== "student" || !currentSession.studentId) {
          alert("세션이 만료되었습니다. 다시 로그인 해주세요.");
          return;
        }
        
        var db2 = getDb();
        var buyer = getStudent(db2, currentSession.studentId);
        var buyerName = buyer ? buyer.name : currentSession.studentId;
        
        var prod = findCouponProduct(db2, id);
        var prodName = prod ? prod.name : "선택한 쿠폰";
        
        if (prod && prod.isGroup) {
          var sharePrice = Math.ceil(prod.priceCal / prod.groupTargetCount);
          if (!confirm("📢 [단체 공동 구매 참여]\n\n참여 학생: " + buyerName + "\n쿠폰 이름: " + prodName + "\n\n 이 쿠폰은 단체권입니다.\n내 부담금: " + formatNum(sharePrice) + " Cal\n목표 인원: " + prod.groupTargetCount + "명\n현재 참여: " + (prod.groupContributors ? prod.groupContributors.length : 0) + "명\n\n공동 구매에 참여하시겠습니까? (참여 후 취소는 불가합니다)")) {
            return;
          }
          var r = joinGroupCoupon(db2, currentSession.studentId, id);
          if (!r.ok) {
            alert(r.msg || "공동 구매에 참여할 수 없습니다.");
            return;
          }
          route();
          return;
        }
        
        if (!confirm("📢 [구매자 신원 및 상품 확인]\n\n구매 학생: " + buyerName + " (" + currentSession.studentId + ")\n구매 상품: " + prodName + "\n\n본인의 정보가 맞습니까? 맞다면 [확인]을 눌러 구매를 완료해 주세요.")) {
          return;
        }
        
        var r = purchaseCouponProduct(db2, currentSession.studentId, id);
        if (!r.ok) {
          alert(r.msg || "구매할 수 없습니다.");
          return;
        }
        route();
      });
    }
  }

  function bindCouponShopDescToggle() {
    var root = document.getElementById("app");
    if (!root) return;
    var btns = root.querySelectorAll(".js-coupon-desc-toggle");
    var bi;
    for (bi = 0; bi < btns.length; bi++) {
      btns[bi].addEventListener("click", function (e) {
        var btn = e.target;
        var wrapper = btn.closest(".coupon-product-card__desc-wrapper");
        if (!wrapper) return;
        var textEl = wrapper.querySelector(".js-coupon-desc-text");
        if (!textEl) return;
        var expanded = textEl.getAttribute("data-expanded") === "true";
        if (expanded) {
          textEl.textContent = textEl.getAttribute("data-short");
          textEl.setAttribute("data-expanded", "false");
          btn.textContent = "더보기";
        } else {
          textEl.textContent = textEl.getAttribute("data-full");
          textEl.setAttribute("data-expanded", "true");
          btn.textContent = "접기";
        }
      });
    }
  }

  function bindCouponMerchantOffer(session) {
    var form = document.getElementById("form-coupon-offer");
    if (form) {
      // Toggle group target count container dynamically
      var groupRadios = form.querySelectorAll('input[name="isGroup"]');
      var groupContainer = document.getElementById("group-target-container");
      if (groupRadios && groupContainer) {
        var handler = function () {
          if (form.isGroup.value === "true") {
            groupContainer.style.display = "block";
            groupContainer.querySelector('input[name="groupTargetCount"]').setAttribute("required", "required");
          } else {
            groupContainer.style.display = "none";
            groupContainer.querySelector('input[name="groupTargetCount"]').removeAttribute("required");
          }
        };
        var ri;
        for (ri = 0; ri < groupRadios.length; ri++) {
          groupRadios[ri].addEventListener("change", handler);
        }
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var db2 = getDb();
        var r = submitCouponProductOffer(
          db2,
          session,
          fd.get("name"),
          fd.get("priceCal"),
          fd.get("totalStock"),
          fd.get("desc"),
          fd.get("isGroup"),
          fd.get("groupTargetCount")
        );
        if (!r.ok) {
          alert(r.msg || "요청을 보낼 수 없습니다.");
          return;
        }
        alert("선생님께 승인 요청을 보냈습니다.");
        route();
      });
    }

    var root = document.getElementById("app");
    if (!root) return;
    var priceForms = root.querySelectorAll(".js-coupon-price-change-form");
    var fi;
    for (fi = 0; fi < priceForms.length; fi++) {
      priceForms[fi].addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(this);
        var pid = fd.get("productId");
        var priceVal = fd.get("newPrice");
        if (!pid || !priceVal) return;
        if (!confirm("이 쿠폰의 가격 변경 요청을 보낼까요?")) return;
        var db2 = getDb();
        var r = submitCouponPriceChangeOffer(db2, session, pid, priceVal);
        if (!r.ok) {
          alert(r.msg || "요청을 보낼 수 없습니다.");
          return;
        }
        alert("선생님께 가격 변경 승인 요청을 보냈습니다.");
        route();
      });
    }
  }

  function bindCouponMerchantEditDesc(session) {
    var root = document.getElementById("app");
    if (!root) return;
    var editBtns = root.querySelectorAll(".js-coupon-edit-desc");
    var ei;
    for (ei = 0; ei < editBtns.length; ei++) {
      editBtns[ei].addEventListener("click", function (e) {
        var btn = e.target;
        var pid = btn.getAttribute("data-product-id");
        var curDesc = btn.getAttribute("data-desc") || "";
        var newDesc = prompt("쿠폰 소개를 입력하세요 (최대 300자):", curDesc);
        if (newDesc === null) return;
        var dbEdit = getDb();
        var res = updateCouponProductDesc(dbEdit, session, pid, newDesc);
        if (!res.ok) {
          alert(res.msg);
        } else {
          route();
        }
      });
    }
  }

  function bindTeacherCouponShopApproval() {
    var root = document.getElementById("app");
    if (!root) return;

    var approves = root.querySelectorAll(".js-coupon-approve");
    var ri;
    for (ri = 0; ri < approves.length; ri++) {
      approves[ri].addEventListener("click", function () {
        var oid = this.getAttribute("data-offer-id");
        if (!oid || !confirm("이 요청을 승인할까요?")) return;
        var db2 = getDb();
        var r = approveCouponPendingOffer(db2, oid);
        if (!r.ok) {
          alert(r.msg || "승인할 수 없습니다.");
          return;
        }
        route();
      });
    }

    var rejs = root.querySelectorAll(".js-coupon-reject");
    for (ri = 0; ri < rejs.length; ri++) {
      rejs[ri].addEventListener("click", function () {
        var oid = this.getAttribute("data-offer-id");
        if (!oid || !confirm("이 요청을 거절할까요?")) return;
        var db2 = getDb();
        var r = rejectCouponPendingOffer(db2, oid);
        if (!r.ok) {
          alert(r.msg || "거절할 수 없습니다.");
          return;
        }
        route();
      });
    }

    var dels = root.querySelectorAll(".js-coupon-delete");
    for (ri = 0; ri < dels.length; ri++) {
      dels[ri].addEventListener("click", function () {
        var pid = this.getAttribute("data-product-id");
        if (!pid || !confirm("이 쿠폰을 삭제하시겠습니까?")) return;
        var db2 = getDb();
        var r = deleteCouponProduct(db2, pid);
        if (!r.ok) {
          alert(r.msg || "삭제할 수 없습니다.");
          return;
        }
        route();
      });
    }

    var addForm = document.getElementById("form-teacher-coupon-add");
    if (addForm) {
      addForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var db2 = getDb();
        var nameInput = addForm.querySelector('[name="name"]');
        var priceInput = addForm.querySelector('[name="priceCal"]');
        var stockInput = addForm.querySelector('[name="totalStock"]');
        var nameVal = nameInput ? nameInput.value : "";
        var priceVal = priceInput ? priceInput.value : "";
        var stockVal = stockInput ? stockInput.value : "";
        var r = addTeacherCoupon(db2, nameVal, priceVal, stockVal);
        if (!r.ok) {
          alert(r.msg || "등록할 수 없습니다.");
          return;
        }
        alert("쿠폰을 직접 등록했습니다.");
        route();
      });
    }
  }

  function bindCouponShopUseRequest() {
    var root = document.getElementById("app");
    if (!root) return;
    var btns = root.querySelectorAll(".js-coupon-use-request");
    var i;
    for (i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        var id = this.getAttribute("data-rental-id");
        if (!id || this.disabled) return;
        if (!confirm("이 쿠폰의 사용 승인을 요청하시겠습니까?\n쿠폰상인과 선생님의 승인이 완료되면 쿠폰이 사용 처리됩니다.")) return;
        var currentSession = requireSession();
        if (!currentSession || currentSession.role !== "student" || !currentSession.studentId) {
          alert("세션이 만료되었습니다. 다시 로그인 해주세요.");
          return;
        }
        var db2 = getDb();
        var r = requestUseCoupon(db2, currentSession.studentId, id);
        if (!r.ok) {
          alert(r.msg || "요청할 수 없습니다.");
          return;
        }
        alert("사용 승인 요청을 보냈습니다. 먼저 쿠폰상인에게 승인을 받으세요!");
        route();
      });
    }
  }

  function bindCouponMerchantUseApproval() {
    var root = document.getElementById("app");
    if (!root) return;
    var btns = root.querySelectorAll(".js-coupon-merchant-approve-use");
    var i;
    for (i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        var id = this.getAttribute("data-rental-id");
        if (!id || this.disabled) return;
        if (!confirm("이 쿠폰 사용 요청을 승인하시겠습니까?\n승인하면 선생님 최종 승인 대기 단계로 넘어갑니다.")) return;
        var currentSession = requireSession();
        if (!currentSession || currentSession.role !== "student" || !currentSession.studentId) {
          alert("세션이 만료되었습니다. 다시 로그인 해주세요.");
          return;
        }
        var db2 = getDb();
        var r = merchantApproveUseCoupon(db2, currentSession.studentId, id);
        if (!r.ok) {
          alert(r.msg || "승인할 수 없습니다.");
          return;
        }
        alert("사용 요청을 승인했습니다. 선생님 최종 승인 완료 시 쿠폰 사용이 완료됩니다.");
        route();
      });
    }

    var cancels = root.querySelectorAll(".js-coupon-merchant-cancel");
    for (var ci = 0; ci < cancels.length; ci++) {
      cancels[ci].addEventListener("click", function (e) {
        var rentalId = this.getAttribute("data-rental-id");
        var logId = this.getAttribute("data-log-id");
        if (!rentalId && !logId) return;
        if (!confirm("이 쿠폰 구매 거래를 취소하시겠습니까?\n취소 시 학생의 Calory가 환불되고 쿠폰이 소유 목록에서 회수되며, 장부 기록이 삭제되고 국고 총수입에서 차감됩니다.")) return;
        var db2 = getDb();
        var currentSession = requireSession();
        if (!currentSession || currentSession.role !== "student") {
          alert("세션이 만료되었습니다. 다시 로그인 해주세요.");
          return;
        }
        
        var targetRentalId = rentalId;
        if (!targetRentalId && logId) {
          var logObj = db2.couponShop.merchantLog.find(function(l) { return l.id === logId; });
          if (logObj) targetRentalId = logObj.rentalId;
        }
        
        if (!targetRentalId && logId) {
          var logObj = db2.couponShop.merchantLog.find(function(l) { return l.id === logId; });
          if (logObj) {
            var rentObj = db2.couponShop.rentals.find(function(rn) {
              return rn.productId === logObj.productId && rn.studentId === logObj.buyerStudentId && (rn.status === "held" || rn.status === "use_requested" || rn.status === "merchant_approved");
            });
            if (rentObj) targetRentalId = rentObj.id;
          }
        }

        if (!targetRentalId) {
          alert("취소 가능한 대여/소유 상태의 쿠폰을 찾을 수 없거나 이미 사용 완료된 쿠폰입니다.");
          return;
        }

        var r = cancelCouponPurchase(db2, targetRentalId, currentSession.studentId, false);
        if (!r.ok) {
          alert(r.msg || "오류가 발생했습니다.");
          return;
        }
        alert("구매 취소 및 환불 처리가 완료되었습니다.");
        route();
      });
    }
  }

  function bindTeacherCouponUseApproval() {
    var root = document.getElementById("app");
    if (!root) return;

    var approveBtns = root.querySelectorAll(".js-coupon-teacher-approve-use");
    var i;
    for (i = 0; i < approveBtns.length; i++) {
      approveBtns[i].addEventListener("click", function () {
        var id = this.getAttribute("data-rental-id");
        if (!id) return;
        if (!confirm("이 쿠폰의 사용을 최종 승인(회수 및 반납)하시겠습니까?")) return;
        var db2 = getDb();
        var r = teacherApproveUseCoupon(db2, id);
        if (!r.ok) {
          alert(r.msg || "승인할 수 없습니다.");
          return;
        }
        alert("최종 승인 및 반납 처리가 완료되었습니다.");
        route();
      });
    }

    var rejectBtns = root.querySelectorAll(".js-coupon-teacher-reject-use");
    for (i = 0; i < rejectBtns.length; i++) {
      rejectBtns[i].addEventListener("click", function () {
        var id = this.getAttribute("data-rental-id");
        if (!id) return;
        if (!confirm("이 쿠폰 사용 요청을 반려(취소)하시겠습니까?\n쿠폰은 다시 해당 학생의 보유 중 상태로 원복됩니다.")) return;
        var db2 = getDb();
        var r = teacherRejectUseCoupon(db2, id);
        if (!r.ok) {
          alert(r.msg || "반려할 수 없습니다.");
          return;
        }
        alert("사용 요청을 반려하여 보류 상태로 돌려놓았습니다.");
        route();
      });
    }

    var teacherCancels = root.querySelectorAll(".js-teacher-coupon-cancel");
    for (var ci = 0; ci < teacherCancels.length; ci++) {
      teacherCancels[ci].addEventListener("click", function (e) {
        var rentalId = this.getAttribute("data-rental-id");
        var logId = this.getAttribute("data-log-id");
        if (!rentalId && !logId) return;
        if (!confirm("선생님 권한으로 이 쿠폰 구매 거래를 취소하시겠습니까?\n취소 시 학생의 Calory가 환불되고 쿠폰이 소유 목록에서 회수되며, 장부 기록이 삭제되고 국고 총수입에서 차감됩니다.")) return;
        var db2 = getDb();
        
        var targetRentalId = rentalId;
        if (!targetRentalId && logId) {
          var logObj = db2.couponShop.merchantLog.find(function(l) { return l.id === logId; });
          if (logObj) targetRentalId = logObj.rentalId;
        }
        
        if (!targetRentalId && logId) {
          var logObj = db2.couponShop.merchantLog.find(function(l) { return l.id === logId; });
          if (logObj) {
            var rentObj = db2.couponShop.rentals.find(function(rn) {
              return rn.productId === logObj.productId && rn.studentId === logObj.buyerStudentId && (rn.status === "held" || rn.status === "use_requested" || rn.status === "merchant_approved");
            });
            if (rentObj) targetRentalId = rentObj.id;
          }
        }

        if (!targetRentalId) {
          alert("취소 가능한 대여/소유 상태의 쿠폰을 찾을 수 없거나 이미 사용 완료된 쿠폰입니다.");
          return;
        }

        var r = cancelCouponPurchase(db2, targetRentalId, null, true);
        if (!r.ok) {
          alert(r.msg || "오류가 발생했습니다.");
          return;
        }
        alert("선생님 권한으로 구매 취소 및 환불 처리가 완료되었습니다.");
        route();
      });
    }
  }

  function bindCanteenShopBuy() {
    var root = document.getElementById("app");
    if (!root) return;
    var btns = root.querySelectorAll(".js-canteen-buy");
    var bi;
    for (bi = 0; bi < btns.length; bi++) {
      btns[bi].addEventListener("click", function () {
        var id = this.getAttribute("data-product-id");
        if (!id || this.disabled) return;
        if (!confirm("이 상품을 구매하시겠습니까?")) return;
        var currentSession = requireSession();
        if (!currentSession || currentSession.role !== "student" || !currentSession.studentId) {
          alert("세션이 만료되었습니다. 다시 로그인 해주세요.");
          return;
        }
        var db2 = getDb();
        var r = purchaseCanteenProduct(db2, currentSession.studentId, id);
        if (!r.ok) {
          alert(r.msg || "구매할 수 없습니다.");
          return;
        }
        route();
      });
    }
  }

  function bindCanteenMerchantOffer(session) {
    var form = document.getElementById("form-canteen-offer");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(form);
        var db2 = getDb();
        var r = submitCanteenProductOffer(db2, session, fd.get("name"), fd.get("priceCal"), fd.get("totalStock"));
        if (!r.ok) {
          alert(r.msg || "요청을 보낼 수 없습니다.");
          return;
        }
        alert("선생님께 승인 요청을 보냈습니다.");
        route();
      });
    }

    var root = document.getElementById("app");
    if (!root) return;
    var priceForms = root.querySelectorAll(".js-canteen-price-change-form");
    var fi;
    for (fi = 0; fi < priceForms.length; fi++) {
      priceForms[fi].addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(e.currentTarget || this);
        var pid = fd.get("productId");
        var priceVal = fd.get("newPrice");
        if (!pid || !priceVal) return;
        if (!confirm("이 상품의 가격 변경 요청을 보낼까요?")) return;
        var db2 = getDb();
        var r = submitCanteenPriceChangeOffer(db2, session, pid, priceVal);
        if (!r.ok) {
          alert(r.msg || "요청을 보낼 수 없습니다.");
          return;
        }
        alert("선생님께 가격 변경 승인 요청을 보냈습니다.");
        route();
      });
    }

    var approves = root.querySelectorAll(".js-canteen-merchant-approve-order");
    var ai;
    for (ai = 0; ai < approves.length; ai++) {
      approves[ai].addEventListener("click", function (e) {
        var oid = (e.currentTarget || this).getAttribute("data-order-id");
        if (!oid) return;
        if (!confirm("상품을 인도하고 이 주문을 승인하시겠습니까?")) return;
        var db2 = getDb();
        var currentSession = requireSession();
        if (!currentSession || currentSession.role !== "student") {
          alert("세션이 만료되었습니다. 다시 로그인 해주세요.");
          return;
        }
        var r = approveCanteenOrder(db2, oid, currentSession.studentId, false);
        if (!r.ok) {
          alert(r.msg || "오류가 발생했습니다.");
          return;
        }
        alert("승인 처리되었습니다.");
        route();
      });
    }

    var rejects = root.querySelectorAll(".js-canteen-merchant-reject-order");
    var rejI;
    for (rejI = 0; rejI < rejects.length; rejI++) {
      rejects[rejI].addEventListener("click", function (e) {
        var oid = (e.currentTarget || this).getAttribute("data-order-id");
        if (!oid) return;
        if (!confirm("이 주문을 반려하시겠습니까? 학생에게 Calory가 환불됩니다.")) return;
        var db2 = getDb();
        var currentSession = requireSession();
        if (!currentSession || currentSession.role !== "student") {
          alert("세션이 만료되었습니다. 다시 로그인 해주세요.");
          return;
        }
        var r = cancelCanteenOrder(db2, oid, currentSession.studentId, false);
        if (!r.ok) {
          alert(r.msg || "오류가 발생했습니다.");
          return;
        }
        alert("반려 처리되었습니다.");
        route();
      });
    }

    var canteenCancels = root.querySelectorAll(".js-canteen-merchant-cancel");
    for (var ci = 0; ci < canteenCancels.length; ci++) {
      canteenCancels[ci].addEventListener("click", function (e) {
        var orderId = this.getAttribute("data-order-id");
        var logId = this.getAttribute("data-log-id");
        if (!orderId && !logId) return;
        if (!confirm("이 매점 상품 구매 거래를 취소하시겠습니까?\n취소 시 학생의 Calory가 환불되고 매점 상품 재고가 +1 복구되며, 장부 기록이 삭제되고 매점 국고 수입에서 차감됩니다.")) return;
        var db2 = getDb();
        var currentSession = requireSession();
        if (!currentSession || currentSession.role !== "student") {
          alert("세션이 만료되었습니다. 다시 로그인 해주세요.");
          return;
        }
        
        var targetOrderId = orderId;
        if (!targetOrderId && logId) {
          var logObj = db2.canteenShop.merchantLog.find(function(l) { return l.id === logId; });
          if (logObj) targetOrderId = logObj.orderId;
        }
        
        if (!targetOrderId && logId) {
          var logObj = db2.canteenShop.merchantLog.find(function(l) { return l.id === logId; });
          if (logObj) {
            var ordObj = db2.canteenShop.orders.find(function(o) {
              return o.productId === logObj.productId && o.buyerStudentId === logObj.buyerStudentId && (o.status === "completed" || o.status === "pending");
            });
            if (ordObj) targetOrderId = ordObj.id;
          }
        }

        if (!targetOrderId) {
          alert("취소 가능한 주문 내역을 찾을 수 없습니다.");
          return;
        }

        var r = cancelCanteenOrder(db2, targetOrderId, currentSession.studentId, false);
        if (!r.ok) {
          alert(r.msg || "오류가 발생했습니다.");
          return;
        }
        alert("구매 취소 및 환불 처리가 완료되었습니다.");
        route();
      });
    }
  }

  function bindTeacherCanteenShopApproval() {
    var root = document.getElementById("app");
    if (!root) return;

    var approves = root.querySelectorAll(".js-canteen-approve");
    var ri;
    for (ri = 0; ri < approves.length; ri++) {
      approves[ri].addEventListener("click", function () {
        var oid = this.getAttribute("data-offer-id");
        if (!oid || !confirm("이 요청을 승인할까요?")) return;
        var db2 = getDb();
        var r = approveCanteenPendingOffer(db2, oid);
        if (!r.ok) {
          alert(r.msg || "승인할 수 없습니다.");
          return;
        }
        route();
      });
    }

    var rejs = root.querySelectorAll(".js-canteen-reject");
    for (ri = 0; ri < rejs.length; ri++) {
      rejs[ri].addEventListener("click", function () {
        var oid = this.getAttribute("data-offer-id");
        if (!oid || !confirm("이 요청을 거절할까요?")) return;
        var db2 = getDb();
        var r = rejectCanteenPendingOffer(db2, oid);
        if (!r.ok) {
          alert(r.msg || "거절할 수 없습니다.");
          return;
        }
        route();
      });
    }

    var dels = root.querySelectorAll(".js-canteen-delete");
    for (ri = 0; ri < dels.length; ri++) {
      dels[ri].addEventListener("click", function () {
        var pid = this.getAttribute("data-product-id");
        if (!pid || !confirm("이 상품을 삭제하시겠습니까?")) return;
        var db2 = getDb();
        var r = deleteCanteenProduct(db2, pid);
        if (!r.ok) {
          alert(r.msg || "삭제할 수 없습니다.");
          return;
        }
        route();
      });
    }

    var teacherApproves = root.querySelectorAll(".js-canteen-teacher-approve-order");
    for (ri = 0; ri < teacherApproves.length; ri++) {
      teacherApproves[ri].addEventListener("click", function () {
        var oid = this.getAttribute("data-order-id");
        if (!oid || !confirm("이 주문을 강제 승인(인도 완료)하시겠습니까?")) return;
        var db2 = getDb();
        var r = approveCanteenOrder(db2, oid, null, true);
        if (!r.ok) {
          alert(r.msg || "승인할 수 없습니다.");
          return;
        }
        alert("강제 승인 처리가 완료되었습니다.");
        route();
      });
    }

    var teacherRejects = root.querySelectorAll(".js-canteen-teacher-reject-order");
    for (ri = 0; ri < teacherRejects.length; ri++) {
      teacherRejects[ri].addEventListener("click", function () {
        var oid = this.getAttribute("data-order-id");
        if (!oid || !confirm("이 주문을 반려(취소 및 Calory 환불)하시겠습니까?")) return;
        var db2 = getDb();
        var r = cancelCanteenOrder(db2, oid, null, true);
        if (!r.ok) {
          alert(r.msg || "반려할 수 없습니다.");
          return;
        }
        alert("주문 반려 처리가 완료되었습니다.");
        route();
      });
    }

    var teacherCanteenCancels = root.querySelectorAll(".js-teacher-canteen-cancel");
    for (var ci = 0; ci < teacherCanteenCancels.length; ci++) {
      teacherCanteenCancels[ci].addEventListener("click", function (e) {
        var orderId = this.getAttribute("data-order-id");
        var logId = this.getAttribute("data-log-id");
        if (!orderId && !logId) return;
        if (!confirm("선생님 권한으로 이 매점 상품 구매 거래를 취소하시겠습니까?\n취소 시 학생의 Calory가 환불되고 매점 상품 재고가 +1 복구되며, 장부 기록이 삭제되고 매점 국고 수입에서 차감됩니다.")) return;
        var db2 = getDb();
        
        var targetOrderId = orderId;
        if (!targetOrderId && logId) {
          var logObj = db2.canteenShop.merchantLog.find(function(l) { return l.id === logId; });
          if (logObj) targetOrderId = logObj.orderId;
        }
        
        if (!targetOrderId && logId) {
          var logObj = db2.canteenShop.merchantLog.find(function(l) { return l.id === logId; });
          if (logObj) {
            var ordObj = db2.canteenShop.orders.find(function(o) {
              return o.productId === logObj.productId && o.buyerStudentId === logObj.buyerStudentId && (o.status === "completed" || o.status === "pending");
            });
            if (ordObj) targetOrderId = ordObj.id;
          }
        }

        if (!targetOrderId) {
          alert("취소 가능한 주문 내역을 찾을 수 없습니다.");
          return;
        }

        var r = cancelCanteenOrder(db2, targetOrderId, null, true);
        if (!r.ok) {
          alert(r.msg || "오류가 발생했습니다.");
          return;
        }
        alert("선생님 권한으로 구매 취소 및 환불 처리가 완료되었습니다.");
        route();
      });
    }

    var addForm = document.getElementById("form-teacher-canteen-add");
    if (addForm) {
      addForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var db2 = getDb();
        var nameInput = addForm.querySelector('[name="name"]');
        var priceInput = addForm.querySelector('[name="priceCal"]');
        var stockInput = addForm.querySelector('[name="totalStock"]');
        var nameVal = nameInput ? nameInput.value : "";
        var priceVal = priceInput ? priceInput.value : "";
        var stockVal = stockInput ? stockInput.value : "";
        var r = addTeacherCanteen(db2, nameVal, priceVal, stockVal);
        if (!r.ok) {
          alert(r.msg || "등록할 수 없습니다.");
          return;
        }
        alert("상품을 직접 등록했습니다.");
        route();
      });
    }
  }

  function viewStudentCouponShop(session) {
    var db = getDb();
    var main = buildCouponShopStudentHtml(db, session.studentId, { preview: false });
    shell(
      renderStudentChrome("쿠폰샵", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "coupon-shop"),
      })
    );
    bindLogout();
    bindCouponShopBuy();
    bindCouponShopUseRequest();
    bindCouponShopDescToggle();
  }

  function viewStudentStore(session) {
    var db = getDb();
    var main = buildCanteenShopStudentHtml(db, session.studentId, { preview: false });
    shell(
      renderStudentChrome("매점", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "store"),
      })
    );
    bindLogout();
    bindCanteenShopBuy();
  }

  function viewStudentCanteenMerchant(session) {
    var db = getDb();
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "store_merchant") {
      window.location.hash = "#/student";
      route();
      return;
    }
    var main = buildCanteenMerchantStudentHtml(db, session.studentId, { preview: false });
    shell(
      renderStudentChrome("매점 상인 · 샵 관리", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "store-merchant"),
      })
    );
    bindLogout();
    bindCanteenMerchantOffer(session);
  }

  function viewTeacherCanteenShop(session) {
    var db = getDb();
    var main = buildTeacherCanteenShopApprovalHtml(db);
    shell(renderTeacherChrome("매점 관리", "storeshop", main));
    bindLogout();
    bindTeacherCanteenShopApproval();
  }

  function viewStudentCouponMerchant(session) {
    var db = getDb();
    var st = getStudent(db, session.studentId);
    if (!st || st.jobId !== "coupon_merchant") {
      window.location.hash = "#/student";
      route();
      return;
    }
    var main = buildCouponMerchantStudentHtml(db, session.studentId, { preview: false });
    shell(
      renderStudentChrome("쿠폰 상인 · 샵 관리", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "coupon-merchant"),
      })
    );
    bindLogout();
    bindCouponMerchantOffer(session);
    bindCouponMerchantUseApproval();
    bindCouponMerchantEditDesc(session);
  }

  function viewTeacherCouponShop(session) {
    var db = getDb();
    var main = buildTeacherCouponShopApprovalHtml(db);
    shell(renderTeacherChrome("쿠폰샵 관리", "couponshop", main));
    bindLogout();
    bindTeacherCouponShopApproval();
    bindTeacherCouponUseApproval();
  }

  function viewStudentTitleShop(session) {
    var db = getDb();
    var main = buildTitleShopStudentHtml(db, session.studentId, { preview: false });
    shell(
      renderStudentChrome("칭호샵", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "title-shop"),
      })
    );
    bindLogout();
    bindTitleShopStudent(session.studentId, false);
  }

  function viewTeacherTitleShop(session) {
    var db = getDb();
    var main = buildTitleShopTeacherHtml(db);
    shell(renderTeacherChrome("칭호샵 관리", "titleshop", main));
    bindLogout();
    bindTitleShopTeacher();
  }

  function buildTitleShopStudentHtml(db, viewerStudentId, opts) {
    opts = opts || {};
    ensureTitleShop(db);
    var preview = opts.preview === true;
    var viewer = getStudent(db, viewerStudentId);
    
    var prevNote = preview ? '<p class="panel__text muted" style="color: var(--accent); font-weight: bold;">⚠️ 교사 미리보기 모드입니다. 구매 및 제안이 불가합니다.</p>' : "";
    
    // 칭호 제안 목록
    var mySubmissions = [];
    if (viewer) {
      mySubmissions = db.titleShop.pendingSubmissions.filter(function (s) {
        return s.creatorStudentId === viewer.id;
      });
    }
    
    var subListHtml = "";
    if (mySubmissions.length > 0) {
      subListHtml = mySubmissions.map(function (s) {
        return '<li style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem; background: rgba(255,255,255,0.03); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">' +
          '<span class="status-pill">' + escapeHtml(s.titleText) + '</span>' +
          '<div style="display: flex; align-items: center; gap: 0.5rem;">' +
            '<span class="badge" style="background: rgba(255, 193, 7, 0.2); color: #ffc107; border: 1px solid rgba(255,193,7,0.3); padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem;">승인 대기</span>' +
            '<span class="muted text-xs">' + fmtDateShort(s.createdAt) + '</span>' +
          '</div>' +
        '</li>';
      }).join("");
    } else {
      subListHtml = '<li class="muted" style="text-align: center; padding: 1rem;">신청한 칭호가 없습니다.</li>';
    }
    
    // 임원 승인 대기 목록 패널 추가 (본인 제안 제외)
    var officerPanelHtml = "";
    if (viewer && (viewer.classRole === "president" || viewer.classRole === "vice_president")) {
      var officerPending = db.titleShop.pendingSubmissions.filter(function (s) {
        return s.creatorStudentId !== viewer.id;
      });
      var officerPendingRows = "";
      if (officerPending.length > 0) {
        officerPendingRows = officerPending.map(function (s) {
          var st = getStudent(db, s.creatorStudentId);
          var name = st ? st.name : "알 수 없음";
          return (
            '<tr>' +
              '<td><strong>' + escapeHtml(name) + '</strong></td>' +
              '<td><span class="status-pill" style="font-size: 0.85rem;">' + escapeHtml(s.titleText) + '</span></td>' +
              '<td class="muted text-xs">' + fmtDateShort(s.createdAt) + '</td>' +
              '<td>' +
                '<div style="display: flex; gap: 0.4rem;">' +
                  '<button type="button" class="btn btn--primary btn--xs js-officer-approve" data-id="' + escapeHtml(s.id) + '">승인</button>' +
                  '<button type="button" class="btn btn--danger btn--xs js-officer-reject" data-id="' + escapeHtml(s.id) + '">반려</button>' +
                '</div>' +
              '</td>' +
            '</tr>'
          );
        }).join("");
      } else {
        officerPendingRows = '<tr><td colspan="4" class="muted text-center" style="padding: 1.5rem;">승인 대기 중인 다른 학생들의 제안이 없습니다.</td></tr>';
      }

      officerPanelHtml = (
        '<section class="panel" style="border: 1px solid rgba(46, 204, 113, 0.3); background: linear-gradient(165deg, rgba(39, 174, 96, 0.1) 0%, rgba(30, 40, 30, 0.4) 100%);">' +
          '<h2 class="panel__title" style="color: #2ecc71;">👑 학급 임원 전용 승인 대기 목록</h2>' +
          '<p class="panel__text muted">선생님을 대신해 친구들의 칭호 제안을 승인하거나 반려할 수 있습니다. (본인 제안 승인 불가)</p>' +
          '<div class="table-responsive" style="margin-top: 1rem; overflow-x: auto;">' +
            '<table class="table" style="width: 100%; border-collapse: collapse;">' +
              '<thead>' +
                '<tr>' +
                  '<th>신청 학생</th>' +
                  '<th>제안 칭호</th>' +
                  '<th>신청 일시</th>' +
                  '<th>작업</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                officerPendingRows +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</section>'
      );
    }
    
    // 상점 판매 목록
    var cardsHtml = "";
    if (db.titleShop.approvedTitles.length > 0) {
      cardsHtml = db.titleShop.approvedTitles.map(function (p) {
        var creatorName = "선생님";
        if (p.creatorStudentId) {
          var cr = getStudent(db, p.creatorStudentId);
          if (cr) creatorName = cr.name;
        }
        var dis = preview ? " disabled" : "";
        var owned = viewer ? db.titleGrants.some(function (tg) {
          return tg.studentId === viewer.id && tg.titleText === p.titleText;
        }) : false;
        
        var buyBtnHtml = "";
        if (owned) {
          buyBtnHtml = '<button type="button" class="btn btn--secondary btn--sm" disabled style="width: 100%;">이미 보유함</button>';
        } else {
          buyBtnHtml = '<button type="button" class="btn btn--primary btn--sm js-title-buy" ' + dis + ' data-title-id="' + escapeHtml(p.id) + '" style="width: 100%;">구매하기</button>';
        }
        
        return (
          '<article class="title-product-card" data-title-id="' + escapeHtml(p.id) + '" style="border: 1px solid rgba(232, 201, 107, 0.2); background: linear-gradient(165deg, rgba(30, 50, 80, 0.4) 0%, rgba(10, 15, 30, 0.8) 100%); border-radius: 8px; padding: 1.2rem; display: flex; flex-direction: column; gap: 0.8rem; box-shadow: var(--shadow);">' +
            '<div class="title-product-card__preview" style="display: flex; justify-content: center; align-items: center; padding: 1rem 0.5rem; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px dashed rgba(255,255,255,0.08);">' +
              '<span class="status-pill js-title-badge-preview" style="font-size: 0.95rem;">' + escapeHtml(p.titleText) + '</span>' +
            '</div>' +
            '<div class="title-product-card__info" style="margin-top: 0.2rem;">' +
              '<h4 class="title-product-card__name" style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--text);">' + escapeHtml(p.titleText) + '</h4>' +
              '<p class="title-product-card__meta text-xs muted" style="margin: 0.2rem 0 0 0; font-size: 0.78rem;">제안 학생: <strong style="color: var(--primary-light);">' + escapeHtml(creatorName) + '</strong></p>' +
            '</div>' +
            '<div class="title-product-card__options" style="display: flex; flex-direction: column; gap: 0.4rem; padding: 0.4rem 0; border-top: 1px solid rgba(255,255,255,0.06);">' +
              '<label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; cursor: pointer;"><input type="radio" name="option_' + escapeHtml(p.id) + '" value="base" checked' + dis + '> 기본형 (100 Cal)</label>' +
              '<label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; cursor: pointer;"><input type="radio" name="option_' + escapeHtml(p.id) + '" value="color"' + dis + '> 글자색 변경 (+50 Cal)</label>' +
              '<label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.82rem; cursor: pointer;"><input type="radio" name="option_' + escapeHtml(p.id) + '" value="full"' + dis + '> 글자&배경색 변경 (+100 Cal)</label>' +
            '</div>' +
            '<div class="title-product-card__pickers js-pickers-container" style="display: none; gap: 0.5rem; background: rgba(0,0,0,0.15); padding: 0.6rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">' +
              '<div class="picker-item js-text-picker-wrapper" style="display: none; flex: 1;">' +
                '<label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.25rem;">글자 색</label>' +
                '<input type="color" class="js-title-text-color" value="#ffffff" style="width: 100%; height: 32px; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 0; background: none; cursor: pointer;"' + dis + '>' +
              '</div>' +
              '<div class="picker-item js-bg-picker-wrapper" style="display: none; flex: 1;">' +
                '<label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.25rem;">배경 색</label>' +
                '<input type="color" class="js-title-bg-color" value="#3278c8" style="width: 100%; height: 32px; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 0; background: none; cursor: pointer;"' + dis + '>' +
              '</div>' +
            '</div>' +
            buyBtnHtml +
          '</article>'
        );
      }).join("");
    } else {
      cardsHtml = '<div class="grid-span-all" style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px;"><p class="muted">판매 중인 칭호가 없습니다. 학생들이 등록하거나 선생님이 추가하면 나타납니다.</p></div>';
    }
    
    var myCaloryStr = viewer ? formatNum(studentCaloryBalance(viewer)) : "0";
    
    // 교체 선택 드롭다운 생성 (5개 이상 등록한 경우)
    var myApprovedTitles = (viewer && db.titleShop.approvedTitles) ? db.titleShop.approvedTitles.filter(function (p) {
      return p.creatorStudentId === viewer.id;
    }) : [];
    
    var replaceSelectHtml = "";
    if (viewer && myApprovedTitles.length >= 5) {
      var optionsHtml = myApprovedTitles.map(function (p) {
        return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.titleText) + '</option>';
      }).join("");
      replaceSelectHtml = (
        '<div class="form-group" style="display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem;">' +
          '<label class="form-group__label" style="font-weight: 600; font-size: 0.88rem; color: #ffc107;">⚠️ 교체할 기존 칭호 선택 (필수)</label>' +
          '<p class="muted" style="font-size: 0.78rem; margin: 0;">현재 승인된 칭호가 5개입니다. 새로운 칭호가 승인되면 선택한 기존 칭호가 삭제되며 구매자들에게 Calory가 환불됩니다.</p>' +
          '<select id="replace-title-select" class="form-control" style="border-color: #ffc107;" required' + (preview ? " disabled" : "") + '>' +
            optionsHtml +
          '</select>' +
        '</div>'
      );
    }
    
    return (
      '<div class="title-shop-root" style="display: flex; flex-direction: column; gap: 1.5rem;">' +
        prevNote +
        officerPanelHtml +
        '<section class="panel">' +
          '<h2 class="panel__title">🏷️ 칭호 상점</h2>' +
          '<p class="panel__text muted">상점의 칭호를 구매하여 캐릭터 STATUS에 독특한 스타일 배지를 달아보세요!</p>' +
          '<div class="title-product-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.2rem; margin-top: 1.2rem;">' +
            cardsHtml +
          '</div>' +
        '</section>' +
        '<div class="row-layout" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: start;">' +
          '<section class="panel">' +
            '<h2 class="panel__title">💡 새로운 칭호 제안</h2>' +
            '<p class="panel__text muted">우리 반 친구들과 공유하고 싶은 학교 생활 관련 칭호를 등록해 보세요. 선생님 승인 후 판매가 시작되며, 판매 시마다 <strong>10 Calory</strong>의 정산 수익을 얻습니다!</p>' +
            '<form id="form-title-register" class="form" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 0.8rem;">' +
              '<div class="form-group" style="display: flex; flex-direction: column; gap: 0.35rem;">' +
                '<label class="form-group__label" style="font-weight: 600; font-size: 0.88rem;">제안할 칭호 (12글자 이하)</label>' +
                '<input type="text" id="title-text-input" class="form-control" placeholder="예: 친절한 동반자, 환경 수호신" maxlength="12" required' + (preview ? " disabled" : "") + '>' +
              '</div>' +
              replaceSelectHtml +
              '<button type="submit" class="btn btn--accent" style="align-self: flex-start; padding: 0.5rem 1.2rem;"' + (preview ? " disabled" : "") + '>신청하기</button>' +
            '</form>' +
          '</section>' +
          '<section class="panel">' +
            '<h2 class="panel__title">📋 나의 제안 현황</h2>' +
            '<ul class="title-submission-list" style="list-style: none; padding: 0; margin: 1rem 0 0 0; display: flex; flex-direction: column; gap: 0.6rem;">' +
              subListHtml +
            '</ul>' +
          '</section>' +
        '</div>' +
        (viewer ? '<p class="muted title-shop-foot" style="margin-top: 0.5rem; text-align: center; font-size: 0.85rem;">내 Calory: <strong style="color: var(--accent); font-size: 1rem;">' + myCaloryStr + ' Cal</strong> · 칭호 제안자 수익(10 Cal)을 제외한 나머지 차액 Calory는 국고(세금) 총액에 더해집니다.</p>' : "") +
      '</div>'
    );
  }

  function buildTeacherTitleRevenueJournalHtml(db) {
    ensureTitleShop(db);
    var logs = db.titleShop.purchaseLog || [];

    // 1. Group logs by date for Daily Summary
    var dailyTotals = {};
    var i;
    for (i = 0; i < logs.length; i++) {
      var e = logs[i];
      var ymd = e.dateYmd || todayYmdLocal();
      if (!dailyTotals[ymd]) {
        dailyTotals[ymd] = 0;
      }
      dailyTotals[ymd] += typeof e.priceCal === "number" ? e.priceCal : 0;
    }

    var sortedDates = Object.keys(dailyTotals).sort(function (a, b) {
      return b.localeCompare(a);
    });

    var dailyRows = sortedDates.length
      ? sortedDates.map(function (date) {
          var formattedDate = date;
          try {
            var parts = date.split("-");
            if (parts.length === 3) {
              formattedDate = parseInt(parts[0], 10) + "년 " + parseInt(parts[1], 10) + "월 " + parseInt(parts[2], 10) + "일";
            }
          } catch (err) {}
          return (
            '<tr>' +
              '<td>' + escapeHtml(formattedDate) + '</td>' +
              '<td class="td-num" style="font-weight: bold; color: var(--primary);">' + formatNum(dailyTotals[date]) + ' Cal</td>' +
            '</tr>'
          );
        }).join("")
      : '<tr><td colspan="2" class="empty-state" style="text-align: center;">매출 기록이 없습니다.</td></tr>';

    // 2. Detailed Transaction Logs
    var sortedLogs = logs.slice().sort(function (a, b) {
      return (b.occurredAt || 0) - (a.occurredAt || 0);
    });

    var detailedRows = sortedLogs.length
      ? sortedLogs.map(function (e) {
          var buyer = getStudent(db, e.buyerStudentId);
          var buyerName = buyer ? escapeHtml(buyer.name) + " (" + escapeHtml(String(buyer.number != null ? buyer.number : "?")) + ")" : "(알 수 없음)";
          var dateStr = fmtTime(e.occurredAt);
          
          var optLabel = "기본";
          if (e.optionType === "color") optLabel = "글자 색상";
          else if (e.optionType === "full") optLabel = "배경 색상";
          
          return (
            '<tr>' +
              '<td>' + escapeHtml(dateStr) + '</td>' +
              '<td><span class="status-pill">' + escapeHtml(e.titleText) + '</span></td>' +
              '<td>' + buyerName + '</td>' +
              '<td>' + escapeHtml(optLabel) + '</td>' +
              '<td class="td-num">' + formatNum(e.priceCal) + ' Cal</td>' +
            '</tr>'
          );
        }).join("")
      : '<tr><td colspan="5" class="empty-state" style="text-align: center;">상세 판매 기록이 없습니다.</td></tr>';

    var totalRevenue = db.titleShop.treasuryTotal || 0;

    return (
      '<div class="title-journal-section stack" style="margin-top: 1.5rem;">' +
        '<div class="journal-summary-cards" style="display: grid; grid-template-columns: 1fr; gap: 1rem; margin-bottom: 1rem;">' +
          '<div class="panel" style="background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%); color: #fff;">' +
            '<h3 style="margin: 0; opacity: 0.9; font-size: 0.9rem;">🪙 칭호 누적 총 수입</h3>' +
            '<div style="font-size: 2rem; font-weight: bold; margin-top: 0.5rem;">' + formatNum(totalRevenue) + ' Cal</div>' +
            '<p style="margin: 0.5rem 0 0 0; font-size: 0.8rem; opacity: 0.85;">칭호 판매로 발생한 누적 수입 금액입니다. (국고 적립)</p>' +
          '</div>' +
        '</div>' +
        '<div style="display: grid; grid-template-columns: 1fr 2fr; gap: 1.5rem; align-items: start;">' +
          '<section class="panel">' +
            '<h2 class="panel__title">📅 일자별 매출 합계</h2>' +
            '<div class="table-wrap"><table class="data"><thead><tr><th>일자</th><th>수입 합계</th></tr></thead><tbody>' +
              dailyRows +
            '</tbody></table></div>' +
          '</section>' +
          '<section class="panel">' +
            '<h2 class="panel__title">📋 상세 판매 누가기록</h2>' +
            '<div class="table-wrap"><table class="data" style="font-size: 0.85rem;"><thead><tr><th>일시</th><th>칭호명</th><th>구매자</th><th>옵션</th><th>판매가</th></tr></thead><tbody>' +
              detailedRows +
            '</tbody></table></div>' +
          '</section>' +
        '</div>' +
      '</div>'
    );
  }

  function buildTitleShopTeacherHtml(db, opts) {
    ensureTitleShop(db);
    
    // 대기 중인 칭호 제안 목록
    var pendingHtml = "";
    if (db.titleShop.pendingSubmissions.length > 0) {
      pendingHtml = db.titleShop.pendingSubmissions.map(function (s) {
        var st = getStudent(db, s.creatorStudentId);
        var name = st ? st.name : "알 수 없음";
        return (
          '<tr>' +
            '<td><strong>' + escapeHtml(name) + '</strong></td>' +
            '<td><span class="status-pill" style="font-size: 0.85rem;">' + escapeHtml(s.titleText) + '</span></td>' +
            '<td class="muted text-xs">' + fmtDateShort(s.createdAt) + '</td>' +
            '<td>' +
              '<div style="display: flex; gap: 0.4rem;">' +
                '<button type="button" class="btn btn--primary btn--xs js-title-approve" data-id="' + escapeHtml(s.id) + '">승인</button>' +
                '<button type="button" class="btn btn--danger btn--xs js-title-reject" data-id="' + escapeHtml(s.id) + '">반려</button>' +
              '</div>' +
            '</td>' +
          '</tr>'
        );
      }).join("");
    } else {
      pendingHtml = '<tr><td colspan="4" class="muted text-center" style="padding: 2rem;">승인 대기 중인 칭호 제안이 없습니다.</td></tr>';
    }

    // 승인 완료/판매 중인 칭호 목록
    var approvedHtml = "";
    if (db.titleShop.approvedTitles.length > 0) {
      approvedHtml = db.titleShop.approvedTitles.map(function (p) {
        var name = "선생님";
        if (p.creatorStudentId) {
          var st = getStudent(db, p.creatorStudentId);
          if (st) name = st.name;
        }
        return (
          '<tr>' +
            '<td><span class="status-pill" style="font-size: 0.85rem;">' + escapeHtml(p.titleText) + '</span></td>' +
            '<td>' + escapeHtml(name) + '</td>' +
            '<td class="muted text-xs">' + fmtDateShort(p.createdAt) + '</td>' +
            '<td>' +
              '<button type="button" class="btn btn--danger btn--xs js-title-delete" data-id="' + escapeHtml(p.id) + '">삭제</button>' +
            '</td>' +
          '</tr>'
        );
      }).join("");
    } else {
      approvedHtml = '<tr><td colspan="4" class="muted text-center" style="padding: 2rem;">등록된 칭호가 없습니다.</td></tr>';
    }

    return (
      '<div class="title-shop-teacher-root" style="display: flex; flex-direction: column; gap: 1.5rem;">' +
        '<div class="row-layout" style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; align-items: start;">' +
          // 왼쪽: 승인 대기 목록
          '<section class="panel">' +
            '<h2 class="panel__title">📥 학생 제안 승인 대기 목록</h2>' +
            '<div class="table-responsive" style="margin-top: 1rem; overflow-x: auto;">' +
              '<table class="table" style="width: 100%; border-collapse: collapse;">' +
                '<thead>' +
                  '<tr>' +
                    '<th>신청 학생</th>' +
                    '<th>제안 칭호</th>' +
                    '<th>신청 일시</th>' +
                    '<th>작업</th>' +
                  '</tr>' +
                '</thead>' +
                '<tbody>' +
                  pendingHtml +
                '</tbody>' +
              '</table>' +
            '</div>' +
          '</section>' +
          // 오른쪽: 직접 등록 폼
          '<section class="panel">' +
            '<h2 class="panel__title">➕ 교사 직접 칭호 등록</h2>' +
            '<p class="panel__text muted">상점에 즉시 판매될 칭호를 직접 등록합니다. (판매 가격 100 Calory 고정)</p>' +
            '<form id="form-teacher-title-add" class="form" style="margin-top: 1rem; display: flex; flex-direction: column; gap: 0.8rem;">' +
              '<div class="form-group" style="display: flex; flex-direction: column; gap: 0.35rem;">' +
                '<label class="form-group__label" style="font-weight: 600; font-size: 0.88rem;">칭호명 (12글자 이하)</label>' +
                '<input type="text" id="teacher-title-input" class="form-control" placeholder="예: 성실한 도우미" maxlength="12" required>' +
              '</div>' +
              '<button type="submit" class="btn btn--accent" style="width: 100%; padding: 0.5rem 0;">등록하기</button>' +
            '</form>' +
          '</section>' +
        '</div>' +
        // 아래쪽: 판매 중인 칭호 관리
        '<section class="panel">' +
          '<h2 class="panel__title">📋 등록된 칭호 목록 (판매 중)</h2>' +
          '<div class="table-responsive" style="margin-top: 1rem; overflow-x: auto;">' +
            '<table class="table" style="width: 100%; border-collapse: collapse;">' +
              '<thead>' +
                '<tr>' +
                  '<th>칭호 배지</th>' +
                  '<th>제안자</th>' +
                  '<th>등록 일시</th>' +
                  '<th>관리</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' +
                approvedHtml +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</section>' +
        buildTeacherTitleRevenueJournalHtml(db) +
      '</div>'
    );
  }

  function bindTitleShopStudent(studentId, isPreview) {
    var root = document.getElementById("app");
    if (!root) return;

    // 1. 제안 폼 등록 리스너
    var form = document.getElementById("form-title-register");
    if (form && !isPreview) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var txtInput = document.getElementById("title-text-input");
        if (!txtInput) return;
        var txt = txtInput.value.trim();
        if (!txt) {
          alert("칭호명을 입력해 주세요.");
          return;
        }
        if (txt.length > 12) {
          alert("칭호명은 12글자 이하이어야 합니다.");
          return;
        }
        var db = getDb();
        
        var replaceSelect = document.getElementById("replace-title-select");
        var replaceTitleId = replaceSelect ? replaceSelect.value : null;

        var r = submitTitleOffer(db, studentId, txt, replaceTitleId);
        if (!r.ok) {
          alert(r.msg || "신청에 실패했습니다.");
          return;
        }
        alert("칭호가 신청되었습니다. 임원이나 선생님이 승인한 후 판매가 시작됩니다.");
        route();
      });
    }

    // 2. 각 카드 내 옵션 선택 및 리얼타임 프리뷰 바인딩
    var cards = root.querySelectorAll(".title-product-card");
    var ci;
    for (ci = 0; ci < cards.length; ci++) {
      (function (card) {
        var titleId = card.getAttribute("data-title-id");
        var previewBadge = card.querySelector(".js-title-badge-preview");
        var pickersContainer = card.querySelector(".js-pickers-container");
        var textPickerWrapper = card.querySelector(".js-text-picker-wrapper");
        var bgPickerWrapper = card.querySelector(".js-bg-picker-wrapper");
        var textInput = card.querySelector(".js-title-text-color");
        var bgInput = card.querySelector(".js-title-bg-color");

        // 기본 스타일 저장 (초기화용)
        var defaultStyle = {
          color: previewBadge.style.color || "",
          background: previewBadge.style.background || "",
          borderColor: previewBadge.style.borderColor || ""
        };

        function updatePreview() {
          var optVal = card.querySelector('input[name="option_' + titleId + '"]:checked').value;
          if (optVal === "base") {
            pickersContainer.style.display = "none";
            textPickerWrapper.style.display = "none";
            bgPickerWrapper.style.display = "none";
            previewBadge.style.color = defaultStyle.color;
            previewBadge.style.background = defaultStyle.background;
            previewBadge.style.borderColor = defaultStyle.borderColor;
          } else if (optVal === "color") {
            pickersContainer.style.display = "flex";
            textPickerWrapper.style.display = "block";
            bgPickerWrapper.style.display = "none";
            previewBadge.style.color = textInput.value;
            previewBadge.style.borderColor = textInput.value;
            previewBadge.style.background = defaultStyle.background;
          } else if (optVal === "full") {
            pickersContainer.style.display = "flex";
            textPickerWrapper.style.display = "block";
            bgPickerWrapper.style.display = "block";
            previewBadge.style.color = textInput.value;
            previewBadge.style.background = bgInput.value;
            previewBadge.style.borderColor = bgInput.value;
          }
        }

        // 라디오 버튼 선택 이벤트
        var radios = card.querySelectorAll('input[name="option_' + titleId + '"]');
        var ri;
        for (ri = 0; ri < radios.length; ri++) {
          radios[ri].addEventListener("change", updatePreview);
        }

        // 컬러 피커 변경 이벤트
        if (textInput) textInput.addEventListener("input", updatePreview);
        if (bgInput) bgInput.addEventListener("input", updatePreview);

        // 구매 버튼 바인딩
        var buyBtn = card.querySelector(".js-title-buy");
        if (buyBtn && !isPreview) {
          buyBtn.addEventListener("click", function () {
            var optVal = card.querySelector('input[name="option_' + titleId + '"]:checked').value;
            var totalPrice = 100;
            if (optVal === "color") totalPrice = 150;
            if (optVal === "full") totalPrice = 200;

            if (!confirm("이 칭호를 " + totalPrice + " Calory에 구매하시겠습니까?")) return;

            var db = getDb();
            var r = purchaseTitleProduct(db, studentId, titleId, {
              optionType: optVal,
              textColor: textInput ? textInput.value : null,
              bgColor: bgInput ? bgInput.value : null
            });

            if (!r.ok) {
              alert(r.msg || "구매에 실패했습니다.");
              return;
            }
            alert("칭호를 성공적으로 구매했습니다!");
            route();
          });
        }
      })(cards[ci]);
    }

    // 3. 임원용 승인/반려 버튼 리스너 바인딩
    if (!isPreview) {
      var officerApproveBtns = root.querySelectorAll(".js-officer-approve");
      var oai;
      for (oai = 0; oai < officerApproveBtns.length; oai++) {
        officerApproveBtns[oai].addEventListener("click", function () {
          var id = this.getAttribute("data-id");
          if (!id) return;
          if (!confirm("이 제안을 승인하여 상점에 등록하시겠습니까?")) return;
          var db = getDb();
          var r = approveTitleOffer(db, id);
          if (!r.ok) {
            alert(r.msg || "처리에 실패했습니다.");
            return;
          }
          alert("제안을 승인했습니다!");
          route();
        });
      }

      var officerRejectBtns = root.querySelectorAll(".js-officer-reject");
      var ori;
      for (ori = 0; ori < officerRejectBtns.length; ori++) {
        officerRejectBtns[ori].addEventListener("click", function () {
          var id = this.getAttribute("data-id");
          if (!id) return;
          if (!confirm("이 제안을 반려하시겠습니까?")) return;
          var db = getDb();
          var r = rejectTitleOffer(db, id);
          if (!r.ok) {
            alert(r.msg || "처리에 실패했습니다.");
            return;
          }
          alert("제안을 반려했습니다.");
          route();
        });
      }
    }
  }

  function bindTitleShopTeacher() {
    var root = document.getElementById("app");
    if (!root) return;

    // 1. 교사 직접 등록 폼
    var form = document.getElementById("form-teacher-title-add");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var txtInput = document.getElementById("teacher-title-input");
        if (!txtInput) return;
        var txt = txtInput.value.trim();
        if (!txt) {
          alert("칭호명을 입력해 주세요.");
          return;
        }
        if (txt.length > 12) {
          alert("칭호는 12글자 이하이어야 합니다.");
          return;
        }
        var db = getDb();
        var r = addTeacherTitle(db, txt);
        if (!r.ok) {
          alert(r.msg || "등록에 실패했습니다.");
          return;
        }
        alert("칭호가 상점에 등록되었습니다.");
        route();
      });
    }

    // 2. 승인 버튼 리스너
    var approveBtns = root.querySelectorAll(".js-title-approve");
    var ai;
    for (ai = 0; ai < approveBtns.length; ai++) {
      approveBtns[ai].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        if (!id) return;
        if (!confirm("이 제안을 승인하여 상점에 등록하시겠습니까?")) return;
        var db = getDb();
        var r = approveTitleOffer(db, id);
        if (!r.ok) {
          alert(r.msg || "처리에 실패했습니다.");
          return;
        }
        route();
      });
    }

    // 3. 반려 버튼 리스너
    var rejectBtns = root.querySelectorAll(".js-title-reject");
    var ri;
    for (ri = 0; ri < rejectBtns.length; ri++) {
      rejectBtns[ri].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        if (!id) return;
        if (!confirm("이 제안을 반려하시겠습니까?")) return;
        var db = getDb();
        var r = rejectTitleOffer(db, id);
        if (!r.ok) {
          alert(r.msg || "처리에 실패했습니다.");
          return;
        }
        route();
      });
    }

    // 4. 삭제 버튼 리스너
    var deleteBtns = root.querySelectorAll(".js-title-delete");
    var di;
    for (di = 0; di < deleteBtns.length; di++) {
      deleteBtns[di].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        if (!id) return;
        if (!confirm("이 칭호를 삭제하여 판매를 중단하시겠습니까?")) return;
        var db = getDb();
        var r = deleteApprovedTitle(db, id);
        if (!r.ok) {
          alert(r.msg || "처리에 실패했습니다.");
          return;
        }
        route();
      });
    }
  }

  function viewStudent(session) {
    var db = getDb();
    if (!session.studentId) {
      shell(renderStudentChrome("오류", '<p class="panel__text">학생 정보가 없습니다.</p>'));
      bindLogout();
      return;
    }
    var st = getStudent(db, session.studentId);
    if (!st) {
      shell(renderStudentChrome("오류", '<p class="panel__text">학생을 찾을 수 없습니다.</p>'));
      bindLogout();
      return;
    }

    var main = buildStatusBoardHtml(db, st, { mode: "student", avatarUpload: true });

    shell(
      renderStudentChrome("나의 STATUS", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "status"),
      })
    );
    bindLogout();
    bindStudentAvatarUpload(session.studentId);
    bindStatusBoardShopShortcuts();
    renderStudentAssetChart(db, session.studentId);
  }

  // ==========================================
  // DJ 기능 (노래 신청 / 확인)
  // ==========================================
  function submitDjRequest(db, session, title) {
    if (!title || !title.trim()) return { ok: false, msg: "노래 제목을 입력해주세요." };
    if (!db.djRequests) db.djRequests = [];
    var st = getStudent(db, session.studentId);
    if (!st) return { ok: false, msg: "학생 정보가 없습니다." };

    var todayKey = boardDateKey();
    var todayCount = 0;
    for (var i = 0; i < db.djRequests.length; i++) {
      var req = db.djRequests[i];
      var reqD = new Date(req.createdAt);
      if (reqD.getHours() < 7) {
        reqD.setDate(reqD.getDate() - 1);
      }
      if (ymdFromDate(reqD) === todayKey) {
        todayCount++;
      }
    }
    if (todayCount >= 8) {
      return { ok: false, msg: "오늘의 신청곡은 마감되었습니다." };
    }

    db.djRequests.push({
      id: C.uid(),
      studentId: st.id,
      studentName: st.name,
      title: title.trim(),
      createdAt: Date.now(),
      confirmed: false
    });
    saveDb(db);
    return { ok: true };
  }

  function confirmDjRequest(db, requestId) {
    if (!db.djRequests) return;
    for (var i = 0; i < db.djRequests.length; i++) {
      if (db.djRequests[i].id === requestId) {
        db.djRequests[i].confirmed = true;
        saveDb(db);
        break;
      }
    }
  }

  function editDjRequest(db, requestId, newTitle) {
    if (!newTitle || !newTitle.trim()) return { ok: false, msg: "노래 제목을 입력해주세요." };
    if (!db.djRequests) return { ok: false, msg: "신청곡 내역이 없습니다." };
    var req = null;
    for (var i = 0; i < db.djRequests.length; i++) {
      if (db.djRequests[i].id === requestId) {
        req = db.djRequests[i];
        break;
      }
    }
    if (!req) return { ok: false, msg: "신청곡을 찾을 수 없습니다." };
    if (req.confirmed) return { ok: false, msg: "이미 확인 완료된 신청곡은 수정할 수 없습니다." };
    req.title = newTitle.trim();
    req.createdAt = Date.now(); // 순서 맨 뒤로 밀기
    saveDb(db);
    return { ok: true };
  }

  function viewStudentDjRequest(session) {
    var db = getDb();
    if (!db) return;
    var st = getStudent(db, session.studentId);
    if (!st) return;

    var html = '<section class="panel"><h2 class="panel__title">🎵 노래 신청하기</h2>' +
               '<form id="form-dj-request" class="stack">' +
               '<label class="field">신청할 노래 제목 및 가수<input type="text" name="title" placeholder="예) 아이브 - I AM" required /></label>' +
               '<button type="submit" class="btn btn--primary">신청하기</button>' +
               '</form></section>';

    var reqs = (db.djRequests || []).filter(function(r) { return r.studentId === st.id; }).sort(function(a,b){ return b.createdAt - a.createdAt; });
    
    html += '<section class="panel"><h2 class="panel__title">나의 신청 내역</h2><ul class="status-log">';
    if (reqs.length === 0) {
      html += '<li class="status-log__item muted">신청한 노래가 없습니다.</li>';
    } else {
      for (var i = 0; i < reqs.length; i++) {
        var r = reqs[i];
        html += '<li class="status-log__item">' + escapeHtml(r.title) + ' <span class="muted">(' + fmtDateShort(r.createdAt) + ')</span>' +
                (r.confirmed 
                  ? ' <span class="status-log__tag status-log__tag--cal">확인완료</span>' 
                  : ' <span class="status-log__tag">대기중</span> <button class="btn btn--sm js-dj-edit" data-id="' + r.id + '" data-title="' + escapeHtml(r.title) + '" style="margin-left: 8px; padding: 2px 6px; font-size: 0.75rem; vertical-align: middle;">수정</button>') +
                '</li>';
      }
    }
    html += '</ul></section>';

    shell(renderStudentChrome("🎵 노래 신청", html, {
      subNavLinks: getStudentSubNavLinks(db, session, "dj-request")
    }));
    bindLogout();

    var form = document.getElementById("form-dj-request");
    if (form) {
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        var ndb = getDb();
        var res = submitDjRequest(ndb, session, form.title.value);
        if (res.ok) {
          saveDb(ndb);
          alert("노래가 신청되었습니다!");
          route();
        } else {
          alert(res.msg);
        }
      });
    }

    var editBtns = document.querySelectorAll(".js-dj-edit");
    for (var j = 0; j < editBtns.length; j++) {
      editBtns[j].addEventListener("click", function(e) {
        var id = this.getAttribute("data-id");
        var oldTitle = this.getAttribute("data-title");
        var newTitle = prompt("신청곡 수정 (수정 시 순서가 대기열 맨 뒤로 밀립니다):", oldTitle);
        if (newTitle === null) return;
        newTitle = newTitle.trim();
        if (!newTitle) {
          alert("노래 제목을 입력해주세요.");
          return;
        }
        var ndb = getDb();
        var res = editDjRequest(ndb, id, newTitle);
        if (res.ok) {
          alert("신청곡이 수정되었습니다!");
          route();
        } else {
          alert(res.msg);
        }
      });
    }
  }

  function viewStudentDj(session) {
    var db = getDb();
    if (!db) return;
    var st = getStudent(db, session.studentId);
    if (!st || (st.jobId !== "dj" && !session.isOverride && !session.preview)) {
      window.location.hash = "#/student"; route(); return;
    }

    var pending = (db.djRequests || []).filter(function(r) { return !r.confirmed; }).sort(function(a,b){ return a.createdAt - b.createdAt; });
    var confirmed = (db.djRequests || []).filter(function(r) { return r.confirmed; }).sort(function(a,b){ return b.createdAt - a.createdAt; }).slice(0, 20);

    var html = '<section class="panel"><h2 class="panel__title">🎵 DJ 뮤직 리스트 (신청곡 목록)</h2>' +
               '<p class="muted">친구들이 신청한 노래를 확인하고, 음악을 틀어준 뒤 [확인 완료]를 눌러주세요.</p>';
               
    if (pending.length === 0) {
      html += '<p class="panel__text">새로 들어온 신청곡이 없습니다.</p>';
    } else {
      html += '<table class="data"><thead><tr><th>신청일</th><th>신청자</th><th>신청곡</th><th>작업</th></tr></thead><tbody>';
      for (var i = 0; i < pending.length; i++) {
        var p = pending[i];
        html += '<tr><td>' + fmtDateShort(p.createdAt) + '</td><td>' + escapeHtml(p.studentName) + '</td><td>' + escapeHtml(p.title) + '</td>' +
                '<td><button class="btn btn--sm btn--primary js-dj-confirm" data-id="' + p.id + '">확인 완료</button></td></tr>';
      }
      html += '</tbody></table>';
    }
    html += '</section>';

    html += '<section class="panel"><h2 class="panel__title">최근 확인된 신청곡</h2><ul class="status-log">';
    if (confirmed.length === 0) {
      html += '<li class="status-log__item muted">확인된 곡이 없습니다.</li>';
    } else {
      for (var j = 0; j < confirmed.length; j++) {
        var c = confirmed[j];
        html += '<li class="status-log__item">' + escapeHtml(c.title) + ' <span class="muted">- ' + escapeHtml(c.studentName) + ' (' + fmtDateShort(c.createdAt) + ')</span></li>';
      }
    }
    html += '</ul></section>';

    shell(renderStudentChrome("DJ · 뮤직 리스트", html, {
      subNavLinks: getStudentSubNavLinks(db, session, "dj")
    }));
    bindLogout();

    var btns = document.querySelectorAll(".js-dj-confirm");
    for (var k = 0; k < btns.length; k++) {
      btns[k].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        confirmDjRequest(getDb(), id);
        route();
      });
    }
  }

  // ==========================================
  // 분리수거부 기능
  // ==========================================
  function viewStudentRecycler(session) {
    var db = getDb();
    if (!db) return;
    var st = getStudent(db, session.studentId);
    if (!st || (st.jobId !== "recycler" && !session.isOverride && !session.preview)) {
      window.location.hash = "#/student"; route(); return;
    }

    var html = '<section class="panel"><h2 class="panel__title">♻️ 슬기로운 분리수거 (승인 요청)</h2>' +
               '<form id="form-recycler" class="stack">' +
               '<label class="field">활동 종류<select name="type"><option value="정기 분리수거">정기 분리수거</option><option value="비정기 분리수거">비정기 분리수거</option></select></label>' +
               '<label class="field">분리수거 물품 종류 / 특이사항<input type="text" name="items" placeholder="예) 종이, 플라스틱 처리 완료" required /></label>' +
               '<button type="submit" class="btn btn--primary">선생님께 승인 요청</button>' +
               '</form></section>';

    var logs = (db.recyclerLogs || []).filter(function(l) { return l.studentId === st.id; }).sort(function(a,b){ return b.createdAt - a.createdAt; }).slice(0, 10);
    html += '<section class="panel"><h2 class="panel__title">최근 요청 내역</h2><ul class="status-log">';
    if (logs.length === 0) {
      html += '<li class="status-log__item muted">기록이 없습니다.</li>';
    } else {
      for (var i = 0; i < logs.length; i++) {
        var l = logs[i];
        var stat = l.status === "pending" ? "대기중" : (l.status === "approved" ? "승인됨" : "반려됨");
        html += '<li class="status-log__item">' + escapeHtml(l.type + " - " + l.items) + ' <span class="muted">(' + fmtDateShort(l.createdAt) + ')</span> <span class="status-log__tag">' + stat + '</span></li>';
      }
    }
    html += '</ul></section>';

    shell(renderStudentChrome("분리수거부", html, { subNavLinks: getStudentSubNavLinks(db, session, "recycler") }));
    bindLogout();

    var form = document.getElementById("form-recycler");
    if (form) {
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        var ndb = getDb();
        if (!ndb.recyclerLogs) ndb.recyclerLogs = [];
        ndb.recyclerLogs.push({
          id: C.uid(),
          studentId: st.id,
          studentName: st.name,
          type: form.type.value,
          items: form.items.value,
          status: "pending",
          createdAt: Date.now()
        });
        saveDb(ndb);
        alert("승인 요청이 전송되었습니다.");
        route();
      });
    }
  }

  function deleteRecyclerLog(db, logId) {
    if (!db.recyclerLogs) return { ok: false };
    var idx = db.recyclerLogs.findIndex(function(l) { return l.id === logId; });
    if (idx === -1) return { ok: false };
    var log = db.recyclerLogs[idx];
    if (log.status === "approved" && log.incentive) {
      var expD = 0; var calD = 0;
      var parts = log.incentive.split("/");
      if (parts[0]) expD = parseInt(parts[0].replace(/[^0-9-]/g, "")) || 0;
      if (parts[1]) calD = parseInt(parts[1].replace(/[^0-9-]/g, "")) || 0;
      var st = getStudent(db, log.studentId);
      if (st) {
        st.exp = clampExp((st.exp || 0) - expD);
        st.calory = Math.max(0, (st.calory || 0) - calD);
        if (db.activityLogs && db.activityLogs[st.id]) {
          var aLogs = db.activityLogs[st.id];
          var aIdx = aLogs.findIndex(function(al) {
            return al.summary === "분리수거부 인센티브" && al.expDelta === expD && al.caloryDelta === calD;
          });
          if (aIdx !== -1) aLogs.splice(aIdx, 1);
        }
      }
    }
    db.recyclerLogs.splice(idx, 1);
    saveDb(db);
    return { ok: true };
  }

  function deleteEnvLog(db, logId) {
    if (!db.envLogs) return { ok: false };
    var idx = db.envLogs.findIndex(function(l) { return l.id === logId; });
    if (idx === -1) return { ok: false };
    var log = db.envLogs[idx];
    if (log.status === "approved" && log.incentive) {
      var expD = 0; var calD = 0;
      var parts = log.incentive.split("/");
      if (parts[0]) expD = parseInt(parts[0].replace(/[^0-9-]/g, "")) || 0;
      if (parts[1]) calD = parseInt(parts[1].replace(/[^0-9-]/g, "")) || 0;
      var st = getStudent(db, log.studentId);
      if (st) {
        st.exp = clampExp((st.exp || 0) - expD);
        st.calory = Math.max(0, (st.calory || 0) - calD);
        if (db.activityLogs && db.activityLogs[st.id]) {
          var aLogs = db.activityLogs[st.id];
          var aIdx = aLogs.findIndex(function(al) {
            return al.summary === "환경부 인센티브" && al.expDelta === expD && al.caloryDelta === calD;
          });
          if (aIdx !== -1) aLogs.splice(aIdx, 1);
        }
      }
    }
    db.envLogs.splice(idx, 1);
    saveDb(db);
    return { ok: true };
  }

  function deleteDjRequest(db, requestId) {
    if (!db.djRequests) return { ok: false };
    var idx = db.djRequests.findIndex(function(r) { return r.id === requestId; });
    if (idx === -1) return { ok: false };
    db.djRequests.splice(idx, 1);
    saveDb(db);
    return { ok: true };
  }

  function deleteBankPayrollRequest(db, reqId) {
    ensureBankPayrollRequests(db);
    var idx = db.bankPayrollRequests.findIndex(function (r) { return r.id === reqId; });
    if (idx === -1) return { ok: false };
    var req = db.bankPayrollRequests[idx];
    if (req.status === "approved") {
      var r = revokeApprovedBankPayrollRequest(db, reqId);
      if (!r.ok) return r;
    }
    db.bankPayrollRequests.splice(idx, 1);
    saveDb(db);
    return { ok: true };
  }

  function deleteTaxCollectionRequest(db, reqId) {
    ensureTaxCollectionRequests(db);
    var idx = db.taxCollectionRequests.findIndex(function (r) { return r.id === reqId; });
    if (idx === -1) return { ok: false };
    var req = db.taxCollectionRequests[idx];
    if (req.status === "approved") {
      var r = revokeApprovedTaxCollectionRequest(db, reqId);
      if (!r.ok) return r;
    }
    db.taxCollectionRequests.splice(idx, 1);
    saveDb(db);
    return { ok: true };
  }

  function resetTreasuryAndTaxHistory(db) {
    if (!db) return { ok: false };
    db.taxCollectionRequests = [];
    
    if (!db.couponShop) db.couponShop = {};
    db.couponShop.treasuryTotal = 0;
    db.couponShop.merchantLog = [];
    
    if (!db.canteenShop) db.canteenShop = {};
    db.canteenShop.treasuryTotal = 0;
    db.canteenShop.merchantLog = [];
    
    if (!db.titleShop) db.titleShop = {};
    db.titleShop.treasuryTotal = 0;
    db.titleShop.purchaseLog = [];
    
    delete db.classTaxTotalManual;
    delete db.classTaxTotalManualConfirmed;
    
    saveDb(db);
    return { ok: true };
  }

  function adjustCorrespondingTaxForStudent(db, studentId, bankPayrollCreatedAt, oldAmount, newAmount) {
    var oldTax = taxFromPayrollBase(oldAmount);
    var newTax = taxFromPayrollBase(newAmount);
    var taxDiff = newTax - oldTax;
    if (taxDiff === 0) return;

    var targetReq = null;
    var targetLine = null;
    var minDiff = Infinity;

    var requests = db.taxCollectionRequests || [];
    var i;
    for (i = 0; i < requests.length; i++) {
      var req = requests[i];
      var lines = req.lines || [];
      var j;
      var line = null;
      for (j = 0; j < lines.length; j++) {
        if (lines[j].studentId === studentId) {
          line = lines[j];
          break;
        }
      }
      if (line) {
        var diff = Math.abs(req.createdAt - bankPayrollCreatedAt);
        if (diff < 7 * 24 * 60 * 60 * 1000 && diff < minDiff) {
          minDiff = diff;
          targetReq = req;
          targetLine = line;
        }
      }
    }

    if (targetReq && targetLine) {
      if (targetReq.status === "approved") {
        var student = getStudent(db, studentId);
        if (student) {
          student.calory = Math.max(0, (student.calory || 0) - taxDiff);
          addActivityLog(db, {
            studentId: studentId,
            summary: "주급 변동에 따른 세금 자동 조정: " + (taxDiff > 0 ? "-" : "+") + Math.abs(taxDiff) + " Cal",
            expDelta: 0,
            caloryDelta: -taxDiff
          });
        }
      }
      targetLine.baseAmount = newAmount;
      targetLine.taxAmount = newTax;
    }
  }

  function viewTeacherRecycler(session) {
    var db = getDb();
    if (!db) return;
    
    var pending = (db.recyclerLogs || []).filter(function(l) { return l.status === "pending"; }).sort(function(a,b){ return a.createdAt - b.createdAt; });
    var allLogs = (db.recyclerLogs || []).sort(function(a,b){ return b.createdAt - a.createdAt; });

    var html = '<section class="panel"><h2 class="panel__title">♻️ 분리수거부 승인 대기</h2>';
    if (pending.length === 0) {
      html += '<p class="panel__text">대기 중인 요청이 없습니다.</p>';
    } else {
      html += '<table class="data"><thead><tr><th>학생</th><th>활동 종류</th><th>내용</th><th>인센티브(EXP/Cal)</th><th>작업</th></tr></thead><tbody>';
      for (var i = 0; i < pending.length; i++) {
        var p = pending[i];
        html += '<tr><td>' + escapeHtml(p.studentName) + '</td><td>' + escapeHtml(p.type) + '</td><td>' + escapeHtml(p.items) + '</td>' +
                '<td><input type="text" class="js-recycler-incentive" data-id="' + p.id + '" placeholder="+5% / 10" /></td>' +
                '<td class="row-actions"><button class="btn btn--sm btn--primary js-recycler-approve" data-id="' + p.id + '">승인</button>' +
                '<button class="btn btn--sm btn--danger js-recycler-reject" data-id="' + p.id + '">반려</button></td></tr>';
      }
      html += '</tbody></table>';
    }
    html += '</section>';

    html += '<section class="panel"><h2 class="panel__title">♻️ 분리수거부 전체 기록 내역</h2>';
    if (allLogs.length === 0) {
      html += '<p class="panel__text">제출된 기록이 없습니다.</p>';
    } else {
      html += '<table class="data"><thead><tr><th>학생</th><th>신청일시</th><th>활동 종류</th><th>내용</th><th>상태</th><th>인센티브</th><th>관리</th></tr></thead><tbody>';
      for (var j = 0; j < allLogs.length; j++) {
        var al = allLogs[j];
        var statusLabel = al.status === "pending" ? "대기중" : (al.status === "approved" ? "승인됨" : "반려됨");
        var statusClass = al.status === "pending" ? "status-log__tag" : (al.status === "approved" ? "status-log__tag status-log__tag--cal" : "status-log__tag status-log__tag--tax");
        html += '<tr>' +
                '<td>' + escapeHtml(al.studentName) + '</td>' +
                '<td>' + fmtTime(al.createdAt) + '</td>' +
                '<td>' + escapeHtml(al.type) + '</td>' +
                '<td>' + escapeHtml(al.items) + '</td>' +
                '<td><span class="' + statusClass + '">' + statusLabel + '</span></td>' +
                '<td>' + escapeHtml(al.incentive || "없음") + '</td>' +
                '<td><button class="btn btn--sm btn--danger js-recycler-delete" data-id="' + al.id + '">삭제</button></td>' +
                '</tr>';
      }
      html += '</tbody></table>';
    }
    html += '</section>';

    shell(renderTeacherChrome("분리수거부 관리", "recycler", html));
    bindLogout();

    var appBtns = document.querySelectorAll(".js-recycler-approve");
    for (var j = 0; j < appBtns.length; j++) {
      appBtns[j].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        var inc = document.querySelector('.js-recycler-incentive[data-id="'+id+'"]').value;
        var ndb = getDb();
        var req = ndb.recyclerLogs.find(function(r) { return r.id === id; });
        if (req) {
          req.status = "approved";
          req.incentive = inc;
          if (inc) {
            var expD = 0; var calD = 0;
            var parts = inc.split("/");
            if (parts[0]) expD = parseInt(parts[0].replace(/[^0-9-]/g, "")) || 0;
            if (parts[1]) calD = parseInt(parts[1].replace(/[^0-9-]/g, "")) || 0;
            var st = getStudent(ndb, req.studentId);
            if (st) {
              st.exp = clampExp((st.exp || 0) + expD);
              st.calory = (st.calory || 0) + calD;
              autoLevelUp(st, ndb);
              addActivityLog(ndb, { studentId: st.id, summary: "분리수거부 인센티브", expDelta: expD, caloryDelta: calD });
            }
          }
          saveDb(ndb);
          route();
        }
      });
    }

    var rejBtns = document.querySelectorAll(".js-recycler-reject");
    for (var k = 0; k < rejBtns.length; k++) {
      rejBtns[k].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        var ndb = getDb();
        var req = ndb.recyclerLogs.find(function(r) { return r.id === id; });
        if (req) {
          req.status = "rejected";
          saveDb(ndb);
          route();
        }
      });
    }

    var delBtns = document.querySelectorAll(".js-recycler-delete");
    for (var d = 0; d < delBtns.length; d++) {
      delBtns[d].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        if (confirm("이 기록을 삭제할까요? 이미 승인되어 부여된 경험치/보유 화폐가 있다면 회수됩니다.")) {
          var ndb = getDb();
          deleteRecyclerLog(ndb, id);
          route();
        }
      });
    }
  }

  // ==========================================
  // 환경부 기능
  // ==========================================
  function viewStudentEnv(session) {
    var db = getDb();
    if (!db) return;
    var st = getStudent(db, session.studentId);
    if (!st || (st.jobId !== "env" && !session.isOverride && !session.preview)) {
      window.location.hash = "#/student"; route(); return;
    }

    var html = '<section class="panel"><h2 class="panel__title">🌿 교실 관리 체크리스트 (환경부)</h2>' +
               '<form id="form-env" class="stack">' +
               '<fieldset><legend>관리 항목 (확인된 것 체크)</legend>' +
               '<label><input type="checkbox" name="chkDay" /> 요일 바꾸기</label><br/>' +
               '<label><input type="checkbox" name="chkTime" /> 시간표 설정</label><br/>' +
               '<label><input type="checkbox" name="chkBoard" /> 칠판 지우기</label><br/>' +
               '<label class="field" style="margin-top:8px">기타 활동<input type="text" name="other" placeholder="기타 한 일" /></label>' +
               '</fieldset>' +
               '<label class="field">환경 파괴범 🚨 (선택)<input type="text" name="destroyer" placeholder="이름 기록" /></label>' +
               '<button type="submit" class="btn btn--primary">선생님께 승인 요청</button>' +
               '</form></section>';

    var logs = (db.envLogs || []).filter(function(l) { return l.studentId === st.id; }).sort(function(a,b){ return b.createdAt - a.createdAt; }).slice(0, 10);
    html += '<section class="panel"><h2 class="panel__title">최근 요청 내역</h2><ul class="status-log">';
    if (logs.length === 0) {
      html += '<li class="status-log__item muted">기록이 없습니다.</li>';
    } else {
      for (var i = 0; i < logs.length; i++) {
        var l = logs[i];
        var stat = l.status === "pending" ? "대기중" : (l.status === "approved" ? "승인됨" : "반려됨");
        var tasks = [];
        if (l.chkDay) tasks.push("요일");
        if (l.chkTime) tasks.push("시간표");
        if (l.chkBoard) tasks.push("칠판");
        if (l.other) tasks.push(l.other);
        var tStr = tasks.length ? tasks.join(", ") : "항목없음";
        html += '<li class="status-log__item">' + escapeHtml(tStr) + ' <span class="muted">(' + fmtDateShort(l.createdAt) + ')</span> <span class="status-log__tag">' + stat + '</span></li>';
      }
    }
    html += '</ul></section>';

    shell(renderStudentChrome("환경부", html, { subNavLinks: getStudentSubNavLinks(db, session, "env") }));
    bindLogout();

    var form = document.getElementById("form-env");
    if (form) {
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        var ndb = getDb();
        if (!ndb.envLogs) ndb.envLogs = [];
        ndb.envLogs.push({
          id: C.uid(),
          studentId: st.id,
          studentName: st.name,
          chkDay: form.chkDay.checked,
          chkTime: form.chkTime.checked,
          chkBoard: form.chkBoard.checked,
          other: form.other.value,
          destroyer: form.destroyer.value,
          status: "pending",
          createdAt: Date.now()
        });
        saveDb(ndb);
        alert("승인 요청이 전송되었습니다.");
        route();
      });
    }
  }

  function viewTeacherEnv(session) {
    var db = getDb();
    if (!db) return;
    
    var pending = (db.envLogs || []).filter(function(l) { return l.status === "pending"; }).sort(function(a,b){ return a.createdAt - b.createdAt; });
    var allLogs = (db.envLogs || []).sort(function(a,b){ return b.createdAt - a.createdAt; });

    var html = '<section class="panel"><h2 class="panel__title">🌿 환경부 승인 대기</h2>';
    if (pending.length === 0) {
      html += '<p class="panel__text">대기 중인 요청이 없습니다.</p>';
    } else {
      html += '<table class="data"><thead><tr><th>학생</th><th>수행 항목</th><th>환경파괴범</th><th>인센티브</th><th>작업</th></tr></thead><tbody>';
      for (var i = 0; i < pending.length; i++) {
        var p = pending[i];
        var tasks = [];
        if (p.chkDay) tasks.push("요일");
        if (p.chkTime) tasks.push("시간표");
        if (p.chkBoard) tasks.push("칠판");
        if (p.other) tasks.push(p.other);
        var tStr = tasks.join(", ");
        html += '<tr><td>' + escapeHtml(p.studentName) + '</td><td>' + escapeHtml(tStr) + '</td><td>' + escapeHtml(p.destroyer || "") + '</td>' +
                '<td><input type="text" class="js-env-incentive" data-id="' + p.id + '" placeholder="+5% / 10" /></td>' +
                '<td class="row-actions"><button class="btn btn--sm btn--primary js-env-approve" data-id="' + p.id + '">승인</button>' +
                '<button class="btn btn--sm btn--danger js-env-reject" data-id="' + p.id + '">반려</button></td></tr>';
      }
      html += '</tbody></table>';
    }
    html += '</section>';

    html += '<section class="panel"><h2 class="panel__title">🌿 환경부 전체 기록 내역</h2>';
    if (allLogs.length === 0) {
      html += '<p class="panel__text">제출된 기록이 없습니다.</p>';
    } else {
      html += '<table class="data"><thead><tr><th>학생</th><th>신청일시</th><th>수행 항목</th><th>환경파괴범</th><th>상태</th><th>인센티브</th><th>관리</th></tr></thead><tbody>';
      for (var j = 0; j < allLogs.length; j++) {
        var al = allLogs[j];
        var statusLabel = al.status === "pending" ? "대기중" : (al.status === "approved" ? "승인됨" : "반려됨");
        var statusClass = al.status === "pending" ? "status-log__tag" : (al.status === "approved" ? "status-log__tag status-log__tag--cal" : "status-log__tag status-log__tag--tax");
        var tasks = [];
        if (al.chkDay) tasks.push("요일");
        if (al.chkTime) tasks.push("시간표");
        if (al.chkBoard) tasks.push("칠판");
        if (al.other) tasks.push(al.other);
        var tStr = tasks.join(", ");
        html += '<tr>' +
                '<td>' + escapeHtml(al.studentName) + '</td>' +
                '<td>' + fmtTime(al.createdAt) + '</td>' +
                '<td>' + escapeHtml(tStr) + '</td>' +
                '<td>' + escapeHtml(al.destroyer || "없음") + '</td>' +
                '<td><span class="' + statusClass + '">' + statusLabel + '</span></td>' +
                '<td>' + escapeHtml(al.incentive || "없음") + '</td>' +
                '<td><button class="btn btn--sm btn--danger js-env-delete" data-id="' + al.id + '">삭제</button></td>' +
                '</tr>';
      }
      html += '</tbody></table>';
    }
    html += '</section>';

    shell(renderTeacherChrome("환경부 관리", "env", html));
    bindLogout();

    var appBtns = document.querySelectorAll(".js-env-approve");
    for (var j = 0; j < appBtns.length; j++) {
      appBtns[j].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        var inc = document.querySelector('.js-env-incentive[data-id="'+id+'"]').value;
        var ndb = getDb();
        var req = ndb.envLogs.find(function(r) { return r.id === id; });
        if (req) {
          req.status = "approved";
          req.incentive = inc;
          if (inc) {
            var expD = 0; var calD = 0;
            var parts = inc.split("/");
            if (parts[0]) expD = parseInt(parts[0].replace(/[^0-9-]/g, "")) || 0;
            if (parts[1]) calD = parseInt(parts[1].replace(/[^0-9-]/g, "")) || 0;
            var st = getStudent(ndb, req.studentId);
            if (st) {
              st.exp = clampExp((st.exp || 0) + expD);
              st.calory = (st.calory || 0) + calD;
              autoLevelUp(st, ndb);
              addActivityLog(ndb, { studentId: st.id, summary: "환경부 인센티브", expDelta: expD, caloryDelta: calD });
            }
          }
          saveDb(ndb);
          route();
        }
      });
    }

    var rejBtns = document.querySelectorAll(".js-env-reject");
    for (var k = 0; k < rejBtns.length; k++) {
      rejBtns[k].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        var ndb = getDb();
        var req = ndb.envLogs.find(function(r) { return r.id === id; });
        if (req) {
          req.status = "rejected";
          saveDb(ndb);
          route();
        }
      });
    }

    var delBtns = document.querySelectorAll(".js-env-delete");
    for (var d = 0; d < delBtns.length; d++) {
      delBtns[d].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        if (confirm("이 기록을 삭제할까요? 이미 승인되어 부여된 경험치/보유 화폐가 있다면 회수됩니다.")) {
          var ndb = getDb();
          deleteEnvLog(ndb, id);
          route();
        }
      });
    }
  }

  function viewTeacherDj(session) {
    var db = getDb();
    if (!db) return;

    var pending = (db.djRequests || []).filter(function(r) { return !r.confirmed; }).sort(function(a,b){ return a.createdAt - b.createdAt; });
    var allRequests = (db.djRequests || []).sort(function(a,b){ return b.createdAt - a.createdAt; });

    var html = '<section class="panel"><h2 class="panel__title">🎧 DJ 신청곡 승인 대기</h2>';
    if (pending.length === 0) {
      html += '<p class="panel__text">대기 중인 신청곡이 없습니다.</p>';
    } else {
      html += '<table class="data"><thead><tr><th>신청일시</th><th>학생</th><th>신청곡</th><th>작업</th></tr></thead><tbody>';
      for (var i = 0; i < pending.length; i++) {
        var p = pending[i];
        html += '<tr><td>' + fmtTime(p.createdAt) + '</td><td>' + escapeHtml(p.studentName) + '</td><td>' + escapeHtml(p.title) + '</td>' +
                '<td><button class="btn btn--sm btn--primary js-dj-confirm" data-id="' + p.id + '">확인 완료</button></td></tr>';
      }
      html += '</tbody></table>';
    }
    html += '</section>';

    html += '<section class="panel"><h2 class="panel__title">🎧 DJ 신청곡 전체 내역</h2>';
    if (allRequests.length === 0) {
      html += '<p class="panel__text">신청된 음악이 없습니다.</p>';
    } else {
      html += '<table class="data"><thead><tr><th>신청일시</th><th>학생</th><th>신청곡</th><th>상태</th><th>관리</th></tr></thead><tbody>';
      for (var j = 0; j < allRequests.length; j++) {
        var req = allRequests[j];
        var statusLabel = req.confirmed ? "확인완료" : "대기중";
        var statusClass = req.confirmed ? "status-log__tag status-log__tag--cal" : "status-log__tag";
        html += '<tr>' +
                '<td>' + fmtTime(req.createdAt) + '</td>' +
                '<td>' + escapeHtml(req.studentName) + '</td>' +
                '<td>' + escapeHtml(req.title) + '</td>' +
                '<td><span class="' + statusClass + '">' + statusLabel + '</span></td>' +
                '<td><button class="btn btn--sm btn--danger js-dj-delete" data-id="' + req.id + '">삭제</button></td>' +
                '</tr>';
      }
      html += '</tbody></table>';
    }
    html += '</section>';

    shell(renderTeacherChrome("DJ 신청곡 관리", "dj", html));
    bindLogout();

    var confBtns = document.querySelectorAll(".js-dj-confirm");
    for (var k = 0; k < confBtns.length; k++) {
      confBtns[k].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        var ndb = getDb();
        confirmDjRequest(ndb, id);
        route();
      });
    }

    var delBtns = document.querySelectorAll(".js-dj-delete");
    for (var d = 0; d < delBtns.length; d++) {
      delBtns[d].addEventListener("click", function(e) {
        var id = e.target.getAttribute("data-id");
        if (confirm("이 신청곡을 삭제하시겠습니까?")) {
          var ndb = getDb();
          deleteDjRequest(ndb, id);
          route();
        }
      });
    }
  }

  // ==========================================
  // 교사 1인 1역 장부 강제 접속 (Master Override)
  // ==========================================
  function viewTeacherStudentJobOverride(session, studentIdRaw, jobIdRaw, subPageRaw) {
    var db = getDb();
    if (!db) return;
    var sid = decodeURIComponent(String(studentIdRaw || ""));
    var jid = decodeURIComponent(String(jobIdRaw || ""));
    var subPage = decodeURIComponent(String(subPageRaw || ""));

    // Extract real jobId if jid contains ?sub= query parameter from custom subnav href
    var qIdx = jid.indexOf("?sub=");
    if (qIdx !== -1) {
      jid = jid.substring(0, qIdx);
    }

    var st = getStudent(db, sid);
    
    if (!st || !jid || st.jobId !== jid) {
      alert("해당 학생이 그 직업을 가지고 있지 않거나 잘못된 접근입니다.");
      window.location.hash = "#/teacher";
      return;
    }
    
    var overrideSession = {
      userId: session.userId,
      role: "student", // 권한 우회를 위해 student로 위장
      studentId: st.id,
      isOverride: true // 교사 우회 플래그
    };

    // If a specific subPage was clicked from student sub-navigation menu, route dynamically
    if (subPage) {
      if (subPage === "bank-payroll") { viewStudentBankPayroll(overrideSession); return; }
      if (subPage === "tax-collect") { viewStudentTaxCollect(overrideSession); return; }
      if (subPage === "statistics-checklist") { viewStudentStatisticsChecklist(overrideSession); return; }
      if (subPage === "postman-errands") { viewStudentPostmanErrand(overrideSession); return; }
      if (subPage === "cleaning-checklist") { viewStudentCleaningChecklist(overrideSession); return; }
      if (subPage === "coupon-shop") { viewStudentCouponShop(overrideSession); return; }
      if (subPage === "title-shop") { viewStudentTitleShop(overrideSession); return; }
      if (subPage === "store") { viewStudentStore(overrideSession); return; }
      if (subPage === "coupon-merchant") { viewStudentCouponMerchant(overrideSession); return; }
      if (subPage === "store-merchant") { viewStudentCanteenMerchant(overrideSession); return; }
      if (subPage === "dj-request") { viewStudentDjRequest(overrideSession); return; }
      if (subPage === "dj") { viewStudentDj(overrideSession); return; }
      if (subPage === "recycler") { viewStudentRecycler(overrideSession); return; }
      if (subPage === "env") { viewStudentEnv(overrideSession); return; }
    }

    // Default to "나의 STATUS" (main student page) if no specific subPage is set
    if (window.location.hash.indexOf("?sub=") === -1) {
      viewStudent(overrideSession);
      return;
    }
    
    if (jid === "cleaner") { viewStudentCleaningChecklist(overrideSession); return; }
    if (jid === "dj") { viewStudentDj(overrideSession); return; }
    if (jid === "recycler") { viewStudentRecycler(overrideSession); return; }
    if (jid === "env") { viewStudentEnv(overrideSession); return; }
    if (jid === "statistician") { viewStudentStatisticsChecklist(overrideSession); return; }
    if (jid === "postman") { viewStudentPostmanErrand(overrideSession); return; }
    if (jid === "bank_m" || jid === "bank_f") { viewStudentBankPayroll(overrideSession); return; }
    if (jid === "tax_m" || jid === "tax_f") { viewStudentTaxCollect(overrideSession); return; }
    if (jid === "coupon_merchant") { viewStudentCouponMerchant(overrideSession); return; }
    if (jid === "store_merchant") { viewStudentCanteenMerchant(overrideSession); return; }

    alert("이 직업은 별도의 전용 장부가 없습니다.");
    window.location.hash = "#/teacher";
  }


  function route() {
    if (window.location.hash.indexOf("stock-market") === -1) {
      if (window.activeStockInterval) {
        clearInterval(window.activeStockInterval);
        window.activeStockInterval = null;
      }
    }
    var session = requireSession();
    if (!session) return;
    var dbRoute = getDb();
    if (dbRoute && session.role === "teacher") {
      runDailyBoardBoundaryPipeline(dbRoute);
    }
    document.body.classList.remove("app-body--digital-board");

    var parts = parseHash();
    var role = session.role;

    if (role === "student") {
      if (parts[0] === "student-pin") {
        viewStudentPinChange(session);
        return;
      }
      if (parts[0] !== "student") {
        window.location.hash = "#/student";
        return;
      }
      if (studentUserNeedsPinChange(getDb(), session)) {
        window.location.hash = "#/student-pin";
        route();
        return;
      }
      if (parts[1] === "bank-payroll") {
        viewStudentBankPayroll(session);
        return;
      }
      if (parts[1] === "tax-collect") {
        viewStudentTaxCollect(session);
        return;
      }
      if (parts[1] === "statistics-checklist") {
        viewStudentStatisticsChecklist(session);
        return;
      }
      if (parts[1] === "postman-errands") {
        viewStudentPostmanErrand(session);
        return;
      }
      if (parts[1] === "cleaning-checklist") {
        viewStudentCleaningChecklist(session);
        return;
      }
      if (parts[1] === "coupon-shop") {
        viewStudentCouponShop(session);
        return;
      }
      if (parts[1] === "title-shop") {
        viewStudentTitleShop(session);
        return;
      }
      if (parts[1] === "store") {
        viewStudentStore(session);
        return;
      }
      if (parts[1] === "coupon-merchant") {
        viewStudentCouponMerchant(session);
        return;
      }
      if (parts[1] === "store-merchant") {
        viewStudentCanteenMerchant(session);
        return;
      }
      if (parts[1] === "stock-market") {
        viewStudentStockMarket(session);
        return;
      }
      if (parts[1] === "dj-request") { viewStudentDjRequest(session); return; }
      if (parts[1] === "dj") { viewStudentDj(session); return; }
      if (parts[1] === "recycler") { viewStudentRecycler(session); return; }
      if (parts[1] === "env") { viewStudentEnv(session); return; }
      if (parts[1] === "peers") { viewStudentPeers(session); return; }
      if (parts[1] === "hall-of-fame") { viewStudentHallOfFame(session); return; }
      if (parts[1] && parts[1] !== "") {
        window.location.hash = "#/student";
        return;
      }
      viewStudent(session);
      return;
    }

    if (role === "teacher") {
      if (parts[0] === "student") {
        window.location.hash = "#/teacher";
        return;
      }

      var p0 = parts[0] || "teacher";
      if (p0 !== "teacher") {
        window.location.hash = "#/teacher";
        return;
      }

      var p1 = parts[1] || "";
      var p2 = parts[2] || "";

      if (!p1 || p1 === "dashboard") {
        viewTeacherDashboard(session);
        return;
      }
      if (p1 === "board") {
        viewTeacherDigitalBoard(session);
        return;
      }
      if (p1 === "preview") {
        if (!p2) {
          viewTeacherPreviewPicker(session);
          return;
        }
        var p3preview = parts[3] || "";
        viewTeacherStudentPreview(session, p2, p3preview);
        return;
      }
      if (p1 === "students") {
        if (!p2) {
          viewTeacherStudents(session);
          return;
        }
        if (p2 === "new") {
          viewTeacherStudentNew(session);
          return;
        }
        var p3 = parts[3] || "";
        if (p3 === "status") {
          viewTeacherStudentStatusBoard(session, p2);
          return;
        }
        viewTeacherStudentDetail(session, p2);
        return;
      }
      if (p1 === "bulk") {
        viewTeacherBulk(session);
        return;
      }
      if (p1 === "bank-payroll") {
        viewTeacherBankPayroll(session);
        return;
      }
      if (p1 === "tax-collect") {
        viewTeacherTaxCollect(session);
        return;
      }
      if (p1 === "statistics-checklist") {
        viewTeacherStatisticsChecklist(session);
        return;
      }
      if (p1 === "postman-errands") {
        viewTeacherPostmanErrand(session);
        return;
      }
      if (p1 === "cleaning-checklist") {
        viewTeacherCleaningChecklist(session);
        return;
      }
      if (p1 === "coupon-shop" && !p2) {
        viewTeacherCouponShop(session);
        return;
      }
      if (p1 === "title-shop" && !p2) {
        viewTeacherTitleShop(session);
        return;
      }
      if (p1 === "store-shop" && !p2) {
        viewTeacherCanteenShop(session);
        return;
      }
      if (p1 === "stock-market" && !p2) {
        viewTeacherStockMarket(session);
        return;
      }
      if (p1 === "student-jobs") { viewTeacherStudentJobOverride(session, p2, parts[3], parts[4]); return; }
      if (p1 === "recycler") { viewTeacherRecycler(session); return; }
      if (p1 === "env") { viewTeacherEnv(session); return; }
      if (p1 === "dj") { viewTeacherDj(session); return; }
      if (p1 === "hall-of-fame-settings") { viewTeacherHallOfFameSettings(session); return; }


      viewTeacherDashboard(session);
    }
  }

  function attemptLocalTeacherLogin(loginId, password) {
    var db = C.loadDb();
    if (!db) {
      alert("데이터를 불러올 수 없습니다.");
      return;
    }
    var u = C.findUserByLoginId(db, loginId);
    if (!u || u.role !== "teacher") {
      alert("아이디 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    C.verifyUserPassword(u, password).then(function (ok) {
      if (!ok) {
        alert("아이디 또는 비밀번호가 올바르지 않습니다.");
        return;
      }
      C.setSession({
        userId: u.id,
        role: "teacher",
        studentId: null,
        displayName: u.displayName || "",
      });
      window.location.hash = "#/teacher";
      route();
    });
  }

  function attemptLocalStudentLogin(nameRaw, pinRaw) {
    var db = getDb();
    if (!db) {
      alert("데이터를 불러올 수 없습니다.");
      return;
    }
    var u = findStudentUserForLogin(db, nameRaw);
    if (!u) {
      alert("이름 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    verifyStudentLogin(u, pinRaw).then(function (ok) {
      if (!ok) {
        alert("이름 또는 비밀번호가 올바르지 않습니다.");
        return;
      }
      C.setSession({
        userId: u.id,
        role: "student",
        studentId: u.studentId,
        displayName: u.displayName || "",
      });
      window.location.hash = "#/student";
      route();
    });
  }

  /** Firebase 학생 로그인 시도 중 — 익명 로그인 직후 onAuthStateChanged가 로그인 폼을 다시 그리지 않도록 함 */
  function setFirebaseStudentLoginFormError(msg) {
    var el = document.getElementById("login-student-inline-err");
    if (el) {
      el.textContent = msg || "";
      el.hidden = !msg;
    } else if (msg) {
      alert(msg);
    }
  }

  function clearFirebaseStudentLoginFormError() {
    setFirebaseStudentLoginFormError("");
  }

  function attemptFirebaseStudentLogin(nameRaw, pinRaw) {
    var cfg = window.ClassStatusFirebaseConfig;
    if (!cfg || !String(cfg.teacherFirestoreUid || "").trim()) {
      setFirebaseStudentLoginFormError(
        "firebase-config.js에 teacherFirestoreUid(선생님 UID)가 필요합니다. 콘솔 Authentication에서 확인하세요."
      );
      return;
    }
    if (typeof firebase === "undefined" || !firebase.auth) {
      setFirebaseStudentLoginFormError("Firebase를 불러올 수 없습니다.");
      return;
    }
    window.__classStatusFirebaseStudentLoginBusy = true;
    clearFirebaseStudentLoginFormError();
    firebase
      .auth()
      .signInAnonymously()
      .then(function () {
        return window.ClassStatusFirebase.initForUser(String(cfg.teacherFirestoreUid).trim());
      })
      .then(function () {
        var db = getDb();
        if (!db || !db.users) {
          setFirebaseStudentLoginFormError("학급 데이터를 불러오지 못했습니다.");
          return firebase.auth().signOut();
        }
        var u = findStudentUserForLogin(db, nameRaw);
        if (!u) {
          setFirebaseStudentLoginFormError("이름 또는 비밀번호가 올바르지 않습니다.");
          return firebase.auth().signOut();
        }
        return verifyStudentLogin(u, pinRaw).then(function (ok) {
          if (!ok) {
            setFirebaseStudentLoginFormError("이름 또는 비밀번호가 올바르지 않습니다.");
            return firebase.auth().signOut();
          }
          clearFirebaseStudentLoginFormError();
          C.setSession({
            userId: u.id,
            role: "student",
            studentId: u.studentId,
            displayName: u.displayName || "",
          });
          if (!window.__classStatusHashBound) {
            window.__classStatusHashBound = true;
            window.addEventListener("hashchange", route);
          }
          window.location.hash = "#/student";
          route();
        });
      })
      .catch(function (err) {
        console.warn(err);
        setFirebaseStudentLoginFormError(
          "로그인에 실패했습니다: " + (err && err.message ? err.message : "")
        );
      })
      .finally(function () {
        window.__classStatusFirebaseStudentLoginBusy = false;
      });
  }

  function renderDualLoginLocal() {
    var root = document.getElementById("app");
    if (!root) return;
    document.body.classList.remove("app-body--digital-board");
    root.innerHTML =
      '<div class="login-screen login-screen--dual">' +
      '<section class="panel login-screen__panel">' +
      '<h1 class="panel__title">선생님 로그인</h1>' +
      '<p class="panel__text muted">데모: <code>teacher</code> / <code>demo123</code></p>' +
      '<form id="form-local-teacher-login" class="stack">' +
      '<label class="field">아이디<input type="text" name="loginId" required autocomplete="username" /></label>' +
      '<label class="field">비밀번호<input type="password" name="password" required autocomplete="current-password" /></label>' +
      '<button type="submit" class="btn btn--primary">로그인</button>' +
      "</form></section>" +
      '<section class="panel login-screen__panel">' +
      '<h1 class="panel__title">학생 로그인</h1>' +
      '<p class="panel__text muted">아이디는 <strong class="accent">이름</strong>(끝 공백 없이), 비밀번호는 숫자 <strong class="accent">4자리</strong>입니다.</p>' +
      '<form id="form-local-student-login" class="stack" autocomplete="off">' +
      '<label class="field">이름<input type="text" name="name" required autocomplete="name" /></label>' +
      '<label class="field">비밀번호 (4자리 숫자)<input type="password" name="pin" inputmode="numeric" maxlength="4" required autocomplete="off" autocapitalize="off" spellcheck="false" /></label>' +
      '<p class="field-hint muted">숫자 4자리 PIN입니다. Chrome이 「유출된 비밀번호」라고 뜨면 무시하거나, 주소창 오른쪽 자물쇠 → 사이트 설정에서 이 사이트의 비밀번호 저장을 끄면 됩니다.</p>' +
      '<button type="submit" class="btn btn--accent">학생으로 로그인</button>' +
      "</form></section></div>";

    var ft = document.getElementById("form-local-teacher-login");
    var fs = document.getElementById("form-local-student-login");
    if (ft) {
      ft.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(ft);
        attemptLocalTeacherLogin(String(fd.get("loginId") || "").trim(), String(fd.get("password") || ""));
      });
    }
    if (fs) {
      fs.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(fs);
        attemptLocalStudentLogin(String(fd.get("name") || "").trim(), String(fd.get("pin") || ""));
      });
    }
  }

  function renderDualLoginFirebase() {
    var root = document.getElementById("app");
    if (!root) return;
    document.body.classList.remove("app-body--digital-board");
    var cfg = window.ClassStatusFirebaseConfig;
    var uidHint =
      cfg && String(cfg.teacherFirestoreUid || "").trim()
        ? ""
        : '<p class="field-error">학생 로그인을 쓰려면 <code>teacherFirestoreUid</code>를 설정해야 합니다.</p>';
    root.innerHTML =
      '<div class="login-screen login-screen--dual">' +
      '<section class="panel login-screen__panel">' +
      '<h1 class="panel__title">선생님 로그인</h1>' +
      '<p class="panel__text muted">Firebase에 등록한 <strong class="accent">이메일</strong>과 <strong class="accent">비밀번호</strong>로 로그인합니다.</p>' +
      '<form id="form-teacher-login" class="stack">' +
      '<label class="field">이메일<input type="email" name="email" required autocomplete="username" /></label>' +
      '<label class="field">비밀번호<input type="password" name="password" required autocomplete="current-password" /></label>' +
      '<p id="login-firebase-err" class="field-error" hidden></p>' +
      '<button type="submit" class="btn btn--primary">로그인</button>' +
      "</form></section>" +
      '<section class="panel login-screen__panel">' +
      '<h1 class="panel__title">학생 로그인</h1>' +
      '<p class="panel__text muted">아이디는 <strong class="accent">이름</strong>(공백 없이), 비밀번호는 숫자 <strong class="accent">4자리</strong>. 첫 로그인에서 비밀번호를 바꿉니다.</p>' +
      uidHint +
      '<form id="form-student-login" class="stack" autocomplete="off">' +
      '<label class="field">이름<input type="text" name="name" required autocomplete="name" /></label>' +
      '<label class="field">비밀번호 (4자리 숫자)<input type="password" name="pin" inputmode="numeric" maxlength="4" required autocomplete="off" autocapitalize="off" spellcheck="false" /></label>' +
      '<p id="login-student-inline-err" class="field-error" role="alert" hidden></p>' +
      '<p class="field-hint muted">숫자 4자리 PIN입니다. Chrome이 「유출된 비밀번호」라고 뜨면 무시하거나, 이 사이트에 대해 비밀번호 저장을 끄면 됩니다.</p>' +
      '<button type="submit" class="btn btn--accent" id="btn-student-firebase-login">학생으로 로그인</button>' +
      "</form></section></div>";

    var form = document.getElementById("form-teacher-login");
    var errEl = document.getElementById("login-firebase-err");
    if (form && errEl) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        errEl.hidden = true;
        var fd = new FormData(form);
        var email = String(fd.get("email") || "").trim();
        var password = String(fd.get("password") || "");
        firebase
          .auth()
          .signInWithEmailAndPassword(email, password)
          .catch(function (err) {
            errEl.textContent = err.message || "로그인에 실패했습니다.";
            errEl.hidden = false;
          });
      });
    }
    var fs = document.getElementById("form-student-login");
    if (fs) {
      fs.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(fs);
        attemptFirebaseStudentLogin(String(fd.get("name") || "").trim(), String(fd.get("pin") || ""));
      });
    }
  }

  function runLocalOnlyApp() {
    C.ensureDb().then(function () {
      if (!window.__classStatusHashBound) {
        window.__classStatusHashBound = true;
        window.addEventListener("hashchange", route);
      }

      var session = C.getSession();
      if (!session || !session.userId) {
        renderDualLoginLocal();
        return;
      }

      if (!location.hash || location.hash === "#") {
        if (session.role === "student") window.location.hash = "#/student";
        else window.location.hash = "#/teacher";
      }

      route();
    });
  }

  function isUserTyping() {
    var active = document.activeElement;
    if (!active) return false;
    var tag = active.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      var type = (active.type || "text").toLowerCase();
      var textTypes = ["text", "number", "password", "email", "search", "tel", "url"];
      return textTypes.indexOf(type) !== -1;
    }
    return false;
  }

  /**
   * 다른 탭(학생 로그인)에서 saveDb → localStorage 갱신 시, 이 탭의 memoryDb는 옛날 객체를
   * 계속 들고 있어 아바타 등이 안 보일 수 있음 → storage 이벤트로 맞춤.
   * Firebase 모드에서는 Firestore onSnapshot 후 classstatus-db-synced 로 동일 처리.
   */
  function attachExternalDbSyncListeners() {
    if (window.__classStatusExternalDbSyncAttached) return;
    window.__classStatusExternalDbSyncAttached = true;
    window.addEventListener("storage", function (e) {
      if (!e || e.key !== C.STORAGE_KEY || !e.newValue) return;
      try {
        var parsed = JSON.parse(e.newValue);
        if (!parsed || !parsed.users) return;
        C.hydrateDb(parsed);
        var session = C.getSession();
        if (!session || !session.userId) return;
        if (
          session.role === "teacher" &&
          (location.hash || "").indexOf("#/teacher/board") === 0
        ) {
          var dbR = getDb();
          if (dbR) runDailyBoardBoundaryPipeline(dbR);
          refreshDigitalBoardDomFromDb();
          return;
        }
        window.__classStatusIsBackgroundSync = true;
        try {
          route();
        } finally {
          window.__classStatusIsBackgroundSync = false;
        }
      } catch (err) {}
    });
    window.addEventListener("classstatus-db-synced", function () {
      var session = C.getSession();
      if (!session || !session.userId) return;
      if (
        session.role === "teacher" &&
        (location.hash || "").indexOf("#/teacher/board") === 0
      ) {
        var dbS = getDb();
        if (dbS) runDailyBoardBoundaryPipeline(dbS);
        refreshDigitalBoardDomFromDb();
        return;
      }
      window.__classStatusIsBackgroundSync = true;
      try {
        route();
      } finally {
        window.__classStatusIsBackgroundSync = false;
      }
    });
  }

  /* Peer Gallery & Hall of Fame Feature */

  function buildPeersGalleryHtml(db, currentStudentId, options) {
    var students = studentsSortedByNumber(db);
    var cardsHtml = "";
    for (var i = 0; i < students.length; i++) {
      var st = students[i];
      var titles = titlesForStudent(db, st.id);
      var activeTitleHtml = "";
      if (titles.length > 0) {
        var t = titles[0];
        var styleAttr = "";
        if (t.textColor && t.bgColor) {
          styleAttr = ' style="color: ' + escapeHtml(t.textColor) + '; background-color: ' + escapeHtml(t.bgColor) + '; border-color: ' + escapeHtml(t.bgColor) + '; display: inline-block; max-width: 100%; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;"';
        } else if (t.textColor) {
          styleAttr = ' style="color: ' + escapeHtml(t.textColor) + '; border-color: ' + escapeHtml(t.textColor) + '; display: inline-block; max-width: 100%; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;"';
        }
        activeTitleHtml = '<span class="status-pill"' + styleAttr + '>' + escapeHtml(t.titleText) + '</span>';
      } else {
        activeTitleHtml = '<span class="status-pill status-pill--none" style="opacity: 0.5;">칭호 없음</span>';
      }

      var jobDef = getJobDef(st.jobId);
      var jobLabel = jobDef ? jobDef.label : "무직";

      cardsHtml +=
        '<div class="peer-card" data-peer-id="' + escapeHtml(st.id) + '">' +
          '<div class="peer-card__avatar-container">' +
            renderAvatarInnerHtml(st) +
          '</div>' +
          '<h3 class="peer-card__name">' + escapeHtml(st.number) + '번 ' + escapeHtml(st.name) + '</h3>' +
          '<div class="peer-card__info">' +
            '<span class="peer-card__badge">Lv. ' + escapeHtml(st.lv || 1) + '</span>' +
            '<span class="peer-card__badge peer-card__badge--job">' + escapeHtml(jobLabel) + '</span>' +
          '</div>' +
          '<div class="peer-card__title-section">' +
            activeTitleHtml +
          '</div>' +
        '</div>';
    }

    if (students.length === 0) {
      cardsHtml = '<div class="grid-span-all text-center muted" style="padding: 3rem;">학급에 등록된 학생이 없습니다.</div>';
    }

    return (
      '<div class="peers-gallery-container">' +
        '<div class="panel">' +
          '<h2 class="panel__title">👥 우리반 친구들</h2>' +
          '<p class="panel__text muted">우리 반 친구들의 캐릭터, 레벨, 대표 칭호를 한눈에 모아보세요. 카드를 클릭하면 상세 프로필과 보유한 모든 칭호 목록을 볼 수 있습니다.</p>' +
          '<div class="peers-grid">' +
            cardsHtml +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function viewStudentPeers(session) {
    var db = getDb();
    var isPreview = session.role === "teacher" && session.preview;
    var main = buildPeersGalleryHtml(db, session.studentId, { preview: isPreview });
    shell(
      renderStudentChrome("우리반 친구들", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "peers"),
      })
    );
    bindLogout();
    bindPeersModalClicks(db);
  }

  function bindPeersModalClicks(db) {
    var cards = document.querySelectorAll(".peer-card");
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener("click", function (e) {
        var studentId = this.getAttribute("data-peer-id");
        var st = getStudent(db, studentId);
        if (!st) return;

        var titles = titlesForStudent(db, st.id);
        var titlesHtml = "";
        if (titles.length > 0) {
          titlesHtml = '<div class="peer-modal__titles-list">';
          for (var j = 0; j < titles.length; j++) {
            var t = titles[j];
            var styleAttr = "";
            if (t.textColor && t.bgColor) {
              styleAttr = ' style="color: ' + escapeHtml(t.textColor) + '; background-color: ' + escapeHtml(t.bgColor) + '; border-color: ' + escapeHtml(t.bgColor) + ';"';
            } else if (t.textColor) {
              styleAttr = ' style="color: ' + escapeHtml(t.textColor) + '; border-color: ' + escapeHtml(t.textColor) + ';"';
            }
            titlesHtml += '<span class="status-pill"' + styleAttr + ' title="획득일: ' + fmtTime(t.acquiredAt) + '">' + escapeHtml(t.titleText) + '</span>';
          }
          titlesHtml += '</div>';
        } else {
          titlesHtml = '<p class="muted" style="margin-top: 0.5rem; font-size: 0.85rem;">획득한 칭호가 없습니다.</p>';
        }

        var jobDef = getJobDef(st.jobId);
        var jobLabel = jobDef ? jobDef.label : "무직";

        var modalHtml =
          '<div class="peer-modal__backdrop"></div>' +
          '<div class="peer-modal__dialog">' +
            '<button class="peer-modal__close-btn" aria-label="닫기">&times;</button>' +
            '<div class="peer-modal__grid">' +
              '<div class="peer-modal__left">' +
                '<div class="peer-modal__avatar-container">' +
                  renderAvatarInnerHtml(st) +
                '</div>' +
                '<h3 class="peer-modal__name">' + escapeHtml(st.number) + '번 ' + escapeHtml(st.name) + '</h3>' +
                '<div class="peer-modal__stats">' +
                  '<span class="peer-modal__badge peer-modal__badge--level">Lv. ' + escapeHtml(st.lv || 1) + '</span>' +
                  '<span class="peer-modal__badge peer-modal__badge--job">' + escapeHtml(jobLabel) + '</span>' +
                '</div>' +
              '</div>' +
              '<div class="peer-modal__right">' +
                '<h4 class="peer-modal__section-title">🎖️ 보유한 칭호 목록 (' + titles.length + '개)</h4>' +
                titlesHtml +
              '</div>' +
            '</div>' +
          '</div>';

        var modalEl = document.createElement("div");
        modalEl.className = "peer-modal";
        modalEl.innerHTML = modalHtml;
        document.body.appendChild(modalEl);

        var closeModal = function () {
          if (modalEl.parentNode) {
            modalEl.parentNode.removeChild(modalEl);
          }
        };

        modalEl.querySelector(".peer-modal__backdrop").addEventListener("click", closeModal);
        modalEl.querySelector(".peer-modal__close-btn").addEventListener("click", closeModal);
      });
    }
  }

  function buildPodiumColumn(st, label, valueHtml, rankClass, symbolEmoji, isGroupText) {
    var avatarHtml = "";
    var nameHtml = "";

    if (isGroupText) {
      var teamName = st || "";
      if (teamName) {
        avatarHtml =
          '<div class="student-card__avatar-wrapper team-avatar-wrapper">' +
            '<span style="font-size: 2.2rem; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">👥</span>' +
          '</div>';
        nameHtml = '<div class="podium-column__name">' + escapeHtml(teamName) + '</div>';
      } else {
        avatarHtml =
          '<div class="student-card__avatar-wrapper placeholder-avatar-wrapper">' +
            '<span class="placeholder-avatar-inner">❓</span>' +
          '</div>';
        nameHtml = '<div class="podium-column__name muted">선정 대기</div>';
      }
    } else {
      if (st) {
        avatarHtml = renderAvatarInnerHtml(st);
        nameHtml = '<div class="podium-column__name">' + escapeHtml(st.number) + '번 ' + escapeHtml(st.name) + '</div>';
      } else {
        avatarHtml =
          '<div class="student-card__avatar-wrapper placeholder-avatar-wrapper">' +
            '<span class="placeholder-avatar-inner">❓</span>' +
          '</div>';
        nameHtml = '<div class="podium-column__name muted">선정 대기</div>';
      }
    }

    var valDisplay = valueHtml || "";

    return (
      '<div class="podium-column podium-column--' + rankClass + '">' +
        '<div class="podium-column__avatar-section">' +
          avatarHtml +
          valDisplay +
        '</div>' +
        nameHtml +
        '<div class="podium-step podium-step--' + rankClass + '">' +
          '<span class="podium-step-symbol">' + symbolEmoji + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  function buildPodiumWrapper(categoryTitle, firstSt, secondSt, thirdSt, firstVal, secondVal, thirdVal, isGroupText) {
    var leftCol = buildPodiumColumn(secondSt, "2nd", secondVal, "2nd", "⭐", isGroupText);
    var centerCol = buildPodiumColumn(firstSt, "1st", firstVal, "1st", "👑", isGroupText);
    var rightCol = buildPodiumColumn(thirdSt, "3rd", thirdVal, "3rd", "🥉", isGroupText);

    return (
      '<div class="podium-category-card">' +
        '<h3 class="podium-category-title">' + categoryTitle + '</h3>' +
        '<div class="podium-container">' +
          leftCol +
          centerCol +
          rightCol +
        '</div>' +
      '</div>'
    );
  }

  function buildHallOfFameHtml(db, currentStudentId, options) {
    ensureHallOfFame(db);
    var students = db.students || [];

    var excludedIds = db.hallOfFame.excludedStudentIds || [];
    var studentsForRanking = students.filter(function (st) {
      return excludedIds.indexOf(st.id) === -1;
    });

    // Compute rankings
    // 1. Level Rank
    var sortedByLevel = students.slice().sort(function (a, b) {
      var alv = typeof a.lv === "number" && !isNaN(a.lv) ? a.lv : 1;
      var blv = typeof b.lv === "number" && !isNaN(b.lv) ? b.lv : 1;
      if (alv !== blv) return blv - alv;
      var aexp = typeof a.exp === "number" && !isNaN(a.exp) ? a.exp : 0;
      var bexp = typeof b.exp === "number" && !isNaN(b.exp) ? b.exp : 0;
      return bexp - aexp;
    });

    // 2. Wealth Rank
    var studentWealths = studentsForRanking.map(function (st) {
      ensureStudentStockPortfolio(st);
      var cash = typeof st.calory === "number" && !isNaN(st.calory) ? st.calory : 0;
      var stockVal = 0;
      var holdingCodes = Object.keys(st.stockPortfolio.holdings || {});
      for (var j = 0; j < holdingCodes.length; j++) {
        var hCode = holdingCodes[j];
        var holding = st.stockPortfolio.holdings[hCode];
        var curPriceKcal = 0;
        if (window.currentStockPrices && window.currentStockPrices[hCode] && typeof window.currentStockPrices[hCode].price === 'number' && window.currentStockPrices[hCode].price > 0) {
          curPriceKcal = window.currentStockPrices[hCode].price / 10000;
        }
        stockVal += (holding.amount || 0) * curPriceKcal;
      }
      return {
        student: st,
        wealth: cash + stockVal
      };
    });
    var sortedByWealth = studentWealths.sort(function (a, b) {
      return b.wealth - a.wealth;
    });

    // 3. Stock ROI Rank
    var studentROIs = studentsForRanking.map(function (st) {
      ensureStudentStockPortfolio(st);
      var totalEvaluation = 0;
      var totalPurchaseCost = 0;
      var holdingCodes = Object.keys(st.stockPortfolio.holdings || {});
      for (var j = 0; j < holdingCodes.length; j++) {
        var hCode = holdingCodes[j];
        var holding = st.stockPortfolio.holdings[hCode];
        var curPriceKcal = 0;
        if (window.currentStockPrices && window.currentStockPrices[hCode] && typeof window.currentStockPrices[hCode].price === 'number' && window.currentStockPrices[hCode].price > 0) {
          curPriceKcal = window.currentStockPrices[hCode].price / 10000;
        }
        totalEvaluation += (holding.amount || 0) * curPriceKcal;
        totalPurchaseCost += (holding.amount || 0) * (holding.avgPriceKcal || 0);
      }
      var roi = 0;
      var hasBought = totalPurchaseCost > 0;
      if (hasBought) {
        roi = ((totalEvaluation - totalPurchaseCost) / totalPurchaseCost) * 100;
      }
      return {
        student: st,
        roi: roi,
        hasBought: hasBought
      };
    }).filter(function (x) { return x.hasBought; });
    var sortedByROI = studentROIs.sort(function (a, b) {
      return b.roi - a.roi;
    });

    // 4. Coupon Purchases Rank
    var studentCoupons = studentsForRanking.map(function (st) {
      var rentals = (db.couponShop && db.couponShop.rentals) || [];
      var count = rentals.filter(function (r) { return r.studentId === st.id; }).length;
      return {
        student: st,
        count: count
      };
    });
    var sortedByCoupons = studentCoupons.sort(function (a, b) {
      return b.count - a.count;
    });

    // 5. Title Revenue Rank
    var studentTitles = studentsForRanking.map(function (st) {
      var titleRevenue = 0;
      var logs = db.activityLogs || [];
      for (var k = 0; k < logs.length; k++) {
        var log = logs[k];
        if (log.studentId === st.id && log.summary && log.summary.indexOf("칭호 판매 수익") >= 0) {
          titleRevenue += typeof log.caloryDelta === "number" && !isNaN(log.caloryDelta) ? log.caloryDelta : 0;
        }
      }
      return {
        student: st,
        revenue: titleRevenue
      };
    });
    var sortedByTitles = studentTitles.sort(function (a, b) {
      return b.revenue - a.revenue;
    });

    // Extract automatic podiums
    // Level
    var lv1 = sortedByLevel[0] || null, lv2 = sortedByLevel[1] || null, lv3 = sortedByLevel[2] || null;
    var lvVal1 = lv1 ? '<div class="podium-column__value">Lv. ' + lv1.lv + '</div>' : "";
    var lvVal2 = lv2 ? '<div class="podium-column__value">Lv. ' + lv2.lv + '</div>' : "";
    var lvVal3 = lv3 ? '<div class="podium-column__value">Lv. ' + lv3.lv + '</div>' : "";

    // Wealth
    var w1 = sortedByWealth[0] || null, w2 = sortedByWealth[1] || null, w3 = sortedByWealth[2] || null;
    var wVal1 = w1 ? '<div class="podium-column__value">' + formatNum(Math.round(w1.wealth)) + ' Cal</div>' : "";
    var wVal2 = w2 ? '<div class="podium-column__value">' + formatNum(Math.round(w2.wealth)) + ' Cal</div>' : "";
    var wVal3 = w3 ? '<div class="podium-column__value">' + formatNum(Math.round(w3.wealth)) + ' Cal</div>' : "";

    // Stock ROI
    var roi1 = sortedByROI[0] || null, roi2 = sortedByROI[1] || null, roi3 = sortedByROI[2] || null;
    function formatROIValue(roiItem) {
      if (!window.currentStockPrices) {
        return '<div class="podium-column__value" style="color:#94a3b8; font-weight:600;">준비중</div>';
      }
      if (!roiItem || typeof roiItem.roi !== 'number' || isNaN(roiItem.roi) || !isFinite(roiItem.roi)) {
        return '<div class="podium-column__value" style="color:#94a3b8; font-weight:600;">준비중</div>';
      }
      var roi = roiItem.roi;
      var color = roi > 0 ? '#ef4444' : roi < 0 ? '#3b82f6' : '#94a3b8';
      var sign = roi > 0 ? '+' : '';
      return '<div class="podium-column__value" style="color: ' + color + '; font-weight:600;">' + sign + roi.toFixed(2) + '%</div>';
    }
    var roiVal1 = roi1 ? formatROIValue(roi1) : "";
    var roiVal2 = roi2 ? formatROIValue(roi2) : "";
    var roiVal3 = roi3 ? formatROIValue(roi3) : "";

    // Coupon Purchase Count
    var cp1 = sortedByCoupons[0] || null, cp2 = sortedByCoupons[1] || null, cp3 = sortedByCoupons[2] || null;
    var cpVal1 = cp1 ? '<div class="podium-column__value">' + cp1.count + '개</div>' : "";
    var cpVal2 = cp2 ? '<div class="podium-column__value">' + cp2.count + '개</div>' : "";
    var cpVal3 = cp3 ? '<div class="podium-column__value">' + cp3.count + '개</div>' : "";

    // Title Revenue
    var tr1 = sortedByTitles[0] || null, tr2 = sortedByTitles[1] || null, tr3 = sortedByTitles[2] || null;
    var trVal1 = tr1 ? '<div class="podium-column__value">' + formatNum(tr1.revenue) + ' Cal</div>' : "";
    var trVal2 = tr2 ? '<div class="podium-column__value">' + formatNum(tr2.revenue) + ' Cal</div>' : "";
    var trVal3 = tr3 ? '<div class="podium-column__value">' + formatNum(tr3.revenue) + ' Cal</div>' : "";

    // Extract manual podiums (Teacher Weekly Awards)
    var note1 = getStudent(db, db.hallOfFame.bestNotes[0]), note2 = getStudent(db, db.hallOfFame.bestNotes[1]), note3 = getStudent(db, db.hallOfFame.bestNotes[2]);
    var noteVal1 = note1 ? '<div class="podium-column__value">📝 필기왕</div>' : "";
    var noteVal2 = note2 ? '<div class="podium-column__value">📝 필기왕</div>' : "";
    var noteVal3 = note3 ? '<div class="podium-column__value">📝 필기왕</div>' : "";

    var pres1 = getStudent(db, db.hallOfFame.bestPresenter[0]), pres2 = getStudent(db, db.hallOfFame.bestPresenter[1]), pres3 = getStudent(db, db.hallOfFame.bestPresenter[2]);
    var presVal1 = pres1 ? '<div class="podium-column__value">🎤 발표왕</div>' : "";
    var presVal2 = pres2 ? '<div class="podium-column__value">🎤 발표왕</div>' : "";
    var presVal3 = pres3 ? '<div class="podium-column__value">🎤 발표왕</div>' : "";

    var grp1 = db.hallOfFame.bestGroup[0] || "", grp2 = db.hallOfFame.bestGroup[1] || "", grp3 = db.hallOfFame.bestGroup[2] || "";
    var grpVal1 = grp1 ? '<div class="podium-column__value">👥 1위 모둠</div>' : "";
    var grpVal2 = grp2 ? '<div class="podium-column__value">👥 2위 모둠</div>' : "";
    var grpVal3 = grp3 ? '<div class="podium-column__value">👥 3위 모둠</div>' : "";

    var allContent =
      '<div class="podiums-grid">' +
        buildPodiumWrapper("📈 레벨 랭킹", lv1, lv2, lv3, lvVal1, lvVal2, lvVal3, false) +
        buildPodiumWrapper("💰 총 자산 랭킹 (Calory + 주식)", w1 ? w1.student : null, w2 ? w2.student : null, w3 ? w3.student : null, wVal1, wVal2, wVal3, false) +
        buildPodiumWrapper("📊 모의투자 수익률 랭킹", roi1 ? roi1.student : null, roi2 ? roi2.student : null, roi3 ? roi3.student : null, roiVal1, roiVal2, roiVal3, false) +
        buildPodiumWrapper("👑 칭호 제작 수익 랭킹", tr1 ? tr1.student : null, tr2 ? tr2.student : null, tr3 ? tr3.student : null, trVal1, trVal2, trVal3, false) +
        buildPodiumWrapper("📝 이 주의 필기왕", note1, note2, note3, noteVal1, noteVal2, noteVal3, false) +
        buildPodiumWrapper("🎤 이 주의 발표왕", pres1, pres2, pres3, presVal1, presVal2, presVal3, false) +
        buildPodiumWrapper("👥 이 주의 모둠", grp1, grp2, grp3, grpVal1, grpVal2, grpVal3, true) +
      '</div>';

    return (
      '<div class="hall-of-fame-container">' +
        '<div class="panel">' +
          '<h2 class="panel__title">👑 명예의 전당 (Hall of Fame)</h2>' +
          '<p class="panel__text muted">우리 반 각 분야별 우수 학생들의 명예로운 순위와 단상을 전시합니다! 🏆</p>' +
          '<div class="hall-of-fame-tab-content">' +
            allContent +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function viewStudentHallOfFame(session) {
    var db = getDb();
    var isPreview = session.role === "teacher" && session.preview;
    var main = buildHallOfFameHtml(db, session.studentId, { preview: isPreview });
    shell(
      renderStudentChrome("명예의 전당", main, {
        subNavLinks: getStudentSubNavLinks(db, session, "hall-of-fame"),
      })
    );
    bindLogout();
    bindHallOfFameTabs();
  }

  function viewTeacherHallOfFameSettings(session) {
    var db = getDb();
    if (!db) return;
    ensureHallOfFame(db);
    var students = studentsSortedByNumber(db);

    var buildExcludeStudentsCheckboxes = function (db) {
      var excludedIds = db.hallOfFame.excludedStudentIds || [];
      var html = "";
      for (var i = 0; i < students.length; i++) {
        var s = students[i];
        var isChecked = excludedIds.indexOf(s.id) !== -1 ? " checked" : "";
        html += '<div style="display: flex; align-items: center; margin-bottom: 0.5rem;">' +
                  '<input type="checkbox" name="exclude_student" value="' + escapeHtml(s.id) + '"' + isChecked + ' id="chk-ex-' + s.id + '" style="margin-right: 0.5rem; width: 16px; height: 16px; cursor: pointer;" />' +
                  '<label for="chk-ex-' + s.id + '" style="font-size: 0.9rem; cursor: pointer; color: #f3f4f6;">' + escapeHtml(s.number) + '번 ' + escapeHtml(s.name) + '</label>' +
                '</div>';
      }
      return html;
    };

    var buildStudentSelectHtml = function (name, currentValue) {
      var html = '<select name="' + name + '" class="form-control" style="width:100%; border-radius: 6px; padding: 0.5rem; background: var(--bg-body); color: #fff; border: 1px solid var(--border);">';
      html += '<option value="">-- 학생 선택 (선정 대기) --</option>';
      for (var i = 0; i < students.length; i++) {
        var s = students[i];
        var selected = s.id === currentValue ? " selected" : "";
        html += '<option value="' + escapeHtml(s.id) + '"' + selected + '>' + escapeHtml(s.number) + '번 ' + escapeHtml(s.name) + '</option>';
      }
      html += '</select>';
      return html;
    };

    var buildGroupInputHtml = function (name, currentValue) {
      return '<input type="text" name="' + name + '" class="form-control" value="' + escapeHtml(currentValue || "") + '" placeholder="예: 3모둠" style="width:100%; border-radius: 6px; padding: 0.5rem; background: var(--bg-body); color: #fff; border: 1px solid var(--border);" />';
    };

    var formHtml =
      '<div class="hall-of-fame-settings-container">' +
        '<div class="panel">' +
          '<h2 class="panel__title">👑 명예의 전당 주간 선정 설정</h2>' +
          '<p class="panel__text muted">매주 학급에서 두드러진 활약을 한 학생(필기왕, 발표왕)과 모둠을 선정하여 전시할 수 있습니다.</p>' +
          '<form id="form-hall-of-fame-settings" class="hall-of-fame-settings-form" style="margin-top: 1.5rem;">' +
            '<div class="hall-of-fame-settings-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem;">' +
              // 필기왕
              '<div class="settings-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 1.5rem; border-radius: 8px;">' +
                '<h3 class="settings-card-title" style="margin-top:0; font-size:1.15rem; color:#fbbf24; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-bottom: 1rem;">📝 이 주의 필기왕</h3>' +
                '<div class="form-group" style="margin-bottom: 1rem;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#fbbf24; font-weight:bold;">🥇 1위 (👑 Gold)</label>' +
                  buildStudentSelectHtml("bestNotes_0", db.hallOfFame.bestNotes[0]) +
                '</div>' +
                '<div class="form-group" style="margin-bottom: 1rem;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#9ca3af; font-weight:bold;">🥈 2위 (⭐ Silver)</label>' +
                  buildStudentSelectHtml("bestNotes_1", db.hallOfFame.bestNotes[1]) +
                '</div>' +
                '<div class="form-group" style="margin-bottom: 0;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#b45309; font-weight:bold;">🥉 3위 (🥉 Bronze)</label>' +
                  buildStudentSelectHtml("bestNotes_2", db.hallOfFame.bestNotes[2]) +
                '</div>' +
              '</div>' +
              // 발표왕
              '<div class="settings-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 1.5rem; border-radius: 8px;">' +
                '<h3 class="settings-card-title" style="margin-top:0; font-size:1.15rem; color:#fbbf24; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-bottom: 1rem;">🎤 이 주의 발표왕</h3>' +
                '<div class="form-group" style="margin-bottom: 1rem;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#fbbf24; font-weight:bold;">🥇 1위 (👑 Gold)</label>' +
                  buildStudentSelectHtml("bestPresenter_0", db.hallOfFame.bestPresenter[0]) +
                '</div>' +
                '<div class="form-group" style="margin-bottom: 1rem;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#9ca3af; font-weight:bold;">🥈 2위 (⭐ Silver)</label>' +
                  buildStudentSelectHtml("bestPresenter_1", db.hallOfFame.bestPresenter[1]) +
                '</div>' +
                '<div class="form-group" style="margin-bottom: 0;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#b45309; font-weight:bold;">🥉 3위 (🥉 Bronze)</label>' +
                  buildStudentSelectHtml("bestPresenter_2", db.hallOfFame.bestPresenter[2]) +
                '</div>' +
              '</div>' +
              // 이 주의 모둠
              '<div class="settings-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 1.5rem; border-radius: 8px;">' +
                '<h3 class="settings-card-title" style="margin-top:0; font-size:1.15rem; color:#fbbf24; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-bottom: 1rem;">👥 이 주의 모둠</h3>' +
                '<div class="form-group" style="margin-bottom: 1rem;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#fbbf24; font-weight:bold;">🥇 1위 (👑 Gold)</label>' +
                  buildGroupInputHtml("bestGroup_0", db.hallOfFame.bestGroup[0]) +
                '</div>' +
                '<div class="form-group" style="margin-bottom: 1rem;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#9ca3af; font-weight:bold;">🥈 2위 (⭐ Silver)</label>' +
                  buildGroupInputHtml("bestGroup_1", db.hallOfFame.bestGroup[1]) +
                '</div>' +
                '<div class="form-group" style="margin-bottom: 0;">' +
                  '<label class="field-label" style="display:block; font-size:0.85rem; margin-bottom:0.35rem; color:#b45309; font-weight:bold;">🥉 3위 (🥉 Bronze)</label>' +
                  buildGroupInputHtml("bestGroup_2", db.hallOfFame.bestGroup[2]) +
                '</div>' +
              '</div>' +
              // 실시간 통계 랭킹 제외 학생 설정
              '<div class="settings-card" style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 1.5rem; border-radius: 8px;">' +
                '<h3 class="settings-card-title" style="margin-top:0; font-size:1.15rem; color:#ef4444; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; margin-bottom: 1rem;">🚫 랭킹 제외 학생</h3>' +
                '<div style="max-height: 250px; overflow-y: auto; padding-right: 0.5rem;">' +
                  buildExcludeStudentsCheckboxes(db) +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div style="margin-top: 2rem; display: flex; gap: 1rem;">' +
              '<button type="submit" class="btn btn--primary" style="flex: 1; padding: 1rem; font-weight: bold; border-radius: 6px;">💾 설정 저장</button>' +
              '<a href="#/teacher" class="btn btn--ghost" style="padding: 1rem; text-align: center; text-decoration: none; border-radius: 6px; line-height: 1.2;">대시보드로 돌아가기</a>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</div>';

    shell(renderTeacherChrome("명예의 전당 설정", "halloffame", formHtml));
    bindLogout();
    bindHallOfFameSettingsSave(db);
  }

  function bindHallOfFameSettingsSave(db) {
    var form = document.getElementById("form-hall-of-fame-settings");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      db.hallOfFame.bestNotes = [
        form.elements["bestNotes_0"].value || null,
        form.elements["bestNotes_1"].value || null,
        form.elements["bestNotes_2"].value || null
      ];

      db.hallOfFame.bestPresenter = [
        form.elements["bestPresenter_0"].value || null,
        form.elements["bestPresenter_1"].value || null,
        form.elements["bestPresenter_2"].value || null
      ];

      db.hallOfFame.bestGroup = [
        form.elements["bestGroup_0"].value.trim(),
        form.elements["bestGroup_1"].value.trim(),
        form.elements["bestGroup_2"].value.trim()
      ];

      var excludeBoxes = form.querySelectorAll('input[name="exclude_student"]:checked');
      var excludedList = [];
      for (var i = 0; i < excludeBoxes.length; i++) {
        excludedList.push(excludeBoxes[i].value);
      }
      db.hallOfFame.excludedStudentIds = excludedList;

      saveDb(db);
      alert("명예의 전당 설정이 성공적으로 저장되었습니다!");
      window.location.hash = "#/teacher";
    });
  }

  function bindHallOfFameTabs() {
    var tabs = document.querySelectorAll(".hall-of-fame-tab-btn");
    var contents = document.querySelectorAll(".hall-of-fame-tab-content");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        var targetId = this.getAttribute("data-target");

        // Toggle active class on buttons
        for (var j = 0; j < tabs.length; j++) {
          tabs[j].classList.remove("active");
        }
        this.classList.add("active");

        // Toggle visibility on content sections
        for (var k = 0; k < contents.length; k++) {
          if (contents[k].id === targetId) {
            contents[k].classList.remove("hidden");
          } else {
            contents[k].classList.add("hidden");
          }
        }
      });
    }
  }

  function isServerCloudEnabled() {
    return window.ClassStatusServer && window.ClassStatusServer.isServerCloudEnabled();
  }

  function attemptServerLogin(loginId, pinOrPassword, errElId) {
    var errEl = document.getElementById(errElId);
    if (errEl) errEl.hidden = true;
    
    window.ClassStatusServer.login(loginId, pinOrPassword)
      .then(function (session) {
        var yearPromise = Promise.resolve();
        if (session.role === "teacher") {
          yearPromise = window.ClassStatusServer.getYearsList().then(function (data) {
            if (data.ok) {
              window.classYears = data.years || [];
              window.activeClassYear = data.activeYear || "";
              var savedYear = localStorage.getItem("currentClassYear");
              if (!savedYear || data.years.indexOf(savedYear) === -1) {
                if (data.activeYear) {
                  localStorage.setItem("currentClassYear", data.activeYear);
                } else if (data.years.length > 0) {
                  localStorage.setItem("currentClassYear", data.years[0]);
                }
              }
            }
          }).catch(function (e) {
            console.error("Failed to load years list on login:", e);
          });
        }

        return yearPromise.then(function () {
          return window.ClassStatusServer.syncStudentsFromRemote().then(function () {
            return C.ensureDb().then(function () {
              if (!window.__classStatusHashBound) {
                window.__classStatusHashBound = true;
                window.addEventListener("hashchange", route);
              }
              window.location.hash = session.role === "teacher" ? "#/teacher" : "#/student";
              route();
            });
          });
        });
      })
      .catch(function (err) {
        if (errEl) {
          errEl.textContent = err.message || "로그인에 실패했습니다.";
          errEl.hidden = false;
        }
      });
  }

  function renderDualLoginServer() {
    var root = document.getElementById("app");
    if (!root) return;
    document.body.classList.remove("app-body--digital-board");
    root.innerHTML =
      '<div class="login-screen login-screen--dual">' +
      '<section class="panel login-screen__panel">' +
      '<h1 class="panel__title">선생님 로그인 (서버)</h1>' +
      '<p class="panel__text muted">교사 아이디(<code>teacher</code>)와 설정된 비밀번호로 로그인합니다.</p>' +
      '<form id="form-server-teacher-login" class="stack">' +
      '<label class="field">아이디<input type="text" name="loginId" required autocomplete="username" /></label>' +
      '<label class="field">비밀번호<input type="password" name="password" required autocomplete="current-password" /></label>' +
      '<p id="login-server-teacher-err" class="field-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">로그인</button>' +
      '</form></section>' +
      '<section class="panel login-screen__panel">' +
      '<h1 class="panel__title">학생 로그인 (서버)</h1>' +
      '<p class="panel__text muted">이름(로그인 ID)과 숫자 4자리 비밀번호(PIN)로 로그인합니다.</p>' +
      '<form id="form-server-student-login" class="stack" autocomplete="off">' +
      '<label class="field">이름<input type="text" name="name" required autocomplete="name" /></label>' +
      '<label class="field">비밀번호 (4자리 숫자)<input type="password" name="pin" inputmode="numeric" maxlength="4" required autocomplete="off" autocapitalize="off" spellcheck="false" /></label>' +
      '<p id="login-server-student-err" class="field-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--accent">학생으로 로그인</button>' +
      '</form></section></div>';

    var ft = document.getElementById("form-server-teacher-login");
    var fs = document.getElementById("form-server-student-login");

    if (ft) {
      ft.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(ft);
        attemptServerLogin(String(fd.get("loginId") || "").trim(), String(fd.get("password") || ""), "login-server-teacher-err");
      });
    }
    if (fs) {
      fs.addEventListener("submit", function (e) {
        e.preventDefault();
        var fd = new FormData(fs);
        attemptServerLogin(String(fd.get("name") || "").trim(), String(fd.get("pin") || ""), "login-server-student-err");
      });
    }
  }

  function runServerCloudApp() {
    var s = C.getSession();
    if (s && s.userId) {
      var yearPromise = Promise.resolve();
      if (s.role === "teacher") {
        yearPromise = window.ClassStatusServer.getYearsList().then(function (data) {
          if (data.ok) {
            window.classYears = data.years || [];
            window.activeClassYear = data.activeYear || "";
            var savedYear = localStorage.getItem("currentClassYear");
            if (!savedYear || data.years.indexOf(savedYear) === -1) {
              if (data.activeYear) {
                localStorage.setItem("currentClassYear", data.activeYear);
              } else if (data.years.length > 0) {
                localStorage.setItem("currentClassYear", data.years[0]);
              }
            }
          }
        }).catch(function (e) {
          console.error("Failed to load years list:", e);
        });
      }

      yearPromise.then(function () {
        window.ClassStatusServer.syncStudentsFromRemote().then(function () {
          C.ensureDb().then(function () {
            if (!window.__classStatusHashBound) {
              window.__classStatusHashBound = true;
              window.addEventListener("hashchange", route);
            }
            if (!location.hash || location.hash === "#") {
              window.location.hash = s.role === "teacher" ? "#/teacher" : "#/student";
            }
            route();
          });
        });
      }).catch(function (err) {
        console.warn("Express 서버 데이터 로드 실패, 로그인 화면으로 강제 이동:", err);
        C.clearSession();
        renderDualLoginServer();
      });
    } else {
      C.clearSession();
      renderDualLoginServer();
    }
  }

  function init() {
    attachExternalDbSyncListeners();
    if (isServerCloudEnabled()) {
      runServerCloudApp();
      return;
    }
    if (isFirebaseCloudEnabled()) {
      if (typeof firebase === "undefined") {
        console.warn("Firebase SDK가 없습니다. 로컬 모드로 진행합니다.");
        runLocalOnlyApp();
        return;
      }
      var cfg = window.ClassStatusFirebaseConfig;
      try {
        if (!firebase.apps || firebase.apps.length === 0) {
          firebase.initializeApp(cfg);
        }
      } catch (err) {
        console.warn("Firebase 초기화 실패, 로컬 모드:", err);
        runLocalOnlyApp();
        return;
      }

      firebase.auth().onAuthStateChanged(function (user) {
        if (!user) {
          var skipDb = window.__classStatusSkipClearDbOnAuth;
          window.__classStatusSkipClearDbOnAuth = false;
          C.clearSession();
          if (!skipDb) {
            C.clearDbCache();
          }
          if (window.ClassStatusFirebase && typeof window.ClassStatusFirebase.resetSync === "function") {
            window.ClassStatusFirebase.resetSync();
          }
          renderDualLoginFirebase();
          return;
        }

        if (user.isAnonymous) {
          if (window.__classStatusFirebaseStudentLoginBusy) {
            return;
          }
          var s = C.getSession();
          var tuid = cfg && String(cfg.teacherFirestoreUid || "").trim();
          if (s && s.role === "student" && tuid) {
            window.ClassStatusFirebase.initForUser(tuid).then(function () {
              C.ensureDb().then(function () {
                if (!window.__classStatusHashBound) {
                  window.__classStatusHashBound = true;
                  window.addEventListener("hashchange", route);
                }
                if (!location.hash || location.hash === "#") {
                  window.location.hash = "#/student";
                }
                route();
              });
            }).catch(function (err) {
              console.warn("Firestore 연동 실패:", err);
              alert("학급 데이터를 불러오지 못했습니다.");
            });
            return;
          }
          renderDualLoginFirebase();
          return;
        }

        window.ClassStatusFirebase.initForUser(user.uid)
          .then(function () {
            ensureTeacherSessionFromFirebase();
            return C.ensureDb();
          })
          .then(function () {
            if (!window.__classStatusHashBound) {
              window.__classStatusHashBound = true;
              window.addEventListener("hashchange", route);
            }
            if (!location.hash || location.hash === "#") {
              window.location.hash = "#/teacher";
            }
            route();
          })
          .catch(function (err) {
            console.warn("Firestore 연동 실패:", err);
            alert("클라우드 데이터를 불러오지 못했습니다. 콘솔을 확인해 주세요.");
          });
      });
      return;
    }

    runLocalOnlyApp();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
