const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const http = require('http');

const RENDER_WEBHOOK_URL = 'https://agente-whatsapp-ponderosa.onrender.com/webhook/whatsapp';
const PORT = process.env.PORT || 3000;

let currentQR = '';
let connectionStatus = 'Generando código QR...';

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    if (connectionStatus === 'Conectado') {
        res.end(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: green;">✅ WhatsApp Conectado Exitosamente</h1>
                <p>El bot conector está activo y procesando comprobantes.</p>
            </div>
        `);
    } else if (currentQR) {
        const googleChartUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}`;
        res.end(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 30px;">
                <h2>Vincular WhatsApp - Ponderosa Minerals</h2>
                <p>Abre WhatsApp ➔ Dispositivos vinculados ➔ Vincular un dispositivo</p>
                <img src="${googleChartUrl}" alt="Código QR" style="border: 2px solid #333; padding: 10px; border-radius: 8px;" />
                <p style="font-size: 12px; color: #666;">La página se actualiza sola al conectarse.</p>
                <script>
                    setTimeout(() => { location.reload(); }, 5000);
                </script>
            </div>
        `);
    } else {
        res.end(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h2>${connectionStatus}</h2>
                <p>Por favor, recarga la página en unos segundos...</p>
                <script>
                    setTimeout(() => { location.reload(); }, 4000);
                </script>
            </div>
        `);
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Servidor Web escuchando en puerto ${PORT}`);
});

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            connectionStatus = 'QR listo para escanear';
            console.log('📌 Nuevo código QR listo en el navegador web.');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            connectionStatus = 'Reconectando...';
            if (shouldReconnect) iniciarBot();
        } else if (connection === 'open') {
            connectionStatus = 'Conectado';
            currentQR = '';
            console.log('✅ Bot Conector WhatsApp activo y vinculado exitosamente.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const isImage = msg.message.imageMessage || msg.message.documentMessage;
            if (!isImage) continue;

            console.log('📩 Imagen o comprobante detectado en WhatsApp. Enviando al Webhook...');

            try {
                await axios.post(RENDER_WEBHOOK_URL, msg, {
                    headers: { 'Content-Type': 'application/json' }
                });
                console.log('🚀 Comprobante enviado con éxito.');
            } catch (error) {
                console.error('❌ Error enviando la imagen:', error.message);
            }
        }
    });
}

iniciarBot();