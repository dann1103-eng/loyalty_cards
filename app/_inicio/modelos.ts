// Tarjetas de MENTIRA para el carrusel de la página pública.
//
// Son negocios INVENTADOS por nosotros, a propósito: mostrar la tarjeta real de un cliente sería
// publicar la marca de un tercero sin su permiso. Lo que se luce acá es la variedad —rubros,
// colores, metas distintas, sellos contra puntos—, no una lista de clientes.
//
// Los valores imitan lo que produce el pass de verdad: la grilla de sellos se parte en dos filas
// cuando la meta pasa de 6 y el sello pendiente queda como un aro vacío, igual que en
// lib/apple/stripPass.tsx.

export type Saldo =
  | {
      tipo: 'sellos';
      meta: number;
      llenos: number;
      // Los sellos se dibujan con vectores propios, no con la fuente de íconos: si esa fuente no
      // carga, un <span> con una ligadura muestra el nombre del ícono en crudo ("local_cafe") y
      // eso, en la página que le vende el producto a un comercio, es peor que no tener ícono.
      forma?: 'estrella';
    }
  | {
      tipo: 'puntos';
      // Ya formateado a mano: `toLocaleString()` puede dar distinto en el servidor y en el
      // navegador y romper la hidratación por un separador de miles.
      total: string;
    };

export interface ModeloTarjeta {
  id: string;
  negocio: string;
  rubro: string;
  // Letra del logo. En el producto real es la imagen que sube el comercio.
  inicial: string;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  miembro: string;
  premio: string;
  // La línea de "cuánto te falta". Va escrita a mano en vez de calculada para que el dueño pueda
  // ajustar el tono de cada ejemplo sin tocar lógica.
  nota: string;
  saldo: Saldo;
}

export const MODELOS: ModeloTarjeta[] = [
  {
    id: 'cafe',
    negocio: 'Café Volcán',
    rubro: 'Cafetería',
    inicial: 'V',
    colorFondo: '#3b2416',
    colorTexto: '#fff3e6',
    colorLabel: '#e8b36a',
    miembro: 'María G.',
    premio: 'Café gratis',
    nota: 'Te faltan 3 sellos para tu café',
    saldo: { tipo: 'sellos', meta: 10, llenos: 7, forma: 'estrella' },
  },
  {
    id: 'gimnasio',
    negocio: 'Gimnasio Ritmo',
    rubro: 'Gimnasio',
    inicial: 'R',
    colorFondo: '#0f2233',
    colorTexto: '#eaf6ff',
    colorLabel: '#4fc3f7',
    miembro: 'Carlos M.',
    premio: 'Un mes gratis',
    nota: 'Te faltan 260 puntos para tu mes gratis',
    saldo: { tipo: 'puntos', total: '1,240' },
  },
  {
    id: 'barberia',
    negocio: 'Barbería El Roble',
    rubro: 'Barbería',
    inicial: 'B',
    colorFondo: '#17171a',
    colorTexto: '#f2f0ea',
    colorLabel: '#c9a227',
    miembro: 'Julio A.',
    premio: 'Corte gratis',
    nota: 'Te faltan 3 sellos para tu corte',
    saldo: { tipo: 'sellos', meta: 8, llenos: 5 },
  },
  {
    id: 'pupuseria',
    negocio: 'Pupusería La Ceiba',
    rubro: 'Restaurante',
    inicial: 'C',
    colorFondo: '#40120f',
    colorTexto: '#ffefe6',
    colorLabel: '#f4a259',
    miembro: 'Sofía R.',
    premio: 'Orden de pupusas',
    nota: 'Te faltan 3 sellos para tu orden',
    saldo: { tipo: 'sellos', meta: 12, llenos: 9, forma: 'estrella' },
  },
  {
    id: 'farmacia',
    negocio: 'Farmacia La Cruz',
    rubro: 'Farmacia',
    inicial: 'L',
    colorFondo: '#06302a',
    colorTexto: '#e8fff7',
    colorLabel: '#5ee3b0',
    miembro: 'Ana L.',
    premio: '$5 de descuento',
    nota: 'Te faltan 140 puntos para tu descuento',
    saldo: { tipo: 'puntos', total: '860' },
  },
  {
    id: 'salon',
    negocio: 'Salón Aurora',
    rubro: 'Belleza',
    inicial: 'A',
    colorFondo: '#2b1035',
    colorTexto: '#fbeffa',
    colorLabel: '#e39bda',
    miembro: 'Karla V.',
    premio: 'Manicure gratis',
    nota: 'Te faltan 350 puntos para tu manicure',
    saldo: { tipo: 'puntos', total: '2,150' },
  },
  {
    id: 'lavautos',
    negocio: 'Lavautos Express',
    rubro: 'Lavado de autos',
    inicial: 'E',
    colorFondo: '#0b2545',
    colorTexto: '#eaf4ff',
    colorLabel: '#8ecae6',
    miembro: 'Diego P.',
    premio: 'Lavado completo',
    nota: 'Te faltan 3 sellos para tu lavado',
    saldo: { tipo: 'sellos', meta: 6, llenos: 3 },
  },
];

// El carrusel arranca en el del medio para que el abanico se vea parejo de los dos lados desde el
// primer pintado — incluso sin JavaScript, que es como lo ve un buscador.
export const INDICE_INICIAL = Math.floor(MODELOS.length / 2);

// Texto para lectores de pantalla. El dibujo de la tarjeta va con aria-hidden: leer sus pedazos
// sueltos ("V", "SELLOS", "7 / 10", "MIEMBRO"…) no le dice nada a nadie.
export function descripcionDeModelo(modelo: ModeloTarjeta): string {
  const saldo =
    modelo.saldo.tipo === 'sellos'
      ? `tarjeta de sellos, ${modelo.saldo.llenos} de ${modelo.saldo.meta}`
      : `tarjeta de puntos, ${modelo.saldo.total} puntos`;
  // El rubro se omite cuando el nombre ya lo dice: "Gimnasio Ritmo, gimnasio" suena a error de
  // programa, no a descripción de algo.
  const yaLoDiceElNombre = modelo.negocio.toLowerCase().startsWith(modelo.rubro.toLowerCase());
  const quien = yaLoDiceElNombre
    ? modelo.negocio
    : `${modelo.negocio}, ${modelo.rubro.toLowerCase()}`;
  return `${quien}: ${saldo}.`;
}
