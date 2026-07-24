# PrimeCore Field Photos

App independiente (mismo estilo visual que PrimeCore Ops) para tomar fotos de
equipo desde el teléfono en campo, organizadas igual que la carpeta AMP real
en OneDrive: **Proyecto → Yard/House → carpeta de equipo → fotos**.

El nombre de cada foto se arma automático como
`{Subestación} - {descripción} (Phase X).jpg`, igual que el patrón que ya
usan en OneDrive (ej. `Bandit - Breaker 4W108 (F1) CTs Nameplate.jpg`).

## Cómo funciona

1. Abres la app en el teléfono (instalada como PWA, ícono en pantalla de
   inicio — funciona en iPhone y iPad).
2. Creas o eliges un **proyecto** (ej. subestación "Bandit", proyecto
   "2024 New Solar Substation").
3. Eliges **Yard** o **House**.
4. Eliges una carpeta de equipo ya creada, o creas una nueva escribiendo su
   nombre (ej. "Panel A7 (PD-3519)", "CCVTs 161kV", "Breakers").
5. Tomas la foto, escribes una descripción y (si aplica) la fase A/B/C. La
   app arma el nombre de archivo automático y lo guarda en la nube.
6. Desde la computadora, entras a la misma app y descargas:
   - Un ZIP de una sola carpeta ("Descargar ZIP" dentro de la carpeta), o
   - El **proyecto completo** en un ZIP (botón en la página del proyecto),
     que trae todas las carpetas Yard/House ya organizadas igual que en
     OneDrive, lista para descomprimir directo en la carpeta AMP.

## Correr en local

```bash
npm install
npm run db:push      # crea/actualiza dev.db (SQLite) según prisma/schema.prisma
npm run dev            # http://localhost:3001
```

Ya no hay categorías precreadas para sembrar — el primer proyecto se crea
desde la propia app.

El login ahora es con **cuenta propia** (usuario + contraseña, cualquiera
se puede crear una desde "Create one" en la pantalla de entrada) más
**Face ID / Touch ID opcional por dispositivo** (WebAuthn) -- cada persona
agrega su Face ID desde adentro de la app (botón "Face ID" en la página
principal) una vez que ya inició sesión con su usuario y contraseña.

## Desplegar en producción (Vercel + Postgres, igual que PrimeCore Ops)

Face ID (WebAuthn) sólo funciona en `localhost` o en un sitio con HTTPS
real -- por eso hace falta desplegarlo para poder usarlo desde el
teléfono, no sólo desde la PC.

1. Crea una base de datos Postgres (ej. Neon, igual que primecore-ops-local).
2. En `prisma/schema.prisma`, cambia:
   ```
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. En Vercel, crea un proyecto nuevo apuntando a esta carpeta, con variables
   de entorno:
   - `DATABASE_URL` (cadena de conexión de Postgres)
   - `SESSION_SECRET` (cualquier cadena aleatoria larga)
   - `WEBAUTHN_RP_ID` (el dominio real, sin `https://` ni puerto, ej.
     `fieldphotos.primecoreps.com`)
   - `WEBAUTHN_ORIGIN` (la URL completa, ej.
     `https://fieldphotos.primecoreps.com`)
4. Primer deploy: correr `npx prisma db push` contra la base de datos de
   producción para crear las tablas.
5. Abrir la URL real y tocar "Set Up Face ID" para reclamar la app --
   después de esto ya no hay otra forma de entrar, así que agrega al menos
   un segundo dispositivo (botón "Face ID" en la página principal) antes de
   perder acceso al primero.
6. Instalar en el teléfono: abrir la URL en Safari (iPhone/iPad) → botón
   Compartir → "Agregar a pantalla de inicio".

Importante: `WEBAUTHN_RP_ID` queda ligado permanentemente a cada Face ID ya
registrado -- si cambia el dominio más adelante, todos los dispositivos
tienen que volver a registrarse.

## Notas técnicas

- Modelo de datos: `Project` (subestación + nombre de proyecto) → `Folder`
  (área "Yard"/"House" + nombre libre de equipo) → `Photo` (descripción,
  fase opcional, nombre de archivo ya armado, imagen en base64).
- Las fotos se comprimen en el navegador antes de subirse (igual que los
  recibos en PrimeCore Ops) para no inflar la base de datos.
- El ZIP se genera con un escritor de ZIP propio sin dependencias externas
  (`lib/zip.ts`), verificado contra el lector `zipfile` de Python durante el
  desarrollo. El ZIP del proyecto completo preserva la ruta
  `Área/Carpeta/archivo.jpg` dentro del zip.
- El middleware corre en el Edge Runtime de Next.js, así que la firma de la
  cookie de sesión usa Web Crypto (`lib/crypto-edge.ts`) en vez del módulo
  `crypto` de Node, que no está disponible ahí.
- Acceso protegido con un código de acceso compartido (no login individual
  por empleado) — pensado para uso rápido en campo desde un solo dispositivo
  o varios técnicos compartiendo el mismo código.
