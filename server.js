const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // PostgreSQL kliens
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- Konfiguráció ---
// FONTOS: PostgreSQL adatbázis URL környezeti változóból!
// Ezt a Render-en kell beállítani a 'Environment' fülön.
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/database'; 

// FONTOS: Felhasználónév, jelszó és token környezeti változókból!
const USERNAME = process.env.AMIRE_USERNAME || 'amire_default';
const PASSWORD = process.env.AMIRE_PASSWORD || 'default_password_2025';
const FAKE_TOKEN = process.env.AMIRE_FAKE_TOKEN || 'amire-secret-token-xyz';
const APP_VERSION = '1.0.0';

// --- PostgreSQL Pool létrehozása ---
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Szükséges a Render SSL-hez
    }
});

// --- Adatbázis inicializálása (táblák létrehozása, ha nem léteznek) ---
const initializeDatabase = async () => {
    try {
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
                todoList JSONB
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

        // Kezdeti adatok beszúrása, ha az asztalok üresek
        const jobCount = (await pool.query('SELECT COUNT(*) FROM jobs')).rows[0].count;
        const teamCount = (await pool.query('SELECT COUNT(*) FROM team')).rows[0].count;

        if (jobCount == 0 && teamCount == 0) {
            console.log('[BACKEND] Adatbázis üres, alap adatok beszúrása.');
            await insertInitialData();
        }

    } catch (error) {
        console.error('[BACKEND] Hiba az adatbázis inicializálása során:', error);
    }
};

const insertInitialData = async () => {
    const initialJobs = [
        { id: 1, title: 'Gábor Lakásfelújítás', status: 'Folyamatban', deadline: '2025-09-01', description: 'Teljes lakásfestés, glettelés és mázolás.', assignedTeam: [1, 4], schedule: ['2025-09-01', '2025-09-02', '2025-09-03', '2025-09-04'], color: '#FF6F00', todoList: [{ id: 101, text: 'Megvenni a festéket', completed: true }, { id: 102, text: 'Glettelni a falakat', completed: false }, { id: 103, text: 'Fóliázás és takarás', completed: false }] },
        { id: 2, title: 'Kovács Iroda Festés', status: 'Befejezve', deadline: '2025-08-20', description: 'Az iroda tárgyalójának és folyosójának tisztasági festése.', assignedTeam: [1], schedule: ['2025-08-18', '2025-08-19', '2025-08-20'], color: '#3F51B5', todoList: [{ id: 201, text: 'Elszállítani az irodabútorokat', completed: true }, { id: 202, text: 'Festés befejezése', completed: false }] },
        { id: 3, title: 'Nagy Családi Ház Vízszerelés', status: 'Folyamatban', deadline: '2025-09-30', description: 'Fürdőszoba és konyha vízvezetékeinek cseréje.', assignedTeam: [2], schedule: ['2025-09-29', '2025-09-30'], color: '#00BCD4', todoList: [] },
        { id: 4, title: 'Tervezési Fázis - Új Projekt', status: 'Függőben', deadline: '2025-10-05', description: 'Új építkezés előkészítése, anyagbeszerzés tervezése.', assignedTeam: [], schedule: [], color: '#8BC34A', todoList: [{ id: 401, text: 'Engedélyek beszerzése', completed: false }] },
    ];
    const initialTeam = [
        { id: 1, name: 'Varga Béla', role: 'Festő, Mázoló', color: '#FF6F00', phone: '+36301234567', email: 'bela@amire.hu', availability: ['2025-09-01', '2025-09-16', '2025-09-17'] },
        { id: 2, name: 'Kiss Mária', role: 'Vízvezeték-szerelő', color: '#1E88E5', phone: '+36301112222', email: 'maria@amire.hu', availability: ['2025-09-01', '2025-09-17', '2025-09-18', '2025-09-29', '2025-09-30'] },
        { id: 3, name: 'Nagy Gábor', role: 'Projektvezető', color: '#00ACC1', phone: '+36209876543', email: 'gabor@amire.hu', availability: ['2025-09-01', '2025-09-22', '2025-09-23'] },
        { id: 4, name: 'Horváth Éva', role: 'Segédmunkás', color: '#7CB342', phone: '', email: 'eva@amire.hu', availability: ['2025-09-01', '2025-09-16'] },
    ];

    for (const job of initialJobs) {
        await pool.query(
            `INSERT INTO jobs (id, title, status, deadline, description, assignedTeam, schedule, color, todoList)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [job.id, job.title, job.status, job.deadline, job.description, job.assignedTeam, job.schedule, job.color, JSON.stringify(job.todoList)]
        );
    }
    for (const member of initialTeam) {
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
    // A login és verzió végpontoknak nem kell token
    if (req.path === '/login' || req.path === '/version') {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN" formátum

    if (token == null) {
        // console.log('[BACKEND] Hiba (401): Hiányzó token a nem-login kérésben.'); // Debug
        return res.status(401).json({ message: 'Hozzáférés megtagadva: Hiányzó token.' });
    }

    if (token === FAKE_TOKEN) { // Egyszerű token ellenőrzés
        next(); // Token érvényes, folytatjuk a kéréssel
    } else {
        // console.log('[BACKEND] Hiba (403): Érvénytelen token.'); // Debug
        return res.status(403).json({ message: 'Hozzáférés megtagadva: Érvénytelen token.' });
    }
};

// --- Alkalmazzuk a middleware-t ---
app.use('/api', authenticateToken);

// --- API végpontok: LOGIN ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // console.log(`[BACKEND] Login kérés érkezett. Felhasználónév: "${username}", Jelszó: "${password}"`); // Debug
    // console.log(`[BACKEND] Backend beállított felhasználónév: "${USERNAME}", Jelszó: "${PASSWORD}"`); // Debug

    if (username === USERNAME && password === PASSWORD) {
        // console.log("[BACKEND] Sikeres bejelentkezés."); // Debug
        return res.json({ message: 'Sikeres bejelentkezés!', token: FAKE_TOKEN, version: APP_VERSION }); // Verziószám is hozzáadva
    } else {
        // console.log("[BACKEND] Sikertelen bejelentkezés."); // Debug
        return res.status(401).json({ message: 'Hibás felhasználónév vagy jelszó.' });
    }
});

// --- API végpontok: VERZIÓ ---
app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION });
});

// --- API végpontok: MUNKÁK (jobs) ---

// Munkák lekérése
app.get('/api/jobs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM jobs');
        // A todoList JSONB oszlopot vissza kell alakítani JSON objektummá
        const jobs = result.rows.map(job => ({
            ...job,
            todolist: job.todolist || [] // Biztosítjuk, hogy mindig tömb legyen
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
        res.json({ ...result.rows[0], todolist: result.rows[0].todolist || [] }); // Visszaadjuk a frissített objektumot
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