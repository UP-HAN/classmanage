const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || ''
};

async function migrate() {
  console.log('Copying data from class_tool to class_tool_2026...');
  
  const conn = await mysql.createConnection({
    ...dbConfig,
    multipleStatements: true
  });

  try {
    const [dbs] = await conn.query('SHOW DATABASES');
    const dbNames = dbs.map(r => r.Database || r.database || '');
    
    if (!dbNames.includes('class_tool')) {
      throw new Error("Source database 'class_tool' does not exist!");
    }
    if (!dbNames.includes('class_tool_2026')) {
      throw new Error("Target database 'class_tool_2026' does not exist! Please create it from the web UI first.");
    }

    const tables = [
      'students',
      'users',
      'coupons',
      'rentals',
      'canteen_products',
      'coupon_merchant_logs',
      'canteen_merchant_logs',
      'activity_logs',
      'bulk_adjustments',
      'settings'
    ];

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    
    for (const table of tables) {
      console.log(`Copying table: ${table}`);
      await conn.query(`TRUNCATE TABLE \`class_tool_2026\`.\`${table}\``);
      await conn.query(`INSERT INTO \`class_tool_2026\`.\`${table}\` SELECT * FROM \`class_tool\`.\`${table}\``);
    }
    
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('🎉 Successfully migrated all data from class_tool to class_tool_2026!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await conn.end();
  }
}

migrate();
