import 'dotenv/config';
import cron from 'node-cron';
import fs from 'fs';
import { TelegramBot } from 'node-telegram-bot-api';
import puppeteer from 'puppeteer';
import { generarMapaConEstados } from './generar_mapa.js';

// Credenciales desde .env
const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const STATE_FILE = './estado_catedral.json';
const MAPA_BASE = './assets/mapa_base.png';
const MAPA_OUTPUT = './assets/mapa_estado_actual.png';

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
    'Normal': 3, 'Abierta': 3, 'Abierto': 3,
};

const ESTADOS_ABIERTO = new Set(['Normal', 'Abierta', 'Abierto', 'Regulares']);
const ESTADOS_CERRADO = new Set(['Cerrado', 'Cerrada']);

function emojiEstado(estado) {
    if (ESTADOS_ABIERTO.has(estado)) return '🟢';
    if (estado === 'Condicional') return '🟡';
    if (ESTADOS_CERRADO.has(estado)) return '🔴';
    return '⚪';
}

function direccionCambio(de, a) {
    const rankDe = ESTADO_RANK[de] ?? 0;
    const rankA = ESTADO_RANK[a] ?? 0;
    if (rankA > rankDe) return '⬆️';
    if (rankA < rankDe) return '⬇️';
    return '🔄';
}

function formatearItem(nombre, estado, cambio) {
    const emoji = emojiEstado(estado);
    if (cambio) {
        const dir = direccionCambio(cambio.de, cambio.a);
        return `${emoji} *${nombre}* ${dir}`;
    }
    return `${emoji} ${nombre}`;
}

function formatearPanorama(listaSectores, cambiosMap = {}, esInicial = false) {
    const ahora = new Date();
    const fecha = `${String(ahora.getDate()).padStart(2, '0')}/${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const hora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    const numCambios = Object.keys(cambiosMap).length;

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

    // Ordenar sectores por su campo Orden
    const sectoresOrdenados = [...listaSectores].sort((a, b) => (a.Orden ?? 0) - (b.Orden ?? 0));

    let totalInstalaciones = 0;

    for (const sector of sectoresOrdenados) {
        const sectorNombre = sector.SectorNombre || 'Sin nombre';
        const medios = sector.Medios || [];
        const pistas = sector.Pistas || [];
        const instalaciones = [...medios, ...pistas];

        if (instalaciones.length === 0) continue;

        totalInstalaciones += instalaciones.length;

        msg += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
        msg += `📍 *${sectorNombre}*\n\n`;

        // Medios de elevación
        if (medios.length > 0) {
            msg += `🚡 _Medios:_\n`;
            medios.forEach(item => {
                const nombre = item.Nombre;
                const estado = item.EstadoEsquiadores || 'Desconocido';
                const cambio = cambiosMap[nombre];
                msg += `${formatearItem(nombre, estado, cambio)}\n`;
            });
            msg += `\n`;
        }

        // Pistas y caminos
        if (pistas.length > 0) {
            msg += `⛷️ _Pistas y caminos:_\n`;
            pistas.forEach(item => {
                const nombre = item.Nombre;
                const estado = item.EstadoEsquiadores || 'Desconocido';
                const cambio = cambiosMap[nombre];
                msg += `${formatearItem(nombre, estado, cambio)}\n`;
            });
            msg += `\n`;
        }
    }

    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `📊 ${totalInstalaciones} instalaciones monitoreadas\n`;
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
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    } catch (launchError) {
        console.error('\n❌ ERROR CRÍTICO AL INICIAR PUPPETEER (CHROMIUM) ❌');
        console.error('Si estás ejecutando el bot en Linux/Ubuntu, es muy probable que te falten instalar las dependencias del sistema operativo.');
        console.error('Revisa el README.md y corre el comando "sudo apt install..." para solucionarlo.');
        console.error('Traza del error original:', launchError.message, '\n');
        throw launchError;
    }

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

        // Manejar si la respuesta viene envuelta en un objeto
        const listaSectores = Array.isArray(sectores) ? sectores : (sectores.data || []);

        console.log(`Datos obtenidos: ${listaSectores.length} sectores`);

        const estadoAnterior = obtenerEstadoAnterior();
        const estadoNuevo = {};
        const cambiosMap = {};

        // Construir mapa plano de estados (para comparar cambios)
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

            // Generar y enviar mapa
            const mapaExitoso = await generarMapaConEstados(MAPA_BASE, MAPA_OUTPUT, estadoNuevo);

            if (mapaExitoso) {
                try {
                    await bot.sendPhoto(CHAT_ID, MAPA_OUTPUT);
                } catch (err) {
                    console.error('Error enviando el mapa por Telegram:', err.message);
                }
            }

            // Pasar los sectores crudos para formatear por sector
            const mensaje = formatearPanorama(listaSectores, cambiosMap, esEstadoInicial);
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
        console.error(`[${new Date().toISOString()}] Error consultando el endpoint o procesando datos:`, error.message || error);
    }
}

// Programar ejecución cada 4 minutos
cron.schedule('*/4 * * * *', chequearEstado);

console.log('🏔️ Bot observer iniciado. Primer chequeo en curso...');
chequearEstado();