const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    socket.on('login', (username) => {
        socket.username = username;
        console.log(`${username} est connecté`);
    });

    socket.on('chat message', (msg) => {
        io.emit('chat message', { user: socket.username, text: msg });
    });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Messaging app on port ${port}`));