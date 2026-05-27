const db = require('./db');

async function main() {
  console.log('Connecting to database...');
  const conn = await db.getConnection();
  try {
    console.log('Finding student Hwang Seo-jin (#25)...');
    const [students] = await conn.query("SELECT id, name, number, calory FROM students WHERE name = '황서진' OR number = 25");
    
    if (students.length === 0) {
      console.error('❌ 황서진 학생을 찾을 수 없습니다.');
      process.exit(1);
    }

    const st = students[0];
    console.log(`Found: [#${st.number} ${st.name}] Current Calory: ${st.calory} Cal`);
    
    // 540 Cal로 강제 복구
    const targetCalory = 540;
    await conn.query("UPDATE students SET calory = ? WHERE id = ?", [targetCalory, st.id]);
    console.log(`\n✅ 황서진 학생의 칼로리가 정상 상태인 ${targetCalory} Cal로 성공적으로 복원되었습니다!`);

  } catch (err) {
    console.error('❌ 복원 작업 에러:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
