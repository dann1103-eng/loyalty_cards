import { renderIconoCardly } from '@/lib/portal/iconoCardly';

// Sin datos de request => Next lo optimiza estáticamente (se genera en build y se cachea).
export function GET() {
  return renderIconoCardly(192);
}
