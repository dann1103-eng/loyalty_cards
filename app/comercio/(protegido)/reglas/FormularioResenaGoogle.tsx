'use client';

import { useActionState } from 'react';
import { accionGuardarResenaGoogle, type EstadoResenaGoogle } from './actions';
import type { ResenaGoogle } from '@/lib/comercio/resenaGoogle';

// CAMPOS NO CONTROLADOS + `key` derivada de lo guardado: mismo patrón y mismo motivo que
// FormularioControles.tsx (ver el comentario largo de ese archivo) — al terminar el Server Action,
// React resetea el formulario SIEMPRE (con error o con éxito: `requestFormReset` no mira lo que la
// acción devolvió), y un reset devuelve cada campo a su `defaultValue`/`defaultChecked` — o sea, a
// los valores GUARDADOS. Con un campo controlado eso desincroniza la casilla (el reset la desmarca en
// el DOM sin avisarle a React). Este formulario es de EDICIÓN (a diferencia de FormularioRegla, que
// es de alta), así que necesita lo mismo.
export default function FormularioResenaGoogle({ resena }: { resena: ResenaGoogle }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoResenaGoogle, FormData>(
    accionGuardarResenaGoogle,
    undefined,
  );

  const clave = [resena.pedir, resena.url].join('|');

  return (
    <form key={clave} className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Registro de clientes</h2>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 18 }}>
        Sistema de honor: no podemos verificar que el cliente haya dejado la reseña, así que se le
        pide de buena fe antes de sacar su tarjeta.
      </p>

      <div className="field">
        <label htmlFor="pedir_resena_google" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id="pedir_resena_google"
            name="pedir_resena_google"
            type="checkbox"
            defaultChecked={resena.pedir}
          />
          Pedir una reseña en Google antes de sacar la tarjeta
        </label>
      </div>

      <div className="field">
        <label htmlFor="resena_google_url">Link para dejar reseña en Google</label>
        {/* type="text", NO type="url": un input type="url" dispara la validación nativa del
            navegador ("type mismatch") con un mensaje en el idioma del dispositivo, antes de que el
            texto llegue al servidor — y acá la validación de verdad (validarUrlResenaGoogle) ya
            tiene sus propios mensajes en español, fijados en resenaGoogle.test.ts. Preferimos ese
            mensaje propio al del navegador. inputMode="url" igual pide el teclado de URL en el
            celular (con "/" y ".com" a mano) sin activar esa validación; autoCapitalize/autoCorrect/
            spellCheck apagados porque un link no es texto para corregir ni capitalizar. */}
        <input
          id="resena_google_url"
          name="resena_google_url"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://g.page/r/…/review"
          defaultValue={resena.url ?? ''}
        />
        <p className="admin-fila-slug" style={{ marginTop: 6 }}>
          Lo sacás de tu Perfil de Empresa de Google → &quot;Pedir reseñas&quot;. Se puede guardar el
          link con la casilla de arriba apagada, para dejarlo listo y prenderla después.
        </p>
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'guardado' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 10 }}>Guardado.</p>
      )}
    </form>
  );
}
