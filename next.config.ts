import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["passkit-generator"],
  outputFileTracingIncludes: {
    "/api/**": ["./passModels/**/*"],
  },
  experimental: {
    // Las imágenes de branding viajan por un Server Action, y el límite por defecto de Next es 1 MB
    // — MENOS que los 2 MB que la app dice aceptar (TAMANO_MAXIMO_BYTES en imagenComercio.ts). Esa
    // contradicción rompía la subida desde el teléfono: el body se cortaba ANTES de llegar a la
    // acción, así que el dueño veía la pantalla de error del servidor en vez del aviso amable de
    // "máximo 2 MB". 4 MB deja aire para el overhead del multipart sobre una imagen de 2 MB.
    // Si algún día sube TAMANO_MAXIMO_BYTES, este número tiene que subir con él.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
