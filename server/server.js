const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// === Active Year State Management ===
let globalActiveYear = null;

async function loadActiveYear() {
  try {
    const defaultPool = db.getPool(db.defaultDbName);
    // Ensure settings table exists (in case base db is completely empty)
    await defaultPool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(100) PRIMARY KEY,
        \`value\` JSON NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    
    const [rows] = await defaultPool.query("SELECT `value` FROM settings WHERE `key` = 'activeYear'");
    if (rows.length > 0) {
      let val = rows[0].value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) {}
      }
      globalActiveYear = val;
      console.log(`[Startup] Loaded globally active year: ${globalActiveYear}`);
    } else {
      console.log(`[Startup] No globally active year set. Defaulting to base database.`);
    }
  } catch (err) {
    console.error(`[Startup] Failed to load active year:`, err);
  }
}
loadActiveYear();

// === Schema Migration Safety Check ===
async function checkAndMigrateSchema() {
  try {
    const [columns] = await db.query("SHOW COLUMNS FROM students LIKE 'stock_portfolio'");
    if (columns.length === 0) {
      console.log('[Schema Migration] students 테이블에 stock_portfolio 컬럼이 없습니다. 동적 추가를 시작합니다.');
      await db.query("ALTER TABLE students ADD COLUMN stock_portfolio MEDIUMTEXT DEFAULT NULL");
      console.log('[Schema Migration] students 테이블에 stock_portfolio 컬럼이 성공적으로 추가되었습니다!');
    }
  } catch (err) {
    console.error('[Schema Migration] 스키마 동적 검증 및 추가 중 에러 발생:', err);
  }
}
checkAndMigrateSchema();

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow larger payloads for avatars

// DB Year selection middleware
app.use((req, res, next) => {
  const classYear = req.headers['x-class-year'];
  let dbName = db.defaultDbName;
  if (classYear && /^\d{4}$/.test(classYear)) {
    dbName = `class_tool_${classYear}`;
  } else if (globalActiveYear && /^\d{4}$/.test(globalActiveYear)) {
    dbName = `class_tool_${globalActiveYear}`;
  }
  
  db.asyncLocalStorage.run({ dbName }, () => {
    next();
  });
});

// SHA-256 hash matching the browser client core.js hash implementation
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + '|' + password).digest('hex');
}

// === KIS Stock API Integration & Caching ===
let kisToken = null;
let kisTokenExpires = 0; // Timestamp when token expires
let cachedStockPrices = {}; // { [code]: { code, price, name, updatedAt } }
let isFetchingPrices = false;

// Helper to wait/sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getKISAccessToken() {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const isMock = process.env.KIS_IS_MOCK !== 'false';

  if (!appKey || !appSecret) {
    throw new Error('KIS Credentials (KIS_APP_KEY, KIS_APP_SECRET) are not configured in environment.');
  }

  // Use cached token if valid (expires in 24 hours, safety margin 1 hour)
  const now = Date.now();
  if (kisToken && kisTokenExpires > now + 3600000) {
    return kisToken;
  }

  const baseUrl = isMock
    ? 'https://openapivts.koreainvestment.com:29443'
    : 'https://openapi.koreainvestment.com:9443';

  console.log('[KIS API] Requesting new Access Token...');
  const res = await fetch(`${baseUrl}/oauth2/tokenP`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`KIS Token fetch failed with status ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`KIS Token response did not contain access_token: ${JSON.stringify(data)}`);
  }

  kisToken = data.access_token;
  
  // Parse expiration (Format: "2026-05-23 12:00:00") or default to +23 hours
  let expiresAt = now + 23 * 60 * 60 * 1000;
  if (data.access_token_token_expired) {
    const parsed = new Date(data.access_token_token_expired.replace(' ', 'T'));
    if (!isNaN(parsed.getTime())) {
      expiresAt = parsed.getTime();
    }
  }
  kisTokenExpires = expiresAt;
  console.log('[KIS API] Successfully retrieved and cached new Access Token.');
  return kisToken;
}

async function fetchStockPricesFromKIS() {
  if (isFetchingPrices) {
    console.log('[KIS API] Fetch already in progress. Skipping.');
    return;
  }
  isFetchingPrices = true;

  try {
    const appKey = process.env.KIS_APP_KEY;
    const appSecret = process.env.KIS_APP_SECRET;
    const isMock = process.env.KIS_IS_MOCK !== 'false';

    if (!appKey || !appSecret) {
      console.warn('[KIS API] KIS Credentials not configured. Skipping price fetch.');
      isFetchingPrices = false;
      return;
    }

    // 1. Get all year databases matching class_tool_% plus the default class_tool
    const [rows] = await db.getPool(db.defaultDbName).query('SHOW DATABASES');
    const databases = rows
      .map(r => r.Database || r.database)
      .filter(name => name === db.defaultDbName || name.startsWith('class_tool_'));

    // 2. Collect all active stock codes from all databases
    const allStockCodes = new Set();
    const stockCodeToName = {};

    for (const dbName of databases) {
      try {
        const pool = db.getPool(dbName);
        const [settings] = await pool.query('SELECT `value` FROM settings WHERE `key` = ?', ['stockMarket']);
        if (settings.length > 0) {
          let stockMarket = settings[0].value;
          if (typeof stockMarket === 'string') {
            try { stockMarket = JSON.parse(stockMarket); } catch (e) {}
          }
          if (stockMarket && stockMarket.enabled && Array.isArray(stockMarket.stocks)) {
            for (const stock of stockMarket.stocks) {
              if (stock.code) {
                allStockCodes.add(stock.code);
                stockCodeToName[stock.code] = stock.name || '';
              }
            }
          }
        }
      } catch (err) {
        console.error(`[KIS API] Failed to fetch stock market settings from database ${dbName}:`, err);
      }
    }

    if (allStockCodes.size === 0) {
      console.log('[KIS API] No active stocks configured in any database.');
      isFetchingPrices = false;
      return;
    }

    const token = await getKISAccessToken();
    const baseUrl = isMock
      ? 'https://openapivts.koreainvestment.com:29443'
      : 'https://openapi.koreainvestment.com:9443';

    console.log(`[KIS API] Fetching prices for ${allStockCodes.size} stocks sequentially (Mock env: ${isMock})...`);

    const codes = Array.from(allStockCodes);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const stockName = stockCodeToName[code];

      const url = `${baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`;
      const headers = {
        'content-type': 'application/json; charset=utf-8',
        'authorization': `Bearer ${token}`,
        'appkey': appKey,
        'appsecret': appSecret,
        'tr_id': 'FHKST01010100',
        'custtype': 'P'
      };

      try {
        let response = null;
        let retries = 2;
        let lastError = '';

        while (retries >= 0) {
          try {
            response = await fetch(url, { method: 'GET', headers });
            if (response && response.ok) {
              break;
            }
            lastError = response ? `HTTP ${response.status}` : 'Unknown error';
          } catch (e) {
            lastError = e.toString();
          }

          if (retries > 0) {
            await sleep(1500);
          }
          retries--;
        }

        if (!response || !response.ok) {
          console.error(`[KIS API] Price fetch failed for stock ${code} (${stockName}): ${lastError}`);
          continue;
        }

        const resJson = await response.json();
        if (resJson && resJson.output) {
          const priceVal = parseInt(resJson.output.stck_prpr, 10);
          const sdprVal = parseInt(resJson.output.stck_sdpr, 10);
          if (!isNaN(priceVal)) {
            cachedStockPrices[code] = {
              code: code,
              price: priceVal,
              stck_sdpr: !isNaN(sdprVal) ? sdprVal : priceVal,
              name: resJson.output.hts_kor_shr_nme || stockName || '',
              updatedAt: Date.now()
            };
            console.log(`[KIS API] Updated stock ${code} (${stockName}): ${priceVal} KRW, SDPR: ${!isNaN(sdprVal) ? sdprVal : priceVal} KRW`);
          } else {
            console.warn(`[KIS API] Unexpected price format for stock ${code}: ${JSON.stringify(resJson.output)}`);
          }
        } else {
          console.warn(`[KIS API] Price fetch response output missing for stock ${code}: ${JSON.stringify(resJson)}`);
        }
      } catch (err) {
        console.error(`[KIS API] Error fetching stock ${code}:`, err);
      }

      // If in Mock mode, strictly sleep 1.2s to comply with the 2 requests/sec limit
      if (isMock && i < codes.length - 1) {
        await sleep(1200);
      }
    }
    console.log('[KIS API] Completed fetching all stock prices.');
  } catch (error) {
    console.error('[KIS API] Error in fetchStockPricesFromKIS:', error);
  } finally {
    isFetchingPrices = false;
  }
}

// Background scheduler
// Run 5 seconds after startup
setTimeout(() => {
  console.log('[Scheduler] Initial background stock price fetch triggered.');
  fetchStockPricesFromKIS();
}, 5000);

// Run every 5 minutes (300,000 ms)
setInterval(() => {
  console.log('[Scheduler] Recurring background stock price fetch triggered.');
  fetchStockPricesFromKIS();
}, 300000);


// PIN normalization helper (ensures 4 digits)
function normalizePinDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d.length) return '0000';
  if (d.length >= 4) return d.slice(-4);
  while (d.length < 4) d = '0' + d;
  return d.slice(-4);
}

// 1. User Authentication (POST /api/auth/login)
app.post('/api/auth/login', async (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId || password === undefined) {
    return res.status(400).json({ ok: false, msg: '로그인 ID와 비밀번호를 입력해 주세요.' });
  }

  try {
    const [users] = await db.query('SELECT * FROM users WHERE login_id = ?', [loginId.trim()]);
    if (users.length === 0) {
      return res.status(401).json({ ok: false, msg: '아이디 혹은 비밀번호가 틀렸습니다.' });
    }

    const user = users[0];
    let isMatched = false;

    if (user.role === 'student') {
      const pin = normalizePinDigits(password);
      if (user.pin_code && /^\d{4}$/.test(user.pin_code)) {
        isMatched = (user.pin_code === pin);
      } else {
        const computedHash = hashPassword(pin, user.salt);
        isMatched = (computedHash === user.password_hash);
      }
    } else {
      // teacher/admin
      const computedHash = hashPassword(password, user.salt);
      isMatched = (computedHash === user.password_hash);
    }

    if (!isMatched) {
      return res.status(401).json({ ok: false, msg: '아이디 혹은 비밀번호가 틀렸습니다.' });
    }

    return res.json({
      ok: true,
      session: {
        userId: user.id,
        role: user.role,
        studentId: user.student_id,
        displayName: user.display_name,
        pinMustChange: user.pin_must_change === 1
      }
    });

  } catch (error) {
    console.error('로그인 에러:', error);
    return res.status(500).json({ ok: false, msg: '서버 오류가 발생했습니다.' });
  }
});

// 2. Fetch Students Directory (GET /api/students)
app.get('/api/students', async (req, res) => {
  try {
    // Fetch titleGrants from settings table
    const [settings] = await db.query('SELECT `value` FROM settings WHERE `key` = ?', ['titleGrants']);
    const titleGrants = settings.length > 0 ? settings[0].value : [];

    const [students] = await db.query('SELECT * FROM students ORDER BY number ASC');

    const mappedStudents = students.map(st => {
      const myTitles = Array.isArray(titleGrants)
        ? titleGrants.filter(t => t.studentId === st.id).map(t => t.titleText)
        : [];
      return {
        id: st.id,
        name: st.name,
        number: st.number,
        gender: st.gender,
        lv: st.lv,
        exp: st.exp,
        calory: st.calory,
        coupons: st.coupons,
        classRole: st.class_role,
        jobId: st.job_id,
        avatarDataUrl: st.avatar_data_url,
        avatarCustom: st.avatar_custom,
        titles: myTitles
      };
    });

    return res.json({ ok: true, students: mappedStudents });
  } catch (error) {
    console.error('학생 조회 에러:', error);
    return res.status(500).json({ ok: false, msg: '서버 오류가 발생했습니다.' });
  }
});

// 3. Avatar Upload/Update (POST /api/students/:id/avatar)
app.post('/api/students/:id/avatar', async (req, res) => {
  const { id } = req.params;
  const { avatarDataUrl, avatarCustom } = req.body;

  if (avatarDataUrl === undefined && avatarCustom === undefined) {
    return res.status(400).json({ ok: false, msg: '아바타 데이터를 입력해 주세요.' });
  }

  try {
    const [students] = await db.query('SELECT id FROM students WHERE id = ?', [id]);
    if (students.length === 0) {
      return res.status(404).json({ ok: false, msg: '학생을 찾을 수 없습니다.' });
    }

    if (avatarDataUrl !== undefined && avatarCustom !== undefined) {
      await db.query(
        'UPDATE students SET avatar_data_url = ?, avatar_custom = ? WHERE id = ?',
        [avatarDataUrl, avatarCustom, id]
      );
    } else if (avatarDataUrl !== undefined) {
      await db.query('UPDATE students SET avatar_data_url = ? WHERE id = ?', [avatarDataUrl, id]);
    } else if (avatarCustom !== undefined) {
      await db.query('UPDATE students SET avatar_custom = ? WHERE id = ?', [avatarCustom, id]);
    }

    return res.json({ ok: true, msg: '아바타가 성공적으로 저장되었습니다.' });
  } catch (error) {
    console.error('아바타 업로드 에러:', error);
    return res.status(500).json({ ok: false, msg: '서버 오류가 발생했습니다.' });
  }
});

// 4. Bidirectional Sync APIs
// GET /api/sync - Retrieve reconstructed JSON database state from MySQL
app.get('/api/sync', async (req, res) => {
  try {
    const [students] = await db.query('SELECT * FROM students ORDER BY number ASC');
    const [users] = await db.query('SELECT * FROM users');
    const [coupons] = await db.query('SELECT * FROM coupons');
    const [rentals] = await db.query('SELECT * FROM rentals');
    const [canteenProducts] = await db.query('SELECT * FROM canteen_products');
    const [couponMerchantLogs] = await db.query('SELECT * FROM coupon_merchant_logs');
    const [canteenMerchantLogs] = await db.query('SELECT * FROM canteen_merchant_logs');
    const [activityLogs] = await db.query('SELECT * FROM activity_logs');
    const [bulkAdjustments] = await db.query('SELECT * FROM bulk_adjustments');
    const [settings] = await db.query('SELECT `key`, `value` FROM settings');

    const studentsList = students.map(st => ({
      id: st.id,
      name: st.name,
      number: st.number,
      gender: st.gender,
      lv: st.lv,
      exp: st.exp,
      calory: st.calory,
      coupons: st.coupons,
      classRole: st.class_role,
      jobId: st.job_id,
      avatarDataUrl: st.avatar_data_url,
      avatarCustom: st.avatar_custom,
      stockPortfolio: (() => {
        if (!st.stock_portfolio) return {};
        try {
          return typeof st.stock_portfolio === 'string' ? JSON.parse(st.stock_portfolio) : st.stock_portfolio;
        } catch (e) {
          console.error(`stock_portfolio parsing error for student ${st.id}:`, e);
          return {};
        }
      })()
    }));

    const usersList = users.map(u => ({
      id: u.id,
      loginId: u.login_id,
      passwordHash: u.password_hash,
      salt: u.salt,
      role: u.role,
      displayName: u.display_name,
      pinCode: u.pin_code,
      pinMustChange: u.pin_must_change === 1,
      studentId: u.student_id
    }));

    const couponsList = coupons.map(p => ({
      id: p.id,
      name: p.name,
      priceCal: p.price_cal,
      totalStock: p.total_stock,
      remainingStock: p.remaining_stock,
      desc: p.desc,
      isGroup: p.is_group === 1,
      groupTargetCount: p.group_target_count,
      merchantStudentId: p.merchant_student_id
    }));

    const rentalsList = rentals.map(r => ({
      id: r.id,
      productId: r.product_id,
      couponName: r.coupon_name,
      studentId: r.student_id,
      studentName: r.student_name,
      status: r.status,
      rentedAt: Number(r.rented_at),
      useRequestedAt: r.use_requested_at ? Number(r.use_requested_at) : null,
      merchantApprovedAt: r.merchant_approved_at ? Number(r.merchant_approved_at) : null,
      resolvedAt: r.resolved_at ? Number(r.resolved_at) : null
    }));

    const canteenProductsList = canteenProducts.map(p => ({
      id: p.id,
      name: p.name,
      priceCal: p.price_cal,
      totalStock: p.total_stock,
      remainingStock: p.remaining_stock,
      desc: p.desc,
      merchantStudentId: p.merchant_student_id
    }));

    const couponMerchantLogsList = couponMerchantLogs.map(log => ({
      id: log.id,
      occurredAt: Number(log.occurred_at),
      dateYmd: log.date_ymd,
      productId: log.product_id,
      couponName: log.coupon_name,
      buyerStudentId: log.buyer_student_id,
      priceCal: log.price_cal,
      merchantStudentId: log.merchant_student_id,
      rentalId: log.rental_id
    }));

    const canteenMerchantLogsList = canteenMerchantLogs.map(log => ({
      id: log.id,
      occurredAt: Number(log.occurred_at),
      dateYmd: log.date_ymd,
      productId: log.product_id,
      productName: log.product_name,
      buyerStudentId: log.buyer_student_id,
      priceCal: log.price_cal,
      merchantStudentId: log.merchant_student_id,
      status: log.status
    }));

    const activityLogsList = activityLogs.map(log => ({
      id: log.id,
      studentId: log.student_id,
      occurredAt: Number(log.occurred_at),
      summary: log.summary,
      expDelta: log.exp_delta,
      caloryDelta: log.calory_delta,
      bulkJobId: log.bulk_job_id
    }));

    const bulkAdjustmentsList = bulkAdjustments.map(adj => ({
      id: adj.id,
      occurredAt: Number(adj.occurred_at),
      type: adj.type,
      targetCount: adj.target_count,
      summary: adj.summary,
      expDelta: adj.exp_delta,
      caloryDelta: adj.calory_delta
    }));

    const settingsMap = {};
    for (const s of settings) {
      let val = s.value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) {}
      }
      settingsMap[s.key] = val;
    }

    const dbData = {
      students: studentsList,
      users: usersList,
      activityLogs: activityLogsList,
      bulkAdjustments: bulkAdjustmentsList,
    };

    const settingsKeys = [
      'version', 'titleGrants', 'behaviorNotes', 'classJobQuotas',
      'bankPayrollRequests', 'taxCollectionRequests', 'djRequests',
      'recyclerLogs', 'envLogs', 'hallOfFame', 'cleaningChecklistRequests',
      'digitalBoard', 'statisticsChecklist', 'statisticsApprovalRequests',
      'postmanErrandRequests', 'lastDailyExpGrowthBoardKey',
      'classTaxTotalManual', 'classTaxTotalManualConfirmed', 'stockMarket'
    ];

    for (const key of settingsKeys) {
      dbData[key] = settingsMap[key] !== undefined ? settingsMap[key] : (key === 'version' ? 1 : (key === 'classJobQuotas' || key === 'stockMarket' ? {} : []));
    }

    if (dbData.hallOfFame === undefined || dbData.hallOfFame === null) {
      dbData.hallOfFame = {
        bestNotes: [null, null, null],
        bestGroup: ["", "", ""],
        bestPresenter: [null, null, null]
      };
    }

    const couponShopMeta = settingsMap['coupon_shop_meta'] || {};
    dbData.couponShop = {
      products: couponsList,
      rentals: rentalsList,
      merchantLog: couponMerchantLogsList,
      pendingOffers: couponShopMeta.pendingOffers || [],
      holdings: couponShopMeta.holdings || {},
      treasuryTotal: couponShopMeta.treasuryTotal || 0
    };

    const canteenShopMeta = settingsMap['canteen_shop_meta'] || {};
    dbData.canteenShop = {
      products: canteenProductsList,
      merchantLog: canteenMerchantLogsList,
      pendingOffers: canteenShopMeta.pendingOffers || [],
      holdings: canteenShopMeta.holdings || {},
      treasuryTotal: canteenShopMeta.treasuryTotal || 0,
      orders: canteenShopMeta.orders || []
    };

    dbData.titleShop = settingsMap['title_shop_meta'] || null;

    return res.json({ ok: true, db: dbData });
  } catch (error) {
    console.error('동기화 로드 에러:', error);
    return res.status(500).json({ ok: false, msg: '서버 데이터를 가져오는 중 오류가 발생했습니다.' });
  }
});

// POST /api/sync - Atomically overwrite MySQL tables with incoming client JSON database state
app.post('/api/sync', async (req, res) => {
  const dbData = req.body;
  if (!dbData || typeof dbData !== 'object') {
    return res.status(400).json({ ok: false, msg: '데이터 형식이 올바르지 않습니다.' });
  }

  const sessionRole = req.headers['x-session-role'] || 'unknown';
  const sessionStudentId = req.headers['x-session-student-id'] || null;
  const isTeacher = sessionRole === 'teacher';

  const mergeArraysById = (existingArr, incomingArr) => {
    const arr1 = Array.isArray(existingArr) ? existingArr : [];
    const arr2 = Array.isArray(incomingArr) ? incomingArr : [];
    const map = new Map();
    arr1.forEach(item => { if (item && item.id) map.set(item.id, item); });
    arr2.forEach(item => { if (item && item.id) map.set(item.id, item); });
    return Array.from(map.values());
  };

  const mergeHoldings = (existingHoldings, incomingHoldings) => {
    const h1 = (existingHoldings && typeof existingHoldings === 'object') ? existingHoldings : {};
    const h2 = (incomingHoldings && typeof incomingHoldings === 'object') ? incomingHoldings : {};
    return { ...h1, ...h2 };
  };

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Disable foreign key checks during reconstruction
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    // 1. Fetch current data for merging
    const [dbStudents] = await conn.query('SELECT * FROM students');
    const dbStudentsMap = new Map(dbStudents.map(s => [s.id, s]));

    const [dbUsers] = await conn.query('SELECT * FROM users');
    const dbUsersMap = new Map(dbUsers.map(u => [u.id, u]));

    // 2. Sync Students
    if (isTeacher) {
      const incomingIds = new Set();
      if (Array.isArray(dbData.students)) {
        for (const st of dbData.students) {
          incomingIds.add(st.id);
          const dbSt = dbStudentsMap.get(st.id);
          // Keep database stock_portfolio for existing students to prevent teacher cache overwrite
          const stockPortfolioToSave = dbSt ? dbSt.stock_portfolio : (st.stockPortfolio ? JSON.stringify(st.stockPortfolio) : null);
          
          await conn.query(
            `INSERT INTO students (id, name, number, gender, lv, exp, calory, coupons, class_role, job_id, avatar_data_url, avatar_custom, stock_portfolio)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               name = VALUES(name),
               number = VALUES(number),
               gender = VALUES(gender),
               lv = VALUES(lv),
               exp = VALUES(exp),
               calory = VALUES(calory),
               coupons = VALUES(coupons),
               class_role = VALUES(class_role),
               job_id = VALUES(job_id),
               avatar_data_url = VALUES(avatar_data_url),
               avatar_custom = VALUES(avatar_custom),
               stock_portfolio = VALUES(stock_portfolio)`,
            [
              st.id,
              st.name,
              parseInt(st.number, 10) || 0,
              st.gender || 'female',
              parseInt(st.lv, 10) || 1,
              parseInt(st.exp, 10) || 0,
              parseInt(st.calory, 10) || 0,
              parseInt(st.coupons, 10) || 0,
              st.classRole || '',
              st.jobId || '',
              st.avatarDataUrl || null,
              st.avatarCustom || null,
              stockPortfolioToSave
            ]
          );
        }
      }
      // Delete students not in incoming payload
      for (const dbSt of dbStudents) {
        if (!incomingIds.has(dbSt.id)) {
          await conn.query('DELETE FROM students WHERE id = ?', [dbSt.id]);
        }
      }
    } else if (sessionStudentId) {
      // Student sync - only update their own student row
      if (Array.isArray(dbData.students)) {
        const mySt = dbData.students.find(st => st.id === sessionStudentId);
        if (mySt) {
          await conn.query(
            `INSERT INTO students (id, name, number, gender, lv, exp, calory, coupons, class_role, job_id, avatar_data_url, avatar_custom, stock_portfolio)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               name = VALUES(name),
               number = VALUES(number),
               gender = VALUES(gender),
               lv = VALUES(lv),
               exp = VALUES(exp),
               calory = VALUES(calory),
               coupons = VALUES(coupons),
               class_role = VALUES(class_role),
               job_id = VALUES(job_id),
               avatar_data_url = VALUES(avatar_data_url),
               avatar_custom = VALUES(avatar_custom),
               stock_portfolio = VALUES(stock_portfolio)`,
            [
              mySt.id,
              mySt.name,
              parseInt(mySt.number, 10) || 0,
              mySt.gender || 'female',
              parseInt(mySt.lv, 10) || 1,
              parseInt(mySt.exp, 10) || 0,
              parseInt(mySt.calory, 10) || 0,
              parseInt(mySt.coupons, 10) || 0,
              mySt.classRole || '',
              mySt.jobId || '',
              mySt.avatarDataUrl || null,
              mySt.avatarCustom || null,
              mySt.stockPortfolio ? JSON.stringify(mySt.stockPortfolio) : null
            ]
          );
        }
      }
    }

    // 3. Sync Users
    if (isTeacher) {
      const incomingUserIds = new Set();
      if (Array.isArray(dbData.users)) {
        const studentIds = new Set(Array.isArray(dbData.students) ? dbData.students.map(st => st.id) : []);
        for (const u of dbData.users) {
          incomingUserIds.add(u.id);
          const studentIdToInsert = studentIds.has(u.studentId) ? u.studentId : null;
          await conn.query(
            `INSERT INTO users (id, login_id, password_hash, salt, role, display_name, pin_code, pin_must_change, student_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               login_id = VALUES(login_id),
               password_hash = VALUES(password_hash),
               salt = VALUES(salt),
               role = VALUES(role),
               display_name = VALUES(display_name),
               pin_code = VALUES(pin_code),
               pin_must_change = VALUES(pin_must_change),
               student_id = VALUES(student_id)`,
            [
              u.id,
              u.loginId,
              u.passwordHash || '',
              u.salt || '',
              u.role || 'student',
              u.displayName || '',
              u.pinCode || null,
              u.pinMustChange === false ? 0 : 1,
              studentIdToInsert
            ]
          );
        }
      }
      // Delete users not in incoming list
      for (const dbU of dbUsers) {
        if (!incomingUserIds.has(dbU.id)) {
          await conn.query('DELETE FROM users WHERE id = ?', [dbU.id]);
        }
      }
    } else if (sessionStudentId) {
      // Student - only update their own user row
      if (Array.isArray(dbData.users)) {
        const myU = dbData.users.find(u => u.studentId === sessionStudentId);
        if (myU) {
          await conn.query(
            `INSERT INTO users (id, login_id, password_hash, salt, role, display_name, pin_code, pin_must_change, student_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               password_hash = VALUES(password_hash),
               salt = VALUES(salt),
               pin_code = VALUES(pin_code),
               pin_must_change = VALUES(pin_must_change)`,
            [
              myU.id,
              myU.loginId,
              myU.passwordHash || '',
              myU.salt || '',
              myU.role || 'student',
              myU.displayName || '',
              myU.pinCode || null,
              myU.pinMustChange === false ? 0 : 1,
              sessionStudentId
            ]
          );
        }
      }
    }

    // 4. Coupons
    if (dbData.couponShop && Array.isArray(dbData.couponShop.products)) {
      const incomingCouponIds = new Set(dbData.couponShop.products.map(p => p.id));
      for (const p of dbData.couponShop.products) {
        await conn.query(
          `INSERT INTO coupons (id, name, price_cal, total_stock, remaining_stock, \`desc\`, is_group, group_target_count, merchant_student_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             price_cal = VALUES(price_cal),
             total_stock = VALUES(total_stock),
             remaining_stock = VALUES(remaining_stock),
             \`desc\` = VALUES(\`desc\`),
             is_group = VALUES(is_group),
             group_target_count = VALUES(group_target_count),
             merchant_student_id = VALUES(merchant_student_id)`,
          [
            p.id,
            p.name,
            parseInt(p.priceCal, 10) || 0,
            parseInt(p.totalStock, 10) || 0,
            parseInt(p.remainingStock, 10) || 0,
            p.desc || null,
            p.isGroup ? 1 : 0,
            p.groupTargetCount || null,
            p.merchantStudentId || null
          ]
        );
      }
      if (isTeacher) {
        const [dbCoupons] = await conn.query('SELECT id FROM coupons');
        for (const c of dbCoupons) {
          if (!incomingCouponIds.has(c.id)) {
            await conn.query('DELETE FROM coupons WHERE id = ?', [c.id]);
          }
        }
      }
    }

    // 5. Canteen Products
    if (dbData.canteenShop && Array.isArray(dbData.canteenShop.products)) {
      const incomingProdIds = new Set(dbData.canteenShop.products.map(p => p.id));
      for (const p of dbData.canteenShop.products) {
        await conn.query(
          `INSERT INTO canteen_products (id, name, price_cal, total_stock, remaining_stock, \`desc\`, merchant_student_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             price_cal = VALUES(price_cal),
             total_stock = VALUES(total_stock),
             remaining_stock = VALUES(remaining_stock),
             \`desc\` = VALUES(\`desc\`),
             merchant_student_id = VALUES(merchant_student_id)`,
          [
            p.id,
            p.name,
            parseInt(p.priceCal, 10) || 0,
            parseInt(p.totalStock, 10) || 0,
            parseInt(p.remainingStock, 10) || 0,
            p.desc || null,
            p.merchantStudentId || null
          ]
        );
      }
      if (isTeacher) {
        const [dbProds] = await conn.query('SELECT id FROM canteen_products');
        for (const p of dbProds) {
          if (!incomingProdIds.has(p.id)) {
            await conn.query('DELETE FROM canteen_products WHERE id = ?', [p.id]);
          }
        }
      }
    }

    // 6. Rentals
    if (dbData.couponShop && Array.isArray(dbData.couponShop.rentals)) {
      const [dbRentals] = await conn.query('SELECT id FROM rentals');
      const dbRentalIds = new Set(dbRentals.map(r => r.id));
      const incomingRentalIds = new Set(dbData.couponShop.rentals.map(r => r.id));

      for (const r of dbData.couponShop.rentals) {
        await conn.query(
          `INSERT INTO rentals (id, product_id, coupon_name, student_id, student_name, status, rented_at, use_requested_at, merchant_approved_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             status = VALUES(status),
             use_requested_at = VALUES(use_requested_at),
             merchant_approved_at = VALUES(merchant_approved_at),
             resolved_at = VALUES(resolved_at)`,
          [
            r.id,
            r.productId || null,
            r.couponName || '',
            r.studentId,
            r.studentName || '',
            r.status || 'held',
            r.rentedAt || Date.now(),
            r.useRequestedAt || null,
            r.merchantApprovedAt || null,
            r.resolvedAt || null
          ]
        );
      }
      if (isTeacher) {
        for (const id of dbRentalIds) {
          if (!incomingRentalIds.has(id)) {
            await conn.query('DELETE FROM rentals WHERE id = ?', [id]);
          }
        }
      }
    }

    // Helper to insert new logs only
    const mergeLogs = async (tableName, logsArray, insertQuery, mapRowToValues) => {
      if (!Array.isArray(logsArray) || logsArray.length === 0) return;
      const [existing] = await conn.query(`SELECT id FROM ${tableName}`);
      const existingIds = new Set(existing.map(e => e.id));
      for (const log of logsArray) {
        if (!existingIds.has(log.id)) {
          const values = mapRowToValues(log);
          await conn.query(insertQuery, values);
        }
      }
    };

    // 7. coupon_merchant_logs
    if (dbData.couponShop && Array.isArray(dbData.couponShop.merchantLog)) {
      await mergeLogs(
        'coupon_merchant_logs',
        dbData.couponShop.merchantLog,
        `INSERT INTO coupon_merchant_logs (id, occurred_at, date_ymd, product_id, coupon_name, buyer_student_id, price_cal, merchant_student_id, rental_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        log => [
          log.id,
          log.occurredAt || Date.now(),
          log.dateYmd || '',
          log.productId || null,
          log.couponName || '',
          log.buyerStudentId || '',
          parseInt(log.priceCal, 10) || 0,
          log.merchantStudentId || null,
          log.rentalId || null
        ]
      );
    }

    // 8. canteen_merchant_logs
    if (dbData.canteenShop && Array.isArray(dbData.canteenShop.merchantLog)) {
      await mergeLogs(
        'canteen_merchant_logs',
        dbData.canteenShop.merchantLog,
        `INSERT INTO canteen_merchant_logs (id, occurred_at, date_ymd, product_id, product_name, buyer_student_id, price_cal, merchant_student_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        log => [
          log.id,
          log.occurredAt || Date.now(),
          log.dateYmd || '',
          log.productId || null,
          log.productName || '',
          log.buyerStudentId || '',
          parseInt(log.priceCal, 10) || 0,
          log.merchantStudentId || null,
          log.status || 'approved'
        ]
      );
    }

    // 9. activity_logs
    if (Array.isArray(dbData.activityLogs)) {
      await mergeLogs(
        'activity_logs',
        dbData.activityLogs,
        `INSERT INTO activity_logs (id, student_id, occurred_at, summary, exp_delta, calory_delta, bulk_job_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        log => [
          log.id || ('log-' + Date.now() + Math.random().toString(36).substr(2, 5)),
          log.studentId || '',
          log.occurredAt || Date.now(),
          log.summary || '',
          parseInt(log.expDelta, 10) || 0,
          parseInt(log.caloryDelta, 10) || 0,
          log.bulkJobId || null
        ]
      );
    }

    // 10. bulk_adjustments
    if (Array.isArray(dbData.bulkAdjustments)) {
      await mergeLogs(
        'bulk_adjustments',
        dbData.bulkAdjustments,
        `INSERT INTO bulk_adjustments (id, occurred_at, \`type\`, target_count, summary, exp_delta, calory_delta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        adj => [
          adj.id || ('adj-' + Date.now() + Math.random().toString(36).substr(2, 5)),
          adj.occurredAt || Date.now(),
          adj.type || '',
          parseInt(adj.targetCount, 10) || 0,
          adj.summary || '',
          parseInt(adj.expDelta, 10) || 0,
          parseInt(adj.caloryDelta, 10) || 0
        ]
      );
    }

    // 11. Sync Settings
    const [dbSettings] = await conn.query('SELECT `key`, `value` FROM settings');
    const dbSettingsMap = new Map(dbSettings.map(s => [s.key, s.value]));

    const saveMergedSetting = async (key, incomingVal, mergeFunc) => {
      let dbValStr = dbSettingsMap.get(key);
      let dbVal = null;
      if (dbValStr !== undefined && dbValStr !== null) {
        if (typeof dbValStr === 'string') {
          try {
            dbVal = JSON.parse(dbValStr);
          } catch (e) {
            console.error(`Failed to parse settings key ${key} value:`, dbValStr, e);
            dbVal = dbValStr;
          }
        } else {
          dbVal = dbValStr;
        }
      }
      const mergedVal = mergeFunc(dbVal, incomingVal);
      await conn.query(
        `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
        [key, JSON.stringify(mergedVal)]
      );
    };

    const settingsKeys = [
      'version', 'titleGrants', 'behaviorNotes', 'classJobQuotas',
      'bankPayrollRequests', 'taxCollectionRequests', 'djRequests',
      'recyclerLogs', 'envLogs', 'hallOfFame', 'cleaningChecklistRequests',
      'digitalBoard', 'statisticsChecklist', 'statisticsApprovalRequests',
      'postmanErrandRequests', 'lastDailyExpGrowthBoardKey',
      'classTaxTotalManual', 'classTaxTotalManualConfirmed', 'stockMarket'
    ];

    for (const key of settingsKeys) {
      if (dbData[key] !== undefined) {
        let valToSave = dbData[key];
        if (key === 'stockMarket' && Array.isArray(valToSave)) {
          valToSave = {};
        }

        await saveMergedSetting(key, valToSave, (dbVal, incoming) => {
          if (!dbVal) return incoming;
          
          if (key === 'stockMarket') {
            const mergedTradeLog = mergeArraysById(dbVal.tradeLog, incoming.tradeLog);
            if (isTeacher) {
              return {
                ...incoming,
                tradeLog: mergedTradeLog,
                currentPrices: (incoming.lastPricesUpdatedAt || 0) > (dbVal.lastPricesUpdatedAt || 0) ? incoming.currentPrices : dbVal.currentPrices,
                rawPrices: (incoming.lastPricesUpdatedAt || 0) > (dbVal.lastPricesUpdatedAt || 0) ? incoming.rawPrices : dbVal.rawPrices,
                lastPricesUpdatedAt: Math.max(incoming.lastPricesUpdatedAt || 0, dbVal.lastPricesUpdatedAt || 0)
              };
            } else {
              return {
                ...dbVal,
                tradeLog: mergedTradeLog
              };
            }
          }
          
          const listKeys = [
            'bankPayrollRequests', 'taxCollectionRequests', 'djRequests',
            'recyclerLogs', 'envLogs', 'cleaningChecklistRequests',
            'statisticsApprovalRequests', 'postmanErrandRequests'
          ];
          if (listKeys.includes(key)) {
            return mergeArraysById(dbVal, incoming);
          }
          
          if (isTeacher) {
            return incoming;
          } else {
            return dbVal;
          }
        });
      }
    }

    if (dbData.couponShop) {
      const couponShopMeta = {
        pendingOffers: dbData.couponShop.pendingOffers || [],
        holdings: dbData.couponShop.holdings || {},
        treasuryTotal: dbData.couponShop.treasuryTotal || 0
      };
      await saveMergedSetting('coupon_shop_meta', couponShopMeta, (dbVal, incoming) => {
        if (!dbVal) return incoming;
        return {
          pendingOffers: mergeArraysById(dbVal.pendingOffers, incoming.pendingOffers),
          holdings: mergeHoldings(dbVal.holdings, incoming.holdings),
          treasuryTotal: isTeacher ? incoming.treasuryTotal : dbVal.treasuryTotal
        };
      });
    }

    if (dbData.canteenShop) {
      const canteenShopMeta = {
        pendingOffers: dbData.canteenShop.pendingOffers || [],
        holdings: dbData.canteenShop.holdings || {},
        treasuryTotal: dbData.canteenShop.treasuryTotal || 0,
        orders: dbData.canteenShop.orders || []
      };
      await saveMergedSetting('canteen_shop_meta', canteenShopMeta, (dbVal, incoming) => {
        if (!dbVal) return incoming;
        return {
          pendingOffers: mergeArraysById(dbVal.pendingOffers, incoming.pendingOffers),
          holdings: mergeHoldings(dbVal.holdings, incoming.holdings),
          treasuryTotal: isTeacher ? incoming.treasuryTotal : dbVal.treasuryTotal,
          orders: mergeArraysById(dbVal.orders, incoming.orders)
        };
      });
    }

    if (dbData.titleShop !== undefined && dbData.titleShop !== null) {
      await saveMergedSetting('title_shop_meta', dbData.titleShop, (dbVal, incoming) => {
        if (!dbVal) return incoming;
        return {
          pendingOffers: mergeArraysById(dbVal.pendingOffers, incoming.pendingOffers),
          purchaseLog: mergeArraysById(dbVal.purchaseLog, incoming.purchaseLog),
          products: mergeArraysById(dbVal.products, incoming.products)
        };
      });
    }

    // Restore foreign key checks
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    await conn.commit();
    return res.json({ ok: true });

  } catch (error) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    try {
      await conn.rollback();
    } catch (rbError) {
      console.error('롤백 에러:', rbError);
    }
    console.error('동기화 저장 에러:', error);
    return res.status(500).json({ ok: false, msg: '서버 저장 중 오류가 발생했습니다: ' + error.message });
  } finally {
    conn.release();
  }
});

// GET /api/stocks/prices - Returns cached stock prices and KIS config status
app.get('/api/stocks/prices', async (req, res) => {
  const isConfigured = !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
  
  // If refresh query param is provided, wait for the fetch to complete
  if (req.query.refresh === 'true' && isConfigured) {
    try {
      await fetchStockPricesFromKIS();
    } catch (err) {
      console.error('[KIS API] Synchronous refresh error:', err);
    }
  } else if (Object.keys(cachedStockPrices).length === 0 && isConfigured) {
    try {
      await fetchStockPricesFromKIS();
    } catch (e) {
      console.error('[KIS API] Synchronous initial fetch error:', e);
    }
  }

  return res.json({
    ok: true,
    isConfigured,
    data: cachedStockPrices
  });
});

// === Class Year Management APIs ===

// 1. GET /api/years - List all class years and the current active year
app.get('/api/years', async (req, res) => {
  try {
    const [rows] = await db.query('SHOW DATABASES');
    const databases = rows.map(r => r.Database || r.database || '');
    
    const years = [];
    for (const dbName of databases) {
      const match = dbName.match(/^class_tool_(\d{4})$/);
      if (match) {
        years.push(match[1]);
      }
    }
    
    // Sort descending
    years.sort((a, b) => b.localeCompare(a));
    
    return res.json({
      ok: true,
      years,
      activeYear: globalActiveYear
    });
  } catch (error) {
    console.error('학년도 목록 조회 에러:', error);
    return res.status(500).json({ ok: false, msg: '학년도 목록을 조회하는 중 오류가 발생했습니다.' });
  }
});

// 2. POST /api/years - Create a new year database and migrate schema + teacher accounts
app.post('/api/years', async (req, res) => {
  const { year } = req.body;
  if (!year || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ ok: false, msg: '올바른 학년도(4자리 숫자, 예: 2027)를 입력해 주세요.' });
  }

  const newDbName = `class_tool_${year}`;
  
  try {
    const [dbs] = await db.query('SHOW DATABASES');
    const exists = dbs.some(r => (r.Database || r.database || '') === newDbName);
    if (exists) {
      return res.status(400).json({ ok: false, msg: `${year}학년도 학급이 이미 존재합니다.` });
    }

    console.log(`[API] Creating new year database: ${newDbName}`);
    await db.query(`CREATE DATABASE \`${newDbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

    const newPool = db.getPool(newDbName);
    const conn = await newPool.getConnection();

    try {
      const fs = require('fs');
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');

      // Clean SQL comments and split by semicolon
      const cleanSql = schemaSql
        .replace(/--.*$/gm, '') // Remove single line comments
        .replace(/\/\*[\s\S]*?\*\//g, ''); // Remove block comments

      const statements = cleanSql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => {
          if (!stmt) return false;
          const lower = stmt.toLowerCase();
          return !lower.startsWith('drop database') && 
                 !lower.startsWith('create database') && 
                 !lower.startsWith('use ');
        });

      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const statement of statements) {
        await conn.query(statement);
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      console.log(`[API] Schema migration completed for ${newDbName}`);

      // Copy teacher/admin accounts from the default/current database to the new database
      const [teachers] = await db.query("SELECT * FROM users WHERE role = 'teacher' OR role = 'admin'");
      if (teachers.length > 0) {
        for (const t of teachers) {
          await conn.query(
            `INSERT INTO users (id, login_id, password_hash, salt, role, display_name, pin_code, pin_must_change, student_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t.id, t.login_id, t.password_hash, t.salt, t.role, t.display_name, t.pin_code, t.pin_must_change, null]
          );
        }
        console.log(`[API] Copied ${teachers.length} teacher/admin account(s) to ${newDbName}`);
      } else {
        const defaultSalt = crypto.randomBytes(16).toString('hex');
        const defaultHash = hashPassword('1234', defaultSalt);
        await conn.query(
          `INSERT INTO users (id, login_id, password_hash, salt, role, display_name, pin_code, pin_must_change, student_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['teacher-id', 'teacher', defaultHash, defaultSalt, 'teacher', '선생님', null, 0, null]
        );
        console.log(`[API] Created default teacher account in ${newDbName}`);
      }

    } finally {
      conn.release();
    }

    return res.json({ ok: true, msg: `${year}학년도 학급이 성공적으로 생성되었습니다.` });
  } catch (error) {
    console.error('학년도 생성 에러:', error);
    return res.status(500).json({ ok: false, msg: '학년도 학급을 생성하는 중 오류가 발생했습니다.' });
  }
});

// 3. POST /api/years/active - Set the globally active year
app.post('/api/years/active', async (req, res) => {
  const { year } = req.body;
  if (!year || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ ok: false, msg: '올바른 학년도를 입력해 주세요.' });
  }

  const dbName = `class_tool_${year}`;
  try {
    const [dbs] = await db.query('SHOW DATABASES');
    const exists = dbs.some(r => (r.Database || r.database || '') === dbName);
    if (!exists) {
      return res.status(400).json({ ok: false, msg: `${year}학년도 학급이 존재하지 않습니다.` });
    }

    const defaultPool = db.getPool(db.defaultDbName);
    await defaultPool.query(
      `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE \`value\` = ?`,
      ['activeYear', JSON.stringify(year), JSON.stringify(year)]
    );

    globalActiveYear = year;
    console.log(`[API] Globally active year set to: ${globalActiveYear}`);

    return res.json({ ok: true, msg: `활성화 학년도가 ${year}년으로 변경되었습니다.` });
  } catch (error) {
    console.error('활성화 학년도 설정 에러:', error);
    return res.status(500).json({ ok: false, msg: '활성화 학년도를 설정하는 중 오류가 발생했습니다.' });
  }
});

// Health check API
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
