const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

app.use(express.static(path.join(__dirname, 'public')));

// --- ROUTES ---
app.get('/list', (req, res) => res.sendFile(path.join(__dirname, 'public', 'list.html')));
app.get('/api/games', (req, res) => {
    try {
        const files = fs.readdirSync(path.join(__dirname, 'public'));
        // Correction : On vérifie que c'est bien diapo + des chiffres + .html
        const games = files.filter(f => {
            const match = f.match(/^diapo(\d+)\.html$/);
            return match !== null;
        })
        .map(f => {
            const id = f.replace('diapo', '').replace('.html', '');
            return { id: id, url: f.replace('.html', ''), filename: f };
        })
        .sort((a, b) => parseInt(a.id) - parseInt(b.id));
        res.json(games);
    } catch (err) { res.status(500).json({ error: "Erreur" }); }
});
app.get('/diapo:id', (req, res) => {
    const filePath = path.join(__dirname, 'public', `diapo${req.params.id}.html`);
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send("Module introuvable.");
});

// --- LOGIQUE SOCKET ---
let rooms = { 'global': { host: null, users: [], players: {} } };
let gamePlayers = {}; 
let highScores = []; 

// Data spécifique pour Diapo2 (Cercle & Attaque)
let d2Players = {};

function emitRooms() {
    const list = Object.keys(rooms).map(n => ({
        name: n, userCount: rooms[n].users.length, isGlobal: n === 'global'
    }));
    io.emit('room list', list);
}

io.on('connection', (socket) => {
    emitRooms();

    socket.on('check login', (data) => {
        const { username, room } = data;
        if (!rooms[room]) rooms[room] = { host: socket.id, users: [], players: {} };
        if (!rooms[room].users.includes(username)) rooms[room].users.push(username);
        socket.username = username;
        socket.currentRoom = room;
        socket.join(room);
        socket.emit('login success', { room: room, username: username });
        emitRooms();
    });

    // --- LOGIQUE COMMUNE / DIAPO 1 ---
    socket.on('start game', (name) => {
        const playerName = name || "Anonyme";
        gamePlayers[socket.id] = { 
            x: Math.random()*600+100, y: Math.random()*400+100, 
            angle: 0, color: `hsl(${Math.random()*360},70%,50%)`, 
            id: socket.id, score: 0, name: playerName, alive: true, protected: true
        };
        setTimeout(() => { if(gamePlayers[socket.id]) gamePlayers[socket.id].protected = false; io.emit('state', gamePlayers); }, 2000);
        io.emit('state', gamePlayers);
        io.emit('highscores', highScores);
    });

    // --- LOGIQUE DIAPO 2 ---
    socket.on('join d2', (name) => {
        d2Players[socket.id] = { id: socket.id, name: name, hits: 0, diffuseSuccess: 0, diffuseFail: 0, attacking: false, isUnderAttack: false };
        io.emit('update d2', d2Players);
    });

    socket.on('d2 attack', (targetId) => {
        if(d2Players[socket.id] && d2Players[targetId] && socket.id !== targetId) {
            if(!d2Players[targetId].isUnderAttack) {
                d2Players[targetId].isUnderAttack = true;
                const endTime = Date.now() + 10000; // Fin dans 10 secondes
                io.to(targetId).emit('under attack', { attackerId: socket.id, endTime: endTime });
                io.emit('update d2', d2Players);
            }
        }
    });

    socket.on('d2 attack success', (attackerId) => {
        if(d2Players[attackerId]) d2Players[attackerId].hits++;
        if(d2Players[socket.id]) {
            d2Players[socket.id].diffuseFail++;
            d2Players[socket.id].isUnderAttack = false;
        }
        
        try {
            const soundDir = path.join(__dirname, 'public', 'Sounds');
            if(fs.existsSync(soundDir)) {
                const sounds = fs.readdirSync(soundDir);
                if(sounds.length > 0) {
                    const randomSound = sounds[Math.floor(Math.random() * sounds.length)];
                    io.to(socket.id).emit('play sound', `/Sounds/${randomSound}`);
                }
            }
        } catch(e) {}
        io.emit('update d2', d2Players);
    });

    socket.on('d2 diffuse success', () => {
        if(d2Players[socket.id]) {
            d2Players[socket.id].diffuseSuccess++;
            d2Players[socket.id].isUnderAttack = false;
        }
        io.emit('update d2', d2Players);
    });

    // --- LOGIQUE GENERALE ---
    socket.on('move', (d) => {
        const p = gamePlayers[socket.id];
        if(p && p.alive) {
            let newX = p.x + d.x;
            let newY = p.y + d.y;
            if(newX >= 0 && newX <= 780) p.x = newX;
            if(newY >= 0 && newY <= 580) p.y = newY;
            p.angle = d.angle;
            io.emit('state', gamePlayers);
        }
    });

    socket.on('shoot', (d) => {
        const p = gamePlayers[socket.id];
        if(p && p.alive && !p.protected) {
            io.emit('bullet', { x: d.x, y: d.y, angle: d.angle, owner: socket.id });
        }
    });

    socket.on('hit', (data) => {
        const victim = gamePlayers[data.victimId];
        const shooter = gamePlayers[data.shooterId];
        if(victim && victim.alive && !victim.protected && shooter) {
            victim.alive = false;
            shooter.score += 1;
            let found = highScores.find(h => h.name === shooter.name);
            if(found) { if(shooter.score > found.score) found.score = shooter.score; }
            else { highScores.push({name: shooter.name, score: shooter.score}); }
            highScores.sort((a,b) => b.score - a.score);
            highScores = highScores.slice(0, 5);
            io.emit('state', gamePlayers);
            io.emit('highscores', highScores);
            setTimeout(() => {
                if(gamePlayers[data.victimId]) {
                    gamePlayers[data.victimId].alive = true;
                    gamePlayers[data.victimId].protected = true;
                    gamePlayers[data.victimId].x = Math.random()*600+100;
                    gamePlayers[data.victimId].y = Math.random()*400+100;
                    io.emit('state', gamePlayers);
                    setTimeout(() => {
                        if(gamePlayers[data.victimId]) {
                            gamePlayers[data.victimId].protected = false;
                            io.emit('state', gamePlayers);
                        }
                    }, 2000);
                }
            }, 3000);
        }
    });

    socket.on('chat message', (data) => {
        if (socket.currentRoom) {
            io.to(socket.currentRoom).emit('chat message', { 
                user: socket.username, text: data.text, image: data.image 
            });
        }
    });

    socket.on('disconnect', () => {
        const r = socket.currentRoom;
        if (r && rooms[r]) {
            rooms[r].users = rooms[r].users.filter(u => u !== socket.username);
            emitRooms();
        }
        delete gamePlayers[socket.id];
        delete d2Players[socket.id];
        io.emit('state', gamePlayers);
        io.emit('update d2', d2Players);
    });
});

// ANTI-SLEEP RENDER
const URL_DE_TON_SITE = "https://ton-site.onrender.com"; 
setInterval(() => {
    http.get(URL_DE_TON_SITE, (res) => { console.log("Réveil OK"); }).on('error', (e) => {});
}, 600000);

server.listen(process.env.PORT || 3000);