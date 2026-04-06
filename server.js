const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const DB_PATH = path.join(__dirname, 'users.json');
let users = {};
try {
    if (fs.existsSync(DB_PATH)) users = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    else { users['admin'] = { password: 'catseloadmin', elo: 1000, xp: 0, speedUpgrades: 0 }; saveDB(); }
} catch (e) { users = {}; }

function saveDB() { fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2)); }

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    socket.on('auth', (data) => {
        const { username, password, isRegister } = data;
        if (isRegister) {
            if (users[username]) return socket.emit('authResponse', { success: false, msg: 'Занят' });
            users[username] = { password, elo: 0, xp: 0, speedUpgrades: 0 };
            saveDB();
            socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
        } else {
            if (users[username] && users[username].password === password) {
                socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
            } else socket.emit('authResponse', { success: false, msg: 'Ошибка' });
        }
    });

    socket.on('joinGame', (userData) => {
        let roomId = Object.keys(rooms).find(id => rooms[id].players.length === 1) || socket.id;
        if (!rooms[roomId]) {
            rooms[roomId] = { players: [], master: socket.id };
        }
        
        const side = rooms[roomId].players.length === 0 ? 'left' : 'right';
        rooms[roomId].players.push({ id: socket.id, name: userData.name, side, x: 0, y: 0 });
        socket.join(roomId);
        
        socket.emit('init', { side, roomId, isMaster: socket.id === rooms[roomId].master });

        if (rooms[roomId].players.length === 2) {
            io.to(roomId).emit('startGame', { players: rooms[roomId].players });
        }
    });

    // Главный узел пересылки данных
    socket.on('sync', (data) => {
        // Пробрасываем данные всем в комнате, кроме отправителя
        socket.to(data.roomId).emit('updateState', data);
    });

    socket.on('disconnect', () => {
        for (let id in rooms) {
            rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
            if (rooms[id].players.length === 0) delete rooms[id];
            else io.to(id).emit('playerLeft');
        }
    });
});

server.listen(process.env.PORT || 3000);
