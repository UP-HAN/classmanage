const fs = require('fs');
const path = require('path');

function searchFile() {
  const filePath = path.join(__dirname, '../app/app.js');
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  console.log(`Scanning app/app.js (${lines.length} lines)...`);

  const matches = [];
  lines.forEach((line, idx) => {
    if (line.includes('setInterval') || line.includes('setTimeout')) {
      matches.push({ lineNum: idx + 1, line: line.trim() });
    }
  });

  console.log(`Found ${matches.length} timer lines:`);
  matches.forEach(m => {
    console.log(`[L${m.lineNum}] ${m.line}`);
  });
}

searchFile();
