const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function main() {
  const backupPath = process.argv[2] || path.join(__dirname, '../backup.json');
  if (!fs.existsSync(backupPath)) {
    console.error(`백업 파일을 찾을 수 없습니다: ${backupPath}`);
    console.error(`사용법: node migrate.js [백업파일경로]`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(backupPath, 'utf8');
  let dbData;
  try {
    dbData = JSON.parse(rawData);
    // 만약 Firebase export 형태라면 payloadJson 안에 실제 데이터가 들어있을 수 있음
    if (dbData.payloadJson) {
      dbData = JSON.parse(dbData.payloadJson);
    }
  } catch (e) {
    console.error('JSON 파싱 오류:', e);
    process.exit(1);
  }

  console.log('데이터 마이그레이션을 시작합니다...');

  // db.js를 통하지 않고 DB 생성 단계를 위해 직접 연결
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    // 1. 데이터베이스 생성 및 스키마 로드
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await connection.query(schemaSql);
    console.log('데이터베이스 스키마가 성공적으로 생성/확인되었습니다.');

    // 2. 테이블들 비우기 (마이그레이션이 중복 실행되어 무결성이 깨지는 것을 방지)
    // 외래 키 체크 해제
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    const tables = [
      'users', 'students', 'coupons', 'rentals', 'canteen_products',
      'coupon_merchant_logs', 'canteen_merchant_logs', 'activity_logs',
      'bulk_adjustments', 'settings'
    ];
    for (const table of tables) {
      await connection.query(`TRUNCATE TABLE ${table}`);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('기존 테이블 데이터를 초기화했습니다.');

    // 3. 학생 데이터 (students)
    if (Array.isArray(dbData.students)) {
      for (const st of dbData.students) {
        await connection.query(
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
      console.log(`학생 데이터 마이그레이션 완료: ${dbData.students.length}명`);
    }

    // 4. 유저 데이터 (users)
    if (Array.isArray(dbData.users)) {
      const studentIds = new Set(Array.isArray(dbData.students) ? dbData.students.map(st => st.id) : []);
      for (const u of dbData.users) {
        // 학생 정보에 존재하지 않는 studentId인 경우 외래 키 에러 방지를 위해 null 처리
        const studentIdToInsert = studentIds.has(u.studentId) ? u.studentId : null;
        await connection.query(
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
      console.log(`유저 계정 데이터 마이그레이션 완료: ${dbData.users.length}개`);
    }

    // 5. 쿠폰 데이터 (coupons)
    if (dbData.couponShop && Array.isArray(dbData.couponShop.products)) {
      for (const p of dbData.couponShop.products) {
        await connection.query(
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
      console.log(`쿠폰 상품 마이그레이션 완료: ${dbData.couponShop.products.length}개`);
    }

    // 6. 대여 데이터 (rentals)
    if (dbData.couponShop && Array.isArray(dbData.couponShop.rentals)) {
      const couponIds = new Set(dbData.couponShop.products ? dbData.couponShop.products.map(p => p.id) : []);
      for (const r of dbData.couponShop.rentals) {
        // 이미 상점에서 삭제된 쿠폰인 경우 외래 키 에러 방지를 위해 null 처리
        const productIdToInsert = couponIds.has(r.productId) ? r.productId : null;
        await connection.query(
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
      console.log(`쿠폰 대여 내역 마이그레이션 완료: ${dbData.couponShop.rentals.length}건`);
    }

    // 7. 매점 상품 데이터 (canteen_products)
    if (dbData.canteenShop && Array.isArray(dbData.canteenShop.products)) {
      for (const p of dbData.canteenShop.products) {
        await connection.query(
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
      console.log(`매점 상품 마이그레이션 완료: ${dbData.canteenShop.products.length}개`);
    }

    // 8. 쿠폰 상점 로그 (coupon_merchant_logs)
    if (dbData.couponShop && Array.isArray(dbData.couponShop.merchantLog)) {
      for (const log of dbData.couponShop.merchantLog) {
        await connection.query(
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
      console.log(`쿠폰 상점 로그 마이그레이션 완료: ${dbData.couponShop.merchantLog.length}건`);
    }

    // 9. 매점 상점 로그 (canteen_merchant_logs)
    if (dbData.canteenShop && Array.isArray(dbData.canteenShop.merchantLog)) {
      for (const log of dbData.canteenShop.merchantLog) {
        await connection.query(
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
      console.log(`매점 상점 로그 마이그레이션 완료: ${dbData.canteenShop.merchantLog.length}건`);
    }

    // 10. 활동 로그 (activity_logs)
    if (Array.isArray(dbData.activityLogs)) {
      for (const log of dbData.activityLogs) {
        await connection.query(
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
      console.log(`활동 로그 마이그레이션 완료: ${dbData.activityLogs.length}건`);
    }

    // 11. 벌크 조정 로그 (bulk_adjustments)
    if (Array.isArray(dbData.bulkAdjustments)) {
      for (const adj of dbData.bulkAdjustments) {
        await connection.query(
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
      console.log(`벌크 조정 로그 마이그레이션 완료: ${dbData.bulkAdjustments.length}건`);
    }

    // 12. 공통 전역 설정/Config 테이블 (settings)
    // JSON의 기타 키 값들을 settings 테이블에 JSON으로 적재
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
        await connection.query(
          `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE \`value\` = ?`,
          [key, JSON.stringify(valToSave), JSON.stringify(valToSave)]
        );
      }
    }

    // couponShop과 canteenShop 내의 meta 정보(예: holdings, treasuryTotal, pendingOffers 등)를 저장
    if (dbData.couponShop) {
      const couponShopMeta = {
        pendingOffers: dbData.couponShop.pendingOffers || [],
        holdings: dbData.couponShop.holdings || {},
        treasuryTotal: dbData.couponShop.treasuryTotal || 0
      };
      await connection.query(
        `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`value\` = ?`,
        ['coupon_shop_meta', JSON.stringify(couponShopMeta), JSON.stringify(couponShopMeta)]
      );
    }
    if (dbData.canteenShop) {
      const canteenShopMeta = {
        pendingOffers: dbData.canteenShop.pendingOffers || [],
        holdings: dbData.canteenShop.holdings || {},
        treasuryTotal: dbData.canteenShop.treasuryTotal || 0,
        orders: dbData.canteenShop.orders || []
      };
      await connection.query(
        `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`value\` = ?`,
        ['canteen_shop_meta', JSON.stringify(canteenShopMeta), JSON.stringify(canteenShopMeta)]
      );
    }
    
    // titleShop 메타 정보 저장
    if (dbData.titleShop) {
      await connection.query(
        `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`value\` = ?`,
        ['title_shop_meta', JSON.stringify(dbData.titleShop), JSON.stringify(dbData.titleShop)]
      );
    }

    console.log('기타 전역 설정(settings) 마이그레이션 완료.');
    console.log('🎉 모든 데이터가 성공적으로 마이그레이션되었습니다!');

  } catch (error) {
    console.error('❌ 마이그레이션 도중 오류 발생:', error);
  } finally {
    await connection.end();
  }
}

main();
