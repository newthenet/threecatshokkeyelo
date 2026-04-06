const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DB_PATH = path.join(__dirname, 'users.json');

// Загрузка базы данных
let users = {};
if (fs.existsSync(DB_PATH)) {
    users = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
} else {
    // Дефолтный админ, если файла нет
    users['admin'] = { password: 'catseloadmin', elo: 999, xp: 0, speedUpgrades: 0 };
    saveDB();
}

function saveDB() {
    fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
}

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    // --- АВТОРИЗАЦИЯ ---
    socket.on('auth', (data) => {
        const { username, password, isRegister } = data;
        
        if (isRegister) {
            if (users[username]) {
                return socket.emit('authResponse', { success: false, msg: 'Ник занят' });
            }
            users[username] = { password, elo: 0, xp: 0, speedUpgrades: 0 };
            saveDB();
            socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
        } else {
            if (users[username] && users[username].password === password) {
                socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
            } else {
                socket.emit('authResponse', { success: false, msg: 'Неверный логин/пароль' });
            }
        }
    });

    // --- АДМИН-ПАНЕЛЬ ---
    socket.on('adminGetUsers', () => {
        // Отправляем список всех кроме паролей
        const list = Object.keys(users).map(name => ({ name, elo: users[name].elo }));
        socket.emit('adminUserList', list);
    });

    socket.on('adminDeleteUser', (targetName) => {
        if (targetName !== 'admin' && users[targetName]) {
            delete users[targetName];
            saveDB();
            socket.emit('adminMsg', `Игрок ${targetName} удален`);
        }
    });

    // --- МУЛЬТИПЛЕЕР ---
    socket.on('joinGame', (userData) => {
        let roomId = Object.keys(rooms).find(id => rooms[id].players.length === 1) || socket.id;
        
        if (!rooms[roomId]) {
            rooms[roomId] = { players: [], puck: { x: 400, y: 300, vx: 0, vy: 0 } };
        }

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
            const player = rooms[data.roomId].players.find(p => p.id === socket.id);
            if (player) { player.x = data.x; player.y = data.y; }
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

server.listen(process.env.PORT || 3000, () => console.log('Server started'));
