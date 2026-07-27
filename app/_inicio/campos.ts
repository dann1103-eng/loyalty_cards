// Nombre del campo TRAMPA del formulario de demo (honeypot). Suena a campo legítimo justamente
// para que el bot que rellena todo lo que encuentra caiga; una persona nunca lo ve, porque va
// escondido, fuera del tabulador y marcado como decorativo.
//
// Vive en su propio archivo y no junto a la acción porque un módulo 'use server' solo puede
// exportar funciones asíncronas: una constante ahí rompe la compilación.
export const CAMPO_TRAMPA = 'sitio_web';
