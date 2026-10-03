const mariadb = require("mariadb");
require("dotenv").config();

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT),
  connectionLimit: 5
});

async function testConnection() {
  let connection;

  try {
    connection = await pool.getConnection();

    console.log("MariaDB connected successfully!");

  } catch (error) {
    console.error("MariaDB connection failed:", error.message);

  } finally {
    if (connection) {
      connection.release();
    }
  }
}

testConnection();

module.exports = pool;