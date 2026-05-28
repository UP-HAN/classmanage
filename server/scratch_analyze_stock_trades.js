const db = require('./db');

async function main() {
  const targetDb = process.env.DB_NAME || 'class_tool_2026';
  console.log(`==================================================`);
  console.log(`🔍 [Stock Analyzer] Analyzing Database: ${targetDb}`);
  console.log(`==================================================\n`);

  const conn = await db.getConnection();

  try {
    // 1. Fetch all students
    const [students] = await conn.query('SELECT id, name, number, calory, stock_portfolio FROM students ORDER BY number ASC');
    
    // 2. Fetch stockMarket settings to look at the tradeLog
    const [settings] = await conn.query("SELECT `value` FROM settings WHERE `key` = 'stockMarket'");
    let tradeLog = [];
    if (settings.length > 0) {
      let val = settings[0].value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) {}
      }
      tradeLog = (val && val.tradeLog) || [];
    }

    // 3. Fetch all stock activity logs
    const [logs] = await conn.query(
      "SELECT id, student_id, summary, calory_delta, occurred_at FROM activity_logs WHERE summary LIKE '%주식%' OR summary LIKE '%매수%' OR summary LIKE '%매도%' ORDER BY occurred_at ASC"
    );

    console.log(`📊 Loaded ${students.length} students.`);
    console.log(`📊 Loaded ${tradeLog.length} trades from stockMarket tradeLog.`);
    console.log(`📊 Loaded ${logs.length} stock-related activity logs.`);
    console.log('\n--------------------------------------------------');
    console.log('1. Students Portfolios Analysis');
    console.log('--------------------------------------------------');

    for (const st of students) {
      let portfolio = {};
      if (st.stock_portfolio) {
        try {
          portfolio = typeof st.stock_portfolio === 'string' ? JSON.parse(st.stock_portfolio) : st.stock_portfolio;
        } catch (e) {
          portfolio = {};
        }
      }

      const holdings = portfolio.holdings || {};
      const holdingKeys = Object.keys(holdings);

      if (holdingKeys.length > 0) {
        console.log(`\n[#${st.number} ${st.name}] Current Cash: ${st.calory} Cal`);
        for (const code of holdingKeys) {
          const h = holdings[code];
          console.log(`  - Stock Code: ${code} | Shares: ${h.amount}주 | Avg Price: ${h.avgPriceKcal} Cal`);
        }
        
        // Find recent trades and logs for this student
        const stTrades = tradeLog.filter(t => t.studentId === st.id);
        const stLogs = logs.filter(l => l.student_id === st.id);

        console.log(`  * Recent Trade Log (Settings):`);
        if (stTrades.length === 0) {
          console.log(`    (No trade logs found in settings.stockMarket.tradeLog)`);
        } else {
          stTrades.slice(0, 5).forEach(t => {
            console.log(`    [Trade] ${t.type === 'buy' ? '매수 🔵' : '매도 🔴'} ${t.name} (${t.code}) | ${t.shares}주 | 가격: ${t.priceKcal} Cal | 총합: ${t.totalKcal} Cal | ${new Date(t.occurredAt).toLocaleString()}`);
          });
        }

        console.log(`  * Activity Logs (Database):`);
        if (stLogs.length === 0) {
          console.log(`    (No activity logs found in database)`);
        } else {
          stLogs.slice(-5).forEach(l => {
            console.log(`    [Log] ${l.summary} (Delta: ${l.calory_delta} Cal) | ${new Date(l.occurred_at).toLocaleString()}`);
          });
        }
      }
    }

    console.log('\n--------------------------------------------------');
    console.log('2. Structural Anomalies Analysis');
    console.log('--------------------------------------------------');
    
    // Check if there are mismatch codes (e.g. Kakao mapped as Samsung Electronics 005930)
    const kakaoMismatches = tradeLog.filter(t => t.name && t.name.includes('카카오') && t.code === '005930');
    if (kakaoMismatches.length > 0) {
      console.log(`⚠️ Detected Kakao traded under Samsung code (005930): ${kakaoMismatches.length} occurrences.`);
    }

    const logsMismatch = logs.filter(l => l.summary && l.summary.includes('카카오') && l.summary.includes('005930'));
    if (logsMismatch.length > 0) {
      console.log(`⚠️ Detected Kakao traded under 005930 in activity logs: ${logsMismatch.length} occurrences.`);
    }

  } catch (err) {
    console.error('Analysis error:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
