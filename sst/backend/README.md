# Backend SGSST

FastAPI conectado a SQL Server, base `sst`, esquema `dbo`.

## Inicio con uv

```powershell
uv venv --python 3.12
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
uv run --python .venv\Scripts\python.exe uvicorn main:app --reload
```

Configura `.env` a partir de `.env.example`. Instala el driver ODBC indicado allí. Conserva `DB_NAME=sst`.

## Si el arranque falla al localizar SQL Server

El servidor `COBOGACDASS01\DASHBOARD` requiere acceso a la red corporativa o a su VPN. Si aparece `08001`, `Error Locating Server/Instance Specified` o `getaddrinfo failed`, comprueba primero:

```powershell
Resolve-DnsName COBOGACDASS01
```

Si no resuelve, conecta la red/VPN corporativa y repite la comprobación. Una vez disponible el servidor, vuelve a ejecutar el comando de Uvicorn. El mensaje `Waiting for application startup` indica que aún está conectándose a SQL Server; espera `Application startup complete` antes de abrir la API.

## Autorización única

En http://127.0.0.1:8000/docs pulsa **Authorize** e ingresa solo el token, sin el prefijo Bearer. Swagger lo aplica automáticamente a todos los endpoints. Todas las operaciones de datos y `/health` exigen `Authorization: Bearer <API_TOKEN>`. La documentación queda accesible para permitir autorizarse.

En `ENVIRONMENT=development`, `API_TOKEN` habilita el acceso local sin depender de la Intranet. En producción configura `ENVIRONMENT=production`: el token estático deja de aceptarse y cada JWT se valida con `INTRANET_VERIFY_URL`. `GET /auth/me` devuelve `source`, `app`, `expires_at` y `usuario`, pero nunca devuelve el token. Los reportes y seguimientos nuevos guardan automáticamente al usuario validado como `creador` o `creador_seguimiento`.

## Endpoints

- `GET /health`
- `GET /api/tables`
- `GET /api/Reports?limit=100&offset=0`
- `GET /api/Reports/{id}` (incluye `Actions` y `ReportPeople`)
- `POST /api/Reports`
- `GET /api/Actions?limit=100&offset=0`
- `GET /api/Actions/{id}`
- `POST /api/Actions` (incluye `ReportId` en el cuerpo)
- Los mismos GET/POST funcionan con las tablas de catálogo publicadas en `/api/tables`.

Las FK se expanden con sus valores. Un reporte tiene muchas acciones mediante `Actions.ReportId -> Reports.StrapiId`. Los IDs de Reports/Actions migrados no son IDENTITY: el servidor asigna el siguiente ID dentro de un bloqueo transaccional cuando no se envía. Un reporte puede incluir `ReportPeople: [{Role: "colaborador", Nombre: "...", Documento: "..."}]`; todo se guarda en una transacción.

## Comprobación de integración

```powershell
uv pip install --python .venv\Scripts\python.exe -r requirements-dev.txt
uv run --python .venv\Scripts\python.exe check_api.py
```

Comprueba autorización, lecturas y POST de reporte/acción. Los registros de prueba se insertan dentro de una transacción que se revierte al finalizar; no se conservan.

## API por módulo

Todos los endpoints requieren el mismo Bearer token. `{module}` admite `salud_general`, `salud_mental` y `osteomuscular`.

- `GET/POST /sgsst/{module}/reports`
- `GET /sgsst/{module}/reports/{id}`
- `GET/POST /sgsst/{module}/reports/{id}/actions`
- `GET /sgsst/{module}/catalogs`
- `GET /sgsst/{module}/dashboard`
- `GET /sgsst/{module}/collaborators`

El filtro de tipo de caso se aplica en SQL. La creación asigna el tipo del módulo y rechaza un tipo diferente. Los formularios usan los catálogos de SQL Server. Dashboard devuelve total, distribución por estado y categoría; colaboradores devuelve las personas vinculadas a los casos del módulo.

## Carga optimizada y edición

- `GET /sgsst/{module}/workspace`: casos, relaciones y catálogos en una sola petición; consultas agrupadas y eliminación de JSON originales de migración en las respuestas de listado.
- `GET /sgsst/{module}/cie10?q=texto`: búsqueda por código o diagnóstico, hasta 30 resultados.
- `POST /sgsst/{module}/reports/{report_id}/actions/{action_id}`: edición de seguimiento. Comprueba que el caso pertenece al módulo y la acción al caso. Al crear o editar acciones se actualiza el estado del reporte en la misma transacción.

`check_api.py` prueba creación, edición, estado e aislamiento entre módulos dentro de una transacción revertida. `check_workspace.py` mide la respuesta completa y comprueba búsqueda CIE-10.
