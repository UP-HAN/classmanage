const db = require('c:\\Users\\onizu\\OneDrive\\바탕 화면\\Workspace_Antigravity\\학급운영도구\\server\\db');

async function main() {
  console.log('Connecting to database...');
  const defaultPool = db.getPool(db.defaultDbName);
  try {
    // 1. Get all databases
    const [dbRows] = await defaultPool.query("SHOW DATABASES");
    const databases = dbRows
      .map(r => r.Database || r.database)
      .filter(name => name === db.defaultDbName || name.startsWith('class_tool_'));
    
    console.log('\n=== DETECTED DATABASES ===');
    console.log(databases);

    // 2. Query each database
    for (const dbName of databases) {
      console.log(`\n================ DATABASE: ${dbName} ================`);
      const pool = db.getPool(dbName);

      // Check settings for active year
      try {
        const [sett] = await pool.query("SELECT `value` FROM settings WHERE `key` = 'activeYear'");
        if (sett.length > 0) {
          console.log(`Active Year Setting:`, sett[0].value);
        }
      } catch(e) {
        console.log(`(No activeYear setting found in settings)`);
      }

      // Check Hwang Seo-jin (#25)
      try {
        const [students] = await pool.query("SELECT * FROM students WHERE name LIKE '%황서진%' OR id = '25'");
        if (students.length > 0) {
          const st = students[0];
          console.log(`Student Hwang Seo-jin: ID=${st.id}, Number=${st.number}, Calory=${st.calory} Cal, Portfolio=${st.stock_portfolio}`);
          
          // Query activity logs
          const [logs] = await pool.query("SELECT * FROM activity_logs WHERE student_id = ? ORDER BY occurred_at DESC LIMIT 15", [st.id]);
          console.log(`Recent Activity Logs (up to 15):`);
          logs.forEach(l => {
            console.log(`  [${new Date(Number(l.occurred_at)).toLocaleString()}] ${l.summary} (Calory Delta: ${l.calory_delta}, ID: ${l.id})`);
          });

          // Query coupon rentals
          const [rentals] = await pool.query("SELECT * FROM rentals WHERE student_id = ?", [st.id]);
          console.log(`Coupon Rentals:`, rentals);
        } else {
          console.log(`Student Hwang Seo-jin not found in this database.`);
        }
      } catch(e) {
        console.error(`Error querying students in ${dbName}:`, e.message);
      }
    }

  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    process.exit(0);
  }
}

main();
