import { renderIconoFm } from '@/lib/portal/iconoFm';

// Sin datos de request => Next lo optimiza estáticamente (se genera en build y se cachea).
export function GET() {
  return renderIconoFm(192);
}
