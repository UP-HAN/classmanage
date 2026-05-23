const mysql = require('mysql2/promise');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const asyncLocalStorage = new AsyncLocalStorage();

const baseConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const defaultDbName = process.env.DB_NAME || 'class_tool';
const pools = {};

function getPool(dbName) {
  if (!pools[dbName]) {
    console.log(`[DB Pool] Creating connection pool for database: ${dbName}`);
    pools[dbName] = mysql.createPool({
      ...baseConfig,
      database: dbName
    });
  }
  return pools[dbName];
}

const dbWrapper = {
  getPoolForCurrentRequest() {
    const store = asyncLocalStorage.getStore();
    const dbName = store ? store.dbName : defaultDbName;
    return getPool(dbName);
  },
  query(...args) {
    return this.getPoolForCurrentRequest().query(...args);
  },
  execute(...args) {
    return this.getPoolForCurrentRequest().execute(...args);
  },
  getConnection(...args) {
    return this.getPoolForCurrentRequest().getConnection(...args);
  },
  asyncLocalStorage,
  defaultDbName,
  getPool
};

module.exports = dbWrapper;

