const fs = require('fs');
const path = require('path');

function dumpBackup() {
  const backupPath = path.join(__dirname, '../backup.json');
  const raw = fs.readFileSync(backupPath, 'utf8');
  let backup = JSON.parse(raw);
  if (backup.payloadJson) {
    backup = JSON.parse(backup.payloadJson);
  }

  // 1. Students Map
  const studentsMap = {};
  (backup.students || []).forEach(s => {
    studentsMap[s.name] = {
      number: Number(s.number),
      calory: Number(s.calory) || 0
    };
  });
  console.log('=== STUDENTS MAP ===');
  console.log(JSON.stringify(studentsMap, null, 2));

  // 2. Activity Log IDs
  const logIds = (backup.activityLogs || []).map(l => l.id).filter(Boolean);
  console.log(`\n=== LOG IDS COUNT: ${logIds.length} ===`);
  console.log(JSON.stringify(logIds));
}

dumpBackup();
