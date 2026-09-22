-- 0038: cobranza por cuenta (spec 2026-09-21-cobranza-design.md).
alter table cuentas_comercio
  add column cobranza text not null default 'normal'
    check (cobranza in ('normal', 'exenta')),
  add column cobranza_desde date not null default current_date,
  add column cobranza_pospuesta_hasta date;

-- Las cuentas que YA existen no empiezan a cobrarse solas: quedan exentas hasta que FM las pase a 'normal'.
update cuentas_comercio set cobranza = 'exenta';
