const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

const DB_FILE = path.join(__dirname, 'db.json');

// --- Helyi, ideiglenes felhasználónév és jelszó ---
const USERNAME = 'amire'; // Cseréld le, ha akarod
const PASSWORD = 'ErimA-2025'; // Cseréld le egy erősebbre! NE EZT HASZNÁLD ÉLESBEN!
const FAKE_TOKEN = 'fake-jwt-token-for-amire'; // Ugyanaz a token, mint a frontendben
// ----------------------------------------------------


// Kezdeti adatok, ha a db.json még nem létezik
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

const loadData = () => {
    if (fs.existsSync(DB_FILE)) {
        const rawData = fs.readFileSync(DB_FILE);
        data = JSON.parse(rawData);
    } else {
        saveData();
    }
};

const saveData = () => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// --- Autentikációs Middleware ---
// Ez a függvény minden '/api/' útvonalra érkező kérést ellenőrizni fog
const authenticateToken = (req, res, next) => {
    // FONTOS JAVÍTÁS: A LOGIN VÉGPONT KIZÁRÁSA
    if (req.path === '/api/login') {
        return next(); // Ha login kérés, NEM KELL TOKEN, folytatjuk
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

// Alkalmazzuk az autentikációs middleware-t az összes '/api/' útvonalra
app.use('/api', authenticateToken);

// --- API végpontok: LOGIN ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // HIBAKERESÉS: LOGOLJUK KI A BEÉRKEZŐ ADATOKAT!
    console.log(`Login kérés érkezett. Felhasználónév: "${username}", Jelszó: "${password}"`);
    console.log(`Backend beállított felhasználónév: "${USERNAME}", Jelszó: "${PASSWORD}"`);

    if (username === USERNAME && password === PASSWORD) {
        console.log("Sikeres bejelentkezés a backendről.");
        return res.json({ message: 'Sikeres bejelentkezés!', token: FAKE_TOKEN });
    } else {
        console.log("Sikertelen bejelentkezés a backendről.");
        return res.status(401).json({ message: 'Hibás felhasználónév vagy jelszó.' });
    }
});

// --- API végpontok: MUNKÁK (jobs) ---

// Munkák lekérése (READ - GET)
app.get('/api/jobs', (req, res) => {
    res.json(data.jobs);
});

// Új munka hozzáadása (CREATE - POST)
app.post('/api/jobs', (req, res) => {
    const newJob = { id: Date.now(), ...req.body };
    data.jobs.push(newJob);
    saveData();
    res.status(201).json(newJob); // 201 Created státusz
});

// Munka frissítése (UPDATE - PUT)
app.put('/api/jobs/:id', (req, res) => {
    const jobId = Number(req.params.id);
    const jobIndex = data.jobs.findIndex(job => job.id === jobId);

    if (jobIndex === -1) {
        return res.status(404).json({ message: 'Munka nem található.' });
    }

    data.jobs[jobIndex] = { ...data.jobs[jobIndex], ...req.body, id: jobId };
    saveData();
    res.json(data.jobs[jobIndex]);
});

// Munka törlése (DELETE - DELETE)
app.delete('/api/jobs/:id', (req, res) => {
    const jobId = Number(req.params.id);
    const initialLength = data.jobs.length;
    data.jobs = data.jobs.filter(job => job.id !== jobId);

    if (data.jobs.length === initialLength) {
        return res.status(404).json({ message: 'Munka nem található.' });
    }
    saveData();
    res.status(204).send(); // 204 No Content státusz
});

// --- API végpontok: CSAPAT (team) ---

// Csapat lekérése (READ - GET)
app.get('/api/team', (req, res) => {
    res.json(data.team);
});

// Új csapattag hozzáadása (CREATE - POST)
app.post('/api/team', (req, res) => {
    const newMember = { id: Date.now(), ...req.body };
    data.team.push(newMember);
    saveData();
    res.status(201).json(newMember);
});

// Csapattag frissítése (UPDATE - PUT)
app.put('/api/team/:id', (req, res) => {
    const memberId = Number(req.params.id);
    const memberIndex = data.team.findIndex(member => member.id === memberId);

    if (memberIndex === -1) {
        return res.status(404).json({ message: 'Csapattag nem található.' });
    }

    data.team[memberIndex] = { ...data.team[memberIndex], ...req.body, id: memberId };
    saveData();
    res.json(data.team[memberIndex]);
});

// Csapattag törlése (DELETE - DELETE)
app.delete('/api/team/:id', (req, res) => {
    const memberId = Number(req.params.id);
    const initialLength = data.team.length;
    data.team = data.team.filter(member => member.id !== memberId);

    if (data.team.length === initialLength) {
        return res.status(404).json({ message: 'Csapattag nem található.' });
    }
    saveData();
    res.status(204).send();
});


// Server indítása
app.listen(PORT, () => {
    loadData();
    console.log(`Backend server running on http://localhost:${PORT}`);
});