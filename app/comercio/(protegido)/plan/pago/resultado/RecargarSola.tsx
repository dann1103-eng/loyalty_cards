'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// Mientras Wompi todavía no refleja el pago, la página se vuelve a pedir sola. Cada `refresh` vuelve a
// correr la confirmación en el servidor (idempotente), así que en cuanto Wompi lo tiene, el dueño ve
// "Pago confirmado" sin tocar nada. Tiene tope: una espera infinita sin decir nada es peor que decirle
// que puede tardar y que su plan se activa solo cuando el pago se confirme.
const INTERVALO_MS = 4000;
const MAXIMO_INTENTOS = 8;

export default function RecargarSola() {
  const router = useRouter();
  const [intentos, setIntentos] = useState(0);

  useEffect(() => {
    if (intentos >= MAXIMO_INTENTOS) return;
    const espera = setTimeout(() => {
      router.refresh();
      setIntentos((n) => n + 1);
    }, INTERVALO_MS);
    return () => clearTimeout(espera);
  }, [intentos, router]);

  if (intentos >= MAXIMO_INTENTOS) {
    return (
      <p className="nota" role="status">
        Está tardando más de lo normal. No pagues de nuevo: apenas Wompi confirme el pago, tu plan se activa
        solo. Volvé a mirar en unos minutos.
      </p>
    );
  }
  return (
    <p className="admin-fila-slug" role="status">
      Esperando la confirmación de Wompi…
    </p>
  );
}
