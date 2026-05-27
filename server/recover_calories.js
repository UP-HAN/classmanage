const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('./db');

async function main() {
  const backupPath = process.argv[2] || path.join(__dirname, '../backup.json');
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ 백업 파일을 찾을 수 없습니다: ${backupPath}`);
    console.error(`사용법: node recover_calories.js [백업파일경로]`);
    process.exit(1);
  }

  let backup;
  try {
    const rawData = fs.readFileSync(backupPath, 'utf8');
    backup = JSON.parse(rawData);
    if (backup.payloadJson) {
      backup = JSON.parse(backup.payloadJson);
    }
  } catch (e) {
    console.error('❌ 백업 파일 JSON 파싱 오류:', e);
    process.exit(1);
  }

  const backupStudents = backup.students || [];
  const backupStudentsMap = new Map(backupStudents.map(s => [s.id, s]));
  const backupLogIds = new Set((backup.activityLogs || []).map(l => l.id).filter(Boolean));

  console.log('🔄 데이터베이스 연결 및 분석 중...');
  const conn = await db.getConnection();

  try {
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

    const corrections = [];
    console.log('\n================ 데이터 분석 결과 ================');
    console.log('번호\t이름\t현재 잔액\t예상 잔액\t차액(복사된 돈)');
    console.log('--------------------------------------------------');

    for (const st of students) {
      const backupSt = backupStudentsMap.get(st.id);
      const initialCalory = backupSt ? (parseInt(backupSt.calory, 10) || 0) : 0;
      
      const stLogs = studentLogsMap[st.id] || [];
      // 마이그레이션 이후 새로 추가된 로그만 필터링
      const newLogs = stLogs.filter(log => !backupLogIds.has(log.id));
      
      let sumNewDeltas = 0;
      for (const log of newLogs) {
        let delta = parseInt(log.calory_delta, 10) || 0;
        // 기존 환불 로그에서 calory_delta가 0이었던 경우 텍스트를 통해 파싱하여 보정
        if (delta === 0 && log.summary && log.summary.includes('환불')) {
          const match = log.summary.match(/\(\+(\d+)\s*Cal\)/);
          if (match) {
            delta = parseInt(match[1], 10);
          }
        }
        sumNewDeltas += delta;
      }

      const expectedCalory = Math.max(0, initialCalory + sumNewDeltas);
      const discrepancy = st.calory - expectedCalory;

      if (discrepancy !== 0) {
        // 최아현(#22)과 오주원(#13) 학생은 교사가 배당금으로 지급한 것이므로 보정에서 명시적으로 제외
        if (st.number === 22 || st.number === 13 || String(st.number) === '22' || String(st.number) === '13') {
          console.log(`[보호] #${st.number}\t${st.name}\t${st.calory} Cal\t(예상: ${expectedCalory} Cal, 교사 배당금으로 조정 제외)`);
          continue;
        }

        console.log(`#${st.number}\t${st.name}\t${st.calory} Cal\t${expectedCalory} Cal\t${discrepancy > 0 ? '+' : ''}${discrepancy} Cal`);
        corrections.push({
          id: st.id,
          name: st.name,
          number: st.number,
          correctCalory: expectedCalory,
          currentCalory: st.calory,
          discrepancy: discrepancy
        });
      }
    }

    if (corrections.length === 0) {
      console.log('✨ 분석 결과 복사되거나 불일치하는 칼로리 잔액이 없습니다.');
      conn.release();
      process.exit(0);
    }

    console.log('--------------------------------------------------');
    console.log(`총 ${corrections.length}명의 학생에게서 잔액 불일치가 감지되었습니다.`);
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('\n⚠️ 감지된 오차를 바탕으로 데이터베이스의 칼로리 잔액을 강제 보정하시겠습니까? (y/n): ', async (answer) => {
      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        console.log('\n⚙️ 잔액 강제 보정 시작...');
        await conn.beginTransaction();
        try {
          for (const corr of corrections) {
            await conn.query('UPDATE students SET calory = ? WHERE id = ?', [corr.correctCalory, corr.id]);
            console.log(`✅ [#${corr.number} ${corr.name}] 잔액 보정 완료: ${corr.currentCalory} Cal ➡️ ${corr.correctCalory} Cal`);
          }
          await conn.commit();
          console.log('\n🎉 모든 대상 학생의 칼로리가 정상 상태로 보정 완료되었습니다!');
        } catch (err) {
          await conn.rollback();
          console.error('❌ 보정 처리 중 오류가 발생하여 롤백했습니다:', err);
        }
      } else {
        console.log('\n❌ 보정 처리가 취소되었습니다.');
      }
      rl.close();
      conn.release();
      process.exit(0);
    });

  } catch (err) {
    console.error('❌ 데이터베이스 분석 에러:', err);
    conn.release();
    process.exit(1);
  }
}

main();
