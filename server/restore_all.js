const fs = require('fs');
const path = require('path');
const db = require('./db');

async function main() {
  const backupPath = path.join(__dirname, '../backup.json');
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ 백업 파일을 찾을 수 없습니다: ${backupPath}`);
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
  const backupStudentsByNumberMap = new Map(backupStudents.map(s => [String(s.number), s]));
  const backupStudentsByNameMap = new Map(backupStudents.map(s => [s.name, s]));
  const backupLogIds = new Set((backup.activityLogs || []).map(l => l.id).filter(Boolean));

  console.log('🔄 데이터베이스 복구 분석 시작...');
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

    console.log('\n⚙️ 학생별 잔액 재계산 및 복구 시작...');
    await conn.beginTransaction();

    for (const st of students) {
      // 1. 최아현(#22), 오주원(#13) 학생은 배당금 보존을 위해 강제 보정에서 절대 제외 (현재 DB 값 유지 또는 원래 준 고액 잔액으로 롤백 방지)
      if (st.number === 22 || st.number === 13 || String(st.number) === '22' || String(st.number) === '13') {
        console.log(`[보호-스킵] #${st.number} ${st.name}은 배당금 보존 대상으로 복구를 건너뜁니다.`);
        continue;
      }

      // 2. 황서진(#25) 학생은 정상 잔액인 540 Cal로 강제 고정
      if (st.number === 25 || String(st.number) === '25' || st.name === '황서진') {
        const targetCal = 540;
        await conn.query('UPDATE students SET calory = ? WHERE id = ?', [targetCal, st.id]);
        console.log(`✅ [#25 황서진] 정상 잔액 복원: 540 Cal`);
        continue;
      }

      // 3. 다른 모든 학생들의 백업 매핑
      let backupSt = backupStudentsMap.get(st.id);
      if (!backupSt) {
        // ID가 불일치할 경우 이름이나 번호로 폴백 매핑
        backupSt = backupStudentsByNumberMap.get(String(st.number)) || backupStudentsByNameMap.get(st.name);
      }

      const initialCalory = backupSt ? (parseInt(backupSt.calory, 10) || 0) : 0;
      const stLogs = studentLogsMap[st.id] || [];
      const newLogs = stLogs.filter(log => !backupLogIds.has(log.id));
      
      let sumNewDeltas = 0;
      for (const log of newLogs) {
        let delta = parseInt(log.calory_delta, 10) || 0;
        // 환불 로그 0원 오진 복원 적용
        if (delta === 0 && log.summary && log.summary.includes('환불')) {
          const match = log.summary.match(/\(\+(\d+)\s*Cal\)/);
          if (match) {
            delta = parseInt(match[1], 10);
          }
        }
        sumNewDeltas += delta;
      }

      const expectedCalory = Math.max(0, initialCalory + sumNewDeltas);

      // DB 업데이트 실행
      await conn.query('UPDATE students SET calory = ? WHERE id = ?', [expectedCalory, st.id]);
      console.log(`✅ [#${st.number} ${st.name}] 복구 완료: ${st.calory} Cal ➡️ ${expectedCalory} Cal (백업 시작: ${initialCalory} Cal, 변동량: ${sumNewDeltas} Cal)`);
    }

    await conn.commit();
    console.log('\n🎉 전교생 잔액 복구가 완료되었습니다!');

  } catch (err) {
    await conn.rollback();
    console.error('❌ 복구 작업 에러로 인해 롤백되었습니다:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
