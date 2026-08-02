// Rasteriza un cartel EN UN PROCESO HIJO con fontconfig aislado — cero fuentes del sistema.
//
// Por qué hace falta tanto aparato para una prueba: el bug del 2026-08-02 (el cartel impreso salía
// con un cuadradito por letra en vez de texto) NO se podía reproducir en la máquina del dueño. La
// plantilla pedía `font-family="sans-serif"`, Windows tiene fuentes, librsvg encontraba una y el PNG
// local se veía perfecto. Las 887 pruebas pasaban. El runtime serverless de Vercel, en cambio, no
// trae NINGUNA fuente instalada, así que ahí librsvg dibujaba el glifo "faltante" (tofu) por cada
// carácter — sin error, con el peso esperado, y con la vista previa del navegador viéndose bien.
//
// Una prueba que corre con las fuentes de la máquina no puede atrapar eso NUNCA. Lo único que sirve
// es reproducir la condición de Vercel: fontconfig sin un solo directorio de fuentes. Y tiene que
// ser en otro PROCESO porque fontconfig lee su configuración UNA vez, al primer uso, y la cachea
// para toda la vida del proceso: si se tocara `process.env` dentro de Vitest, el resultado
// dependería de si alguna prueba anterior ya rasterizó texto, y además envenenaría a las que sigan.
//
// Medido el 2026-08-02 con sharp 0.34.5 (librsvg 2.61.2, fontconfig 2.17.1): el mismo <text> da
// 40.881 píxeles de tinta con las fuentes de Windows y 2.128 con esta configuración aislada — esos
// 2.128 son el CONTORNO de los cuadraditos, no letras. La prueba "el aislamiento aísla de verdad"
// de export.test.ts compara esas dos cifras; si algún día fontconfig ignorara FONTCONFIG_FILE, esa
// prueba falla y avisa que las demás dejaron de medir lo que dicen medir.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatosCartel, FormatoCartel } from '../../lib/comercio/cartel/tipos';

const ESTE_ARCHIVO = fileURLToPath(import.meta.url);

interface TrabajoCartel {
  datos: DatosCartel;
  formato: FormatoCartel;
}
interface TrabajoCrudo {
  svgCrudo: string;
  ancho: number;
  alto: number;
}
type Trabajo = TrabajoCartel | TrabajoCrudo;

// Una configuración de fontconfig SIN un solo <dir>: no hay de dónde sacar una fuente. El <cachedir>
// va a un temporal propio para no ensuciar (ni leer) la caché real de la máquina, que podría tener
// fuentes indexadas de antes.
function configSinFuentes(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cartel-sin-fuentes-'));
  const conf = join(dir, 'fonts.conf');
  writeFileSync(
    conf,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <cachedir>${join(dir, 'cache').replace(/\\/g, '/')}</cachedir>
</fontconfig>
`,
  );
  return conf;
}

function ejecutarHijo(trabajo: Trabajo, aislar: boolean): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const entorno = { ...process.env };
    if (aislar) entorno.FONTCONFIG_FILE = configSinFuentes();
    // `--import tsx` deja que el hijo importe los módulos .ts del proyecto tal cual están.
    const hijo = spawn(process.execPath, ['--import', 'tsx', ESTE_ARCHIVO, '--hijo'], {
      env: entorno,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const salida: Buffer[] = [];
    const errores: Buffer[] = [];
    hijo.stdout.on('data', (t: Buffer) => salida.push(t));
    hijo.stderr.on('data', (t: Buffer) => errores.push(t));
    hijo.on('error', rechazar);
    hijo.on('close', (codigo) => {
      if (codigo !== 0) {
        rechazar(new Error(`el rasterizado aislado falló (código ${codigo}):\n${Buffer.concat(errores).toString()}`));
        return;
      }
      resolver(Buffer.from(Buffer.concat(salida).toString('utf8').trim(), 'base64'));
    });
    hijo.stdin.end(JSON.stringify(trabajo));
  });
}

/** El cartel completo (se ARMA y se rasteriza adentro), sin ninguna fuente del sistema. */
export function rasterizarCartelSinFuentes(datos: DatosCartel, formato: FormatoCartel): Promise<Buffer> {
  return ejecutarHijo({ datos, formato }, true);
}

/** Un SVG cualquiera, sin fuentes del sistema. Para los controles que no pasan por las plantillas. */
export function rasterizarSvgSinFuentes(svgCrudo: string, ancho: number, alto: number): Promise<Buffer> {
  return ejecutarHijo({ svgCrudo, ancho, alto }, true);
}

/** El mismo SVG por el MISMO camino, pero con las fuentes de la máquina. La otra mitad del control. */
export function rasterizarSvgConFuentes(svgCrudo: string, ancho: number, alto: number): Promise<Buffer> {
  return ejecutarHijo({ svgCrudo, ancho, alto }, false);
}

// ── El hijo ───────────────────────────────────────────────────────────────────────────────────────
// Importa las plantillas y el exportador DE VERDAD (no una copia): lo que se mide acá es el mismo
// código que corre en Vercel, armado y rasterizado bajo la misma carencia de fuentes.
async function correrComoHijo(): Promise<void> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  const trabajo = JSON.parse(Buffer.concat(trozos).toString('utf8')) as Trabajo;

  let png: Buffer;
  if ('svgCrudo' in trabajo) {
    const sharp = (await import('sharp')).default;
    png = await sharp(Buffer.from(trabajo.svgCrudo), { density: 300 })
      .resize(trabajo.ancho, trabajo.alto)
      .png()
      .toBuffer();
  } else {
    const { construirCartelSvg } = await import('../../lib/comercio/cartel/plantillas');
    const { rasterizarCartelPng } = await import('../../lib/comercio/cartel/export');
    const { dibujarTextoConInter } = await import('../../lib/comercio/cartel/textoInter');
    const svg = await construirCartelSvg(trabajo.datos, trabajo.formato, dibujarTextoConInter);
    png = await rasterizarCartelPng(svg, trabajo.formato);
  }
  process.stdout.write(png.toString('base64'));
}

if (process.argv.includes('--hijo')) {
  correrComoHijo().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
