const db = require('c:\\Users\\onizu\\OneDrive\\바탕 화면\\Workspace_Antigravity\\학급운영도구\\server\\db');

async function main() {
  console.log('Connecting to database...');
  const conn = await db.getConnection();
  try {
    const [settings] = await conn.query("SELECT * FROM settings WHERE `key` = 'stockMarket'");
    console.log('\n=== STOCK MARKET SETTINGS ===');
    if (settings.length > 0) {
      let val = settings[0].value;
      if (typeof val === 'string') {
        try { val = JSON.parse(val); } catch(e) {}
      }
      console.log(val);
    } else {
      console.log('Not found');
    }

    const [students] = await conn.query("SELECT id, name, number, calory, stock_portfolio FROM students");
    console.log('\n=== STUDENTS PORTFOLIO AND CALORY ===');
    students.forEach(st => {
      console.log(`#${st.number} ${st.name}: Calory=${st.calory} Cal, Portfolio=${st.stock_portfolio}`);
    });
  } catch (err) {
    console.error('Error:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
