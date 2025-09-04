const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001; // A backend egy másik porton fut, mint a frontend

// --- Middleware-ek ---
app.use(cors()); // Engedélyezzük a CORS-t, hogy a frontendről is lehessen hívni
app.use(express.json()); // JSON formátumú kérések feldolgozása (Express beépített body-parser)

// --- Konfiguráció ---
const DB_FILE = path.join(__dirname, 'db.json'); // Az "adatbázis" fájl elérési útja

// FONTOS: Felhasználónév, jelszó és token környezeti változókból!
// Ha Render-en vagy, ezeket ott kell beállítani a 'Environment' fülön.
// Ha helyi gépen futtatod, egy '.env' fájlt kell létrehozni a backend mappában.
const USERNAME = process.env.AMIRE_USERNAME || 'amire_default'; // Alapértelmezett, ha nincs beállítva
const PASSWORD = process.env.AMIRE_PASSWORD || 'default_password_2025'; // Alapértelmezett, ha nincs beállítva
const FAKE_TOKEN = process.env.AMIRE_FAKE_TOKEN || 'amire-secret-token-xyz'; // Alapértelmezett, ha nincs beállítva
const APP_VERSION = '1.0.0'; // Alkalmazás verziószám

// --- Kezdeti adatok, ha a db.json még nem létezik ---
// EZEKET PONTOSAN AZ initialJobs ÉS initialTeam LISTÁIDNAK KELL LENNIEK AZ App.jsx-ből!
// A localStorage-ban a token tárolódik, ha bejelentkezünk.
let data = {
    jobs: [
        { id: 1, title: 'Gábor Lakásfelújítás', status: 'Folyamatban', deadline: '2025-09-15', description: 'Teljes lakásfestés, glettelés és mázolás.', assignedTeam: [1, 4], schedule: ['2025-09-01', '2025-09-02', '2025-09-03', '2025-09-04'], color: '#FF6F00', todoList: [{ id: 101, text: 'Megvenni a festéket', completed: true }, { id: 102, text: 'Glettelni a falakat', completed: false }, { id: 103, text: 'Fóliázás és takarás', completed: false }] },
        { id: 2, title: 'Kovács Iroda Festés', status: 'Befejezve', deadline: '2025-08-20', description: 'Az iroda tárgyalójának és folyosójának tisztasági festése.', assignedTeam: [1], schedule: ['2025-08-18', '2025-08-19', '2025-08-20'], color: '#3F51B5', todoList: [{ id: 201, text: 'Elszállítani az irodabútorokat', completed: true }, { id: 202, text: 'Festés befejezése', completed: false }] },
        { id: 3, title: 'Nagy Családi Ház Vízszerelés', status: 'Folyamatban', deadline: '2025-09-30', description: 'Fürdőszoba és konyha vízvezetékeinek cseréje.', assignedTeam: [2], schedule: ['2025-09-29', '2025-09-30'], color: '#00BCD4', todoList: [] },
        { id: 4, title: 'Tervezési Fázis - Új Projekt', status: 'Függőben', deadline: '2025-10-05', description: 'Új építkezés előkészítése, anyagbeszerzés tervezése.', assignedTeam: [], schedule: [], color: '#8BC34A', todoList: [{ id: 401, text: 'Engedélyek beszerzése', completed: false }] },
    ],
    team: [
        { id: 1, name: 'Varga Béla', role: 'Festő, Mázoló', color: '#FF6F00', phone: '+36301234567', email: 'bela@amire.hu', availability: ['2025-09-01', '2025-09-16', '2025-09-17'] },
        { id: 2, name: 'Kiss Mária', role: 'Vízvezeték-szerelő', color: '#1E88E5', phone: '+36301112222', email: 'maria@amire.hu', availability: ['2025-09-01', '2025-09-17', '2025-09-18', '2025-09-29', '2025-09-30'] },
        { id: 3, name: 'Nagy Gábor', role: 'Projektvezető', color: '#00ACC1', phone: '+36209876543', email: 'gabor@amire.hu', availability: ['2025-09-01', '2025-09-22', '2025-09-23'] },
        { id: 4, name: 'Horváth Éva', role: 'Segédmunkás', color: '#7CB342', phone: '', email: 'eva@amire.hu', availability: ['2025-09-01', '2025-09-16'] },
    ],
};

// Adatok betöltése a JSON fájlból induláskor
const loadData = () => {
    if (fs.existsSync(DB_FILE)) {
        try {
            const rawData = fs.readFileSync(DB_FILE, 'utf8');
            data = JSON.parse(rawData);
            // console.log('[BACKEND] Adatok betöltve a db.json-ból.'); // Debug
        } catch (error) {
            console.error('[BACKEND] Hiba a db.json olvasása vagy feldolgozása során:', error);
            saveData(); // Létrehozunk egy új fájlt, ha a régi hibás
        }
    } else {
        // console.log('[BACKEND] db.json fájl nem található, létrehozzuk az alap adatokkal.'); // Debug
        saveData(); // Létrehozzuk a fájlt az alap adatokkal
    }
};

// Adatok mentése a JSON fájlba
const saveData = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); // Szépen formázva írjuk ki
        // console.log('[BACKEND] Adatok sikeresen elmentve a db.json-ba.'); // Debug
    } catch (error) {
        console.error('[BACKEND] Hiba a db.json mentése során:', error);
    }
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
app.get('/api/jobs', (req, res) => {
    res.json(data.jobs);
});

// Új munka hozzáadása
app.post('/api/jobs', (req, res) => {
    const newJob = { id: Date.now(), ...req.body };
    data.jobs.push(newJob);
    saveData();
    res.status(201).json(newJob);
});

// Munka frissítése
app.put('/api/jobs/:id', (req, res) => {
    const jobId = Number(req.params.id);
    const jobIndex = data.jobs.findIndex(job => job.id === jobId);

    if (jobIndex === -1) {
        // console.log(`[BACKEND] Hiba: Munka (ID: ${jobId}) nem található frissítéskor.`); // Debug
        return res.status(404).json({ message: 'Munka nem található.' });
    }

    data.jobs[jobIndex] = { ...data.jobs[jobIndex], ...req.body, id: jobId };
    saveData();
    res.json(data.jobs[jobIndex]);
});

// Munka törlése
app.delete('/api/jobs/:id', (req, res) => {
    const jobId = Number(req.params.id);
    const initialLength = data.jobs.length;
    data.jobs = data.jobs.filter(job => job.id !== jobId);

    if (data.jobs.length === initialLength) {
        // console.log(`[BACKEND] Hiba: Munka (ID: ${jobId}) nem található törléskor.`); // Debug
        return res.status(404).json({ message: 'Munka nem található.' });
    }
    saveData();
    res.status(204).send();
});

// --- API végpontok: CSAPAT (team) ---

// Csapat lekérése
app.get('/api/team', (req, res) => {
    res.json(data.team);
});

// Új csapattag hozzáadása
app.post('/api/team', (req, res) => {
    const newMember = { id: Date.now(), ...req.body };
    data.team.push(newMember);
    saveData();
    res.status(201).json(newMember);
});

// Csapattag frissítése
app.put('/api/team/:id', (req, res) => {
    const memberId = Number(req.params.id);
    const memberIndex = data.team.findIndex(member => member.id === memberId);

    if (memberIndex === -1) {
        // console.log(`[BACKEND] Hiba: Csapattag (ID: ${memberId}) nem található frissítéskor.`); // Debug
        return res.status(404).json({ message: 'Csapattag nem található.' });
    }

    data.team[memberIndex] = { ...data.team[memberIndex], ...req.body, id: memberId };
    saveData();
    res.json(data.team[memberIndex]);
});

// Csapattag törlése
app.delete('/api/team/:id', (req, res) => {
    const memberId = Number(req.params.id);
    const initialLength = data.team.length;
    data.team = data.team.filter(member => member.id !== memberId);

    if (data.team.length === initialLength) {
        // console.log(`[BACKEND] Hiba: Csapattag (ID: ${memberId}) nem található törléskor.`); // Debug
        return res.status(404).json({ message: 'Csapattag nem található.' });
    }
    saveData();
    res.status(204).send();
});


// Server indítása
app.listen(PORT, () => {
    loadData();
    console.log(`[BACKEND] Server running on http://localhost:${PORT}, Version: ${APP_VERSION}`);
});