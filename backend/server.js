const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/api/test", (req, res) => {
    res.json({
        message: "POST API is working!"
    });
});
// ==============================
// HOME
// ==============================

app.get("/", (req, res) => {
    res.json({
        message: "Haven backend is running"
    });
});


// ==============================
// REGISTER USER
// ==============================

app.post("/api/register", async (req, res) => {

    const {
        first_name,
        last_name,
        middle_initial,
        birthday,
        password_hash,
        email,
        mobile_number,
        house_street,
        country,
        city,
        state,
        zip_code
    } = req.body;

    // Check required fields
    if (
        !first_name ||
        !last_name ||
        !birthday ||
        !password_hash ||
        !email ||
        !mobile_number ||
        !house_street ||
        !country ||
        !city ||
        !state ||
        !zip_code
    ) {
        return res.status(400).json({
            message: "Required fields are missing."
        });
    }

    let connection;

    try {

        connection = await db.getConnection();

        // Check if email already exists
        const existingUser = await connection.query(
            "SELECT id FROM users WHERE email = ? LIMIT 1",
            [email]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({
                message: "Email already exists."
            });
        }

        // Generate UUIDs
        const userId = crypto.randomUUID();
        const addressId = crypto.randomUUID();

        // Insert user
        await connection.query(
            `
            INSERT INTO users (
                id,
                first_name,
                last_name,
                middle_initial,
                birthday,
                password_hash,
                email,
                mobile_number
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                userId,
                first_name,
                last_name,
                middle_initial || null,
                birthday,
                password_hash,
                email,
                mobile_number
            ]
        );

        // Insert address
        await connection.query(
            `
            INSERT INTO addresses (
                id,
                user_id,
                house_street,
                country,
                city,
                state,
                zip_code
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                addressId,
                userId,
                house_street,
                country,
                city,
                state,
                zip_code
            ]
        );

        res.status(201).json({
            message: "Registration successful.",
            user_id: userId
        });

    } catch (error) {

        console.error("Registration failed:", error);

        res.status(500).json({
            message: "Registration failed.",
            error: error.message
        });

    } finally {

        if (connection) {
            connection.release();
        }

    }
});


// ==============================
// SERVER
// ==============================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});