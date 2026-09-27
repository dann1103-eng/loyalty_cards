import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { ENCUADRE_POR_DEFECTO } from '../encuadreFranja';
import { dibujarBloqueWallet, geometriaBloqueWallet } from './insigniasWallet';
import { construirCartelSvg } from './plantillas';
import { dibujarTextoConFuenteDelSistema } from './texto';
import { ARCHIVO_POR_PESO, dibujarTextoConInter, rutaDeFuente } from './textoInter';
import type { DatosCartel, FormatoCartel, PlantillaCartel } from './tipos';

const DATOS: DatosCartel = {
  nombreComercio: 'Café Sol',
  plantilla: 'centrado',
  colorFondo: '#3b2a1e',
  colorTexto: '#f5ede0',
  colorLabel: '#e8b978',
  logoDataUri: 'data:image/png;base64,iVBORw0KGgo=',
  fotoDataUri: null,
  medidasLogo: null,
  textoCta: '¡Escaneá y sumate!',
  textoTeaser: 'Tu 5to café gratis',
  urlRegistro: 'https://www.cardly-sv.site/registro/cafe-sol',
  elementos: [],
  encuadreFoto: ENCUADRE_POR_DEFECTO,
  medidasFoto: null,
};

const PLANTILLAS: PlantillaCartel[] = ['centrado', 'split', 'foto'];
const FORMATOS: FormatoCartel[] = ['sticker', 'mostrador'];

const numero = (svg: string, patron: RegExp) => Number(svg.match(patron)![1]);

// Los dos botones son los únicos <rect> negros con filo blanco.
function botones(svg: string) {
  return [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*fill="#000000" stroke="#ffffff"/g)].map(
    (m) => ({ x: Number(m[1]), y: Number(m[2]), ancho: Number(m[3]), alto: Number(m[4]) }),
  );
}

// La línea base de un texto de la vista previa, buscado por su contenido.
function yDelTexto(svg: string, texto: string): number {
  return numero(svg, new RegExp(`<text x="[\\d.]+" y="([\\d.]+)"[^>]*>${texto}</text>`));
}

describe('geometriaBloqueWallet', () => {
  it('los dos botones y el hueco suman EXACTAMENTE el ancho pedido', () => {
    const g = geometriaBloqueWallet(200);
    expect(2 * g.anchoBoton + g.hueco).toBeCloseTo(200, 6);
  });

  // La razón de ser de ANCHO_BOTON: el texto más largo tiene que caber, en la fuente con la que se
  // IMPRIME, entre el ícono y el borde derecho. Medido con la fuente real del repo, no estimado.
  it('"Google Wallet" en Inter 600 cabe entre el ícono y el borde del botón', () => {
    const bytes = readFileSync(rutaDeFuente(ARCHIVO_POR_PESO[600]));
    const fuente = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const g = geometriaBloqueWallet(200);
    const espacio = g.anchoBoton - g.altoBoton * (0.28 + 0.56 + 0.2 + 0.28);
    for (const texto of ['Apple Wallet', 'Google Wallet']) {
      expect(fuente.getAdvanceWidth(texto, g.tamanoTextoBoton), texto).toBeLessThan(espacio);
    }
  });

  it('el bloque dibujado no baja más que `alto`', () => {
    const g = geometriaBloqueWallet(200);
    const svg = dibujarBloqueWallet({
      cx: 200,
      y: 100,
      ancho: 200,
      colorEtiqueta: '#000000',
      dibujarTexto: dibujarTextoConFuenteDelSistema,
    });
    for (const b of botones(svg)) expect(b.y + b.alto).toBeCloseTo(100 + g.alto, 6);
  });
});

describe('el cartel lleva "Disponible para" + los botones de Apple y Google Wallet', () => {
  for (const plantilla of PLANTILLAS) {
    for (const formato of FORMATOS) {
      const datos: DatosCartel = {
        ...DATOS,
        plantilla,
        fotoDataUri: plantilla === 'foto' ? 'data:image/png;base64,iVBORw0KGgo=' : null,
      };

      it(`${plantilla} × ${formato}: los tres textos salen en contornos al imprimir`, async () => {
        const svg = await construirCartelSvg(datos, formato, dibujarTextoConInter);
        expect(svg).not.toContain('<text');
        for (const texto of ['Disponible para', 'Apple Wallet', 'Google Wallet']) {
          expect(svg).toContain(`aria-label="${texto}"`);
        }
        expect(botones(svg)).toHaveLength(2);
      });

      it(`${plantilla} × ${formato}: el bloque va debajo del CTA y los botones caben en el lienzo`, async () => {
        const svg = await construirCartelSvg(datos, formato, dibujarTextoConFuenteDelSistema);
        const [ancho, alto] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number);
        const ctaY = yDelTexto(svg, DATOS.textoCta);
        const etiquetaY = yDelTexto(svg, 'Disponible para');
        expect(etiquetaY, 'la etiqueta tiene que ir DEBAJO del CTA').toBeGreaterThan(ctaY);
        // Lo más bajo del teaser (si lo hay en esta plantilla) también queda arriba de la etiqueta.
        if (svg.includes(`>${DATOS.textoTeaser}</text>`)) {
          expect(etiquetaY).toBeGreaterThan(yDelTexto(svg, DATOS.textoTeaser!));
        }
        const bs = botones(svg);
        for (const b of bs) {
          expect(b.y, 'los botones van debajo de la etiqueta').toBeGreaterThan(etiquetaY);
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.x + b.ancho).toBeLessThanOrEqual(ancho);
          // Un respiro de 2% al pie: el borde del papel lo recorta la guillotina.
          expect(b.y + b.alto, `el botón termina en ${b.y + b.alto} de ${alto}`).toBeLessThanOrEqual(alto * 0.98);
        }
        // Lado a lado, sin encimarse.
        expect(bs[0].x + bs[0].ancho).toBeLessThan(bs[1].x);
      });
    }
  }

  it('split × mostrador: los botones quedan en la mitad BLANCA, no sobre la franja de color', async () => {
    const svg = await construirCartelSvg({ ...DATOS, plantilla: 'split' }, 'mostrador', dibujarTextoConFuenteDelSistema);
    const anchoFranja = numero(svg, /<rect width="([\d.]+)" height="[\d.]+" fill="#3b2a1e"\/>/);
    for (const b of botones(svg)) expect(b.x).toBeGreaterThan(anchoFranja);
  });

  for (const formato of FORMATOS) {
    it(`foto × ${formato}: los botones quedan DENTRO de la tarjeta blanca, y la tarjeta no pisa el logo`, async () => {
      const svg = await construirCartelSvg(
        { ...DATOS, plantilla: 'foto', fotoDataUri: 'data:image/png;base64,iVBORw0KGgo=' },
        formato,
        dibujarTextoConFuenteDelSistema,
      );
      const t = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="#ffffff"\/>/)!;
      const [tx, ty, tw, th] = t.slice(1).map(Number);
      for (const b of botones(svg)) {
        expect(b.x).toBeGreaterThan(tx);
        expect(b.x + b.ancho).toBeLessThan(tx + tw);
        expect(b.y + b.alto).toBeLessThan(ty + th);
      }
      // El logo de "foto" es el único <image> anclado a la izquierda (el otro es la foto de fondo).
      const logo = svg.match(/<image href="[^"]+" x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" preserveAspectRatio="xMinYMid meet"/)!;
      expect(ty, 'la tarjeta blanca sube hasta el logo').toBeGreaterThan(Number(logo[1]) + Number(logo[2]));
    });
  }

  it('sin teaser, el bloque sube a ocupar su lugar (centrado)', async () => {
    const con = await construirCartelSvg(DATOS, 'mostrador', dibujarTextoConFuenteDelSistema);
    const sin = await construirCartelSvg({ ...DATOS, textoTeaser: null }, 'mostrador', dibujarTextoConFuenteDelSistema);
    expect(yDelTexto(sin, 'Disponible para')).toBeLessThan(yDelTexto(con, 'Disponible para'));
  });
});
