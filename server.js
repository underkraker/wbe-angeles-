const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const WA_CLIENT_ID = process.env.WA_CLIENT_ID || `dream-clean-${process.env.PORT || 3000}`;
const waSessionDir = path.join(__dirname, '.wwebjs_auth', `session-${WA_CLIENT_ID}`);

const clearStaleChromeLocks = () => {
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    lockFiles.forEach((fileName) => {
        const lockPath = path.join(waSessionDir, fileName);
        if (fs.existsSync(lockPath)) {
            try {
                fs.unlinkSync(lockPath);
            } catch (_err) {
                // noop
            }
        }
    });
};

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cors());

const ADMIN_PANEL_KEY = process.env.ADMIN_PANEL_KEY || 'dreampanel2026';

app.use((req, res, next) => {
    if (req.path !== '/admin.html') {
        next();
        return;
    }

    const panelKey = String(req.query.k || '');
    if (panelKey === ADMIN_PANEL_KEY) {
        next();
        return;
    }

    res.status(404).send('Not Found');
});

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dreamclean2026';
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const adminSessions = new Map();

function createAdminSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function createAdminSession() {
    const token = createAdminSessionToken();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    adminSessions.set(token, expiresAt);
    return { token, expiresAt };
}

function isSessionValid(token) {
    if (!token) return false;
    const expiresAt = adminSessions.get(token);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
        adminSessions.delete(token);
        return false;
    }
    return true;
}

function getBearerToken(req) {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) return null;
    return header.slice(7).trim() || null;
}

setInterval(() => {
    const now = Date.now();
    for (const [token, expiresAt] of adminSessions.entries()) {
        if (expiresAt <= now) {
            adminSessions.delete(token);
        }
    }
}, 1000 * 60 * 15).unref();

const isTargetCloseError = (err) =>
    err?.name === 'TargetCloseError' ||
    err?.message?.includes('Target closed') ||
    err?.message?.includes('Runtime.callFunctionOn');

process.on('unhandledRejection', (reason) => {
    if (isTargetCloseError(reason)) {
        console.error('WhatsApp/Puppeteer se cerro, el servidor sigue activo.');
        return;
    }
    console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    if (isTargetCloseError(err)) {
        console.error('Excepcion controlada por cierre de WhatsApp/Puppeteer.');
        return;
    }
    console.error('Uncaught Exception fatal:', err);
    process.exit(1);
});

const puppeteerConfig = {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
};
if (process.env.CHROME_BIN) {
    puppeteerConfig.executablePath = process.env.CHROME_BIN;
}

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: WA_CLIENT_ID,
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: puppeteerConfig
});

let whatsappQR = null;
let whatsappReady = false;
let whatsappInitializing = false;
let whatsappInitRetryTimer = null;
let whatsappInitStartedAt = 0;
let whatsappLastUpdateAt = Date.now();
let whatsappLastError = null;
let whatsappStatusText = 'Inicializando motor de WhatsApp...';

const setWhatsAppStatus = (statusText, errText = null) => {
    whatsappStatusText = statusText;
    whatsappLastError = errText;
    whatsappLastUpdateAt = Date.now();
};

const scheduleWhatsAppReinit = (delayMs = 3000) => {
    if (whatsappInitRetryTimer) return;
    whatsappInitRetryTimer = setTimeout(() => {
        whatsappInitRetryTimer = null;
        initializeWhatsApp();
    }, delayMs);
};

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    QRCode.toDataURL(qr, { width: 280 }, (err, url) => {
        if (!err) {
            whatsappQR = url;
            setWhatsAppStatus('QR generado. Escanea para vincular WhatsApp.');
        }
    });
    whatsappReady = false;
    whatsappLastError = null;
});

client.on('ready', () => {
    console.log('WhatsApp conectado.');
    whatsappQR = null;
    whatsappReady = true;
    setWhatsAppStatus('WhatsApp conectado y operativo.', null);
});

client.on('disconnected', () => {
    console.log('WhatsApp desconectado.');
    whatsappReady = false;
    whatsappQR = null;
    setWhatsAppStatus('WhatsApp desconectado. Reintentando reconexion...');
    scheduleWhatsAppReinit(1500);
});

client.on('auth_failure', (message) => {
    console.error('Fallo de autenticacion de WhatsApp:', message || 'sin detalle');
    whatsappReady = false;
    whatsappQR = null;
    setWhatsAppStatus('Fallo de autenticacion de WhatsApp. Regenerando QR...', message || 'Error de autenticacion');
    scheduleWhatsAppReinit(2000);
});

const initializeWhatsApp = () => {
    if (whatsappInitializing) return;
    whatsappInitializing = true;
    whatsappInitStartedAt = Date.now();
    setWhatsAppStatus('Iniciando sesion de WhatsApp Web...');

    client
        .initialize()
        .catch((err) => {
            console.error('Error inicializando WhatsApp:', err.message);
            setWhatsAppStatus('Error iniciando WhatsApp. Reintentando automaticamente...', err.message);

            const lockError = String(err?.message || '').includes('browser is already running');
            if (lockError) {
                clearStaleChromeLocks();
                setWhatsAppStatus('Se detecto bloqueo de sesion. Corrigiendo y reintentando...', err.message);
                scheduleWhatsAppReinit(1200);
                return;
            }

            scheduleWhatsAppReinit(3000);
        })
        .finally(() => {
            whatsappInitializing = false;
            whatsappInitStartedAt = 0;
            whatsappLastUpdateAt = Date.now();
        });
};

setInterval(() => {
    if (whatsappInitializing && whatsappInitStartedAt && Date.now() - whatsappInitStartedAt > 25000) {
        whatsappInitializing = false;
        whatsappInitStartedAt = 0;
        setWhatsAppStatus('Inicio de WhatsApp tardando demasiado. Reintentando automaticamente...');
        scheduleWhatsAppReinit(500);
        return;
    }

    const qrStaleMs = Date.now() - whatsappLastUpdateAt;
    const qrMissingOrStale = !whatsappReady && !whatsappQR && qrStaleMs > 30000;

    if (qrMissingOrStale && !whatsappInitializing) {
        setWhatsAppStatus('WhatsApp en espera. Forzando reinicio automatico del QR...');
        scheduleWhatsAppReinit(500);
        return;
    }

    const qrOldMs = whatsappQR && qrStaleMs > 180000;
    if (qrOldMs && !whatsappInitializing) {
        setWhatsAppStatus('QR anterior vencido. Regenerando uno nuevo...');
        whatsappQR = null;
        scheduleWhatsAppReinit(500);
    }
}, 12000).unref();

initializeWhatsApp();

const db = new sqlite3.Database('./dream_clean.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err);
        return;
    }

    console.log('Base de datos SQLite conectada.');
    db.serialize(() => {
        db.run('CREATE TABLE IF NOT EXISTS servicios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, precio_sedan REAL, precio_camioneta REAL)');
        db.run('CREATE TABLE IF NOT EXISTS configuracion (id INTEGER PRIMARY KEY, telefono_personal TEXT, telefono_local TEXT)');
        const ensureConfigColumn = (columnName, definition) => {
            db.run(`ALTER TABLE configuracion ADD COLUMN ${columnName} ${definition}`, (err) => {
                if (err && !String(err.message || '').includes('duplicate column name')) {
                    console.error(`No se pudo crear columna ${columnName} en configuracion:`, err.message);
                }
            });
        };
        ensureConfigColumn('social_instagram', "TEXT DEFAULT ''");
        ensureConfigColumn('social_facebook', "TEXT DEFAULT ''");
        ensureConfigColumn('social_tiktok', "TEXT DEFAULT ''");
        ensureConfigColumn('social_whatsapp', "TEXT DEFAULT ''");
        db.run('CREATE TABLE IF NOT EXISTS citas (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre_cliente TEXT, telefono TEXT, modelo_auto TEXT, servicio TEXT, fecha_cita TEXT, hora_cita TEXT, recordatorio_24h INTEGER DEFAULT 0, recordatorio_1h INTEGER DEFAULT 0)');
        db.run(`CREATE TABLE IF NOT EXISTS comentarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT,
            comentario TEXT,
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS media_config (
            id INTEGER PRIMARY KEY,
            logo_path TEXT,
            gallery_1 TEXT,
            gallery_2 TEXT,
            gallery_3 TEXT,
            gallery_4 TEXT,
            gallery_5 TEXT,
            gallery_6 TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS promociones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            titulo TEXT,
            descripcion TEXT,
            precio_especial REAL,
            descuento_porcentaje REAL,
            codigo TEXT,
            activa INTEGER DEFAULT 1,
            fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
        )`);

        const flyerServices = [
            {
                nombre: 'Básico Interior',
                precio_sedan: 700,
                precio_camioneta: 800,
                incluye: 'Aspirado profundo, limpieza de asientos y detallado rápido de tablero.',
                es_promocion: 0
            },
            {
                nombre: 'Integral Premium',
                precio_sedan: 900,
                precio_camioneta: 1100,
                incluye: 'Todo lo básico, descontaminado de superficies, hidratación de interiores y aroma premium.',
                es_promocion: 1
            },
            {
                nombre: 'Sofá y Tapicería',
                precio_sedan: 1200,
                precio_camioneta: 1400,
                incluye: 'Limpieza especializada para salas, sillas y tapicería con extracción de suciedad.',
                es_promocion: 0
            },
            {
                nombre: 'Auto Básico',
                precio_sedan: 700,
                precio_camioneta: 900,
                incluye: 'Limpieza de asientos, aspirado en seco de alfombra, hidratación de vestiduras en puertas/tablero y cera especial con aroma.',
                es_promocion: 0
            },
            {
                nombre: 'Auto Integral',
                precio_sedan: 900,
                precio_camioneta: 1300,
                incluye: 'Incluye todo lo básico + limpieza de cinturones, alfombra completa, cielo raso y zonas difíciles con posa brazo.',
                es_promocion: 1
            },
            {
                nombre: 'Colchón Individual / Matrimonial',
                precio_sedan: 450,
                precio_camioneta: 550,
                incluye: 'Limpieza profunda de colchón. Precio 1 = Individual, Precio 2 = Matrimonial.',
                es_promocion: 0
            },
            {
                nombre: 'Colchón Queen / King',
                precio_sedan: 650,
                precio_camioneta: 700,
                incluye: 'Limpieza profunda de colchón. Precio 1 = Queen, Precio 2 = King.',
                es_promocion: 0
            },
            {
                nombre: 'Sala sin cojines / 4 cojines',
                precio_sedan: 600,
                precio_camioneta: 750,
                incluye: 'Limpieza de sala. Precio 1 = sin cojines, Precio 2 = con 4 cojines.',
                es_promocion: 0
            },
            {
                nombre: 'Sala 6 cojines / desmontables',
                precio_sedan: 850,
                precio_camioneta: 950,
                incluye: 'Limpieza de sala. Precio 1 = con 6 cojines, Precio 2 = cojines desmontables.',
                es_promocion: 0
            },
            {
                nombre: 'Sillón Reposet 1 / 2 plazas',
                precio_sedan: 600,
                precio_camioneta: 800,
                incluye: 'Limpieza de sillón reposet. Precio 1 = 1 plaza, Precio 2 = 2 plazas.',
                es_promocion: 0
            },
            {
                nombre: 'Sillón Reposet 3 plazas',
                precio_sedan: 950,
                precio_camioneta: 950,
                incluye: 'Limpieza de sillón reposet de 3 plazas.',
                es_promocion: 0
            },
            {
                nombre: 'Cojín Decorativo',
                precio_sedan: 25,
                precio_camioneta: 25,
                incluye: 'Limpieza por pieza.',
                es_promocion: 0
            }
        ];

        const flyerPromotions = [
            {
                titulo: 'Promo 2 x $600',
                descripcion: 'Colchón individual o matrimonial, sillas de comedor o tapete 1.5 x 1.5.',
                precio_especial: 600,
                descuento_porcentaje: null,
                codigo: 'PROMO2X600',
                activa: 1
            },
            {
                titulo: 'Promo 1 x $600',
                descripcion: 'Limpieza básica auto sedán, sala 3 plazas sin cojines o colchón king size.',
                precio_especial: 600,
                descuento_porcentaje: null,
                codigo: 'PROMO1X600',
                activa: 1
            }
        ];

        const upsertServiceByName = (service) => {
            const normalizeText = (value) =>
                String(value || '')
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .trim();

            db.all('SELECT id, nombre FROM servicios', (selErr, rows) => {
                if (selErr) return;
                const target = normalizeText(service.nombre);
                const found = (rows || []).find((row) => normalizeText(row.nombre) === target);

                if (found?.id) {
                    db.run(
                        'UPDATE servicios SET nombre = ?, precio_sedan = ?, precio_camioneta = ?, incluye = ?, es_promocion = ? WHERE id = ?',
                        [service.nombre, service.precio_sedan, service.precio_camioneta, service.incluye, service.es_promocion ? 1 : 0, found.id]
                    );
                    return;
                }
                db.run(
                    'INSERT INTO servicios (nombre, precio_sedan, precio_camioneta, incluye, es_promocion) VALUES (?, ?, ?, ?, ?)',
                    [service.nombre, service.precio_sedan, service.precio_camioneta, service.incluye, service.es_promocion ? 1 : 0]
                );
            });
        };

        const upsertPromotionByTitle = (promo) => {
            db.get('SELECT id FROM promociones WHERE lower(titulo) = lower(?) LIMIT 1', [promo.titulo], (selErr, found) => {
                if (selErr) return;
                if (found?.id) {
                    db.run(
                        'UPDATE promociones SET descripcion = ?, precio_especial = ?, descuento_porcentaje = ?, codigo = ?, activa = ? WHERE id = ?',
                        [promo.descripcion, promo.precio_especial, promo.descuento_porcentaje, promo.codigo, promo.activa ? 1 : 0, found.id]
                    );
                    return;
                }
                db.run(
                    'INSERT INTO promociones (titulo, descripcion, precio_especial, descuento_porcentaje, codigo, activa) VALUES (?, ?, ?, ?, ?, ?)',
                    [promo.titulo, promo.descripcion, promo.precio_especial, promo.descuento_porcentaje, promo.codigo, promo.activa ? 1 : 0]
                );
            });
        };

        db.all('PRAGMA table_info(servicios)', (colsErr, cols) => {
            if (colsErr) return;
            const hasIncluye = Array.isArray(cols) && cols.some((c) => c.name === 'incluye');
            const hasPromo = Array.isArray(cols) && cols.some((c) => c.name === 'es_promocion');
            const continueSeed = () => {
                flyerServices.forEach((service) => {
                    upsertServiceByName(service);
                });
            };

            if (!hasIncluye) {
                db.run("ALTER TABLE servicios ADD COLUMN incluye TEXT DEFAULT ''", () => {
                    if (!hasPromo) {
                        db.run('ALTER TABLE servicios ADD COLUMN es_promocion INTEGER DEFAULT 0', continueSeed);
                        return;
                    }
                    continueSeed();
                });
                return;
            }

            if (!hasPromo) {
                db.run('ALTER TABLE servicios ADD COLUMN es_promocion INTEGER DEFAULT 0', continueSeed);
                return;
            }

            continueSeed();
        });

        db.get('SELECT COUNT(*) AS count FROM configuracion', (countErr, row) => {
            if (countErr) return;
            if (row && row.count === 0) {
                db.run("INSERT INTO configuracion (id, telefono_personal, telefono_local) VALUES (1, '5215512345678', '5215512345678')");
            }
        });

        db.get('SELECT COUNT(*) AS count FROM media_config', (countErr, row) => {
            if (countErr) return;
            if (row && row.count === 0) {
                db.run(
                    `INSERT INTO media_config (id, logo_path, gallery_1, gallery_2, gallery_3, gallery_4, gallery_5, gallery_6)
                     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        'Gemini_Generated_Image_1ul01j1ul01j1ul0.png',
                        'https://images.unsplash.com/photo-1520342868574-5fa3804e551c?auto=format&fit=crop&w=1200&q=80',
                        'https://images.unsplash.com/photo-1604335399105-a0c585fd81a1?auto=format&fit=crop&w=1200&q=80',
                        'https://images.unsplash.com/photo-1621905251918-48416bd8575a?auto=format&fit=crop&w=1200&q=80',
                        'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1200&q=80',
                        'https://images.unsplash.com/photo-1616486029423-aaa4789e8c9a?auto=format&fit=crop&w=1200&q=80',
                        'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=1200&q=80'
                    ]
                );
            }
        });

        flyerPromotions.forEach((promo) => {
            upsertPromotionByTitle(promo);
        });
    });
});

const saveBase64Image = (dataUrl, prefix) => {
    const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return null;

    const mime = match[1];
    const base64Data = match[2];
    let ext = 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
    else if (mime.includes('webp')) ext = 'webp';

    const fileName = `${prefix}_${Date.now()}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    return `uploads/${fileName}`;
};

const checkAuth = (req, res, next) => {
    const bearerToken = getBearerToken(req);
    if (isSessionValid(bearerToken)) {
        req.adminToken = bearerToken;
        next();
        return;
    }

    const legacyPassword = req.headers['x-admin-password'];
    if (legacyPassword === ADMIN_PASSWORD) {
        next();
        return;
    }

    res.status(401).json({ error: 'No autorizado' });
};

cron.schedule('0 * * * *', () => {
    db.get('SELECT * FROM configuracion WHERE id = 1', (err, config) => {
        if (err || !config) return;
        const miNum = config.telefono_personal;

        db.all("SELECT * FROM citas WHERE fecha_cita = date('now', '+1 day', 'localtime') AND recordatorio_24h = 0", (selErr, results) => {
            if (selErr) return;
            results?.forEach(async (cita) => {
                try {
                    const msg = `Hola ${cita.nombre_cliente}, Dream Clean te recuerda tu cita de mañana a las ${cita.hora_cita}.`;
                    await client.sendMessage(`${cita.telefono}@c.us`, msg);
                    await client.sendMessage(`${miNum}@c.us`, `CITA MAÑANA: ${cita.nombre_cliente} - ${cita.hora_cita}`);
                    db.run('UPDATE citas SET recordatorio_24h = 1 WHERE id = ?', [cita.id]);
                } catch (sendErr) {
                    console.error('Error recordatorio 24h', sendErr.message);
                }
            });
        });

        db.all("SELECT * FROM citas WHERE fecha_cita = date('now', 'localtime') AND substr(hora_cita, 1, 2) = strftime('%H', 'now', '+1 hour', 'localtime') AND recordatorio_1h = 0", (selErr, results) => {
            if (selErr) return;
            results?.forEach(async (cita) => {
                try {
                    const msg = 'Hola, tu cita en Dream Clean comienza en 1 hora.';
                    await client.sendMessage(`${cita.telefono}@c.us`, msg);
                    await client.sendMessage(`${miNum}@c.us`, `EN 1 HORA: ${cita.nombre_cliente}`);
                    db.run('UPDATE citas SET recordatorio_1h = 1 WHERE id = ?', [cita.id]);
                } catch (sendErr) {
                    console.error('Error recordatorio 1h', sendErr.message);
                }
            });
        });
    });
});

app.post('/admin-login', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        res.status(401).json({ success: false });
        return;
    }

    const session = createAdminSession();
    res.json({ success: true, token: session.token, expiresAt: session.expiresAt });
});

app.post('/admin-logout', checkAuth, (req, res) => {
    if (req.adminToken) {
        adminSessions.delete(req.adminToken);
    }
    res.json({ success: true });
});

app.get('/obtener-paquetes', (_req, res) => {
    db.all(
        `SELECT * FROM servicios
         ORDER BY
            CASE lower(nombre)
                WHEN 'auto basico' THEN 1
                WHEN 'auto básico' THEN 1
                WHEN 'auto integral' THEN 2
                WHEN 'colchon individual / matrimonial' THEN 3
                WHEN 'colchón individual / matrimonial' THEN 3
                WHEN 'colchon queen / king' THEN 4
                WHEN 'colchón queen / king' THEN 4
                WHEN 'sala sin cojines / 4 cojines' THEN 5
                WHEN 'sala 6 cojines / desmontables' THEN 6
                WHEN 'sillon reposet 1 / 2 plazas' THEN 7
                WHEN 'sillón reposet 1 / 2 plazas' THEN 7
                WHEN 'sillon reposet 3 plazas' THEN 8
                WHEN 'sillón reposet 3 plazas' THEN 8
                WHEN 'cojin decorativo' THEN 9
                WHEN 'cojín decorativo' THEN 9
                ELSE 99
            END,
            id ASC`,
        (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
    }
    );
});

app.get('/obtener-promociones', (_req, res) => {
    db.all('SELECT * FROM promociones WHERE activa = 1 ORDER BY id DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
    });
});

app.get('/admin-obtener-promociones', checkAuth, (_req, res) => {
    db.all('SELECT * FROM promociones ORDER BY id DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
    });
});

app.get('/obtener-comentarios', (_req, res) => {
    db.all('SELECT * FROM comentarios ORDER BY id DESC LIMIT 50', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
    });
});

app.get('/obtener-media', (_req, res) => {
    db.get('SELECT * FROM media_config WHERE id = 1', (err, row) => {
        if (err || !row) return res.status(500).json({ error: 'Database error' });
        res.json(row);
    });
});

app.post('/agregar-comentario', (req, res) => {
    const { nombre, comentario } = req.body;
    if (!nombre || !comentario) return res.status(400).json({ error: 'Datos incompletos' });

    db.run('INSERT INTO comentarios (nombre, comentario) VALUES (?, ?)', [String(nombre).trim(), String(comentario).trim()], function onDone(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, id: this.lastID });
    });
});

app.post('/eliminar-comentario', checkAuth, (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido' });
    db.run('DELETE FROM comentarios WHERE id = ?', [id], function onDone(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (this.changes === 0) return res.status(404).json({ error: 'Comentario no encontrado' });
        res.sendStatus(200);
    });
});

app.post('/subir-logo', checkAuth, (req, res) => {
    const { imageData } = req.body;
    const savedPath = saveBase64Image(imageData, 'logo');
    if (!savedPath) return res.status(400).json({ error: 'Imagen invalida' });

    db.run('UPDATE media_config SET logo_path = ? WHERE id = 1', [savedPath], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, path: savedPath });
    });
});

app.post('/subir-galeria', checkAuth, (req, res) => {
    const { slot, imageData } = req.body;
    const slotNum = Number(slot);

    if (![1, 2, 3, 4, 5, 6].includes(slotNum)) {
        return res.status(400).json({ error: 'Slot invalido' });
    }

    const savedPath = saveBase64Image(imageData, `galeria_${slotNum}`);
    if (!savedPath) return res.status(400).json({ error: 'Imagen invalida' });

    const field = `gallery_${slotNum}`;
    db.run(`UPDATE media_config SET ${field} = ? WHERE id = 1`, [savedPath], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, path: savedPath, slot: slotNum });
    });
});

app.post('/registrar-cita', (req, res) => {
    const {
        nombre,
        modelo,
        servicio,
        fecha,
        hora,
        telefono
    } = req.body;

    db.run(
        'INSERT INTO citas (nombre_cliente, modelo_auto, servicio, fecha_cita, hora_cita, telefono) VALUES (?,?,?,?,?,?)',
        [nombre, modelo, servicio, fecha, hora, telefono],
        (err) => {
            if (err) return res.status(500).json({ error: 'Database error' });

            db.get('SELECT telefono_local, telefono_personal FROM configuracion WHERE id = 1', (confErr, conf) => {
                const telefonoLocal = !confErr && conf?.telefono_local ? conf.telefono_local : '5215512345678';
                const telefonoPersonal = !confErr && conf?.telefono_personal ? conf.telefono_personal : null;

                res.json({ success: true, telefono_local: telefonoLocal });

                if (!telefonoPersonal || !whatsappReady) return;

                const mensajeAdmin = [
                    'NUEVA CITA AGENDADA',
                    `Cliente: ${nombre}`,
                    `Telefono: ${telefono}`,
                    `Tipo/Modelo: ${modelo}`,
                    `Servicio: ${servicio}`,
                    `Fecha: ${fecha}`,
                    `Hora: ${hora}`
                ].join('\n');

                client.sendMessage(`${telefonoPersonal}@c.us`, mensajeAdmin).catch(() => {});
            });
        }
    );
});

app.get('/obtener-citas', checkAuth, (_req, res) => {
    db.all('SELECT * FROM citas ORDER BY fecha_cita ASC, hora_cita ASC, id ASC', (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
    });
});

app.post('/eliminar-cita', checkAuth, (req, res) => {
    const { id } = req.body;
    db.run('DELETE FROM citas WHERE id = ?', [id], function onDone(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (this.changes === 0) return res.status(404).json({ error: 'Cita no encontrada' });
        res.sendStatus(200);
    });
});

app.post('/reagendar-cita', checkAuth, (req, res) => {
    const { id, nombre, telefono, modelo, servicio, fecha, hora } = req.body;
    db.run(
        `UPDATE citas
         SET nombre_cliente = ?, telefono = ?, modelo_auto = ?, servicio = ?, fecha_cita = ?, hora_cita = ?, recordatorio_24h = 0, recordatorio_1h = 0
         WHERE id = ?`,
        [nombre, telefono, modelo, servicio, fecha, hora, id],
        function onDone(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (this.changes === 0) return res.status(404).json({ error: 'Cita no encontrada' });
            res.sendStatus(200);
        }
    );
});

app.get('/obtener-config', (_req, res) => {
    db.get('SELECT * FROM configuracion WHERE id = 1', (err, row) => {
        if (err || !row) return res.status(500).json({ error: 'Database error' });
        res.json(row);
    });
});

app.post('/actualizar-precio', checkAuth, (req, res) => {
    const { id, p_sedan, p_camioneta } = req.body;
    db.run('UPDATE servicios SET precio_sedan = ?, precio_camioneta = ? WHERE id = ?', [p_sedan, p_camioneta, id], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.sendStatus(200);
    });
});

app.post('/actualizar-paquete', checkAuth, (req, res) => {
    const { id, nombre, p_sedan, p_camioneta, incluye, es_promocion } = req.body;
    db.run(
        'UPDATE servicios SET nombre = ?, precio_sedan = ?, precio_camioneta = ?, incluye = ?, es_promocion = ? WHERE id = ?',
        [nombre, p_sedan, p_camioneta, incluye || '', es_promocion ? 1 : 0, id],
        function onDone(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (this.changes === 0) return res.status(404).json({ error: 'Paquete no encontrado' });
            res.sendStatus(200);
        }
    );
});

app.post('/crear-paquete', checkAuth, (req, res) => {
    const { nombre, p_sedan, p_camioneta, incluye, es_promocion } = req.body;
    if (!nombre || String(nombre).trim().length < 2) {
        return res.status(400).json({ error: 'Nombre invalido' });
    }

    db.run(
        'INSERT INTO servicios (nombre, precio_sedan, precio_camioneta, incluye, es_promocion) VALUES (?, ?, ?, ?, ?)',
        [
            String(nombre).trim(),
            Number(p_sedan) || 0,
            Number(p_camioneta) || 0,
            String(incluye || '').trim(),
            es_promocion ? 1 : 0
        ],
        function onDone(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.post('/eliminar-paquete', checkAuth, (req, res) => {
    const { id } = req.body;
    db.run('DELETE FROM servicios WHERE id = ?', [id], function onDone(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (this.changes === 0) return res.status(404).json({ error: 'Paquete no encontrado' });
        res.sendStatus(200);
    });
});

app.post('/crear-promocion', checkAuth, (req, res) => {
    const { titulo, descripcion, precio_especial, descuento_porcentaje, codigo, activa } = req.body;
    if (!titulo || String(titulo).trim().length < 2) {
        return res.status(400).json({ error: 'Titulo invalido' });
    }

    const precioEspecial = precio_especial === '' || precio_especial == null ? null : Number(precio_especial);
    const descuento = descuento_porcentaje === '' || descuento_porcentaje == null ? null : Number(descuento_porcentaje);

    db.run(
        `INSERT INTO promociones (titulo, descripcion, precio_especial, descuento_porcentaje, codigo, activa)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            String(titulo).trim(),
            String(descripcion || '').trim(),
            Number.isFinite(precioEspecial) ? precioEspecial : null,
            Number.isFinite(descuento) ? descuento : null,
            String(codigo || '').trim(),
            activa === false ? 0 : 1
        ],
        function onDone(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json({ success: true, id: this.lastID });
        }
    );
});

app.post('/actualizar-promocion', checkAuth, (req, res) => {
    const { id, titulo, descripcion, precio_especial, descuento_porcentaje, codigo, activa } = req.body;
    if (!titulo || String(titulo).trim().length < 2) {
        return res.status(400).json({ error: 'Titulo invalido' });
    }

    const precioEspecial = precio_especial === '' || precio_especial == null ? null : Number(precio_especial);
    const descuento = descuento_porcentaje === '' || descuento_porcentaje == null ? null : Number(descuento_porcentaje);

    db.run(
        `UPDATE promociones
         SET titulo = ?, descripcion = ?, precio_especial = ?, descuento_porcentaje = ?, codigo = ?, activa = ?
         WHERE id = ?`,
        [
            String(titulo).trim(),
            String(descripcion || '').trim(),
            Number.isFinite(precioEspecial) ? precioEspecial : null,
            Number.isFinite(descuento) ? descuento : null,
            String(codigo || '').trim(),
            activa ? 1 : 0,
            id
        ],
        function onDone(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (this.changes === 0) return res.status(404).json({ error: 'Promocion no encontrada' });
            res.sendStatus(200);
        }
    );
});

app.post('/eliminar-promocion', checkAuth, (req, res) => {
    const { id } = req.body;
    db.run('DELETE FROM promociones WHERE id = ?', [id], function onDone(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (this.changes === 0) return res.status(404).json({ error: 'Promocion no encontrada' });
        res.sendStatus(200);
    });
});

app.post('/actualizar-config', checkAuth, (req, res) => {
    const { personal, local, social_instagram, social_facebook, social_tiktok, social_whatsapp } = req.body;
    db.run(
        `UPDATE configuracion
         SET telefono_personal = ?, telefono_local = ?, social_instagram = ?, social_facebook = ?, social_tiktok = ?, social_whatsapp = ?
         WHERE id = 1`,
        [
            String(personal || '').trim(),
            String(local || '').trim(),
            String(social_instagram || '').trim(),
            String(social_facebook || '').trim(),
            String(social_tiktok || '').trim(),
            String(social_whatsapp || '').trim()
        ],
        (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.sendStatus(200);
        }
    );
});

app.get('/whatsapp-status', checkAuth, (_req, res) => {
    res.json({
        connected: whatsappReady,
        qr: whatsappQR,
        initializing: whatsappInitializing,
        status_text: whatsappStatusText,
        last_error: whatsappLastError,
        last_update_at: whatsappLastUpdateAt
    });
});

app.post('/whatsapp-restart', checkAuth, async (_req, res) => {
    try {
        whatsappReady = false;
        whatsappQR = null;
        setWhatsAppStatus('Reinicio manual solicitado. Regenerando QR...');
        try {
            await client.destroy();
        } catch (_err) {
            // noop
        }
        scheduleWhatsAppReinit(300);
        res.json({ success: true, message: 'Reinicio de WhatsApp iniciado.' });
    } catch (err) {
        res.status(500).json({ error: 'No se pudo reiniciar WhatsApp.' });
    }
});

app.post('/whatsapp-logout', checkAuth, async (_req, res) => {
    try {
        await client.logout();
        whatsappReady = false;
        whatsappQR = null;
        setWhatsAppStatus('Sesion cerrada. Regenerando QR...');
        scheduleWhatsAppReinit(500);
        res.json({ success: true, message: 'Sesion cerrada. Regenerando QR...' });
    } catch (err) {
        res.status(500).json({ error: 'No se pudo cerrar la sesion.' });
    }
});

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin.html', (_req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, () => {
    console.log(`Dream Clean server en puerto ${PORT}`);
});
