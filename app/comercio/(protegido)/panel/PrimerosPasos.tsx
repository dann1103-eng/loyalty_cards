import Link from 'next/link';
import type { PasoTutorial } from '@/lib/comercio/primerosPasos';

// El tutorial, arriba de todo en el panel y solo mientras falte algo.
//
// Decisiones de diseño, con la vara puesta en alguien de 50 años que abre esto por primera vez:
//
// - Va PRIMERO, antes de las métricas. Un negocio recién dado de alta tiene todo en cero, y dos
//   tarjetas grandes diciendo "0 clientes" no le dicen qué hacer; esta lista sí.
// - Desaparece solo cuando los cuatro pasos están hechos. No hay botón de "ocultar": si todavía
//   falta algo, esconderlo es dejar al dueño sin el mapa. Cuando ya no falta nada, se va sin que
//   nadie tenga que cerrarlo.
// - Cada paso es un ENLACE entero, no un texto con un link chiquito adentro: el área de toque es la
//   fila completa, que en un teléfono es la diferencia entre entrar y errarle.
// - El paso hecho se marca y deja de ser enlace, pero NO se tacha ni se esconde: ver lo que ya
//   lograste es la mitad de por qué una lista así funciona.
export default function PrimerosPasos({ pasos }: { pasos: PasoTutorial[] }) {
  const hechos = pasos.filter((p) => p.hecho).length;
  if (hechos === pasos.length) return null;

  const siguiente = pasos.find((p) => !p.hecho);

  return (
    <section className="panel reveal d1" style={{ marginTop: 0, marginBottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h2 className="admin-fila-nombre" style={{ fontSize: '1.15rem' }}>Para empezar</h2>
        <span className="admin-fila-slug dato-mono">{hechos} de {pasos.length}</span>
      </div>
      <p className="nota" style={{ marginTop: 4 }}>
        {hechos === 0
          ? 'Cuatro cosas y tu programa queda andando. Empezá por la primera.'
          : `Te falta poco. Seguí con “${siguiente!.titulo}”.`}
      </p>

      <div className="admin-lista" style={{ marginTop: 12 }}>
        {pasos.map((paso, i) => {
          const contenido = (
            <>
              <span
                className={`icono-circulo ${paso.hecho ? 'menta' : 'neutro'}`}
                aria-hidden="true"
                style={{ flexShrink: 0 }}
              >
                {paso.hecho ? (
                  <span className="icono icono-lleno">check</span>
                ) : (
                  <span className="dato-mono" style={{ fontWeight: 700 }}>{i + 1}</span>
                )}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="admin-fila-nombre" style={{ display: 'block' }}>{paso.titulo}</span>
                <span className="admin-fila-slug" style={{ display: 'block' }}>
                  {paso.hecho ? 'Listo' : paso.detalle}
                </span>
              </span>
            </>
          );

          // El hecho NO es enlace: mandarlo de vuelta a una pantalla que ya resolvió es ofrecerle
          // deshacer lo único que le salió bien.
          return paso.hecho ? (
            <div key={paso.clave} className="admin-fila">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>{contenido}</div>
            </div>
          ) : (
            <Link key={paso.clave} className="admin-fila" href={paso.href} style={{ textDecoration: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>{contenido}</div>
              <span className="icono" aria-hidden="true">chevron_right</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
