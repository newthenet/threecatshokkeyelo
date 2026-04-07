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

// Загрузка БД
try {
    if (fs.existsSync(DB_PATH)) users = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    else { users['admin'] = { password: 'admin', elo: 1000, xp: 0, speedUpgrades: 0 }; saveDB(); }
} catch (e) { users = {}; }

function saveDB() { 
    try { fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2)); } catch(e){} 
}

app.use(express.static('public'));

let rooms = {};

// ЛОГИКА ФИЗИКИ (800x600)
function resetPuck(room) { room.puck = { x: 400, y: 300, vx: 0, vy: 0 }; }

setInterval(() => {
    for (let id in rooms) {
        let r = rooms[id];
        if (r.status !== 'playing') continue;

        r.puck.vx *= 0.99; r.puck.vy *= 0.99;
        r.puck.x += r.puck.vx; r.puck.y += r.puck.vy;

        if (r.puck.y < 25 || r.puck.y > 575) r.puck.vy *= -1;

        if (r.puck.x < 0) { 
            if (r.puck.y > 210 && r.puck.y < 390) { r.score.right++; resetPuck(r); } 
            else { r.puck.x = 0; r.puck.vx *= -1; } 
        }
        if (r.puck.x > 800) { 
            if (r.puck.y > 210 && r.puck.y < 390) { r.score.left++; resetPuck(r); } 
            else { r.puck.x = 800; r.puck.vx *= -1; } 
        }

        if (r.isBot) {
            let bot = r.players['bot'];
            bot.y += (r.puck.y - bot.y) * 0.1;
            bot.y = Math.max(40, Math.min(560, bot.y));
        }

        // Столкновения с учетом прокачки из Магазина
        for (let pid in r.players) {
            let p = r.players[pid];
            let dx = r.puck.x - p.x, dy = r.puck.y - p.y, dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 40 + 22) { 
                let bonus = (users[p.name] && users[p.name].speedUpgrades) ? users[p.name].speedUpgrades : 0;
                let power = 16 + bonus; 
                r.puck.vx = (dx/dist) * power;
                r.puck.vy = (dy/dist) * power;
            }
        }

        // ПРОВЕРКА НА ПОБЕДУ (3 : 0) + Начисление ELO и XP (Баттл-пасс)
        if (r.score.left >= 3 || r.score.right >= 3) {
            r.status = 'ended';
            let winner = r.score.left >= 3 ? 'Левые' : 'Правые';
            
            for(let pid in r.players) {
                if(pid === 'bot') continue;
                let pName = r.players[pid].name;
                if(users[pName]) {
                    if ((r.score.left >= 3 && r.players[pid].side === 'left') || (r.score.right >= 3 && r.players[pid].side === 'right')) {
                        users[pName].elo += 25; 
                        users[pName].xp = (users[pName].xp || 0) + 50; // Победа = 50 XP
                    } else {
                        users[pName].elo = Math.max(0, users[pName].elo - 10);
                        users[pName].xp = (users[pName].xp || 0) + 15; // Поражение = 15 XP
                    }
                }
            }
            saveDB();
            io.to(id).emit('gameOver', { winner, score: r.score });
            delete rooms[id];
            continue;
        }

        io.to(id).emit('gameState', { puck: r.puck, players: r.players, score: r.score });
    }
}, 1000/60); 

io.on('connection', (socket) => {
    
    socket.on('auth', (data) => {
        const { username, password, isRegister } = data;
        if (isRegister) {
            if (users[username]) return socket.emit('authResponse', { success: false, msg: 'Занят' });
            users[username] = { password, elo: 0, xp: 0, speedUpgrades: 0 }; saveDB();
            socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
        } else {
            if (users[username] && users[username].password === password) {
                socket.emit('authResponse', { success: true, user: { name: username, ...users[username] } });
            } else socket.emit('authResponse', { success: false, msg: 'Ошибка входа' });
        }
    });

    // --- МАГАЗИН И АДМИНКА ---
    socket.on('buyUpgrade', (data) => {
        let u = users[data.name];
        if (u && u.elo >= 100) {
            u.elo -= 100;
            u.speedUpgrades = (u.speedUpgrades || 0) + 1;
            saveDB();
            socket.emit('upgradeSuccess', { name: data.name, ...u });
        }
    });

    socket.on('getLeaderboard', () => {
        let list = Object.keys(users).map(k => ({ name: k, elo: users[k].elo })).sort((a,b) => b.elo - a.elo);
        socket.emit('leaderboardData', list);
    });

    socket.on('adminGetUsers', () => {
        let list = Object.keys(users).map(k => ({ name: k, elo: users[k].elo })).sort((a,b) => b.elo - a.elo);
        socket.emit('adminUserList', list);
    });

    socket.on('adminDeleteUser', (name) => {
        if(users[name] && name !== 'admin') { delete users[name]; saveDB(); }
    });

    // --- МУЛЬТИПЛЕЕР ---
    socket.on('joinGame', (data) => {
        let roomId = Object.keys(rooms).find(id => !rooms[id].isBot && Object.keys(rooms[id].players).length === 1) || socket.id;
        if (!rooms[roomId]) rooms[roomId] = { status: 'waiting', isBot: false, score: {left: 0, right: 0}, puck: {x:400, y:300, vx:0, vy:0}, players: {} };
        const side = Object.keys(rooms[roomId].players).length === 0 ? 'left' : 'right';
        rooms[roomId].players[socket.id] = { name: data.name, side, x: side === 'left' ? 100 : 700, y: 300, color: side==='left'?'#0077b6':'#e63946' };
        socket.join(roomId);
        if (Object.keys(rooms[roomId].players).length === 2) { rooms[roomId].status = 'playing'; io.to(roomId).emit('startGame', { side, roomId }); }
    });

    socket.on('joinBot', (data) => {
        let roomId = 'bot_' + socket.id;
        rooms[roomId] = { status: 'playing', isBot: true, score: {left: 0, right: 0}, puck: {x:400, y:300, vx:0, vy:0}, players: {} };
        rooms[roomId].players[socket.id] = { name: data.name, side: 'left', x: 100, y: 300, color: '#0077b6' };
        rooms[roomId].players['bot'] = { name: 'Бот', side: 'right', x: 700, y: 300, color: '#e63946' };
        socket.join(roomId);
        socket.emit('startGame', { side: 'left', roomId });
    });

    socket.on('move', (data) => {
        for (let id in rooms) {
            if (rooms[id].players[socket.id]) {
                let p = rooms[id].players[socket.id];
                p.x = p.side === 'left' ? Math.min(data.x, 350) : Math.max(data.x, 450);
                p.y = data.y;
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        for (let id in rooms) {
            if (rooms[id].players[socket.id]) {
                io.to(id).emit('gameOver', { winner: 'Соперник ливнул!', score: rooms[id].score });
                delete rooms[id];
            }
        }
    });
});

server.listen(process.env.PORT || 3000);
