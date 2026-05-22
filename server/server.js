const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

    // Query active stocks from database settings
    const [settings] = await db.query('SELECT `value` FROM settings WHERE `key` = ?', ['stockMarket']);
    if (settings.length === 0) {
      console.log('[KIS API] No stockMarket settings found in database.');
      isFetchingPrices = false;
      return;
    }

    let stockMarket = settings[0].value;
    if (typeof stockMarket === 'string') {
      try { stockMarket = JSON.parse(stockMarket); } catch (e) {}
    }

    if (!stockMarket || !stockMarket.enabled) {
      console.log('[KIS API] Stock market is disabled. Skipping price fetch.');
      isFetchingPrices = false;
      return;
    }

    const stocks = stockMarket.stocks || [];
    if (stocks.length === 0) {
      console.log('[KIS API] No active stocks configured.');
      isFetchingPrices = false;
      return;
    }

    const token = await getKISAccessToken();
    const baseUrl = isMock
      ? 'https://openapivts.koreainvestment.com:29443'
      : 'https://openapi.koreainvestment.com:9443';

    console.log(`[KIS API] Fetching prices for ${stocks.length} stocks sequentially (Mock env: ${isMock})...`);

    for (let i = 0; i < stocks.length; i++) {
      const stock = stocks[i];
      const code = stock.code;
      if (!code) continue;

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
          console.error(`[KIS API] Price fetch failed for stock ${code} (${stock.name}): ${lastError}`);
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
              name: resJson.output.hts_kor_shr_nme || stock.name || '',
              updatedAt: Date.now()
            };
            console.log(`[KIS API] Updated stock ${code} (${stock.name}): ${priceVal} KRW, SDPR: ${!isNaN(sdprVal) ? sdprVal : priceVal} KRW`);
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
      if (isMock && i < stocks.length - 1) {
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

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Disable foreign key checks during reconstruction
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    // 1. Delete all existing records from all 10 tables
    const tables = [
      'users', 'students', 'coupons', 'rentals', 'canteen_products',
      'coupon_merchant_logs', 'canteen_merchant_logs', 'activity_logs',
      'bulk_adjustments', 'settings'
    ];
    for (const table of tables) {
      await conn.query(`DELETE FROM ${table}`);
    }

    // 2. Insert students
    if (Array.isArray(dbData.students)) {
      for (const st of dbData.students) {
        await conn.query(
          `INSERT INTO students (id, name, number, gender, lv, exp, calory, coupons, class_role, job_id, avatar_data_url, avatar_custom, stock_portfolio)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            st.stockPortfolio ? JSON.stringify(st.stockPortfolio) : null
          ]
        );
      }
    }

    // 3. Insert users
    if (Array.isArray(dbData.users)) {
      const studentIds = new Set(Array.isArray(dbData.students) ? dbData.students.map(st => st.id) : []);
      for (const u of dbData.users) {
        const studentIdToInsert = studentIds.has(u.studentId) ? u.studentId : null;
        await conn.query(
          `INSERT INTO users (id, login_id, password_hash, salt, role, display_name, pin_code, pin_must_change, student_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    // 4. Insert coupons (coupons table)
    if (dbData.couponShop && Array.isArray(dbData.couponShop.products)) {
      for (const p of dbData.couponShop.products) {
        await conn.query(
          `INSERT INTO coupons (id, name, price_cal, total_stock, remaining_stock, \`desc\`, is_group, group_target_count, merchant_student_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    }

    // 5. Insert rentals (rentals table)
    if (dbData.couponShop && Array.isArray(dbData.couponShop.rentals)) {
      const couponIds = new Set(dbData.couponShop.products ? dbData.couponShop.products.map(p => p.id) : []);
      for (const r of dbData.couponShop.rentals) {
        const productIdToInsert = couponIds.has(r.productId) ? r.productId : null;
        await conn.query(
          `INSERT INTO rentals (id, product_id, coupon_name, student_id, student_name, status, rented_at, use_requested_at, merchant_approved_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.id,
            productIdToInsert,
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
    }

    // 6. Insert canteen_products
    if (dbData.canteenShop && Array.isArray(dbData.canteenShop.products)) {
      for (const p of dbData.canteenShop.products) {
        await conn.query(
          `INSERT INTO canteen_products (id, name, price_cal, total_stock, remaining_stock, \`desc\`, merchant_student_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
    }

    // 7. Insert coupon_merchant_logs
    if (dbData.couponShop && Array.isArray(dbData.couponShop.merchantLog)) {
      for (const log of dbData.couponShop.merchantLog) {
        await conn.query(
          `INSERT INTO coupon_merchant_logs (id, occurred_at, date_ymd, product_id, coupon_name, buyer_student_id, price_cal, merchant_student_id, rental_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
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
    }

    // 8. Insert canteen_merchant_logs
    if (dbData.canteenShop && Array.isArray(dbData.canteenShop.merchantLog)) {
      for (const log of dbData.canteenShop.merchantLog) {
        await conn.query(
          `INSERT INTO canteen_merchant_logs (id, occurred_at, date_ymd, product_id, product_name, buyer_student_id, price_cal, merchant_student_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
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
    }

    // 9. Insert activity_logs
    if (Array.isArray(dbData.activityLogs)) {
      for (const log of dbData.activityLogs) {
        await conn.query(
          `INSERT INTO activity_logs (id, student_id, occurred_at, summary, exp_delta, calory_delta, bulk_job_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
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
    }

    // 10. Insert bulk_adjustments
    if (Array.isArray(dbData.bulkAdjustments)) {
      for (const adj of dbData.bulkAdjustments) {
        await conn.query(
          `INSERT INTO bulk_adjustments (id, occurred_at, \`type\`, target_count, summary, exp_delta, calory_delta)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
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
    }

    // 11. Insert settings (Config keys)
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
        await conn.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)`,
          [key, JSON.stringify(valToSave)]
        );
      }
    }

    // Insert coupon_shop_meta
    if (dbData.couponShop) {
      const couponShopMeta = {
        pendingOffers: dbData.couponShop.pendingOffers || [],
        holdings: dbData.couponShop.holdings || {},
        treasuryTotal: dbData.couponShop.treasuryTotal || 0
      };
      await conn.query(
        `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)`,
        ['coupon_shop_meta', JSON.stringify(couponShopMeta)]
      );
    }

    // Insert canteen_shop_meta
    if (dbData.canteenShop) {
      const canteenShopMeta = {
        pendingOffers: dbData.canteenShop.pendingOffers || [],
        holdings: dbData.canteenShop.holdings || {},
        treasuryTotal: dbData.canteenShop.treasuryTotal || 0,
        orders: dbData.canteenShop.orders || []
      };
      await conn.query(
        `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)`,
        ['canteen_shop_meta', JSON.stringify(canteenShopMeta)]
      );
    }

    // Insert title_shop_meta
    if (dbData.titleShop !== undefined && dbData.titleShop !== null) {
      await conn.query(
        `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)`,
        ['title_shop_meta', JSON.stringify(dbData.titleShop)]
      );
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
    return res.status(500).json({ ok: false, msg: '서버 저장 중 오류가 발생했습니다.' });
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

// Health check API
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
