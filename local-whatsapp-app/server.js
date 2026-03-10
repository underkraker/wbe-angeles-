import express from 'express';
import cors from 'cors';
import qrcode from 'qrcode-terminal';
import { Client, LocalAuth } from 'whatsapp-web.js';

const PORT = Number(process.env.PORT || 3010);
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

let ready = false;

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'dreamclean-local' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('\nEscanea este QR con WhatsApp para vincular la app local:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    ready = true;
    console.log('WhatsApp local conectado y listo.');
});

client.on('auth_failure', (msg) => {
    ready = false;
    console.error('Fallo de autenticacion:', msg);
});

client.on('disconnected', (reason) => {
    ready = false;
    console.warn('WhatsApp desconectado:', reason);
});

function cleanNumber(value) {
    return String(value || '').replace(/[^0-9]/g, '');
}

function bookingMessage(payload) {
    const businessName = payload.businessName || 'Dream Clean';
    const booking = payload.booking || {};
    const phone = booking.phone ? `\nContacto: ${booking.phone}` : '';
    const email = booking.email ? `\nCorreo: ${booking.email}` : '';
    const channel = booking.contactChannel ? `\nCanal preferido: ${booking.contactChannel}` : '';

    return [
        `Nueva cita en ${businessName}`,
        '',
        `Cliente: ${booking.name || 'Sin nombre'}`,
        `Servicio: ${booking.service || 'Sin servicio'}`,
        `Fecha deseada: ${booking.date || 'Sin fecha'}`,
        `Estatus: ${booking.status || 'pendiente'}`,
        phone,
        email,
        channel,
        '',
        `ID: ${booking.id || 'sin-id'}`,
        `Registro: ${booking.createdAt || new Date().toISOString()}`
    ].join('\n');
}

app.get('/health', (_req, res) => {
    res.json({ ok: true, ready });
});

app.post('/send-booking', async (req, res) => {
    if (!ready) {
        return res.status(503).json({ ok: false, message: 'WhatsApp aun no esta listo' });
    }

    const payload = req.body || {};
    const toNumber = cleanNumber(payload.businessWhatsapp || process.env.BUSINESS_WHATSAPP);

    if (!toNumber) {
        return res.status(400).json({ ok: false, message: 'Numero destino faltante' });
    }

    const chatId = `${toNumber}@c.us`;
    const text = bookingMessage(payload);

    try {
        await client.sendMessage(chatId, text);
        return res.json({ ok: true });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'No se pudo enviar', error: String(error.message || error) });
    }
});

app.listen(PORT, () => {
    console.log(`Local WhatsApp App corriendo en http://127.0.0.1:${PORT}`);
});

client.initialize();
