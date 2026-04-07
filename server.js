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

// Инициализация БД
function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) users = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        else { 
            users['admin'] = { password: 'admin', elo: 1000, xp: 0, speedUpgrades: 0, isAdmin: true }; 
            saveDB(); 
        }
    } catch (e) { users = {}; }
}
function saveDB() { fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2)); }
loadDB();

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    // --- АВТОРИЗАЦИЯ ---
    socket.on('auth', (data) => {
        const { username, password, isRegister } = data;
        if (isRegister) {
            if (users[username]) return socket.emit('authResponse', { success: false, msg: 'Ник занят' });
            users[username] = { password, elo: 100, xp: 0, speedUpgrades: 0 };
            saveDB();
            socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
        } else {
            if (users[username] && users[username].password === password) {
                socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
            } else socket.emit('authResponse', { success: false, msg: 'Ошибка входа' });
        }
    });

    // --- МАГАЗИН И ПРОГРЕСС ---
    socket.on('buyUpgrade', (data) => {
        let u = users[data.name];
        if (u && u.elo >= 100) {
            u.elo -= 100; u.speedUpgrades = (u.speedUpgrades || 0) + 1;
            saveDB(); socket.emit('upgradeSuccess', { name: data.name, ...u });
        }
    });

    socket.on('getLeaderboard', () => {
        const list = Object.keys(users).map(k => ({ name: k, elo: users[k].elo }))
            .sort((a,b) => b.elo - a.elo).slice(0, 10);
        socket.emit('leaderboardData', list);
    });

    // --- АДМИНКА ---
    socket.on('adminGetUsers', () => {
        const list = Object.keys(users).map(k => ({ name: k, elo: users[k].elo }));
        socket.emit('adminUserList', list);
    });

    socket.on('adminDeleteUser', (name) => {
        if (users[name] && name !== 'admin') { delete users[name]; saveDB(); }
    });

    // --- ИГРОВОЙ ПРОЦЕСС ---
    socket.on('joinGame', (data) => {
        let roomId = Object.keys(rooms).find(id => rooms[id].players.length === 1) || socket.id;
        if (!rooms[roomId]) rooms[roomId] = { players: [], master: socket.id };
        
        const side = rooms[roomId].players.length === 0 ? 'left' : 'right';
        rooms[roomId].players.push({ id: socket.id, name: data.name, side });
        socket.join(roomId);
        
        socket.emit('init', { side, roomId, isMaster: socket.id === rooms[roomId].master });
        if (rooms[roomId].players.length === 2) io.to(roomId).emit('startGame', { players: rooms[roomId].players });
    });

    socket.on('sync', (data) => { socket.to(data.roomId).emit('updateState', data); });

    socket.on('endGame', (data) => {
        if (users[data.winner]) { users[data.winner].elo += 25; users[data.winner].xp += 50; }
        if (users[data.loser]) { users[data.loser].elo = Math.max(0, users[data.loser].elo - 10); users[data.loser].xp += 15; }
        saveDB();
    });

    socket.on('disconnect', () => {
        for (let id in rooms) {
            rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
            if (rooms[id].players.length === 0) delete rooms[id];
            else io.to(id).emit('opponentLeft');
        }
    });
});

server.listen(process.env.PORT || 3000);
