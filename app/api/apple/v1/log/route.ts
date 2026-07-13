import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body?.logs)) {
    // Strings provistos por el dispositivo. A stdout plano es inofensivo; si algún día esto
    // se enruta a logging estructurado o una UI, sanitizar saltos de línea (log forging).
    console.warn('[Apple Wallet device log]', body.logs.join('\n'));
  }
  return new NextResponse(null, { status: 200 });
}
