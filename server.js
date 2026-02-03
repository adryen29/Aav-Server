const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/diapo', (req, res) => res.sendFile(path.join(__dirname, 'public', 'diapo.html')));

let players = {};

io.on('connection', (socket) => {
    players[socket.id] = {
        x: 400,
        y: 300,
        angle: 0, // Direction en radians
        color: `hsl(${Math.random() * 360}, 70%, 50%)`,
        id: socket.id
    };

    io.emit('state', players);

    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = Math.max(0, Math.min(780, players[socket.id].x + data.x));
            players[socket.id].y = Math.max(0, Math.min(580, players[socket.id].y + data.y));
            players[socket.id].angle = data.angle; // On stocke l'angle envoyé par le client
            io.emit('state', players);
        }
    });

    socket.on('shoot', (data) => {
        if (players[socket.id]) {
            io.emit('bullet', {
                x: players[socket.id].x + 10,
                y: players[socket.id].y + 10,
                angle: data.angle, // La balle part dans l'angle actuel du joueur
                owner: socket.id
            });
        }
    });

    socket.on('hit', (targetId) => {
        if (players[targetId]) {
            players[targetId].x = Math.random() * 700 + 50;
            players[targetId].y = Math.random() * 500 + 50;
            io.emit('state', players);
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('state', players);
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Serveur sur port ${port}`));