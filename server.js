// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

let lobbies = {};

// Função para transmitir o estado atualizado de um lobby para todos os seus jogadores
function broadcastLobbyState(lobbyCode) {
    if (lobbies[lobbyCode]) {
        io.to(lobbyCode).emit('updateLobbyState', lobbies[lobbyCode]);
    }
}

io.on('connection', (socket) => {
    console.log(`Novo jogador conectado: ${socket.id}`);
    let currentLobby = null;

    // --- GERENCIAMENTO DE LOBBY ---
    socket.on('createLobby', (data) => {
        const playerName = data.name.trim();
        if (!playerName) {
            return socket.emit('lobbyError', 'O nome não pode estar em branco.');
        }

        const lobbyCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        currentLobby = lobbyCode;
        socket.join(lobbyCode);
        
        lobbies[lobbyCode] = {
            players: [{ id: socket.id, name: playerName, balance: 1000 }],
            game: {
                active: false,
                bets: {}, // { playerId: amount }
                rolls: {}, // { playerId: roll }
                timer: 0
            },
            code: lobbyCode
        };
        
        console.log(`Lobby ${lobbyCode} criado por ${playerName} (${socket.id})`);
        broadcastLobbyState(lobbyCode);
    });

    socket.on('joinLobby', (data) => {
        const lobbyCode = data.lobbyCode.toUpperCase();
        const playerName = data.name.trim();

        if (!playerName) {
            return socket.emit('lobbyError', 'O nome não pode estar em branco.');
        }
        if (!lobbies[lobbyCode]) {
            return socket.emit('lobbyError', 'Lobby não encontrado.');
        }

        currentLobby = lobbyCode;
        socket.join(lobbyCode);
        
        lobbies[lobbyCode].players.push({ id: socket.id, name: playerName, balance: 1000 });
        
        console.log(`${playerName} (${socket.id}) entrou no lobby ${lobbyCode}`);
        broadcastLobbyState(lobbyCode);
    });

    // --- LÓGICA DO JOGO DE DADOS ---
    socket.on('startGame', () => {
        if (!currentLobby || !lobbies[currentLobby] || lobbies[currentLobby].game.active) return;

        const lobby = lobbies[currentLobby];
        lobby.game.active = true;
        lobby.game.bets = {};
        lobby.game.rolls = {};
        lobby.game.timer = 15; // 15 segundos para apostar
        
        broadcastLobbyState(currentLobby);

        // Inicia um contador no servidor
        const interval = setInterval(() => {
            if (!lobbies[currentLobby]) {
                clearInterval(interval);
                return;
            }
            
            lobbies[currentLobby].game.timer--;
            broadcastLobbyState(currentLobby);

            if (lobbies[currentLobby].game.timer <= 0) {
                clearInterval(interval);
                // O tempo acabou, vamos resolver as apostas
                resolveDiceRound(currentLobby);
            }
        }, 1000);
    });

    socket.on('placeBet', (betAmount) => {
        if (!currentLobby || !lobbies[currentLobby] || !lobbies[currentLobby].game.active) return;
        
        const lobby = lobbies[currentLobby];
        const player = lobby.players.find(p => p.id === socket.id);
        const amount = parseInt(betAmount, 10);

        if (player && amount > 0 && player.balance >= amount && !lobby.game.bets[socket.id]) {
            player.balance -= amount;
            lobby.game.bets[socket.id] = amount;
            broadcastLobbyState(currentLobby);
        }
    });
    
    // --- DESCONEXÃO ---
    socket.on('disconnect', () => {
        console.log(`Jogador desconectado: ${socket.id}`);
        if (currentLobby && lobbies[currentLobby]) {
            lobbies[currentLobby].players = lobbies[currentLobby].players.filter(p => p.id !== socket.id);
            if (lobbies[currentLobby].players.length > 0) {
                broadcastLobbyState(currentLobby);
            } else {
                delete lobbies[currentLobby];
                console.log(`Lobby ${currentLobby} removido.`);
            }
        }
    });
});

function resolveDiceRound(lobbyCode) {
    const lobby = lobbies[lobbyCode];
    if (!lobby) return;

    let totalPot = 0;
    let playersInRound = [];

    // Rola o dado para cada jogador que apostou
    for (const playerId in lobby.game.bets) {
        totalPot += lobby.game.bets[playerId];
        const roll = Math.floor(Math.random() * 6) + 1;
        lobby.game.rolls[playerId] = roll;
        playersInRound.push({ id: playerId, roll: roll });
    }
    
    // Encontra o vencedor (maior rolagem)
    if (playersInRound.length > 0) {
        playersInRound.sort((a, b) => b.roll - a.roll);
        
        // Checa por empates
        const highestRoll = playersInRound[0].roll;
        const winners = playersInRound.filter(p => p.roll === highestRoll);

        if (winners.length > 1) { // Empate
            // Devolve o dinheiro para quem empatou
            const prizePerWinner = Math.floor(totalPot / winners.length);
            winners.forEach(winnerData => {
                const winnerPlayer = lobby.players.find(p => p.id === winnerData.id);
                if(winnerPlayer) {
                    winnerPlayer.balance += prizePerWinner;
                }
            });
        } else { // Vencedor único
            const winnerId = playersInRound[0].id;
            const winner = lobby.players.find(p => p.id === winnerId);
            if(winner) {
                winner.balance += totalPot;
            }
        }
    }

    lobby.game.active = false;
    broadcastLobbyState(lobbyCode);
}


server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
