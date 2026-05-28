const db = require('./db');

async function main() {
  const conn = await db.getConnection();
  try {
    const [dbs] = await conn.query("SHOW DATABASES");
    const dbNames = dbs.map(d => d.Database || d.database).filter(name => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(name));
    console.log("=== DATABASES ON SERVER ===");
    console.log(dbNames);

    for (const dbName of dbNames) {
      console.log(`\n--- Inspecting Database: ${dbName} ---`);
      try {
        const [tables] = await conn.query(`SHOW TABLES FROM \`${dbName}\``);
        const tableNames = tables.map(t => Object.values(t)[0]);
        console.log("Tables:", tableNames);

        if (tableNames.includes('students')) {
          const [studentsCount] = await conn.query(`SELECT COUNT(*) as count FROM \`${dbName}\`.\`students\``);
          console.log(`  students table: ${studentsCount[0].count} rows`);
          
          if (studentsCount[0].count > 0) {
            const [sihu] = await conn.query(`SELECT id, name, number, calory, stock_portfolio FROM \`${dbName}\`.\`students\` WHERE name = '장시후'`);
            if (sihu.length > 0) {
              console.log(`  장시후 found: Calory=${sihu[0].calory}, Portfolio=${sihu[0].stock_portfolio}`);
              
              const [logs] = await conn.query(`SELECT summary, calory_delta, occurred_at FROM \`${dbName}\`.\`activity_logs\` WHERE student_id = ? ORDER BY occurred_at DESC LIMIT 5`, [sihu[0].id]);
              console.log("  장시후's recent logs:");
              logs.forEach(l => {
                console.log(`    [${new Date(l.occurred_at).toLocaleString()}] ${l.summary} (${l.calory_delta})`);
              });
            } else {
              console.log("  장시후 not found in this DB.");
            }
          }
        }
        
        if (tableNames.includes('settings')) {
          const [settings] = await conn.query(`SELECT \`value\` FROM \`${dbName}\`.\`settings\` WHERE \`key\` = 'activeYear'`);
          console.log(`  activeYear setting:`, settings.length > 0 ? settings[0].value : "not set");
        }
      } catch (err) {
        console.log(`  Error: ${err.message}`);
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
