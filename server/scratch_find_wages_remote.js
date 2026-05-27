const db = require('./db');

async function main() {
  const targetDb = process.env.DB_NAME || 'class_tool_2026';
  console.log(`>>> Connecting to database: ${targetDb}`);
  const conn = await db.getConnection();

  try {
    const [logs] = await conn.query(
      "SELECT id, student_id, summary, calory_delta, occurred_at FROM activity_logs WHERE summary LIKE '%주급%' OR summary LIKE '%은행%' OR summary LIKE '%월급%' ORDER BY occurred_at DESC LIMIT 100"
    );
    
    console.log(`\nFound ${logs.length} wage-related logs:`);
    for (const log of logs) {
      console.log(`  [${new Date(log.occurred_at).toLocaleString()}] ID: ${log.id} | Delta: ${log.calory_delta} Cal | Summary: ${log.summary}`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    conn.release();
    process.exit();
  }
}
main();
