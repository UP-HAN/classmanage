const db = require('./db');

async function main() {
  const conn = await db.getConnection();
  try {
    // 1. Get student #6 and #9 IDs
    const [students] = await conn.query("SELECT id, name, number FROM class_tool_2026.students WHERE number IN (6, 9)");
    console.log("Students:", students);

    for (const st of students) {
      console.log(`\n===========================================`);
      console.log(`Logs for #${st.number} ${st.name} (ID: ${st.id})`);
      console.log(`===========================================`);
      
      const [logs] = await conn.query(
        "SELECT id, summary, calory_delta, occurred_at, is_synced FROM class_tool_2026.activity_logs WHERE student_id = ? ORDER BY occurred_at DESC LIMIT 20",
        [st.id]
      );
      
      for (const log of logs) {
        // Convert summary to hex or print characters directly
        const rawSummary = log.summary;
        // Escape Korean characters to ASCII for clear remote output view
        const escapedSummary = rawSummary ? rawSummary.split('').map(c => c.charCodeAt(0) > 127 ? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}` : c).join('') : '';
        console.log(`[${new Date(log.occurred_at).toLocaleString()}] ID: ${log.id} | Delta: ${log.calory_delta} | Synced: ${log.is_synced}`);
        console.log(`  Raw: "${rawSummary}"`);
        console.log(`  Escaped: "${escapedSummary}"`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    conn.release();
    process.exit(0);
  }
}
main();
