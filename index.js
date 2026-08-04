import 'dotenv/config';
import cron from 'node-cron';
import fs from 'fs';
import { TelegramBot } from 'node-telegram-bot-api';
import puppeteer from 'puppeteer';

// Credenciales desde .env
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API_PUBLIC_KEY = process.env.API_PUBLIC_KEY;
const API_URL = 'https://ws.busplus.com.ar/centrosesqui/partediario/estados?Centro=CA';
const STATE_FILE = './estado_catedral.json';

const bot = new TelegramBot(TOKEN, { polling: false });

function obtenerEstadoAnterior() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE));
    }
    return {};
}

// ─── Helpers de clasificación y formateo ────────────────────────────

const ESTADO_RANK = {
    'Cerrado': 0, 'Cerrada': 0,
    'Condicional': 1,
    'Regulares': 2,
    'Normal': 3, 'Abierta': 3,
};

const TIPOS_CONFIG = {
    medios: { emoji: '🚡', label: 'Medios de elevación', abiertoLabel: 'Abiertos' },
    pistas: { emoji: '⛷️', label: 'Pistas', abiertoLabel: 'Abiertas' },
    caminos: { emoji: '🔵', label: 'Caminos', abiertoLabel: 'Abiertos' },
    otros:   { emoji: '📍', label: 'Otros', abiertoLabel: 'Abiertos' },
};

function clasificarTipo(nombre) {
    const n = nombre.toLowerCase();
    if (n.startsWith('ts ') || n.startsWith('tc ') || n.startsWith('t-bar') ||
        n.startsWith('magic') || n.startsWith('séxtuple') || n.startsWith('sextuple') ||
        n.startsWith('área')) {
        return 'medios';
    }
    if (n.startsWith('pista')) return 'pistas';
    if (n.startsWith('camino')) return 'caminos';
    return 'otros';
}

function esAbierto(estado) {
    return ['Normal', 'Abierta', 'Regulares'].includes(estado);
}

function esCondicional(estado) {
    return estado === 'Condicional';
}

function direccionCambio(de, a) {
    const rankDe = ESTADO_RANK[de] ?? 0;
    const rankA = ESTADO_RANK[a] ?? 0;
    if (rankA > rankDe) return '⬆️';
    if (rankA < rankDe) return '⬇️';
    return '🔄';
}

function formatearItem(item) {
    if (item.cambio) {
        const dir = direccionCambio(item.cambio.de, item.cambio.a);
        return `  • *${item.nombre}: ${item.estado}* ${dir}`;
    }
    return `  • ${item.nombre}: ${item.estado}`;
}

function formatearSeccionTipo(tipoKey, grupo) {
    const config = TIPOS_CONFIG[tipoKey];
    if (!config) return '';

    const totalOperativos = grupo.abiertos.length + grupo.condicionales.length;
    if (totalOperativos === 0) return '';

    let msg = `${config.emoji} *${config.label}:*\n\n`;

    if (grupo.abiertos.length > 0) {
        msg += `🟢 ${config.abiertoLabel} (${grupo.abiertos.length}):\n`;
        grupo.abiertos.forEach(item => {
            msg += `${formatearItem(item)}\n`;
        });
        msg += `\n`;
    }

    if (grupo.condicionales.length > 0) {
        msg += `🟡 Condicionales (${grupo.condicionales.length}):\n`;
        grupo.condicionales.forEach(item => {
            msg += `${formatearItem(item)}\n`;
        });
        msg += `\n`;
    }

    return msg;
}

function formatearPanorama(estadoNuevo, cambiosMap = {}, esInicial = false) {
    const ahora = new Date();
    const fecha = `${String(ahora.getDate()).padStart(2, '0')}/${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const hora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    const numCambios = Object.keys(cambiosMap).length;

    // Agrupar por tipo, y dentro de cada tipo por estado
    const porTipo = {
        medios: { abiertos: [], condicionales: [] },
        pistas: { abiertos: [], condicionales: [] },
        caminos: { abiertos: [], condicionales: [] },
        otros: { abiertos: [], condicionales: [] },
    };
    const cerrados = [];

    const sortFn = (a, b) => a.nombre.localeCompare(b.nombre, 'es');

    for (const [nombre, estado] of Object.entries(estadoNuevo)) {
        const tipo = clasificarTipo(nombre);
        const cambio = cambiosMap[nombre];
        const entry = { nombre, estado, cambio };

        if (esAbierto(estado)) {
            porTipo[tipo].abiertos.push(entry);
        } else if (esCondicional(estado)) {
            porTipo[tipo].condicionales.push(entry);
        } else {
            cerrados.push(entry);
        }
    }

    // Ordenar alfabéticamente dentro de cada grupo
    for (const grupo of Object.values(porTipo)) {
        grupo.abiertos.sort(sortFn);
        grupo.condicionales.sort(sortFn);
    }
    cerrados.sort(sortFn);

    const totalCerrados = cerrados.length;
    const totalGeneral = Object.keys(estadoNuevo).length;

    // Construir mensaje
    let msg = '';

    if (esInicial) {
        msg += `🏔️ *Bot Cerro Catedral iniciado*\n`;
    } else {
        msg += `🏔️ *Actualización Cerro Catedral*\n`;
    }
    msg += `📅 ${fecha} — ${hora}hs\n`;

    if (!esInicial && numCambios > 0) {
        msg += `\n⚡ *${numCambios} cambio${numCambios > 1 ? 's' : ''} detectado${numCambios > 1 ? 's' : ''}*\n`;
    }

    // Secciones por tipo (Medios, Pistas, Caminos, Otros)
    for (const tipoKey of Object.keys(TIPOS_CONFIG)) {
        const seccion = formatearSeccionTipo(tipoKey, porTipo[tipoKey]);
        if (seccion) {
            msg += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            msg += seccion;
        }
    }

    // Sección Cerrados (formato compacto, separados por coma)
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `🔴 *Cerrados (${totalCerrados}):*\n`;
    if (totalCerrados === 0) {
        msg += `_Ninguno_\n`;
    } else {
        const cerradosParts = cerrados.map(item => {
            if (item.cambio) {
                return `*${item.nombre}* ⬇️`;
            }
            return item.nombre;
        });
        msg += cerradosParts.join(', ') + '\n';
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `📊 ${totalGeneral} instalaciones monitoreadas\n`;
    msg += `⏰ Próximo chequeo en 5 min`;

    return msg;
}

async function enviarMensajeTelegram(chatId, mensaje) {
    // Telegram tiene un límite de 4096 caracteres por mensaje
    if (mensaje.length <= 4096) {
        await bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
        return;
    }

    // Si es muy largo, dividir por las líneas separadoras
    const separador = '━━━━━━━━━━━━━━━━━━━━';
    const partes = mensaje.split(separador);
    let mensajeActual = '';

    for (const parte of partes) {
        const candidato = mensajeActual + (mensajeActual ? separador : '') + parte;
        if (candidato.length > 4000 && mensajeActual) {
            await bot.sendMessage(chatId, mensajeActual.trim(), { parse_mode: 'Markdown' });
            mensajeActual = parte;
        } else {
            mensajeActual = candidato;
        }
    }

    if (mensajeActual.trim()) {
        await bot.sendMessage(chatId, mensajeActual.trim(), { parse_mode: 'Markdown' });
    }
}

// ─── Scraping con Puppeteer ─────────────────────────────────────────

// Navegar al sitio real y capturar la respuesta de la API que la propia página hace
async function fetchConPuppeteer() {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Bloquear recursos innecesarios para acelerar la carga
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Crear una promesa que se resuelve cuando interceptemos la respuesta de la API
        const apiResponsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout esperando respuesta API')), 30000);

            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('partediario/estados')) {
                    // Ignorar preflight OPTIONS requests
                    const request = response.request();
                    if (request.method() === 'OPTIONS') return;

                    try {
                        clearTimeout(timeout);
                        const text = await response.text();
                        const json = JSON.parse(text);
                        resolve(json);
                    } catch (e) {
                        reject(new Error(`Error parseando respuesta API: ${e.message}`));
                    }
                }
            });
        });

        // Navegar a la página del parte de nieve (la que hace la llamada a la API)
        await page.goto('https://catedralaltapatagonia.com/parte-de-nieve/', {
            waitUntil: 'networkidle2',
            timeout: 25000
        });

        // Esperar a que la página haya hecho la llamada a la API y obtener la respuesta
        const data = await apiResponsePromise;
        return data;
    } finally {
        await browser.close();
    }
}

// ─── Lógica principal ───────────────────────────────────────────────

async function chequearEstado() {
    try {
        console.log(`[${new Date().toISOString()}] Consultando estado del cerro...`);

        const sectores = await fetchConPuppeteer();

        // Si la respuesta es un objeto con status false, lanzar error
        if (sectores && sectores.status === false) {
            throw new Error(`API rechazó la petición: ${sectores.message}`);
        }

        console.log(`Datos obtenidos: ${Array.isArray(sectores) ? sectores.length + ' sectores' : typeof sectores}`);

        const estadoAnterior = obtenerEstadoAnterior();
        const estadoNuevo = {};
        const cambiosMap = {};

        // Manejar si la respuesta viene envuelta en un objeto
        const listaSectores = Array.isArray(sectores) ? sectores : (sectores.data || []);

        // Iterar sobre el JSON real del Catedral
        listaSectores.forEach(sector => {
            const instalaciones = [...(sector.Medios || []), ...(sector.Pistas || [])];

            instalaciones.forEach(item => {
                const nombre = item.Nombre;
                const estado = item.EstadoEsquiadores || 'Desconocido';

                estadoNuevo[nombre] = estado;

                const estadoPrevio = estadoAnterior[nombre];
                if (estadoPrevio && estadoPrevio !== estado) {
                    cambiosMap[nombre] = { de: estadoPrevio, a: estado };
                }
            });
        });

        const hayCambios = Object.keys(cambiosMap).length > 0;
        const esEstadoInicial = Object.keys(estadoAnterior).length === 0;

        if (hayCambios || esEstadoInicial) {
            fs.writeFileSync(STATE_FILE, JSON.stringify(estadoNuevo, null, 2));

            const mensaje = formatearPanorama(estadoNuevo, cambiosMap, esEstadoInicial);
            await enviarMensajeTelegram(CHAT_ID, mensaje);

            if (hayCambios) {
                console.log(`Se notificaron ${Object.keys(cambiosMap).length} cambios.`);
            } else {
                console.log('Estado inicial guardado y resumen enviado.');
            }
        } else {
            console.log('Sin cambios.');
        }

    } catch (error) {
        console.error('Error consultando el endpoint:', error.message);
    }
}

// Programar ejecución cada 2 minutos
cron.schedule('*/2 * * * *', chequearEstado);

console.log('🏔️ Bot observer iniciado. Primer chequeo en curso...');
chequearEstado();