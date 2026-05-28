const fs = require('fs');
const path = require('path');
const db = require('./db');

async function main() {
  const targetDb = process.env.DB_NAME || 'class_tool_2026';
  console.log(`==================================================`);
  console.log(`🚀 Generating stock analysis file from: ${targetDb}`);
  console.log(`==================================================\n`);

  const conn = await db.getConnection();

  try {
    // 1. Fetch all students
    const [students] = await conn.query('SELECT id, name, number, calory, stock_portfolio FROM students ORDER BY number ASC');
    
    // 2. Fetch stockMarket settings
    const [settings] = await conn.query("SELECT `value` FROM settings WHERE `key` = 'stockMarket'");
    let stockMarket = {};
    if (settings.length > 0) {
      let val = settings[0].value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) {}
      }
      stockMarket = val || {};
    }

    // 3. Fetch all activity logs (recent 200 logs)
    const [logs] = await conn.query(
      "SELECT id, student_id, summary, calory_delta, occurred_at, is_synced FROM activity_logs ORDER BY occurred_at DESC"
    );

    // Map students for quick lookup in logs
    const studentMap = {};
    students.forEach(s => {
      studentMap[s.id] = { name: s.name, number: s.number };
    });

    // Structure the data
    const analysisResult = {
      generatedAt: new Date().toISOString(),
      database: targetDb,
      stockMarketConfig: {
        enabled: stockMarket.enabled,
        stocks: stockMarket.stocks || [],
        multiplier: stockMarket.multiplier || 1,
        tradeLogCount: stockMarket.tradeLog?.length || 0
      },
      students: students.map(st => {
        let portfolio = {};
        if (st.stock_portfolio) {
          try {
            portfolio = typeof st.stock_portfolio === 'string' ? JSON.parse(st.stock_portfolio) : st.stock_portfolio;
          } catch (e) {
            portfolio = {};
          }
        }
        return {
          id: st.id,
          name: st.name,
          number: st.number,
          currentCalory: st.calory,
          holdings: portfolio.holdings || {}
        };
      }),
      recentTradeLog: (stockMarket.tradeLog || []).map(t => ({
        id: t.id,
        studentName: t.studentName,
        studentId: t.studentId,
        type: t.type,
        code: t.code,
        name: t.name,
        shares: t.shares,
        priceKcal: t.priceKcal,
        totalKcal: t.totalKcal,
        occurredAt: t.occurredAt
      })),
      activityLogs: logs.map(l => {
        const studentInfo = studentMap[l.student_id] || { name: 'Unknown', number: '?' };
        return {
          id: l.id,
          studentName: studentInfo.name,
          studentNumber: studentInfo.number,
          summary: l.summary,
          caloryDelta: l.calory_delta,
          occurredAt: l.occurred_at,
          isSynced: l.is_synced
        };
      })
    };

    // Save to the web app root directory
    const outputFilename = 'stock_analysis.json';
    const outputPath = path.join(__dirname, '..', outputFilename);
    fs.writeFileSync(outputPath, JSON.stringify(analysisResult, null, 2), 'utf8');

    console.log(`✅ Success! Analysis file generated successfully at:`);
    console.log(`   ${outputPath}\n`);
    console.log(`🔗 You can download the file from your browser:`);
    console.log(`   http://3.35.13.249/${outputFilename}\n`);
    console.log(`Please download it, save it, and upload/attach the file to this chat.`);

  } catch (err) {
    console.error('❌ Failed to generate analysis file:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
