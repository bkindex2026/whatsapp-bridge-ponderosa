const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const http = require('http');

const RENDER_WEBHOOK_URL = 'https://agente-whatsapp-ponderosa.onrender.com/webhook/whatsapp';
const PORT = process.env.PORT || 3000;

// Servidor HTTP para cumplir el chequeo de salud de Render
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WhatsApp Bridge Activo');
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
            console.log('\n--- ESCANEA ESTE CÓDIGO QR ---');
            qrcode.generate(qr, { small: true });
            console.log('-------------------------------\n');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) iniciarBot();
        } else if (connection === 'open') {
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