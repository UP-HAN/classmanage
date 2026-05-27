const fs = require('fs');
const path = require('path');
const db = require('./db');

async function main() {
  const targetDb = process.env.DB_NAME || 'class_tool_2026';
  console.log(`>>> Connecting to database: ${targetDb}`);
  const conn = await db.getConnection();

  try {
    // 1. Read starting state from backup.json
    const backupPath = path.join(__dirname, '../backup.json');
    if (!fs.existsSync(backupPath)) {
      throw new Error(`backup.json file not found at ${backupPath}`);
    }
    
    console.log('>>> Loading backup.json...');
    const rawBackup = fs.readFileSync(backupPath, 'utf8');
    let backup = JSON.parse(rawBackup);
    if (backup.payloadJson) {
      backup = JSON.parse(backup.payloadJson);
    }

    const backupStudents = {};
    (backup.students || []).forEach(s => {
      backupStudents[s.name] = {
        number: Number(s.number),
        calory: Number(s.calory) || 0
      };
    });

    const backupLogIds = new Set((backup.activityLogs || []).map(l => l.id).filter(Boolean));
    console.log(`Loaded ${Object.keys(backupStudents).length} students and ${backupLogIds.size} historical logs from backup.json.`);

    // 2. Find weekly wage logs on May 26th, 2026 to determine cutoff timestamp
    console.log('>>> Locating weekly wage logs on May 26th, 2026...');
    const [wageLogs] = await conn.query(
      "SELECT occurred_at FROM activity_logs WHERE (summary LIKE '%주급%' OR summary LIKE '%은행%') AND occurred_at BETWEEN 1779600000000 AND 1779700000000"
    );

    if (wageLogs.length === 0) {
      throw new Error('No weekly wage logs found on May 26th, 2026 in the database.');
    }

    const cutoffTimestamp = Math.max(...wageLogs.map(l => Number(l.occurred_at)));
    console.log(`>>> Identified Cutoff Timestamp: ${cutoffTimestamp} (${new Date(cutoffTimestamp).toLocaleString()})`);

    // 3. Fetch current database state
    const [students] = await conn.query('SELECT id, name, number, calory FROM students');
    const [logs] = await conn.query('SELECT id, student_id, calory_delta, summary, occurred_at FROM activity_logs ORDER BY occurred_at ASC');

    // Group logs by student
    const studentLogsMap = {};
    for (const log of logs) {
      if (log.student_id) {
        if (!studentLogsMap[log.student_id]) {
          studentLogsMap[log.student_id] = [];
        }
        studentLogsMap[log.student_id].push(log);
      }
    }

    // 4. Recalculate and restore balances
    console.log('\n>>> Commencing database rollback to post-payroll state...');
    await conn.beginTransaction();

    let changeCount = 0;
    for (const st of students) {
      const studentName = st.name;
      const backupSt = backupStudents[studentName];
      if (!backupSt) {
        console.warn(`[WARN] Student ${studentName} (#${st.number}) not found in backup.json. Skipping.`);
        continue;
      }

      const initialCalory = backupSt.calory;
      const stLogs = studentLogsMap[st.id] || [];
      
      // Filter: Only keep logs that happened AFTER the backup but BEFORE or EQUAL to the cutoff timestamp
      const intermediateLogs = stLogs.filter(log => 
        !backupLogIds.has(log.id) && Number(log.occurred_at) <= cutoffTimestamp
      );

      let sumDeltas = 0;
      for (const log of intermediateLogs) {
        let delta = parseInt(log.calory_delta, 10) || 0;
        // Parse and recover the calory delta if it was logged as 0 in older refund logs
        if (delta === 0 && log.summary && log.summary.includes('환불')) {
          const match = log.summary.match(/\(\+(\d+)\s*Cal\)/);
          if (match) {
            delta = parseInt(match[1], 10);
          }
        }
        sumDeltas += delta;
      }

      const targetCalory = Math.max(0, initialCalory + sumDeltas);

      // Force update calories and clear stock portfolio
      await conn.query(
        'UPDATE students SET calory = ?, stock_portfolio = NULL WHERE id = ?',
        [targetCalory, st.id]
      );

      console.log(`[RESTORE] #${st.number} ${studentName}: Current=${st.calory} Cal -> Restored=${targetCalory} Cal (Start=${initialCalory} Cal, Deltas=${sumDeltas} Cal, Stock Portfolio Cleared)`);
      changeCount++;
    }

    // 5. Mark all activity logs up to the cutoff timestamp as is_synced = 1,
    // and delete logs after the cutoff timestamp (stock purchases, etc.) to completely clean up.
    console.log('\n>>> Cleaning up activity logs in the database...');
    await conn.query('UPDATE activity_logs SET is_synced = 1 WHERE occurred_at <= ?', [cutoffTimestamp]);
    await conn.query('DELETE FROM activity_logs WHERE occurred_at > ?', [cutoffTimestamp]);
    console.log('>>> Standardized activity logs and cleared post-payroll actions.');

    await conn.commit();
    console.log('\n=============================================');
    console.log(`🎉 [COMPLETE] Successfully restored ${changeCount} student(s) to post-payroll state!`);
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
