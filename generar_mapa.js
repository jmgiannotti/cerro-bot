import fs from 'fs';
import sharp from 'sharp';

// ─── Coordenadas relativas (%) — Base → Cima, de abajo hacia arriba ─────────
const MEDIOS_LINES = {
  "TC Amancay":          [[61.33,84.08],[55.53,76.76],[49.40,70.03],[42.31,60.04],[31.80,43.92],[30.19,42.83],[30.18,42.73]],
  "TS Bosque":           [[23.74,56.38],[23.99,25.42]],
  "TS Diente de Caballo":[[27.15,42.93],[29.28,29.18]],
  "TS Princesita":       [[67.00,82.69],[64.55,74.18]],
  "TS Ciprés":           [[68.55,81.70],[61.14,61.36],[58.49,55.79]],
  "Magic I":             [[65.51,79.33],[64.74,79.72]],
  "Magic II":            [[59.32,84.77],[58.94,82.49]],
  "Magic III":           [[65.71,82.29],[62.22,81.80]],
  "Magic IV":            [[63.96,79.72],[60.10,79.13]],
  "Magic V":             [[57.07,85.36],[56.61,81.40]],
  "TS Ñire":             [[59.77,56.48],[40.69,31.16]],
  "TS Centro":           [[56.13,39.30],[53.94,18.82]],
  "TS Triple Park":      [[47.78,29.18],[49.65,20.87]],
  "TS Nubes":            [[53.66,42.97],[42.89,23.58],[39.48,11.22]],
  "TS Lenga":            [[32.51,17.15],[43.73,34.26]],
  "TS Séxtuple Express": [[69.91,80.36],[64.10,53.55],[63.85,44.65],[61.01,32.84]],
  "Cable Carril":        [[76.68,82.14],[60.49,23.58]],
  "TS La Hoya":          [[63.46,42.18],[64.23,16.16]],
  "TS Punta Nevada":     [[61.40,36.64],[54.82,13.69]],
  "TS Lynch":            [[61.24,31.92],[58.14,14.21]],
  "TS Cóndor I":         [[75.58,80.75],[75.71,61.36]],
  "TS Cóndor II":        [[75.39,60.38],[76.48,39.11]],
  "TS Cóndor III":       [[76.87,38.12],[79.19,23.48]],
  "T-Bar Corto":         [[81.19,60.38],[79.06,57.21]],
  "T-Bar Largo":         [[82.87,60.57],[78.22,37.23]]
};

// ─── Estilos por estado ─────────────────────────────────────────────────────
const ESTILOS = {
  abierto:      { color: '#00FF00', width: 5, dash: false, opacity: 1.0 },
  condicional:  { color: '#FFFF00', width: 4, dash: true,  opacity: 1.0 },
  cerrado:      { color: '#FF3333', width: 2, dash: false, opacity: 0.6 },
  desconocido:  { color: '#555555', width: 2, dash: false, opacity: 0.5 }
};

const ESTADOS_ABIERTO     = new Set(['Normal', 'Abierta', 'Abierto', 'Regulares']);
const ESTADOS_CONDICIONAL = new Set(['Condicional']);
const ESTADOS_CERRADO     = new Set(['Cerrado', 'Cerrada']);

function obtenerEstilo(estado) {
  if (ESTADOS_ABIERTO.has(estado))     return ESTILOS.abierto;
  if (ESTADOS_CONDICIONAL.has(estado)) return ESTILOS.condicional;
  if (ESTADOS_CERRADO.has(estado))     return ESTILOS.cerrado;
  return ESTILOS.desconocido;
}

// ─── Generador SVG ──────────────────────────────────────────────────────────
function generarSVGOverlay(width, height, estadosBot) {
  const elementos = [];

  for (const [nombre, puntosRel] of Object.entries(MEDIOS_LINES)) {
    const estado = estadosBot[nombre] || 'Desconocido';
    const estilo = obtenerEstilo(estado);

    // Convertir porcentajes a píxeles
    const pts = puntosRel.map(([xPct, yPct]) => [
      (xPct / 100) * width,
      (yPct / 100) * height
    ]);

    const pointsStr = pts.map(p => p.join(',')).join(' ');
    const dashAttr = estilo.dash ? ' stroke-dasharray="10,5"' : '';

    // Línea (polyline)
    elementos.push(
      `<polyline points="${pointsStr}" fill="none" stroke="${estilo.color}" ` +
      `stroke-width="${estilo.width}" stroke-linejoin="round" stroke-linecap="round" ` +
      `opacity="${estilo.opacity}"${dashAttr}/>`
    );

    // Círculo en la base si está activo (abierto/condicional)
    if (estilo.opacity === 1.0) {
      elementos.push(
        `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="6" ` +
        `fill="#FFF" stroke="${estilo.color}" stroke-width="2"/>`
      );
    }

    // Texto con el nombre — sobre el último tramo
    if (pts.length >= 2) {
      const [ax, ay] = pts[pts.length - 2];
      const [bx, by] = pts[pts.length - 1];
      const tx = (ax + bx) / 2;
      const ty = (ay + by) / 2;

      let rot = Math.atan2(by - ay, bx - ax) * (180 / Math.PI);
      if (rot > 90 || rot < -90) rot += 180;

      const textColor = estilo.opacity === 1.0 ? '#FFF' : '#AAA';

      elementos.push(
        `<text x="${tx}" y="${ty - 8}" font-family="sans-serif" font-size="14" ` +
        `font-weight="bold" fill="${textColor}" stroke="#000" stroke-width="3" ` +
        `paint-order="stroke fill" text-anchor="middle" dominant-baseline="middle" ` +
        `transform="rotate(${rot},${tx},${ty})" opacity="${estilo.opacity}">${nombre}</text>`
      );
    }
  }

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${elementos.join('')}</svg>`;
}

// ─── Exportar ───────────────────────────────────────────────────────────────
export async function generarMapaConEstados(imagenMapaPath, outputPath, estadosBot) {
  if (!fs.existsSync(imagenMapaPath)) {
    console.warn(`[Mapa] No se encontró la imagen base en ${imagenMapaPath}`);
    return false;
  }

  try {
    const { width, height } = await sharp(imagenMapaPath).metadata();
    const svg = generarSVGOverlay(width, height, estadosBot);

    await sharp(imagenMapaPath)
      .composite([{ input: Buffer.from(svg), blend: 'over' }])
      .toFile(outputPath);

    return true;
  } catch (error) {
    console.error('[Mapa] Error generando mapa:', error);
    return false;
  }
}
