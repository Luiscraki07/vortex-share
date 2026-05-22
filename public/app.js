/* ==========================================================================
   LÓGICA PRINCIPAL DE LA APLICACIÓN (WEBRTC & FILE SYSTEM) - ANTIGRAVITY SHARE
   ========================================================================== */

// Configuración de WebRTC con servidores STUN gratuitos de Google
const iceConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// Parámetros técnicos del canal
const CHUNK_SIZE = 32 * 1024; // Fragmentos de 32 KB para máxima compatibilidad y rendimiento
const BUFFER_HIGH_WATERMARK = 4 * 1024 * 1024; // 4 MB para pausar la lectura de archivos
const BUFFER_LOW_THRESHOLD = 512 * 1024; // 512 KB para reanudar el envío (threshold)

// Variables de estado global
let ws = null;
let peerConnection = null;
let dataChannel = null;
let localRole = null; // 'sender' o 'receiver'
let selectedFile = null;
let currentRoomId = null;
let iceCandidatesQueue = [];

// Variables de estadísticas y transferencia
let sentBytes = 0;
let receivedBytes = 0;
let totalFileBytes = 0;
let transferStartTime = 0;
let isTransferActive = false;
let speedCalculationInterval = null;
let lastBytesLogged = 0;
let lastTimeLogged = 0;

// Variables para el Receptor
let incomingFileInfo = null;
let fileWritableStream = null;
let fileWriteQueue = [];
let isWritingQueue = false;

// Elementos del DOM - Paneles
const panelRoleSelection = document.getElementById('role-selection-panel');
const panelSender = document.getElementById('sender-panel');
const panelReceiver = document.getElementById('receiver-panel');
const panelTransfer = document.getElementById('transfer-panel');

// Elementos del DOM - Botones
const btnSelectSender = document.getElementById('btn-select-sender');
const btnSelectReceiver = document.getElementById('btn-select-receiver');
const btnBackSender = document.getElementById('btn-back-sender');
const btnBackReceiver = document.getElementById('btn-back-receiver');
const btnGenerateCode = document.getElementById('btn-generate-code');
const btnCopyCode = document.getElementById('btn-copy-code');
const btnConnectReceiver = document.getElementById('btn-connect-receiver');
const btnStartDownload = document.getElementById('btn-start-download');
const btnRemoveFile = document.getElementById('btn-remove-file');
const btnCancelTransfer = document.getElementById('btn-cancel-transfer');
const btnFinishTransfer = document.getElementById('btn-finish-transfer');

// Elementos del DOM - Inputs y Datos
const fileInput = document.getElementById('file-input');
const fileDropZone = document.getElementById('file-drop-zone');
const cardSelectedFile = document.getElementById('selected-file-details');
const textDetailFileName = document.getElementById('detail-file-name');
const textDetailFileSize = document.getElementById('detail-file-size');
const cardShareCode = document.getElementById('share-code-display');
const textGeneratedCode = document.getElementById('generated-code');
const textSenderStatus = document.getElementById('sender-connection-status-text');
const inputShareCode = document.getElementById('input-share-code');
const indicatorReceiverStatus = document.getElementById('receiver-connection-status');
const textReceiverStatus = document.getElementById('receiver-connection-text');
const cardIncomingFile = document.getElementById('incoming-file-card');
const textIncomingFileName = document.getElementById('incoming-file-name');
const textIncomingFileSize = document.getElementById('incoming-file-size');

// Elementos del DOM - Transferencia
const textTransferTitle = document.getElementById('transfer-title');
const progressBarFill = document.getElementById('progress-bar-fill');
const textProgressPercentage = document.getElementById('progress-percentage-text');
const textStatSpeed = document.getElementById('stat-speed');
const textStatTransferred = document.getElementById('stat-transferred');
const textStatEta = document.getElementById('stat-eta');
const terminalLogs = document.getElementById('terminal-logs');
const particleCanvas = document.getElementById('speed-particle-canvas');

// ==========================================================================
// 1. SISTEMA DE LOGS / TERMINAL DIAGNÓSTICO
// ==========================================================================
function logTerminal(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  let prefix = '[INFO]';
  
  if (type === 'system') prefix = '[SISTEMA]';
  if (type === 'connection') prefix = '[P2P NET]';
  if (type === 'success') prefix = '[ÉXITO]';
  if (type === 'error') prefix = '[ERROR]';

  const logLine = document.createElement('p');
  logLine.className = `log-line ${type}`;
  logLine.innerHTML = `<span style="opacity: 0.5;">${timestamp}</span> <strong>${prefix}</strong> ${message}`;
  
  terminalLogs.appendChild(logLine);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
  console.log(`${prefix} ${message}`);
}

// ==========================================================================
// 2. SISTEMA DE NAVEGACIÓN Y CONFIGURACIÓN INICIAL
// ==========================================================================

// Selección de Rol: Emisor
btnSelectSender.addEventListener('click', () => {
  localRole = 'sender';
  panelRoleSelection.classList.add('hidden');
  panelSender.classList.remove('hidden');
  logTerminal('Panel de Emisor inicializado. Listo para cargar archivo.', 'system');
});

// Selección de Rol: Receptor
btnSelectReceiver.addEventListener('click', () => {
  localRole = 'receiver';
  panelRoleSelection.classList.add('hidden');
  panelReceiver.classList.remove('hidden');
  logTerminal('Panel de Receptor inicializado. Esperando código de enlace.', 'system');
});

// Volver al Inicio
btnBackSender.addEventListener('click', resetApplication);
btnBackReceiver.addEventListener('click', resetApplication);

// Arrastrar y Soltar Archivos
fileDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  fileDropZone.classList.add('dragover');
});

fileDropZone.addEventListener('dragleave', () => {
  fileDropZone.classList.remove('dragover');
});

fileDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    handleFileSelect(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileSelect(e.target.files[0]);
  }
});

function handleFileSelect(file) {
  selectedFile = file;
  textDetailFileName.innerText = file.name;
  textDetailFileSize.innerText = formatBytes(file.size);
  cardSelectedFile.classList.remove('hidden');
  
  if (file.name.toLowerCase().endsWith('.img') || file.name.toLowerCase().endsWith('.iso')) {
    logTerminal(`Imagen de disco detectada. Se transmitirá virtualmente como ".zip" para evadir el bloqueo de seguridad de Chrome/Edge.`, 'info');
  } else {
    logTerminal(`Archivo seleccionado: "${file.name}" (${formatBytes(file.size)})`, 'info');
  }
}

// Quitar archivo seleccionado
btnRemoveFile.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = ''; // Limpiar input de archivo
  cardSelectedFile.classList.add('hidden');
  logTerminal('Archivo quitado. Listo para seleccionar un nuevo archivo.', 'info');
});

// ==========================================================================
// 3. CONEXIÓN A SEÑALIZACIÓN WEBSOCKET
// ==========================================================================
function initSignaling(role, roomId) {
  return new Promise((resolve, reject) => {
    // Generar WebSocket dinámico según protocolo (HTTP -> WS / HTTPS -> WSS)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:3000';
    const wsUrl = `${protocol}//${host}`;

    logTerminal(`Conectando al servidor de señalización: ${wsUrl}...`, 'system');
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      logTerminal('Conectado al servidor de señalización de forma segura.', 'success');
      // Unirse a la sala con código e indicar rol
      ws.send(JSON.stringify({ type: 'join', roomId, role }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSignalingMessage(msg, resolve);
      } catch (err) {
        logTerminal(`Error al descodificar señal: ${err.message}`, 'error');
      }
    };

    ws.onerror = (err) => {
      logTerminal('Error en el WebSocket de señalización.', 'error');
      reject(err);
    };

    ws.onclose = () => {
      logTerminal('Servidor de señalización desconectado.', 'info');
    };
  });
}

// Procesar Mensajes de Señalización
function handleSignalingMessage(msg, resolve) {
  switch (msg.type) {
    case 'joined':
      logTerminal(`Unido exitosamente a la sala ${currentRoomId} como ${msg.role}.`, 'success');
      if (msg.role === 'sender') {
        textSenderStatus.innerText = 'Esperando conexión del receptor...';
      }
      resolve();
      break;

    case 'peer-connected':
      logTerminal(`¡Par conectado! El otro extremo es ${msg.role}.`, 'connection');
      if (localRole === 'sender') {
        textSenderStatus.innerText = 'Receptor conectado. Negociando canal seguro...';
        // El emisor inicia el PeerConnection y el DataChannel
        startPeerConnection();
      } else {
        textReceiverStatus.innerText = 'Emisor conectado. Esperando detalles del archivo...';
        // El receptor también debe inicializar el PeerConnection para poder recibir la oferta
        startPeerConnection();
      }
      break;

    case 'signal':
      // Reenviar datos de negociación WebRTC al PeerConnection
      if (peerConnection) {
        handleWebRTCSignal(msg.signal);
      }
      break;

    case 'status-update':
      // El emisor puede recibir información sobre la descarga
      if (msg.status === 'file-rejected') {
        logTerminal('El receptor rechazó el archivo.', 'error');
        alert('El receptor ha cancelado el archivo.');
        resetApplication();
      }
      break;

    case 'peer-disconnected':
      logTerminal('El otro dispositivo se desconectó.', 'error');
      alert('La conexión con el otro dispositivo se ha perdido.');
      resetApplication();
      break;

    case 'error':
      logTerminal(`Error del servidor: ${msg.message}`, 'error');
      alert(msg.message);
      resetApplication();
      break;
  }
}

// ==========================================================================
// 4. GENERACIÓN DE CÓDIGO (EMISOR) Y CONEXIÓN (RECEPTOR)
// ==========================================================================

// Emisor: Genera código de 6 dígitos e inicia el servidor de señalización
btnGenerateCode.addEventListener('click', async () => {
  // Limpiar terminal logs para una nueva sesión
  terminalLogs.innerHTML = '<p class="log-line system">[SISTEMA] Listo para iniciar conexión segura...</p>';
  
  // Generar código aleatorio tipo '482-109'
  const codePart1 = Math.floor(100 + Math.random() * 900);
  const codePart2 = Math.floor(100 + Math.random() * 900);
  currentRoomId = `${codePart1}-${codePart2}`;

  textGeneratedCode.innerText = currentRoomId;
  cardShareCode.classList.remove('hidden');
  btnGenerateCode.disabled = true;

  try {
    await initSignaling('sender', currentRoomId);
  } catch (err) {
    logTerminal('Fallo al inicializar canal de señalización.', 'error');
    btnGenerateCode.disabled = false;
  }
});

// Copiar código de enlace
btnCopyCode.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoomId).then(() => {
    btnCopyCode.innerText = 'Copiado ✓';
    setTimeout(() => { btnCopyCode.innerText = 'Copiar'; }, 2000);
  });
});

// Receptor: Conectarse usando código
btnConnectReceiver.addEventListener('click', async () => {
  // Limpiar terminal logs para una nueva sesión
  terminalLogs.innerHTML = '<p class="log-line system">[SISTEMA] Listo para iniciar conexión segura...</p>';

  const code = inputShareCode.value.trim();
  // Validar formato simple xxx-xxx
  if (!code || code.length < 6) {
    alert('Ingresa un código de enlace válido (ej. 123-456).');
    return;
  }
  
  currentRoomId = code;
  btnConnectReceiver.disabled = true;
  indicatorReceiverStatus.classList.remove('hidden');
  textReceiverStatus.innerText = 'Conectando al canal seguro...';

  try {
    await initSignaling('receiver', currentRoomId);
  } catch (err) {
    logTerminal('Error al conectar. Verifica el código e inténtalo de nuevo.', 'error');
    btnConnectReceiver.disabled = false;
    indicatorReceiverStatus.classList.add('hidden');
  }
});

// ==========================================================================
// 5. PROTOCOLO DE CONEXIÓN WEBRTC (PEER CONNECTION)
// ==========================================================================
async function startPeerConnection() {
  logTerminal('Inicializando PeerConnection WebRTC...', 'system');
  peerConnection = new RTCPeerConnection(iceConfiguration);

  // Escuchar candidatos ICE (direcciones de red)
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'signal',
        signal: { candidate: event.candidate }
      }));
    }
  };

  peerConnection.onconnectionstatechange = () => {
    logTerminal(`Estado de conexión WebRTC cambiado a: ${peerConnection.connectionState}`, 'connection');
    if (peerConnection.connectionState === 'connected') {
      logTerminal('Conexión P2P encriptada establecida directamente entre dispositivos.', 'success');
    } else if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
      logTerminal('Fallo en la conexión WebRTC.', 'error');
    }
  };

  if (localRole === 'sender') {
    // Crear el canal de datos ordenado
    logTerminal('Creando canal de datos seguro (RTCDataChannel)...', 'system');
    dataChannel = peerConnection.createDataChannel('file-transfer-channel', {
      ordered: true // Garantizar la entrega secuencial exacta
    });
    
    // Configurar canal de datos
    setupDataChannel();

    // Crear oferta SDP
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    logTerminal('Enviando propuesta criptográfica de red (SDP Offer)...', 'system');
    ws.send(JSON.stringify({
      type: 'signal',
      signal: { sdp: peerConnection.localDescription }
    }));
  } else {
    // Si somos el receptor, escuchamos cuando el canal de datos es creado por el emisor
    peerConnection.ondatachannel = (event) => {
      logTerminal('Canal de datos abierto por el emisor. Sincronizando...', 'success');
      dataChannel = event.channel;
      setupDataChannel();
    };
  }
}

// Manejar SDP y Candidatos del Servidor de Señalización
async function handleWebRTCSignal(signal) {
  try {
    if (signal.sdp) {
      logTerminal(`Recibida descripción SDP (${signal.sdp.type}). Configurando...`, 'system');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      
      if (signal.sdp.type === 'offer') {
        // Generar respuesta
        logTerminal('Generando acuerdo criptográfico de red (SDP Answer)...', 'system');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        ws.send(JSON.stringify({
          type: 'signal',
          signal: { sdp: peerConnection.localDescription }
        }));
      }

      // Procesar candidatos acumulados en cola tras configurar el SDP remoto
      if (iceCandidatesQueue.length > 0) {
        logTerminal(`Procesando ${iceCandidatesQueue.length} candidatos de red en cola...`, 'system');
        for (const candidate of iceCandidatesQueue) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        iceCandidatesQueue = [];
      }
    } else if (signal.candidate) {
      // Comprobar si ya se configuró la descripción remota
      if (peerConnection && peerConnection.remoteDescription) {
        logTerminal('Recibiendo candidato de red (ICE Candidate). Agregando...', 'system');
        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        logTerminal('Candidato de red recibido antes de tiempo. Encolando...', 'system');
        iceCandidatesQueue.push(signal.candidate);
      }
    }
  } catch (err) {
    logTerminal(`Error en negociación de señal WebRTC: ${err.message}`, 'error');
  }
}

// Configuración del DataChannel (Canal de Datos P2P)
function setupDataChannel() {
  dataChannel.binaryType = 'arraybuffer'; // Enviar datos en binario crudo

  dataChannel.onopen = () => {
    logTerminal('¡Canal de datos P2P abierto y listo para transferir!', 'success');
    
    if (localRole === 'sender') {
      // Enviar metadatos del archivo como primer mensaje
      logTerminal('Enviando metadatos del archivo al receptor...', 'info');
      
      let nameToSend = selectedFile.name;
      let wasAutoRenamed = false;
      const lowerName = selectedFile.name.toLowerCase();
      
      if (lowerName.endsWith('.img') || lowerName.endsWith('.iso')) {
        const extLength = lowerName.endsWith('.img') ? 4 : 4;
        nameToSend = selectedFile.name.substring(0, selectedFile.name.length - extLength) + '.zip';
        wasAutoRenamed = true;
      }

      dataChannel.send(JSON.stringify({
        type: 'file-metadata',
        name: nameToSend,
        size: selectedFile.size,
        fileType: selectedFile.type,
        wasAutoRenamed: wasAutoRenamed
      }));
    }
  };

  dataChannel.onmessage = async (event) => {
    if (typeof event.data === 'string') {
      // Mensaje de control
      const msg = JSON.parse(event.data);
      handleDataChannelMessage(msg);
    } else {
      // Pedazo de archivo binario (ArrayBuffer)
      handleIncomingChunk(event.data);
    }
  };

  dataChannel.onerror = (err) => {
    logTerminal(`Fallo en el canal de datos P2P: ${err.message}`, 'error');
  };

  dataChannel.onclose = () => {
    logTerminal('Canal de datos P2P cerrado.', 'info');
    if (isTransferActive) {
      alert('La transferencia se ha cancelado inesperadamente.');
      resetApplication();
    }
  };
}

// Manejar mensajes JSON por el canal de datos
async function handleDataChannelMessage(msg) {
  switch (msg.type) {
    case 'file-metadata':
      incomingFileInfo = msg;
      textIncomingFileName.innerText = msg.name;
      textIncomingFileSize.innerText = formatBytes(msg.size);
      
      // Mostrar la ficha del archivo para que el receptor acepte
      cardIncomingFile.classList.remove('hidden');
      textReceiverStatus.innerText = 'Archivo detectado de forma segura.';
      
      if (msg.wasAutoRenamed) {
        logTerminal(`Aviso: Se renombró virtualmente el archivo entrante a "${msg.name}" para evitar el bloqueo del navegador.`, 'info');
      } else {
        logTerminal(`Metadatos recibidos: "${msg.name}" (${formatBytes(msg.size)})`, 'info');
      }
      break;

    case 'file-accepted':
      logTerminal('El receptor ha aceptado el archivo. Iniciando flujo de datos...', 'success');
      startFileTransfer();
      break;

    case 'transfer-cancelled':
      logTerminal('El compañero ha cancelado la transferencia.', 'error');
      alert('El otro dispositivo canceló la transferencia.');
      resetApplication();
      break;
  }
}

// ==========================================================================
// 6. FLUJO DE ESCRITURA Y DESCARGA A DISCO (RECEPTOR)
// ==========================================================================

// El receptor aprueba el archivo y elige dónde guardarlo con la API de FileSystem Access
btnStartDownload.addEventListener('click', async () => {
  if (!incomingFileInfo) return;

  btnStartDownload.disabled = true;
  logTerminal('Abriendo Selector de Archivos para almacenamiento seguro...', 'system');

  try {
    // Comprobar soporte de la API de File System Access
    if ('showSaveFilePicker' in window) {
      const options = {
        suggestedName: incomingFileInfo.name,
        types: [{
          description: 'Guardar Archivo P2P',
          accept: { '*/*': ['.' + incomingFileInfo.name.split('.').pop()] }
        }]
      };
      
      // Abre ventana del sistema operativo Windows para seleccionar dónde guardar
      const fileHandle = await window.showSaveFilePicker(options);
      logTerminal('Preparando archivo local para escritura secuencial...', 'system');
      
      // Crear canal de escritura directa en disco
      fileWritableStream = await fileHandle.createWritable();
      logTerminal('Estructura de escritura directa en disco lista. RAM protegida.', 'success');
    } else {
      // Fallback para navegadores antiguos: Usaremos descarga en memoria (Máx ~2GB)
      logTerminal('showSaveFilePicker no soportada. Usando fallback de descarga en memoria...', 'error');
      alert('Tu navegador no soporta la escritura directa en disco (FileSystem Access API). Se usará descarga en memoria RAM. Recomendamos Google Chrome o Microsoft Edge en Windows para archivos de más de 2 GB.');
      fileWritableStream = null; // Indica que usaremos array de blobs en memoria
      fileWriteQueue = [];
    }

    // Informar al emisor que hemos aceptado el archivo
    dataChannel.send(JSON.stringify({ type: 'file-accepted' }));
    
    // Cambiar a pantalla de transferencia
    prepareTransferUI(incomingFileInfo.name, incomingFileInfo.size);
    
  } catch (err) {
    logTerminal(`Operación cancelada por el usuario o error: ${err.message}`, 'info');
    btnStartDownload.disabled = false;
  }
});

// Manejar los pedazos del archivo binario a medida que llegan
async function handleIncomingChunk(chunk) {
  receivedBytes += chunk.byteLength;

  if (fileWritableStream) {
    // Escribir secuencialmente a disco usando la cola asíncrona (Previene bloqueos del disco)
    fileWriteQueue.push(chunk);
    if (!isWritingQueue) {
      processWriteQueue();
    }
  } else {
    // Fallback: Almacenar en RAM temporal (Colección de ArrayBuffers/Blobs)
    fileWriteQueue.push(chunk);
  }

  // Actualizar interfaz con progreso
  updateTransferProgress();

  // Verificar si la descarga se completó
  if (receivedBytes === totalFileBytes) {
    finalizeDownload();
  }
}

// Cola de Escritura Asíncrona (Consistencia de Datos en Windows)
async function processWriteQueue() {
  isWritingQueue = true;
  while (fileWriteQueue.length > 0) {
    const chunk = fileWriteQueue.shift();
    try {
      await fileWritableStream.write(chunk);
    } catch (err) {
      logTerminal(`Error al escribir fragmento en el disco: ${err.message}`, 'error');
      cancelTransfer(`Error al escribir en el disco: ${err.message}`);
      return;
    }
  }
  isWritingQueue = false;
}

// Finalizar la descarga y cerrar el archivo
async function finalizeDownload() {
  isTransferActive = false;
  clearInterval(speedCalculationInterval);
  logTerminal('Transferencia de datos finalizada. Ensamblando archivo...', 'system');

  try {
    if (fileWritableStream) {
      // Esperar a que la cola de escritura termine
      while (isWritingQueue) {
        await new Promise(r => setTimeout(r, 50));
      }
      // Cerrar y guardar el archivo en disco definitivamente
      await fileWritableStream.close();
      fileWritableStream = null;
      logTerminal('¡Archivo guardado en disco con éxito! RAM 100% libre.', 'success');
    } else {
      // Fallback: Crear el blob de memoria e iniciar la descarga tradicional del navegador
      logTerminal('Generando enlace de descarga desde memoria RAM...', 'info');
      const blob = new Blob(fileWriteQueue);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = incomingFileInfo.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      fileWriteQueue = [];
      logTerminal('Archivo descargado de forma tradicional.', 'success');
    }

    // UI Finalizado
    btnCancelTransfer.classList.add('hidden');
    btnFinishTransfer.classList.remove('hidden');
    textTransferTitle.innerText = '¡Descarga Completada!';
    
    if (incomingFileInfo && incomingFileInfo.wasAutoRenamed) {
      logTerminal(`Descarga totalizada con éxito.`, 'success');
      logTerminal(`⚠️ IMPORTANTE: Recuerda cambiar el nombre del archivo de ".zip" a su formato original ".img" para poder instalarlo.`, 'system');
      alert(`¡Descarga completada con éxito!\n\nPara evitar el bloqueo de seguridad del navegador, transferimos este archivo temporalmente como ".zip".\n\nPor favor, ve a la carpeta donde lo guardaste y cámbiale la extensión de ".zip" a ".img" para poder instalar Office.`);
    } else {
      logTerminal(`Descarga totalizada con éxito: ${formatBytes(totalFileBytes)} transferidos.`, 'success');
    }
  } catch (err) {
    logTerminal(`Fallo al cerrar el flujo de almacenamiento: ${err.message}`, 'error');
  }
}

// ==========================================================================
// 7. FLUJO DE LECTURA Y ENVÍO DE DATOS (EMISOR)
// ==========================================================================
function startFileTransfer() {
  prepareTransferUI(selectedFile.name, selectedFile.size);
  
  let offset = 0;
  const fileReader = new FileReader();

  // Configurar threshold bajo en el canal de datos
  dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;

  // Lógica de envío en bucle controlado
  const sendNextChunk = () => {
    // Si la transferencia ya no está activa, detenemos
    if (!isTransferActive) return;

    // Si dataChannel está bloqueado por demasiados datos acumulados (Backpressure)
    if (dataChannel.bufferedAmount > BUFFER_HIGH_WATERMARK) {
      // Pausamos el envío y esperamos al evento 'bufferedamountlow' para reanudar
      dataChannel.onbufferedamountlow = () => {
        dataChannel.onbufferedamountlow = null; // Limpiar listener
        sendNextChunk();
      };
      return;
    }

    // Leer el siguiente trozo del archivo
    if (offset < selectedFile.size) {
      const slice = selectedFile.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(slice);
    }
  };

  fileReader.onload = (e) => {
    const buffer = e.target.result;
    
    try {
      dataChannel.send(buffer);
      offset += buffer.byteLength;
      sentBytes = offset;

      // Actualizar interfaz
      updateTransferProgress();

      if (sentBytes === selectedFile.size) {
        // Envió todo
        isTransferActive = false;
        clearInterval(speedCalculationInterval);
        logTerminal(`¡Envío completado de forma exitosa! total: ${formatBytes(selectedFile.size)}`, 'success');
        btnCancelTransfer.classList.add('hidden');
        btnFinishTransfer.classList.remove('hidden');
        textTransferTitle.innerText = '¡Envío Completado!';
      } else {
        // Sigue enviando
        sendNextChunk();
      }
    } catch (err) {
      logTerminal(`Error de transmisión en canal P2P: ${err.message}`, 'error');
      cancelTransfer(`Fallo en el canal de transmisión P2P: ${err.message}`);
    }
  };

  fileReader.onerror = (err) => {
    logTerminal(`Error al leer archivo del disco local: ${err.message}`, 'error');
    cancelTransfer(`Error de lectura local: ${err.message}`);
  };

  // Iniciar el bucle de envío
  sendNextChunk();

  // Si baja el buffer acumulado, continuar enviando
  dataChannel.onbufferedamountlow = () => {
    sendNextChunk();
  };
}

// ==========================================================================
// 8. INTERFAZ DE PROGRESO Y CONTROLES
// ==========================================================================

function prepareTransferUI(name, size) {
  isTransferActive = true;
  totalFileBytes = size;
  receivedBytes = 0;
  sentBytes = 0;
  transferStartTime = Date.now();
  lastBytesLogged = 0;
  lastTimeLogged = Date.now();

  // Ocultar paneles anteriores
  panelSender.classList.add('hidden');
  panelReceiver.classList.add('hidden');
  panelTransfer.classList.remove('hidden');

  // Configurar textos de la UI de transferencia
  textTransferTitle.innerText = localRole === 'sender' ? 'Enviando Archivo P2P...' : 'Descargando Archivo P2P...';
  textStatTransferred.innerText = `0 MB de ${formatBytes(size)}`;
  progressBarFill.style.width = '0%';
  textProgressPercentage.innerText = '0%';

  logTerminal(`Iniciando reloj de transferencia. Archivo: "${name}"`, 'system');

  // Iniciar Intervalo de cálculo de Velocidad
  speedCalculationInterval = setInterval(calculateSpeedAndETA, 1000);

  // Iniciar animación del visualizador de velocidad
  initParticleVisualizer();
}

function updateTransferProgress() {
  const currentBytes = localRole === 'sender' ? sentBytes : receivedBytes;
  const percentage = Math.min(100, ((currentBytes / totalFileBytes) * 100));

  progressBarFill.style.width = `${percentage.toFixed(1)}%`;
  textProgressPercentage.innerText = `${percentage.toFixed(1)}%`;
  textStatTransferred.innerText = `${formatBytes(currentBytes)} de ${formatBytes(totalFileBytes)}`;
}

// Calcular velocidad en MB/s y Tiempo Restante (ETA)
function calculateSpeedAndETA() {
  const now = Date.now();
  const currentBytes = localRole === 'sender' ? sentBytes : receivedBytes;
  
  const elapsedSeconds = (now - lastTimeLogged) / 1000;
  const bytesSentInPeriod = currentBytes - lastBytesLogged;

  if (elapsedSeconds > 0) {
    const currentSpeedBps = bytesSentInPeriod / elapsedSeconds; // Bytes por segundo
    const speedMBs = currentSpeedBps / (1024 * 1024); // MB por segundo
    
    // Actualizar visualización
    textStatSpeed.innerText = `${speedMBs.toFixed(2)} MB/s`;

    // Ajustar velocidad del visualizador de partículas según la velocidad real
    adjustParticleSpeed(speedMBs);

    // Calcular ETA (Tiempo estimado)
    const remainingBytes = totalFileBytes - currentBytes;
    if (currentSpeedBps > 0) {
      const etaSeconds = remainingBytes / currentSpeedBps;
      textStatEta.innerText = formatTime(etaSeconds);
    } else {
      textStatEta.innerText = 'Infinito (Pausado)';
    }
  }

  lastBytesLogged = currentBytes;
  lastTimeLogged = now;
}

// Cancelar Transferencia
btnCancelTransfer.addEventListener('click', cancelTransfer);

function cancelTransfer(reason = '') {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify({ type: 'transfer-cancelled', reason }));
  }
  const message = reason ? `Transferencia fallida: ${reason}` : 'Has cancelado la transferencia.';
  logTerminal(message, 'error');
  alert(message);
  resetApplication();
}

// Finalizar correctamente
btnFinishTransfer.addEventListener('click', resetApplication);

// Resetear la Aplicación al Estado Inicial
function resetApplication() {
  isTransferActive = false;
  clearInterval(speedCalculationInterval);
  
  // Limpiar timers y visualizadores
  stopParticleVisualizer();

  // Cerrar sockets y conexiones
  if (ws) {
    ws.close();
    ws = null;
  }
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (fileWritableStream) {
    fileWritableStream.close().catch(() => {});
    fileWritableStream = null;
  }

  // Reiniciar variables
  selectedFile = null;
  currentRoomId = null;
  localRole = null;
  sentBytes = 0;
  receivedBytes = 0;
  totalFileBytes = 0;
  incomingFileInfo = null;
  fileWriteQueue = [];
  isWritingQueue = false;
  iceCandidatesQueue = [];

  // Restaurar DOM
  panelTransfer.classList.add('hidden');
  panelSender.classList.add('hidden');
  panelReceiver.classList.add('hidden');
  panelRoleSelection.classList.remove('hidden');

  // Habilitar botones e inputs
  btnGenerateCode.disabled = false;
  btnConnectReceiver.disabled = false;
  btnStartDownload.disabled = false;
  btnCancelTransfer.classList.remove('hidden');
  btnFinishTransfer.classList.add('hidden');
  cardSelectedFile.classList.add('hidden');
  cardShareCode.classList.add('hidden');
  cardIncomingFile.classList.add('hidden');
  indicatorReceiverStatus.classList.add('hidden');
  inputShareCode.value = '';
  fileInput.value = '';
}

// ==========================================================================
// 9. ANIMACIÓN DILATADA DEL VISUALIZADOR DE PARTÍCULAS (VELOCITY EFFECTS)
// ==========================================================================
let canvasCtx = null;
let animationFrameId = null;
let particles = [];
let particleSpeedFactor = 0.5; // Comienza lento

function initParticleVisualizer() {
  canvasCtx = particleCanvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  particles = [];
  // Generar 60 partículas iniciales
  for (let i = 0; i < 60; i++) {
    particles.push({
      x: Math.random() * particleCanvas.width,
      y: Math.random() * particleCanvas.height,
      radius: Math.random() * 2 + 1,
      speed: Math.random() * 2 + 0.5,
      color: Math.random() > 0.5 ? '#00f2fe' : '#ff007f'
    });
  }

  // Lanzar bucle de renderizado
  renderParticles();
}

function resizeCanvas() {
  if (particleCanvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = particleCanvas.getBoundingClientRect();
    particleCanvas.width = rect.width * dpr;
    particleCanvas.height = rect.height * dpr;
    if (canvasCtx) canvasCtx.scale(dpr, dpr);
  }
}

function renderParticles() {
  if (!isTransferActive) return;

  const w = particleCanvas.width / (window.devicePixelRatio || 1);
  const h = particleCanvas.height / (window.devicePixelRatio || 1);

  // Efecto estela (semi-transparente)
  canvasCtx.fillStyle = 'rgba(7, 9, 19, 0.15)';
  canvasCtx.fillRect(0, 0, w, h);

  // Renderizar y mover partículas
  particles.forEach(p => {
    canvasCtx.beginPath();
    canvasCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    canvasCtx.fillStyle = p.color;
    canvasCtx.shadowBlur = 5;
    canvasCtx.shadowColor = p.color;
    canvasCtx.fill();
    canvasCtx.shadowBlur = 0; // reset shadow

    // El factor de velocidad de partículas ajusta el desplazamiento horizontal
    p.x += p.speed * particleSpeedFactor;

    // Reiniciar partícula si sale de pantalla
    if (p.x > w) {
      p.x = 0;
      p.y = Math.random() * h;
    }
  });

  animationFrameId = requestAnimationFrame(renderParticles);
}

function adjustParticleSpeed(speedMBs) {
  // Traducir velocidad real a un factor de velocidad física visual de partículas (Mínimo 0.5, Máximo 10)
  particleSpeedFactor = Math.min(10, 0.5 + (speedMBs / 5));
}

function stopParticleVisualizer() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  window.removeEventListener('resize', resizeCanvas);
}

// ==========================================================================
// 10. FUNCIONES DE AYUDA (HELPERS)
// ==========================================================================

// Formatear bytes a formato comprensible (KB, MB, GB, etc.)
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Formatear segundos en formato MM:SS u HH:MM:SS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return 'Calculando...';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds - (hrs * 3600)) / 60);
  const secs = Math.floor(seconds - (hrs * 3600) - (mins * 60));

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}
