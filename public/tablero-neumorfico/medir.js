// Mide el contraste de cada [data-par] de los tres iframes con la cascada REAL del navegador
// (getComputedStyle), para contrastar con lo que calcula lib/diseno/temas.test.ts leyendo el CSS.
// Misma fórmula que lib/diseno/contraste.ts (WCAG 2.x); copiada porque esta página es suelta.
(function () {
  function rgba(texto) {
    var m = texto.match(/rgba?\(([^)]+)\)/);
    if (!m) throw new Error('color que no se puede medir: ' + texto);
    var p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function sobre(arriba, abajo) {
    var a = arriba.a;
    return {
      r: arriba.r * a + abajo.r * (1 - a),
      g: arriba.g * a + abajo.g * (1 - a),
      b: arriba.b * a + abajo.b * (1 - a),
      a: 1,
    };
  }
  function lineal(c) {
    var s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  function luminancia(c) {
    return 0.2126 * lineal(c.r) + 0.7152 * lineal(c.g) + 0.0722 * lineal(c.b);
  }
  function razon(x, y) {
    var a = luminancia(x);
    var b = luminancia(y);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  // El fondo efectivo: se suben los ancestros juntando capas hasta encontrar una opaca.
  function fondoDe(el, win) {
    var capas = [];
    for (var n = el; n; n = n.parentElement) {
      var c = rgba(win.getComputedStyle(n).backgroundColor);
      if (c.a > 0) capas.push(c);
      if (c.a === 1) break;
    }
    var base = capas.length && capas[capas.length - 1].a === 1 ? capas.pop() : { r: 255, g: 255, b: 255, a: 1 };
    while (capas.length) base = sobre(capas.pop(), base);
    return base;
  }
  window.medirTablero = function () {
    var filas = [];
    document.querySelectorAll('iframe[data-tema]').forEach(function (marco) {
      var win = marco.contentWindow;
      marco.contentDocument.querySelectorAll('[data-par]').forEach(function (el) {
        var fondo = fondoDe(el, win);
        var estilo = win.getComputedStyle(el, el.getAttribute('data-pseudo') || null);
        var r = razon(sobre(rgba(estilo.color), fondo), fondo);
        var minimo = Number(el.getAttribute('data-min') || 4.5);
        filas.push({
          tema: marco.getAttribute('data-tema'),
          par: el.getAttribute('data-par'),
          razon: Math.round(r * 100) / 100,
          minimo: minimo,
          ok: r >= minimo,
        });
      });
    });
    return filas;
  };
})();
