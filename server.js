const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DB_PATH = path.join(__dirname, 'users.json');

// Загрузка БД
let users = {};
try {
    if (fs.existsSync(DB_PATH)) {
        users = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        console.log("БД загружена, игроков:", Object.keys(users).length);
    } else {
        users['admin'] = { password: 'catseloadmin', elo: 1000, xp: 0, speedUpgrades: 0 };
        fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
    }
} catch (e) { console.log("Ошибка БД:", e); users = {}; }

function saveDB() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
    } catch (e) { console.log("Ошибка сохранения:", e); }
}

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    socket.on('auth', (data) => {
        const { username, password, isRegister } = data;
        if (!username || !password) return;

        if (isRegister) {
            if (users[username]) return socket.emit('authResponse', { success: false, msg: 'Ник занят' });
            users[username] = { password, elo: 100, xp: 0, speedUpgrades: 0 };
            saveDB();
            socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
        } else {
            const u = users[username];
            if (u && u.password === password) {
                socket.emit('authResponse', { success: true, user: { name: username, ...u } });
            } else {
                socket.emit('authResponse', { success: false, msg: 'Ошибка входа' });
            }
        }
    });

    socket.on('joinGame', (userData) => {
        let roomId = Object.keys(rooms).find(id => rooms[id].players.length === 1) || socket.id;
        if (!rooms[roomId]) rooms[roomId] = { players: [], puck: { x: 400, y: 300, vx: 0, vy: 0 } };
        
        const side = rooms[roomId].players.length === 0 ? 'left' : 'right';
        rooms[roomId].players.push({ id: socket.id, name: userData.name, side, x: 0, y: 0 });
        socket.join(roomId);
        socket.emit('init', { side, roomId });
        
        if (rooms[roomId].players.length === 2) {
            io.to(roomId).emit('startGame', rooms[roomId]);
        }
    });

    socket.on('updatePos', (data) => {
        if (rooms[data.roomId]) {
            const p = rooms[data.roomId].players.find(pl => pl.id === socket.id);
            if (p) { p.x = data.x; p.y = data.y; }
            socket.to(data.roomId).emit('updateState', { players: rooms[data.roomId].players, puck: data.puck });
        }
    });

    socket.on('disconnect', () => {
        for (let id in rooms) {
            rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
            if (rooms[id].players.length === 0) delete rooms[id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Сервер запущен на порту:', PORT));
