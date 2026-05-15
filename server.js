const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// We'll manage games in memory
const games = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinGame', (roomId) => {
        socket.join(roomId);
        
        if (!games[roomId]) {
            games[roomId] = {
                chess: new Chess(),
                players: {},
                spectators: []
            };
        }
        
        const game = games[roomId];
        
        // Assign colors
        if (!game.players.white) {
            game.players.white = socket.id;
            socket.emit('playerColor', 'w');
        } else if (!game.players.black) {
            game.players.black = socket.id;
            socket.emit('playerColor', 'b');
        } else {
            game.spectators.push(socket.id);
            socket.emit('playerColor', 'spectator');
        }

        // Send current state
        socket.emit('gameState', {
            fen: game.chess.fen(),
            history: game.chess.history({ verbose: true })
        });
        
        // Broadcast system message to chat
        io.to(roomId).emit('chatMessage', {
            sender: 'System',
            text: 'A user joined the room.',
            color: '#a37b5b'
        });
    });

    socket.on('makeMove', ({ roomId, move }) => {
        const game = games[roomId];
        if (!game) return;

        // Verify player is allowed to move
        const color = game.chess.turn(); // 'w' or 'b'
        const expectedPlayerId = color === 'w' ? game.players.white : game.players.black;
        
        if (socket.id !== expectedPlayerId) {
            return; // Not this player's turn or not a player
        }

        try {
            const result = game.chess.move(move);
            if (result) {
                io.to(roomId).emit('moveMade', {
                    fen: game.chess.fen(),
                    move: result
                });
                
                if (game.chess.isCheckmate()) {
                    io.to(roomId).emit('gameOver', 'Checkmate!');
                } else if (game.chess.isDraw()) {
                    io.to(roomId).emit('gameOver', 'Draw!');
                }
            }
        } catch (e) {
            // Invalid move
            socket.emit('invalidMove', move);
        }
    });

    socket.on('sendChat', ({ roomId, message }) => {
        const game = games[roomId];
        if (!game) return;
        
        let role = 'Spectator';
        if (socket.id === game.players.white) role = 'White Player';
        if (socket.id === game.players.black) role = 'Black Player';

        io.to(roomId).emit('chatMessage', {
            sender: role,
            text: message,
            color: role === 'White Player' ? '#f0d9b5' : (role === 'Black Player' ? '#b58863' : '#888')
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Find which game the user was in and notify others
        for (const [roomId, game] of Object.entries(games)) {
            if (game.players.white === socket.id) {
                game.players.white = null;
                io.to(roomId).emit('chatMessage', { sender: 'System', text: 'White Player disconnected.', color: '#ff6b6b' });
            } else if (game.players.black === socket.id) {
                game.players.black = null;
                io.to(roomId).emit('chatMessage', { sender: 'System', text: 'Black Player disconnected.', color: '#ff6b6b' });
            } else {
                game.spectators = game.spectators.filter(id => id !== socket.id);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
