// Idempotent additions only: existing accounts and tokens are preserved.
const tables = [
  `CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY, first_name VARCHAR(50) NOT NULL, last_name VARCHAR(50) NOT NULL,
    middle_initial VARCHAR(2), birthday DATE NOT NULL, password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE, email_verified_at TIMESTAMP NULL, mobile_number VARCHAR(20) NOT NULL,
    mobile_verified BOOLEAN DEFAULT FALSE, failed_login_attempts INT DEFAULT 0,
    is_locked BOOLEAN DEFAULT FALSE, lockout_until TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS addresses (
    id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, house_street VARCHAR(255) NOT NULL,
    country VARCHAR(100) NOT NULL, city VARCHAR(100) NOT NULL, state VARCHAR(100) NOT NULL, zip_code VARCHAR(20) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS verification_tokens (
    id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, token_hash VARCHAR(255) NOT NULL,
    type ENUM('email_verify','mobile_otp','password_reset','account_unlock') NOT NULL, expires_at TIMESTAMP NOT NULL,
    INDEX (token_hash,type), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL,
    type ENUM('verification','authenticated') NOT NULL, expires_at DATETIME(3) NOT NULL,
    INDEX (expires_at), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS mobile_verifications (
    user_id CHAR(36) PRIMARY KEY, provider_id VARCHAR(255), expires_at DATETIME(3), resend_at DATETIME(3),
    attempts INT NOT NULL DEFAULT 0, is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS api_rate_limits (
    rate_key CHAR(64) PRIMARY KEY, count INT NOT NULL DEFAULT 0, reset_at DATETIME(3) NOT NULL, INDEX (reset_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];
async function ensureSchema(db) { for (const statement of tables) await db.query(statement); }
module.exports = { ensureSchema };
