const mariadb = require("mariadb");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  connectionLimit: 5,
  acquireTimeout: 10000,
  connectTimeout: 5000,
  timezone: 'Z',
  initSql: "SET time_zone = '+00:00'"
});

module.exports = pool;
