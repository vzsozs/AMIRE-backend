const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // PostgreSQL kliens

const app = express();
const PORT = 3001; // A backend egy másik porton fut, mint a frontend

// --- Middleware-ek ---
app.use(cors()); // Engedélyezzük a CORS-t, hogy a frontendről is lehessen hívni
app.use(express.json()); // JSON formátumú kérések feldolgozása (Express beépített body-parser)

// --- Konfiguráció ---
// FONTOS: PostgreSQL adatbázis URL környezeti változóból!
// Ezt a Render-en kell beállítani a 'Environment' fülön.
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/database'; 

// FONTOS: Felhasználónév, jelszó és token környezeti változókból!
const USERNAME = process.env.AMIRE_USERNAME || 'admin'; // DEFAULT: admin
const PASSWORD = process.env.AMIRE_PASSWORD || 'admin'; // DEFAULT: admin
const FAKE_TOKEN = process.env.AMIRE_FAKE_TOKEN || 'amire-secret-token-xyz';
const APP_VERSION = '1.0.0'; // Alkalmazás verziószám

// --- Kezdeti adatok (DEFAULT), ha az adatbázis üres ---
const initialJobs = [
    { id: 1, title: 'Teszt munka', status: 'Folyamatban', deadline: '2025-09-10', description: 'Ez egy alapértelmezett teszt munka.', assignedTeam: [1], schedule: ['2025-09-01', '2025-09-02'], color: '#FF6F00', todoList: [{ id: 101, text: 'Teszt feladat', completed: false }] },
];
const initialTeam = [
    { id: 1, name: 'Béla', role: 'Segédmunkás', color: '#1E88E5', phone: '+36701234567', email: 'bela@amire.hu', availability: ['2025-09-01', '2025-09-02'] },
];

// --- PostgreSQL Pool létrehozása ---
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Szükséges a Render SSL-hez, ha nincs CA tanúsítvány
    }
});

// --- Adatbázis inicializálása (táblák létrehozása, ha nem léteznek) ---
const initializeDatabase = async () => {
    try {
        // Táblák létrehozása
        await pool.query(`
            CREATE TABLE IF NOT EXISTS jobs (
                id BIGINT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                status VARCHAR(50),
                deadline VARCHAR(10),
                description TEXT,
                assignedTeam BIGINT[],
                schedule VARCHAR(10)[],
                color VARCHAR(7),
                todoList JSONB -- JSONB típus a JSON objektumok tárolására
            );
            CREATE TABLE IF NOT EXISTS team (
                id BIGINT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                role VARCHAR(255),
                color VARCHAR(7),
                phone VARCHAR(50),
                email VARCHAR(255),
                availability VARCHAR(10)[]
            );
        `);
        console.log('[BACKEND] Adatbázis táblák ellenőrizve/létrehozva.');

        const jobCountResult = await pool.query('SELECT COUNT(*) FROM jobs');
        const jobCount = parseInt(jobCountResult.rows[0].count, 10); // Konvertálás számmá
        
        const teamCountResult = await pool.query('SELECT COUNT(*) FROM team');
        const teamCount = parseInt(teamCountResult.rows[0].count, 10); // Konvertálás számmá

        // Csak akkor szúrunk be alap adatokat, ha MINDEN tábla üres
        if (jobCount === 0 && teamCount === 0) {
            console.log('[BACKEND] Adatbázis üres, alap adatok beszúrása.');
            await insertInitialData();
        } else {
            console.log(`[BACKEND] Adatbázis már tartalmaz adatokat. Munkák: ${jobCount}, Csapat: ${teamCount}.`);
        }

    } catch (error) {
        console.error('[BACKEND] Hiba az adatbázis inicializálása során:', error);
    }
};

const insertInitialData = async () => {
    for (const job of initialJobs) { // Használjuk a fájl elején definiált initialJobs-ot
        await pool.query(
            `INSERT INTO jobs (id, title, status, deadline, description, assignedTeam, schedule, color, todoList)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [job.id, job.title, job.status, job.deadline, job.description, job.assignedTeam, job.schedule, job.color, JSON.stringify(job.todoList)]
        );
    }
    for (const member of initialTeam) { // Használjuk a fájl elején definiált initialTeam-et
        await pool.query(
            `INSERT INTO team (id, name, role, color, phone, email, availability)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [member.id, member.name, member.role, member.color, member.phone, member.email, member.availability]
        );
    }
    console.log('[BACKEND] Alap adatok sikeresen beszúrva.');
};

// --- Autentikációs Middleware ---
// Ellenőrzi a token érvényességét minden /api/ kérésnél, kivéve a login-t
const authenticateToken = (req, res, next) => {
    if (req.path === '/login' || req.path === '/version') {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN" formátum

    if (token == null) {
        console.log('[BACKEND] Hiba (401): Hiányzó token a nem-login kérésben.');
        return res.status(401).json({ message: 'Hozzáférés megtagadva: Hiányzó token.' });
    }

    if (token === FAKE_TOKEN) { // Egyszerű token ellenőrzés
        next();
    } else {
        console.log('[BACKEND] Hiba (403): Érvénytelen token.');
        return res.status(403).json({ message: 'Hozzáférés megtagadva: Érvénytelen token.' });
    }
};

// --- Alkalmazzuk a middleware-t ---
app.use('/api', authenticateToken);

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

// --- API végpontok: MUNKÁK (jobs) ---

// Munkák lekérése
app.post('/api/jobs', async (req, res) => {
    try {
        // A frontend nem küld ID-t, a backend generálja
        const newJob = { 
            id: Date.now(), 
            ...req.body,
            // Biztosítjuk, hogy a todoList mindig létezzen (üres tömbként), ha a frontend nem küldi
            todoList: req.body.todoList || [] 
        };
        console.log("[BACKEND] Új munka létrehozása. Adatok:", newJob);
        
        await pool.query(
            `INSERT INTO jobs (id, title, status, deadline, description, assignedTeam, schedule, color, todoList)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            // FONTOS: Itt a 'newJob.todoList'-et használjuk, nem a 'newJob.todolist'-et
            [newJob.id, newJob.title, newJob.status, newJob.deadline, newJob.description, newJob.assignedTeam, newJob.schedule, newJob.color, JSON.stringify(newJob.todoList)]
        );
        console.log("[BACKEND] Új munka sikeresen beszúrva az adatbázisba.");
        
        res.status(201).json(newJob);
    } catch (error) {
        console.error('[BACKEND] Hiba új munka hozzáadásakor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Új munka hozzáadása
app.post('/api/jobs', async (req, res) => {
    try {
        // A frontend nem küld ID-t, a backend generálja
        const newJob = { id: Date.now(), ...req.body };
        await pool.query(
            `INSERT INTO jobs (id, title, status, deadline, description, assignedTeam, schedule, color, todoList)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [newJob.id, newJob.title, newJob.status, newJob.deadline, newJob.description, newJob.assignedTeam, newJob.schedule, newJob.color, JSON.stringify(newJob.todoList)]
        );
        res.status(201).json(newJob);
    } catch (error) {
        console.error('[BACKEND] Hiba új munka hozzáadásakor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Munka frissítése
app.put('/api/jobs/:id', async (req, res) => {
    try {
        const jobId = Number(req.params.id);
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
        res.json({ ...result.rows[0], todoList: result.rows[0].todolist || [] }); // Itt is 'todoList'-et használunk!
    } catch (error) {
        console.error('[BACKEND] Hiba munka frissítésekor:', error);
        res.status(500).json({ message: 'Belső szerverhiba' });
    }
});

// Munka törlése
app.delete('/api/jobs/:id', async (req, res) => {
    try {
        const jobId = Number(req.params.id);
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
        // A frontend nem küld ID-t, a backend generálja
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
app.listen(PORT, async () => { // Async függvény, mert initializeDatabase async
    console.log('[BACKEND] Server starting...');
    await initializeDatabase(); // Adatbázis inicializálása
    console.log(`[BACKEND] Server running on http://localhost:${PORT}, Version: ${APP_VERSION}`);
});