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
        const games = files.filter(f => f.startsWith('diapo') && f.endsWith('.html'))
            .map(f => ({ id: f.replace('diapo', '').replace('.html', ''), url: f.replace('.html', ''), filename: f }))
            .sort((a, b) => a.id - b.id);
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

    socket.on('start game', (name) => {
        const playerName = name || "Anonyme";
        gamePlayers[socket.id] = { 
            x: Math.random()*600+100, y: Math.random()*400+100, 
            angle: 0, color: `hsl(${Math.random()*360},70%,50%)`, 
            id: socket.id, score: 0, name: playerName, alive: true
        };
        io.emit('state', gamePlayers);
        io.emit('highscores', highScores);
    });

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
        if(gamePlayers[socket.id] && gamePlayers[socket.id].alive) {
            io.emit('bullet', { x: d.x, y: d.y, angle: d.angle, owner: socket.id });
        }
    });

    socket.on('hit', (data) => {
        const victim = gamePlayers[data.victimId];
        const shooter = gamePlayers[data.shooterId];
        if(victim && victim.alive && shooter) {
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
                    gamePlayers[data.victimId].x = Math.random()*600+100;
                    gamePlayers[data.victimId].y = Math.random()*400+100;
                    io.emit('state', gamePlayers);
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
        io.emit('state', gamePlayers);
    });
});

server.listen(3000);