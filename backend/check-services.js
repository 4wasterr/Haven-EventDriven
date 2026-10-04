const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const db = require('./db');
async function main() {
  try {
    const connection = await db.getConnection();
    try {
      console.log('Database reachable.');
      console.log((await connection.query('SHOW TABLES')).map(row => Object.values(row)[0]).join(', '));
    } finally { connection.release(); }
  } catch (error) { console.error('Database check:', error.code || 'connection failed'); process.exitCode = 1; }
  finally { await db.end(); }
}
main();
