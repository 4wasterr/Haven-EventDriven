const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const db = require("./db");
const { createApp } = require("./app");
const { ensureSchema } = require('./schema');
const fs = require('fs');
const https = require('https');

const PORT = process.env.PORT || 5000;
async function start() {
    try {
        const production = process.env.NODE_ENV === 'production';
        const tls = process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE;
        if (production && (!process.env.PUBLIC_APP_URL?.startsWith('https://') || (!tls && process.env.TRUST_PROXY !== '1'))) {
            throw new Error('Production requires an HTTPS PUBLIC_APP_URL and TLS certificates or a trusted TLS 1.3 reverse proxy.');
        }
        await ensureSchema(db);
        const app = createApp({ db });
        const server = tls ? https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT_FILE),
            key: fs.readFileSync(process.env.TLS_KEY_FILE), minVersion: 'TLSv1.3' }, app) : require('http').createServer(app);
        server.on('error', error => { console.error(`Backend startup failed: ${error.code || error.message}`); db.end(); process.exitCode = 1; });
        server.listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`Haven running on ${tls ? 'https' : 'http'}://localhost:${PORT}`));
        const stop = () => server.close(() => db.end().then(() => process.exit(0)));
        process.on('SIGINT', stop); process.on('SIGTERM', stop);
    } catch (error) {
        console.error(`Backend startup failed: ${error.code || error.message}`);
        await db.end(); process.exitCode = 1;
    }
}
start();
