import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('POST log', () => {
  it('acepta un arreglo de logs y devuelve 200', async () => {
    const req = new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify({ logs: ['algo pasó'] }) });
    expect((await POST(req)).status).toBe(200);
  });

  it('tolera un body malformado y devuelve 200', async () => {
    const req = new NextRequest('http://localhost/x', { method: 'POST', body: 'no-es-json' });
    expect((await POST(req)).status).toBe(200);
  });
});
