const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory database (Resets on server restart. Link to MongoDB for permanent storage)
const users = {}; 
const activeTrades = [];

// Pre-defined Blook Packs
const PACKS = {
    Medieval: { cost: 25, blooks: ['King', 'Queen', 'Knight', 'Dragon', 'Wizard'] },
    Space: { cost: 50, blooks: ['Astronaut', 'Alien', 'UFO', 'Meteor', 'Star'] },
    Chroma: { cost: 250, blooks: ['Rainbow Slime', 'Neon Cat', 'Glitch Blob'] }
};

io.on('connection', (socket) => {
    let currentUser = null;

    // Authentication
    socket.on('auth', ({ username, action }) => {
        if (action === 'signup') {
            if (users[username]) return socket.emit('auth_res', { success: false, msg: 'User exists' });
            users[username] = {
                username,
                coins: 100,
                blooks: [],
                lastWheel: 0,
                isAdmin: username.toLowerCase() === 'gio'
            };
        }
        
        if (!users[username]) return socket.emit('auth_res', { success: false, msg: 'User not found' });
        
        currentUser = users[username];
        socket.join('global');
        socket.emit('auth_res', { success: true, user: currentUser, packs: PACKS });
        io.emit('chat_msg', { user: 'System', text: `${username} joined the lobby!` });
    });

    // Hourly Wheel
    socket.on('spin_wheel', () => {
        if (!currentUser) return;
        const now = Date.now();
        if (now - currentUser.lastWheel < 3600000) {
            const remaining = Math.ceil((3600000 - (now - currentUser.lastWheel)) / 60000);
            return socket.emit('wheel_res', { success: false, msg: `Wait ${remaining} mins` });
        }
        const reward = Math.floor(Math.random() * 100) + 20;
        currentUser.coins += reward;
        currentUser.lastWheel = now;
        socket.emit('user_update', currentUser);
        socket.emit('wheel_res', { success: true, reward });
    });

    // Open Pack
    socket.on('open_pack', (packName) => {
        if (!currentUser || !PACKS[packName]) return;
        const pack = PACKS[packName];
        if (currentUser.coins < pack.cost) return socket.emit('pack_res', { success: false, msg: 'Poor!' });
        
        currentUser.coins -= pack.cost;
        const rewardBlook = pack.blooks[Math.floor(Math.random() * pack.blooks.length)];
        currentUser.blooks.push(rewardBlook);
        
        socket.emit('user_update', currentUser);
        socket.emit('pack_res', { success: true, blook: rewardBlook });
    });

    // Global Chat
    socket.on('send_msg', (text) => {
        if (!currentUser) return;
        let prefix = currentUser.isAdmin ? '[👑 OWNER] ' : '';
        io.emit('chat_msg', { user: prefix + currentUser.username, text });
    });

    // Global Trading
    socket.on('offer_trade', (blook) => {
        if (!currentUser || !currentUser.blooks.includes(blook)) return;
        const trade = { id: Date.now(), sender: currentUser.username, blook };
        activeTrades.push(trade);
        io.emit('trade_list', activeTrades);
    });

    socket.on('accept_trade', (tradeId) => {
        if (!currentUser) return;
        const idx = activeTrades.findIndex(t => t.id === tradeId);
        if (idx === -1) return;
        const trade = activeTrades[idx];
        if (trade.sender === currentUser.username) return;

        const senderUser = users[trade.sender];
        if (!senderUser || !senderUser.blooks.includes(trade.blook)) return;

        // Simple gift swap: Acceptor gives nothing, takes offered item (Expandable to counter-offers)
        senderUser.blooks.splice(senderUser.blooks.indexOf(trade.blook), 1);
        currentUser.blooks.push(trade.blook);
        
        activeTrades.splice(idx, 1);
        io.emit('trade_list', activeTrades);
        socket.emit('user_update', currentUser);
        io.to('global').emit('chat_msg', { user: 'System', text: `${currentUser.username} accepted ${trade.sender}'s trade!` });
    });

    // Admin Commands
    socket.on('admin_cmd', ({ target, targetBlook, amt }) => {
        if (!currentUser || !currentUser.isAdmin) return;
        if (users[target]) {
            if (targetBlook) users[target].blooks.push(targetBlook);
            if (amt) users[target].coins += parseInt(amt);
            io.emit('chat_msg', { user: 'SYSTEM', text: `Admin Gio modified ${target}'s account.` });
        }
    });
});

server.listen(3000, () => console.log('Game running on http://localhost:3000'));
