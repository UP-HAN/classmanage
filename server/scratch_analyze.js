const db = require('./db');

async function analyze() {
  const conn = await db.getConnection();
  try {
    const [students] = await conn.query("SELECT id, name, number, calory FROM students WHERE name = '황서진'");
    if (students.length === 0) {
      console.log('황서진 not found!');
      process.exit();
    }
    const st = students[0];
    console.log(`Student: #${st.number} ${st.name} | Current Calory: ${st.calory}`);

    const [logs] = await conn.query("SELECT summary, calory_delta, exp_delta, occurred_at FROM activity_logs WHERE student_id = ? ORDER BY occurred_at ASC", [st.id]);
    console.log(`Found ${logs.length} logs in database:`);
    for (const log of logs) {
      console.log(`  [${new Date(log.occurred_at).toLocaleString()}] ${log.summary} (Calory Delta: ${log.calory_delta}, EXP Delta: ${log.exp_delta})`);
    }

    // Let's also check settings stockMarket tradeLog for 황서진
    const [settings] = await conn.query('SELECT `value` FROM settings WHERE `key` = ?', ['stockMarket']);
    let tradeLog = [];
    if (settings.length > 0) {
      let val = settings[0].value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch(e) {}
      }
      tradeLog = (val && val.tradeLog) || [];
    }

    const stTrades = tradeLog.filter(t => t.studentId === st.id);
    console.log(`\nFound ${stTrades.length} trades in settings.stockMarket.tradeLog:`);
    for (const t of stTrades) {
      console.log(`  [${new Date(t.occurredAt).toLocaleString()}] Type: ${t.type} | Stock: ${t.name} (${t.code}) | Shares: ${t.shares} | totalKcal: ${t.totalKcal} Cal`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    conn.release();
    process.exit();
  }
}

analyze();
