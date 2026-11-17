const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode');
const http = require('http');

const RENDER_WEBHOOK_URL = 'https://agente-whatsapp-ponderosa.onrender.com/webhook/whatsapp';
const PORT = process.env.PORT || 3000;

let latestQrImage = '';
let connectionStatus = 'Esperando código QR...';

// Servidor Web que renderiza la imagen del QR o el estado de la conexión
const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    if (connectionStatus === 'Conectado') {
        res.end(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #2e7d32;">✅ WhatsApp Conectado Exitosamente</h1>
                <p>El bot está activo y reenviando comprobantes al Webhook.</p>
            </div>
        `);
    } else if (latestQrImage) {
        res.end(`
            <div style="font-family: sans-serif; text-align: center; padding: 30px;">
                <h2>Escanear Código QR de WhatsApp</h2>
                <p>Abre WhatsApp ➔ Dispositivos vinculados ➔ Vincular un dispositivo</p>
                <img src="${latestQrImage}" alt="Código QR" style="width: 300px; height: 300px; border: 1px solid #ccc; padding: 10px;"/>
            </div>
        `);
    } else {
        res.end(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h2>${connectionStatus}</h2>
                <p>Actualiza la página en unos segundos...</p>
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

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            try {
                latestQrImage = await qrcode.toDataURL(qr);
                connectionStatus = 'QR Generado';
                console.log('📌 Nuevo código QR generado. Abre la URL del servicio en el navegador.');
            } catch (err) {
                console.error('Error generando imagen QR:', err);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            connectionStatus = 'Reconectando...';
            if (shouldReconnect) iniciarBot();
        } else if (connection === 'open') {
            connectionStatus = 'Conectado';
            latestQrImage = '';
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