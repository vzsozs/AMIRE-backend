const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = 3001;

// --- Middleware-ek ---
app.use(cors());
app.use(express.json());

// --- Konfiguráció ---
const DATABASE_URL = process.env.DATABASE_URL;
const USERNAME = process.env.AMIRE_USERNAME || 'admin';
const PASSWORD = process.env.AMIRE_PASSWORD || 'admin';
const FAKE_TOKEN = process.env.AMIRE_FAKE_TOKEN || 'amire-secret-token-xyz';
const APP_VERSION = '1.0.0';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- Adatbázis inicializálása ---
const initializeDatabase = async () => {
    try {
        // FONTOS: Az 'id' oszlopot BIGSERIAL-re cseréljük!
        // Ez egy auto-inkrementált 64-bites egész szám.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS jobs (
                id BIGSERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                status VARCHAR(50),
                deadline VARCHAR(10),
                description TEXT,
                assignedTeam BIGINT[],
                schedule VARCHAR(10)[],
                color VARCHAR(7),
                todoList JSONB
            );
            CREATE TABLE IF NOT EXISTS team (
                id BIGSERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(255),
                color VARCHAR(7),
                phone VARCHAR(50),
                email VARCHAR(255),
                availability VARCHAR(10)[]
            );
        `);
        console.log('[BACKEND] Adatbázis táblák ellenőrizve/létrehozva (BIGSERIAL ID-vel).');
        
        const jobCountResult = await pool.query('SELECT COUNT(*) FROM jobs');
        if (parseInt(jobCountResult.rows[0].count, 10) === 0) {
            console.log('[BACKEND] Jobs tábla üres, alap adat beszúrása.');
            await pool.query(
                `INSERT INTO jobs (title, status, deadline, description, assignedTeam, schedule, color, todoList) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                ['Teszt munka', 'Folyamatban', '2025-09-10', 'Ez egy alapértelmezett teszt munka.', [1], ['2025-09-01', '2025-09-02'], '#FF6F00', JSON.stringify([{ id: Date.now(), text: 'Teszt feladat', completed: false }])]
            );
        }

        const teamCountResult = await pool.query('SELECT COUNT(*) FROM team');
        if (parseInt(teamCountResult.rows[0].count, 10) === 0) {
            console.log('[BACKEND] Team tábla üres, alap adat beszúrása.');
            await pool.query(
                `INSERT INTO team (name, role, color, phone, email, availability) VALUES ($1, $2, $3, $4, $5, $6)`,
                ['Béla', 'Segédmunkás', '#1E88E5', '+36701234567', 'bela@amire.hu', ['2025-09-01', '2025-09-02']]
            );
        }
    } catch (error) {
        console.error('[BACKEND] Hiba az adatbázis inicializálása során:', error);
    }
};

// --- Autentikációs Middleware ---
const authenticateToken = (req, res, next) => {
    if (req.path === '/login' || req.path === '/version') {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ message: 'Hozzáférés megtagadva: Hiányzó token.' });
    }

    if (token === FAKE_TOKEN) {
        next();
    } else {
        return res.status(403).json({ message: 'Hozzáférés megtagadva: Érvénytelen token.' });
    }
};

// --- API végpontok: LOGIN ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (username === USERNAME && password === PASSWORD) {
        return res.json({ message: 'Sikeres bejelentkezés!', token: FAKE_TOKEN, version: APP_VERSION });
    } else {
        return res.status(401).json({ message: 'Hibás felhasználónév vagy jelszó.' });
    }
});

// --- API végpontok: VERZIÓ ---
app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION });
});

// --- Alkalmazzuk a middleware-t ---
app.use('/api', authenticateToken);


// --- API végpontok: MUNKÁK (jobs) ---

// Munkák lekérése
app.get('/api/jobs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM jobs');
        const jobs = result.rows.map(job => ({
            ...job,
            todoList: job.todolist || [] // Biztosítjuk, hogy mindig tömb legyen
        }));
        res.json(jobs);
    } catch (error) {
        console.error('[BACKEND] Hiba munkák lekérésekor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Új munka hozzáadása
app.post('/api/jobs', async (req, res) => {
    try {
        const { title, status, deadline, description, assignedTeam, schedule, color, todoList } = req.body;
        // Az adatbázis generálja az ID-t, a RETURNING * visszaadja a teljes sort
        const result = await pool.query(
            `INSERT INTO jobs (title, status, deadline, description, assignedTeam, schedule, color, todoList)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                title || 'Nincs cím',
                status || 'Függőben',
                deadline || null,
                description || '',
                Array.isArray(assignedTeam) ? assignedTeam.map(Number) : [],
                schedule || [],
                color || '#607D8B',
                JSON.stringify(todoList || [])
            ]
        );
        const newJob = { ...result.rows[0], todolist: result.rows[0].todolist || [] };
        console.log("[BACKEND] Új munka sikeresen beszúrva. Visszaadott adat:", newJob);
        res.status(201).json(newJob);
    } catch (error) {
        console.error('[BACKEND] Hiba új munka hozzáadásakor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Munka frissítése
app.put('/api/jobs/:id', async (req, res) => {
    try {
        const jobId = req.params.id; // Stringként kezeljük, a PostgreSQL tudja kezelni
        const { title, status, deadline, description, assignedTeam, schedule, color, todoList } = req.body;
        
        const result = await pool.query(
            `UPDATE jobs SET
                title = $1, status = $2, deadline = $3, description = $4,
                assignedTeam = $5, schedule = $6, color = $7, todoList = $8
             WHERE id = $9 RETURNING *`,
            [title, status, deadline, description, assignedTeam, schedule, color, JSON.stringify(todoList), jobId]
        );

        if (result.rows.length === 0) {
            console.log(`[BACKEND] Hiba: Munka (ID: ${jobId}) nem található frissítéskor.`);
            return res.status(404).json({ message: 'Munka nem található.' });
        }
        res.json({ ...result.rows[0], todoList: result.rows[0].todolist || [] }); // Visszaadjuk a frissített objektumot
    } catch (error) {
        console.error('[BACKEND] Hiba munka frissítésekor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Munka törlése
app.delete('/api/jobs/:id', async (req, res) => {
    try {
        const jobId = req.params.id; // Stringként kezeljük
        const result = await pool.query('DELETE FROM jobs WHERE id = $1 RETURNING id', [jobId]);

        if (result.rows.length === 0) {
            console.log(`[BACKEND] Hiba: Munka (ID: ${jobId}) nem található törléskor.`);
            return res.status(404).json({ message: 'Munka nem található.' });
        }
        res.status(204).send();
    } catch (error) {
        console.error('[BACKEND] Hiba munka törlésekor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// --- API végpontok: CSAPAT (team) ---

// Csapat lekérése
app.get('/api/team', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM team');
        res.json(result.rows);
    } catch (error) {
        console.error('[BACKEND] Hiba csapat lekérésekor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Új csapattag hozzáadása
app.post('/api/team', async (req, res) => {
    try {
        const newMember = { id: Date.now(), ...req.body };
        await pool.query(
            `INSERT INTO team (id, name, role, color, phone, email, availability)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [newMember.id, newMember.name, newMember.role, newMember.color, newMember.phone, newMember.email, newMember.availability]
        );
        res.status(201).json(newMember);
    } catch (error) {
        console.error('[BACKEND] Hiba új csapattag hozzáadásakor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Csapattag frissítése
app.put('/api/team/:id', async (req, res) => {
    try {
        const memberId = Number(req.params.id);
        const { name, role, color, phone, email, availability } = req.body;
        
        const result = await pool.query(
            `UPDATE team SET
                name = $1, role = $2, color = $3, phone = $4, email = $5, availability = $6
             WHERE id = $7 RETURNING *`,
            [name, role, color, phone, email, availability, memberId]
        );

        if (result.rows.length === 0) {
            console.log(`[BACKEND] Hiba: Csapattag (ID: ${memberId}) nem található frissítéskor.`);
            return res.status(404).json({ message: 'Csapattag nem található.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[BACKEND] Hiba csapattag frissítésekor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Csapattag törlése
app.delete('/api/team/:id', async (req, res) => {
    try {
        const memberId = Number(req.params.id);
        const result = await pool.query('DELETE FROM team WHERE id = $1 RETURNING id', [memberId]);

        if (result.rows.length === 0) {
            console.log(`[BACKEND] Hiba: Csapattag (ID: ${memberId}) nem található törléskor.`);
            return res.status(404).json({ message: 'Csapattag nem található.' });
        }
        res.status(204).send();
    } catch (error) {
        console.error('[BACKEND] Hiba csapattag törlésekor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});


// Server indítása
app.listen(PORT, async () => {
    console.log('[BACKEND] Server starting...');
    await initializeDatabase();
    console.log(`[BACKEND] Server running on http://localhost:${PORT}, Version: ${APP_VERSION}`);
});