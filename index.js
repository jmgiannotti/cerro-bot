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
        let cambios = [];

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
                    cambios.push(`🔄 *${nombre}* cambió de \`${estadoPrevio}\` a \`${estado}\``);
                }
            });
        });

        // Notificar y guardar si hay cambios
        if (cambios.length > 0) {
            const mensaje = `🏔️ *Actualización Cerro Catedral*\n\n${cambios.join('\n')}`;
            await bot.sendMessage(CHAT_ID, mensaje, { parse_mode: 'Markdown' });
            
            fs.writeFileSync(STATE_FILE, JSON.stringify(estadoNuevo, null, 2));
            console.log(`Se notificaron ${cambios.length} cambios.`);
        } else {
            console.log('Sin cambios.');
            if (Object.keys(estadoAnterior).length === 0) {
                fs.writeFileSync(STATE_FILE, JSON.stringify(estadoNuevo, null, 2));
                console.log('Estado inicial guardado.');

                // Enviar resumen inicial por Telegram
                const abiertos = Object.entries(estadoNuevo).filter(([_, e]) => e === 'Normal' || e === 'Abierta' || e === 'Condicional');
                const cerrados = Object.entries(estadoNuevo).filter(([_, e]) => e === 'Cerrado' || e === 'Cerrada');

                let resumen = `🏔️ *Bot Cerro Catedral iniciado*\n\n`;
                resumen += `✅ *Abiertos/Operativos (${abiertos.length}):*\n`;
                abiertos.forEach(([nombre, estado]) => resumen += `  • ${nombre}: \`${estado}\`\n`);
                resumen += `\n❌ *Cerrados (${cerrados.length}):* ${cerrados.map(([n]) => n).join(', ')}\n`;
                resumen += `\n📊 Total: ${Object.keys(estadoNuevo).length} instalaciones monitoreadas`;
                resumen += `\n⏰ Próximo chequeo en 5 minutos`;

                await bot.sendMessage(CHAT_ID, resumen, { parse_mode: 'Markdown' });
                console.log('Resumen inicial enviado por Telegram.');
            }
        }

    } catch (error) {
        console.error('Error consultando el endpoint:', error.message);
    }
}

// Programar ejecución cada 5 minutos
cron.schedule('*/2 * * * *', chequearEstado);

console.log('🏔️ Bot observer iniciado. Primer chequeo en curso...');
chequearEstado();