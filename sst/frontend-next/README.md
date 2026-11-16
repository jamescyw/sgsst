# Frontend SGSST

Nueva aplicación Next.js, React, Tailwind y componentes shadcn/ui. La referencia en `../frontend` se conserva.

## Ejecutar

Desde `frontend-next` (Node.js 20.9+):

```powershell
npm.cmd install
npm.cmd run dev
```

Abre http://localhost:3000. Ingresa el valor de `API_TOKEN` de `backend/.env` una sola vez. Se conserva en la pestaña durante la sesión, se envía en todas las peticiones y se elimina al cerrar sesión. No incluyas el token en variables `NEXT_PUBLIC_*`.

En desarrollo no se exige abrir la aplicación desde la Intranet. Después de ingresar, el menú muestra **Sesión local de desarrollo** y un diagnóstico con la identidad devuelta por `/auth/me`.

## Integración con la Intranet

`@intranet/sdk` está instalado desde `vendor/intranet-sdk-0.2.0.tgz`. En una compilación de producción la aplicación:

1. Ejecuta `init()` y `syncHistory()` dentro del iframe de la Intranet.
2. Obtiene el JWT de corta duración con `getToken()` y lo conserva solo en memoria.
3. Envía `Authorization: Bearer <token>` al backend.
4. Consulta `/auth/me`; el backend valida el token con la Intranet y devuelve la persona autenticada.
5. Actualiza el token con `onTokenChange()` y cierra la sesión local con `onSessionLost()`.

La persona validada aparece en el menú lateral con nombre y correo. Esa es la comprobación recomendada de que el token llegó y corresponde al usuario esperado. El token no se imprime ni se guarda en `sessionStorage`. Para desplegar, usa `ENVIRONMENT=production` en el backend y registra el origen de la aplicación en Administración → Aplicaciones.

En otra terminal, desde `backend`:

```powershell
uv run --python .venv\Scripts\python.exe uvicorn main:app --reload
```

La base debe ser `DB_NAME=sst`, esquema `dbo`. Next.js reenvía `/backend/*` a FastAPI; para otro servidor copia `.env.example` a `.env.local` y cambia `API_URL`. Reinicia Next.js después del cambio.

## Flujo

Salud General, Salud Mental y Osteomuscular comparten listado de casos, filtros por colaborador/documento, ciudad y estado, indicadores, paginación y detalle. El reporte muestra sus colaboradores y acciones. Nuevo reporte crea el reporte y el colaborador en una transacción; Nueva acción agrega un seguimiento al reporte seleccionado. Los catálogos provienen de SQL Server.

Las integraciones de ausentismos, perfiles y validación de líderes de Strapi del ejemplo no tienen equivalentes en el esquema `sst` confirmado; esos módulos requieren su fuente de datos y reglas de permisos antes de migrarse.

## Compilar

```powershell
npm.cmd run build
npm.cmd run start
```

## Interfaz funcional

Los tres módulos incluyen doce gráficos (tortas, barras y línea), indicadores de estado y vencimientos, filtros por colaborador, ciudad, cargo, área, departamento, dirección y sistema, y una tabla de casos con acceso a los seguimientos. Los formularios permiten crear reportes, crear/editar seguimientos, buscar CIE-10 y registrar biometría y datos osteomusculares. El estado del reporte se actualiza al guardar su seguimiento.

Los módulos cargan una única respuesta `/sgsst/{module}/workspace` y mantienen una copia en memoria durante la sesión. El botón Recargar vuelve a consultar la base. Los gráficos responden a los filtros activos. El panel de roles y permisos se deja para la siguiente etapa.

## Comprobación de interfaz (Windows)

Con backend activo en 8000 y una compilación disponible, abre un servidor de prueba:

```powershell
npm.cmd run start -- -p 3002
```

En otra terminal, desde esta carpeta:

```powershell
node check-ui.mjs
```

Usa Microsoft Edge en modo headless, obtiene el token del `.env` local sin imprimirlo y comprueba acceso, módulos, gráficos, formularios, detalle y adaptación móvil. No guarda registros.
