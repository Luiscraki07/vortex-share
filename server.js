const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Servir archivos estáticos del directorio public
app.use(express.static(path.join(__dirname, 'public')));

// Almacenamiento de salas activas
// Estructura: { roomId: [ws1, ws2] }
const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoom = null;
  let peerType = null; // 'sender' o 'receiver'

  console.log('[SIGNALING] Nuevo cliente de WebSocket conectado.');

  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);

      switch (data.type) {
        case 'join': {
          const { roomId, role } = data;
          currentRoom = roomId;
          peerType = role;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, []);
          }

          const clientList = rooms.get(roomId);

          if (clientList.length >= 2) {
            ws.send(JSON.stringify({ type: 'error', message: 'La sala está llena (máximo 2 personas).' }));
            console.log(`[SIGNALING] Conexión rechazada: Sala ${roomId} llena.`);
            return;
          }

          clientList.push(ws);
          ws.roomId = roomId;
          ws.role = role;
          
          console.log(`[SIGNALING] Cliente unido a sala ${roomId} como ${role}. Total en sala: ${clientList.length}`);

          // Notificar al cliente que se unió exitosamente
          ws.send(JSON.stringify({ type: 'joined', role, clientCount: clientList.length }));

          // Si hay dos clientes en la sala, notificar a ambos para iniciar la conexión WebRTC
          if (clientList.length === 2) {
            const sender = clientList.find(c => c.role === 'sender');
            const receiver = clientList.find(c => c.role === 'receiver');

            if (sender && receiver) {
              console.log(`[SIGNALING] Sala ${roomId} lista. Notificando a emisor y receptor.`);
              sender.send(JSON.stringify({ type: 'peer-connected', role: 'receiver' }));
              receiver.send(JSON.stringify({ type: 'peer-connected', role: 'sender' }));
            }
          }
          break;
        }

        case 'signal': {
          if (!currentRoom) return;

          const clientList = rooms.get(currentRoom);
          if (!clientList) return;

          // Reenviar la señal al otro cliente en la misma sala
          clientList.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'signal',
                signal: data.signal,
                senderRole: peerType
              }));
            }
          });
          break;
        }

        case 'status-update': {
          // Reenviar actualizaciones de estado (como porcentaje o mensajes) al otro cliente
          if (!currentRoom) return;
          const clientList = rooms.get(currentRoom);
          if (!clientList) return;

          clientList.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'status-update',
                status: data.status
              }));
            }
          });
          break;
        }

        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        default:
          console.warn(`[SIGNALING] Tipo de mensaje desconocido: ${data.type}`);
      }
    } catch (err) {
      console.error('[SIGNALING] Error al procesar mensaje:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[SIGNALING] Cliente desconectado. Sala: ${currentRoom}, Rol: ${peerType}`);
    
    if (currentRoom && rooms.has(currentRoom)) {
      let clientList = rooms.get(currentRoom);
      // Eliminar el cliente actual de la sala
      clientList = clientList.filter(client => client !== ws);
      
      if (clientList.length === 0) {
        rooms.delete(currentRoom);
        console.log(`[SIGNALING] Sala ${currentRoom} vacía. Eliminada.`);
      } else {
        rooms.set(currentRoom, clientList);
        // Notificar al cliente restante que el compañero se desconectó
        clientList.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'peer-disconnected' }));
          }
        });
        console.log(`[SIGNALING] Notificado compañero en sala ${currentRoom} sobre desconexión.`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`🚀 VORTEX SHARE - SERVIDOR CORRIENDO`);
  console.log(`🌐 Interfaz Web: http://localhost:${PORT}`);
  console.log(`🔌 Señalización: ws://localhost:${PORT}`);
  console.log(`================================================================`);
});
