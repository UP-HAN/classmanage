const db = require('./db');

// Hardcoded starting balances from backup.json
const BACKUP_STUDENTS = {
  "김민서": { "number": 1, "calory": 630 },
  "김민지": { "number": 2, "calory": 730 },
  "김서원": { "number": 3, "calory": 1210 },
  "김수하": { "number": 4, "calory": 1110 },
  "김지유": { "number": 5, "calory": 1040 },
  "김태완": { "number": 6, "calory": 1080 },
  "김현수": { "number": 7, "calory": 10 },
  "남유찬": { "number": 8, "calory": 910 },
  "박서현": { "number": 9, "calory": 1020 },
  "서은유": { "number": 10, "calory": 450 },
  "석지윤": { "number": 11, "calory": 940 },
  "안준우": { "number": 12, "calory": 190 },
  "오주원": { "number": 13, "calory": 580 },
  "이규현": { "number": 14, "calory": 490 },
  "이시은": { "number": 15, "calory": 650 },
  "이재경": { "number": 16, "calory": 470 },
  "이준서": { "number": 17, "calory": 450 },
  "장시후": { "number": 18, "calory": 80 },
  "정다영": { "number": 19, "calory": 750 },
  "최가은": { "number": 20, "calory": 1170 },
  "최서우": { "number": 21, "calory": 250 },
  "최아현": { "number": 22, "calory": 550 },
  "허은채": { "number": 23, "calory": 830 },
  "홍하진": { "number": 24, "calory": 1210 },
  "황서진": { "number": 25, "calory": 540 }
};

// Hardcoded historical log IDs present in backup.json
const BACKUP_LOG_IDS = new Set([
  "70f8f496-6ec1-4c71-bd84-19c1801344d7","b323f464-b9d2-4783-b209-9c3aca993ec9","6c3e37e3-d606-45bd-8e4a-2d35f27c6d1f","37d464e1-e2cf-4e4b-b12e-a9b30e455fd0","d69c38d3-4197-4497-9948-49a0c351d3cd","96336024-f967-4120-b8b5-ef565f12bc09","b864c825-a340-4378-83e1-67b34dde7009","170fd885-efe9-4ff8-9fc2-38ac5daabff1","cf706587-8a27-4905-a5c4-af180a737b82","e03b344b-814c-48b7-8d96-d3a0e16de3f5","2ca0f742-b07a-4fb7-b16b-d039eaa5288e","01724c1c-5f02-4cb7-824c-2c5d5155dcb4","17d065ab-b91b-4149-9f31-6b278d0c53cd","7706e987-6dcc-4249-a274-2d788537dc88","b0db4be7-03a5-44e3-9dca-fbf35cb54f54","1a7c47f7-7088-4ca5-94aa-ba69cddeb877","335ab799-428f-4b1e-aa85-a5ede5ac3c0e","2dd2488e-74a2-4d5d-9846-dae03abba3b2","6e4a6436-98b6-40d9-be00-84a3f586c805","5fd63ad3-ea16-423d-aed2-f627f56f5b38","a4e355ff-ad3d-4ae6-a7f0-0cd52e628470","ffc39a8d-2c88-4781-917d-07c1be4f22cd","b9fdfe85-6543-411f-bf41-4ff5cb358973","5659a223-98b4-4346-bef7-6bae3810ce6c","a43180a2-51f3-4942-a873-153cdcc257ac","446da480-5687-40b8-853f-b15bb47b5b87","f6252bcb-cf6b-4ca7-8d7c-975e68d6fe7e","19b09c44-9452-47b9-9b3b-2b9302c36258","7368b5ac-d4c3-4fcc-996d-bfa8d1c82755","c3af4298-ecc3-451a-90db-c92e3512cd5a","a3e60f56-296d-4513-9357-13ed61e1528d","a3bbaf07-46d3-4cfd-bc6e-48fc554b0774","a93cb5bc-6eda-420c-9561-038b21e89ab9","37706308-45d7-498b-a52e-a9d0fd0d695f","8e93edad-626e-4b43-9ee6-d8670f3f27ec","539e8ff7-0ffa-4d9a-a268-9079cef7a2f8","8a537d4e-bc2f-4fdd-8ec8-77d0ccbd1cf5","bc82449d-18c2-43d6-a5cd-4e0088e7b122","78e68d92-501b-43c5-b492-43d8e48399f1","4de990e6-2c3d-45e3-aff5-8aa3e3c08de7","35193783-1ae5-4a70-9848-bec06c1e755a","a5937aab-71e5-4e6c-99ef-1b5751cd3f7b","1c0a69c1-20c0-4765-975d-63bab0db6653","936bd2b4-abfd-4a7a-ba6d-88d59bfe0cc1","5f1fcc0e-bdb4-49b2-bec4-63c2496dbd70","09de8146-1797-4739-8f9a-bdb5a4790b50","4fcf62a3-0505-4982-a53a-5e97499676c2","3ae7b401-0238-4fdb-95c4-5cb9e2da3c81","4b5cb8ff-af80-423a-bbda-f061ce3fb706","58acf304-3667-4a65-861d-ee169fd0ae9d","24f58cf9-99ef-4d52-9692-19cc9ceeb9d1","ba14f63b-c56e-4033-8ad5-5635271e1398","5bce5211-d723-41e0-8e16-6a7d20b4019b","3dc8ba81-c34d-4f30-82dc-93e7eb06f97a","9936e28d-e491-4593-900a-bc8447829c54","075f40e7-ad64-496b-9a7c-172fc99ea979","32bb450f-c983-4bc2-80f9-af8dee555c90","2f151699-6b17-472f-950b-4feb58f950b8","df721e47-2c63-4e91-84fd-ba78858c6e6c","6d34d1e2-6b2e-46f2-964d-a316f0973895","10b69a32-de03-42ed-bb14-bd0b3644c168","3bda291d-b4c6-4480-9aca-37bbd2b1fa6d","37b1e737-d9fa-4ec8-8ae7-068bd72e07d2","15216587-4d6b-4163-a39f-3bcad7068743","c0af2368-8e57-4077-af26-bee56b1b99e5","5ae2f2fe-a1d7-45bb-beb7-420c4e9185b3","4823c6f7-fff1-45ca-a3d5-761e98836130","dcbf7f00-a296-454a-ae61-abb994c8f6a4","65aa4e02-46f2-4ae2-8990-09b6e7a81504","3b2b2db2-1193-4aaa-adf1-9d29a46b9668","c57e4f69-53f5-4845-9b6e-680596492c23","f2c06035-0d9f-4977-8923-7ee44aaffd10","82443495-0e0b-4dfa-9740-fcf40db9cf98","b66a3e21-6d2e-4cdb-af78-a322ee69d95f","17218292-e0ee-4aa5-ba96-82ee18670782","bd32e5a2-3899-4e9b-b649-b74f301345ed","3de14a32-fd4f-4afc-be22-032ceea7f32b","eb95b867-3ba2-4da9-8a22-1112966c062c","927595fe-d19f-44b0-922a-8fff96eeb432","e04ce351-5344-4356-8631-09121df56a97","eb89942c-ad22-4abf-95e1-501970ec24db","9df82109-16ea-4aa0-90dc-0610cbfb2cda","ab1da888-b5f7-4b48-9f45-c55aa0be0b73","383cb3f3-29e1-4c01-8e21-0fe79206d5a6","3a9fe001-c02e-46e2-96d1-9ec0e15cff13","b3e0bb43-f10c-4c72-a4cf-49ada3e7ae1f","016604a2-1a95-467d-af3b-ca636b033c40","35fdff8b-ac55-4f36-9f6d-562a9ed672ac","27139135-44aa-44c5-9d59-c220305d5501","2326072f-acab-45e7-b704-0dbedb61beb6","528e57fe-1e3b-4e4d-92a3-bec37ebd46a6","86c51d01-a044-4568-afcc-93c984204113","551bdb66-aecb-404e-8046-cf284a331851","0dbe9151-6bf0-41c5-b15f-a1e826de2096","71975f01-77f3-4115-92d7-336c3a850070","6c9dede0-c608-40b2-afb3-97bce81dec5e","9f1026cb-6cc4-43cb-8167-591ecb0da4a6","ba4291a0-7f1e-4f27-b17b-0700ee4af995","b30453c4-e33b-4595-844d-bb08f1d15467","9e43a772-e861-4fb9-b703-2e37874afc8c","a02136a4-4269-4166-99ad-35b6c2f60050","ab46e1c2-f3ce-4fbe-a1de-a6fcdb66902c","8fad3dd5-c450-4b33-8169-da70ab9c4370","ceea7560-094c-47c8-a55d-b19c7d1ef12c","98dacb0e-f37a-4310-9d7a-b8193f784105","48762e63-f5e1-48f6-99bd-c705c0d906f1","e92efe21-8ec8-433a-91a0-315989023ec3","95f779b6-b180-421e-9da1-3d11498da3c6","60ee818c-c21a-4277-8381-8ec7867bf975","2445e266-bd49-4b69-84dc-2e3c153da6e1","3e7547ff-3e33-4c30-8ed1-eb8aac58a01d","6a35486c-59d1-41b3-9997-89e1ab319ae6","7ef06617-678d-4bfd-a479-2aef33dbea35","e87adf9d-bc79-410e-a1a5-a744c208c862","a2fd82c0-5756-4638-b748-d034b21d4a0e","89e87982-2f4e-404b-9622-1b1a688fcc58","5265f018-3a04-4dcf-8afa-5fd27ea3874d","2c21d908-17e1-416d-a6a5-c8d02f81631a","c2c342d3-583c-46c5-8e79-00a9528413fa","377c1234-3327-4a71-901a-db6a78a47e93","1fc57d0d-b01c-422a-a589-b1f649566b27","44e2cae2-0a07-41be-9d6c-e8292c562724","f2742d76-1c78-4b39-baea-1a71ac2ddeb1","d18bd815-f02a-4387-a13e-76ebc2289255","b911e12b-f093-4b8b-a518-9dbc681ba653","a9fc038e-4378-441d-8963-35002c6a6f4e","220d6fd6-ff5b-49a6-be2f-bb332ec4999c","9b81fc24-698c-416d-93e1-646afcba4518","a5287aa5-c6df-49ce-99c3-987036b9eb44","72fd0d51-67b2-45cf-97d0-6bb41144a86a","4e8aff2a-3f71-412c-8a43-c2de7404d11b","78707f80-030d-4799-a11b-135a93f2f158","f5eab3c9-7474-4b7d-9524-4b25a9e0ca40","f4605e23-ef8d-4274-a9a7-7c876942ca4d","33a87251-8981-49a3-b70b-5c19b7e8ecdd","b2d0d6ea-627a-4dba-af95-f2ffb0755d95","4bc189e4-34d2-4552-82cb-a10f9f758578","218d025f-51e8-43f2-b88b-c92aaf2a4759","cb3a4845-d950-49dd-8e70-50edb9046899","627ca3d4-40b6-4dae-96ef-ffda08e8a467","54b93505-71bf-46c8-9b47-a1fa89e43d0f","0ca5d494-eee8-4863-8603-64b24337013b","12b60148-7c95-4310-9a2a-a4ebb384e558","1ed38c13-a0cc-424f-94b6-9e4547036748","ba80056a-578b-4b69-8f1a-7abbf4744063","4378ce72-998d-4ace-af91-79b340dac8eb","2649bdaf-d427-46be-ab14-017973686d87","aa36fc66-f1c4-4665-aa89-3337edb09512","366c0009-5a91-4ebc-986d-2ef11b5d5770","e8ccba09-20e3-47fa-9017-4870c1a82651"
]);

async function main() {
  const targetDb = process.env.DB_NAME || 'class_tool_2026';
  console.log(`>>> Connecting to database: ${targetDb}`);
  const conn = await db.getConnection();

  try {
    // 2. Find weekly wage logs that are not in the backup to determine cutoff timestamp
    console.log('>>> Locating newly added weekly wage logs...');
    const [wageLogs] = await conn.query(
      "SELECT id, occurred_at, summary FROM activity_logs WHERE (summary LIKE '%주급%' OR summary LIKE '%은행%')"
    );

    const newWageLogs = wageLogs.filter(l => !BACKUP_LOG_IDS.has(l.id));

    if (newWageLogs.length === 0) {
      console.log('All wage/bank logs in DB:');
      for (const log of wageLogs) {
        console.log(`  [${log.id}] ${new Date(Number(log.occurred_at)).toLocaleString()} | Summary: ${log.summary}`);
      }
      throw new Error('No newly added weekly wage logs found in the database. Please verify if the payroll was run.');
    }

    console.log(`>>> Found ${newWageLogs.length} new wage logs.`);
    const cutoffTimestamp = Math.max(...newWageLogs.map(l => Number(l.occurred_at)));
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
      const backupSt = BACKUP_STUDENTS[studentName];
      if (!backupSt) {
        console.warn(`[WARN] Student ${studentName} (#${st.number}) not found in backup.json. Skipping.`);
        continue;
      }

      const initialCalory = backupSt.calory;
      const stLogs = studentLogsMap[st.id] || [];
      
      // Filter: Only keep logs that happened AFTER the backup but BEFORE or EQUAL to the cutoff timestamp
      const intermediateLogs = stLogs.filter(log => 
        !BACKUP_LOG_IDS.has(log.id) && Number(log.occurred_at) <= cutoffTimestamp
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
