const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode-terminal');

const RENDER_WEBHOOK_URL = 'https://agente-whatsapp-ponderosa.onrender.com/webhook/whatsapp';

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📌 ESCANEA ESTE CÓDIGO QR DESDE TU CELULAR:');
            qrcode.generate(qr, { small: true }, (qrcodeStr) => console.log(qrcodeStr));
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

            console.log('📩 Imagen o comprobante detectado en WhatsApp. Enviando al Webhook de Render...');

            try {
                await axios.post(RENDER_WEBHOOK_URL, msg, {
                    headers: { 'Content-Type': 'application/json' }
                });
                console.log('🚀 Comprobante enviado con éxito a Render.');
            } catch (error) {
                console.error('❌ Error enviando la imagen al Webhook:', error.message);
            }
        }
    });
}

iniciarBot();