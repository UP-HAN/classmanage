const db = require('./db');
const crypto = require('crypto');

function uid() {
  return crypto.randomUUID();
}

async function main() {
  const targetDb = process.env.DB_NAME || 'class_tool_2026';
  console.log(`>>> Connecting to database: ${targetDb}`);
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Fetch stockMarket settings to get current stocks and prices
    console.log('>>> Fetching stock market settings...');
    const [settings] = await conn.query("SELECT `value` FROM settings WHERE `key` = 'stockMarket'");
    if (settings.length === 0) {
      throw new Error("No stockMarket setting found in database settings table.");
    }
    
    let stockMarket = typeof settings[0].value === 'string' ? JSON.parse(settings[0].value) : settings[0].value;
    const stocks = stockMarket.stocks || [];
    const currentPrices = stockMarket.currentPrices || {};
    
    if (stocks.length === 0) {
      throw new Error("No stocks listed in the stock market configuration.");
    }
    console.log(`>>> Detected ${stocks.length} active stocks in market.`);

    // Initialize tradeLog array if it doesn't exist
    if (!Array.isArray(stockMarket.tradeLog)) {
      stockMarket.tradeLog = [];
    }

    // 2. Fetch Choi Ah-hyeon and Oh Ju-won student records
    const [leaders] = await conn.query(
      "SELECT id, name, calory FROM students WHERE name IN ('최아현', '오주원')"
    );

    const choi = leaders.find(l => l.name === '최아현');
    const oh = leaders.find(l => l.name === '오주원');

    if (!choi) console.warn('[WARN] Student 최아현 not found!');
    if (!oh) console.warn('[WARN] Student 오주원 not found!');

    const occurredAt = Date.now();

    // 3. Process Choi Ah-hyeon (반장 최아현 - 1000 Cal reward, buys 100 Cal of each stock)
    if (choi) {
      console.log(`\n>>> Processing reward for 반장 ${choi.name}...`);
      const buyKcalPerStock = 100;
      const holdings = {};
      
      // Create reward activity log
      const rewardLogId = uid();
      await conn.query(
        "INSERT INTO activity_logs (id, student_id, summary, calory_delta, exp_delta, occurred_at, is_synced) VALUES (?, ?, ?, ?, 0, ?, 1)",
        [rewardLogId, choi.id, "칭찬 보상 · 반장 포상 (+1000 Cal)", 1000, occurredAt - 20000]
      );

      for (const stock of stocks) {
        const priceKrw = currentPrices[stock.code]?.price || 100000;
        const priceKcal = priceKrw / 10000;
        const shares = Math.round((buyKcalPerStock / priceKcal) * 10000) / 10000;

        holdings[stock.code] = {
          amount: shares,
          avgPriceKcal: priceKcal
        };

        // Add to student activity logs
        const purchaseLogId = uid();
        await conn.query(
          "INSERT INTO activity_logs (id, student_id, summary, calory_delta, exp_delta, occurred_at, is_synced) VALUES (?, ?, ?, ?, 0, ?, 1)",
          [
            purchaseLogId,
            choi.id,
            `주식 매수: ${stock.name} (${stock.code}) ${shares}주 매수`,
            -buyKcalPerStock,
            occurredAt - 10000
          ]
        );

        // Add to stock market tradeLog
        stockMarket.tradeLog.unshift({
          id: uid(),
          studentId: choi.id,
          studentName: choi.name,
          code: stock.code,
          name: stock.name,
          type: "buy",
          shares: shares,
          priceKcal: priceKcal,
          priceKrw: priceKrw,
          totalKcal: buyKcalPerStock,
          occurredAt: occurredAt
        });
      }

      const choiPortfolio = { holdings };
      
      // Update Choi's database portfolio and keep calory balance (Reward +1000, Spent -1000 = net 0 change)
      await conn.query(
        "UPDATE students SET stock_portfolio = ? WHERE id = ?",
        [JSON.stringify(choiPortfolio), choi.id]
      );
      console.log(`[SUCCESS] Restored 최아현 stock portfolio and created activity logs.`);
    }

    // 4. Process Oh Ju-won (부반장 오주원 - 500 Cal reward, buys 50 Cal of each stock)
    if (oh) {
      console.log(`\n>>> Processing reward for 부반장 ${oh.name}...`);
      const buyKcalPerStock = 50;
      const holdings = {};

      // Create reward activity log
      const rewardLogId = uid();
      await conn.query(
        "INSERT INTO activity_logs (id, student_id, summary, calory_delta, exp_delta, occurred_at, is_synced) VALUES (?, ?, ?, ?, 0, ?, 1)",
        [rewardLogId, oh.id, "칭찬 보상 · 부반장 포상 (+500 Cal)", 500, occurredAt - 20000]
      );

      for (const stock of stocks) {
        const priceKrw = currentPrices[stock.code]?.price || 100000;
        const priceKcal = priceKrw / 10000;
        const shares = Math.round((buyKcalPerStock / priceKcal) * 10000) / 10000;

        holdings[stock.code] = {
          amount: shares,
          avgPriceKcal: priceKcal
        };

        // Add to student activity logs
        const purchaseLogId = uid();
        await conn.query(
          "INSERT INTO activity_logs (id, student_id, summary, calory_delta, exp_delta, occurred_at, is_synced) VALUES (?, ?, ?, ?, 0, ?, 1)",
          [
            purchaseLogId,
            oh.id,
            `주식 매수: ${stock.name} (${stock.code}) ${shares}주 매수`,
            -buyKcalPerStock,
            occurredAt - 10000
          ]
        );

        // Add to stock market tradeLog
        stockMarket.tradeLog.unshift({
          id: uid(),
          studentId: oh.id,
          studentName: oh.name,
          code: stock.code,
          name: stock.name,
          type: "buy",
          shares: shares,
          priceKcal: priceKcal,
          priceKrw: priceKrw,
          totalKcal: buyKcalPerStock,
          occurredAt: occurredAt
        });
      }

      const ohPortfolio = { holdings };

      // Update Oh's database portfolio and keep calory balance (Reward +500, Spent -500 = net 0 change)
      await conn.query(
        "UPDATE students SET stock_portfolio = ? WHERE id = ?",
        [JSON.stringify(ohPortfolio), oh.id]
      );
      console.log(`[SUCCESS] Restored 오주원 stock portfolio and created activity logs.`);
    }

    // 5. Save updated stockMarket settings back to database
    console.log('\n>>> Updating stock market trade logs...');
    await conn.query(
      "UPDATE settings SET `value` = ? WHERE `key` = 'stockMarket'",
      [JSON.stringify(stockMarket)]
    );
    console.log('>>> [SUCCESS] Successfully synced stock market trade logs.');

    await conn.commit();
    console.log('\n=============================================');
    console.log('🎉 [COMPLETE] Leaders rewarded and portfolios configured successfully!');
    console.log('=============================================');

  } catch (err) {
    await conn.rollback();
    console.error('❌ [ERROR] Processing failed:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main();
