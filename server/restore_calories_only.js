const db = require('./db');

async function main() {
  const targetDb = process.env.DB_NAME || 'class_tool';
  console.log(`>>> Connecting to database: ${targetDb}`);
  const conn = await db.getConnection();

  try {
    // Fetch all students
    const [students] = await conn.query('SELECT id, name, number, calory, stock_portfolio FROM students');
    
    // Fetch all stock logs
    const [logs] = await conn.query(
      "SELECT id, student_id, calory_delta, summary FROM activity_logs WHERE summary LIKE '%주식 매수%' OR summary LIKE '%주식 매도%'"
    );

    // Group stock logs by student
    const stockDeltasMap = {};
    for (const log of logs) {
      if (log.student_id) {
        if (!stockDeltasMap[log.student_id]) {
          stockDeltasMap[log.student_id] = 0;
        }
        stockDeltasMap[log.student_id] += parseInt(log.calory_delta, 10) || 0;
      }
    }

    console.log('\n>>> Calculating and restoring student balances (reversing stock trades)...');
    await conn.beginTransaction();

    let changeCount = 0;
    for (const st of students) {
      const sumStockDeltas = stockDeltasMap[st.id] || 0;
      
      // If there are stock deltas, we reverse them (subtract from current calory)
      // and we also clear the stock portfolio to prevent double asset possession.
      if (sumStockDeltas !== 0 || (st.stock_portfolio && st.stock_portfolio !== '{}')) {
        const targetCalory = Math.max(0, Math.round((st.calory - sumStockDeltas) * 100) / 100);
        
        await conn.query(
          'UPDATE students SET calory = ?, stock_portfolio = NULL WHERE id = ?',
          [targetCalory, st.id]
        );
        
        console.log(`[ROLLBACK] #${st.number} ${st.name}: Cash=${st.calory} Cal -> Restored=${targetCalory} Cal (Reversed Stock Deltas=${sumStockDeltas} Cal, Stock Portfolio Cleared)`);
        changeCount++;
      } else {
        console.log(`[NO CHANGE] #${st.number} ${st.name}: Cash=${st.calory} Cal (No stock trades found)`);
      }
    }

    await conn.commit();
    console.log('\n=============================================');
    console.log(`🎉 [COMPLETE] Successfully rolled back ${changeCount} student(s) to pre-stock-trade state!`);
    console.log('=============================================');

  } catch (err) {
    await conn.rollback();
    console.error('❌ [ERROR] Rollback failed:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
