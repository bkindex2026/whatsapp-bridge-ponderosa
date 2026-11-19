const { default: makeWASocket, DisconnectReason, downloadMediaMessage, initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const axios = require('axios');
const http = require('http');
const { Pool } = require('pg');

const RENDER_WEBHOOK_URL = 'https://agente-whatsapp-ponderosa.onrender.com/webhook/whatsapp';
const PORT = process.env.PORT || 3000;

let currentQR = '';
let connectionStatus = 'Generando código QR...';

// Conexión a Neon PostgreSQL mediante la variable de entorno de Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Adaptador de almacenamiento persistente en PostgreSQL para Baileys
async function usePostgresAuthState() {
    const readData = async (type, id) => {
        try {
            const key = `${type}-${id}`;
            const res = await pool.query('SELECT data FROM whatsapp_session WHERE id = $1', [key]);
            if (res.rows.length > 0) {
                return JSON.parse(res.rows[0].data, BufferJSON.reviver);
            }
        } catch (error) {
            console.error(`Error leyendo clave ${type}-${id} de Neon:`, error);
        }
        return null;
    };

    const writeData = async (type, id, data) => {
        try {
            const key = `${type}-${id}`;
            const value = JSON.stringify(data, BufferJSON.replacer);
            await pool.query(
                `INSERT INTO whatsapp_session (id, data, updated_at) 
                 VALUES ($1, $2, NOW()) 
                 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
                [key, value]
            );
        } catch (error) {
            console.error(`Error escribiendo clave ${type}-${id} en Neon:`, error);
        }
    };

    const removeData = async (type, id) => {
        try {
            const key = `${type}-${id}`;
            await pool.query('DELETE FROM whatsapp_session WHERE id = $1', [key]);
        } catch (error) {
            console.error(`Error eliminando clave ${type}-${id} en Neon:`, error);
        }
    };

    const credsData = await readData('auth', 'creds');
    const creds = credsData || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(type, id);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            if (value) {
                                tasks.push(writeData(category, id, value));
                            } else {
                                tasks.push(removeData(category, id));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData('auth', 'creds', creds);
        }
    };
}

const server = http.createServer((req, res) => {
    // Responder 200 OK a monitores de Render / cron-job
    if (req.url === '/docs' || req.url === '/health' || req.headers['user-agent']?.includes('cron-job')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('OK');
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    if (connectionStatus === 'Conectado') {
        res.end(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h1 style="color: green;">✅ WhatsApp Conectado Exitosamente (Neon PostgreSQL)</h1>
                <p>El bot conector está activo y respaldado en la base de datos.</p>
            </div>
        `);
    } else if (currentQR) {
        const googleChartUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}`;
        res.end(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 30px;">
                <h2>Vincular WhatsApp - Ponderosa Minerals</h2>
                <p>Abre WhatsApp ➔ Dispositivos vinculados ➔ Vincular un dispositivo</p>
                <img src="${googleChartUrl}" alt="Código QR" style="border: 2px solid #333; padding: 10px; border-radius: 8px;" />
                <script>setTimeout(() => { location.reload(); }, 5000);</script>
            </div>
        `);
    } else {
        res.end(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h2>${connectionStatus}</h2>
                <script>setTimeout(() => { location.reload(); }, 4000);</script>
            </div>
        `);
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Servidor Web escuchando en puerto ${PORT}`);
});

async function iniciarBot() {
    const { state, saveCreds } = await usePostgresAuthState();
    const sock = makeWASocket({ auth: state });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            connectionStatus = 'QR listo para escanear';
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            connectionStatus = 'Reconectando...';
            if (shouldReconnect) iniciarBot();
        } else if (connection === 'open') {
            connectionStatus = 'Conectado';
            currentQR = '';
            console.log('✅ Bot Conector WhatsApp activo (Sesión guardada en Neon).');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const isImage = msg.message.imageMessage || msg.message.documentMessage;
            if (!isImage) continue;

            console.log('📩 Imagen detectada. Descargando buffer...');

            try {
                const buffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    { },
                    { reuploadRequest: sock.updateMediaMessage }
                );

                const base64Image = buffer.toString('base64');
                const mimeType = isImage.mimetype || 'image/jpeg';

                const payload = {
                    data: {
                        message: {
                            imageMessage: {
                                base64: base64Image,
                                mimetype: mimeType
                            }
                        }
                    }
                };

                await axios.post(RENDER_WEBHOOK_URL, payload, {
                    headers: { 'Content-Type': 'application/json' }
                });
                console.log('🚀 Imagen en Base64 enviada con éxito al backend.');
            } catch (error) {
                console.error('❌ Error al procesar o enviar imagen:', error.message);
            }
        }
    });
}

iniciarBot();