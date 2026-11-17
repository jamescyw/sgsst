"""Token-protected, schema-reflected API for the SST SQL Server database."""
from __future__ import annotations

import os
import secrets
import hashlib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict
from sqlalchemy import MetaData, Table, create_engine, insert, select, func
from sqlalchemy.engine import Engine, URL
from sqlalchemy.exc import SQLAlchemyError

from pathlib import Path
load_dotenv(Path(__file__).with_name('.env'), encoding='utf-8-sig')


def make_engine() -> Engine:
    dialect = os.getenv("DB_DIALECT", "pymssql" if os.name != "nt" else "pyodbc").lower()
    host = os.getenv("DB_HOST", r"COBOGACDASS01\DASHBOARD")
    port = int(os.getenv("DB_PORT", "1433"))
    database = os.getenv("DB_NAME", "sst")
    username = os.getenv("DB_USER", "SA")
    password = os.getenv("DB_PASSWORD", "")
    if not password:
        raise RuntimeError("DB_PASSWORD is required; configure it in the environment.")
    if dialect == "pymssql":
        url = URL.create(
            "mssql+pymssql", username=username, password=password,
            host=host, port=port, database=database,
        )
    else:
        driver = os.getenv("DB_DRIVER", "ODBC Driver 18 for SQL Server")
        url = URL.create(
            "mssql+pyodbc", username=username, password=password,
            host=host, port=port, database=database,
            query={"driver": driver, "TrustServerCertificate": os.getenv("DB_TRUST_SERVER_CERT", "yes")},
        )
    return create_engine(url, pool_pre_ping=True, pool_recycle=1800)


engine: Engine | None = None
metadata = MetaData()
tables: dict[str, Table] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    global engine
    engine = make_engine()
    try:
        metadata.reflect(bind=engine, schema=os.getenv("DB_SCHEMA", "dbo"))
        tables.clear()
        tables.update({table.name: table for table in metadata.tables.values()})
        yield
    finally:
        if engine:
            engine.dispose()


bearer = HTTPBearer(auto_error=False)


async def _legacy_static_authorize(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    expected = os.getenv('API_TOKEN', '')
    if not expected:
        raise HTTPException(503, 'API_TOKEN no configurado')
    if credentials is None or not secrets.compare_digest(credentials.credentials.encode(), expected.encode()):
        raise HTTPException(401, 'Token inválido o ausente', headers={'WWW-Authenticate': 'Bearer'})


auth_cache: dict[str, tuple[datetime, dict[str, Any]]] = {}


def development_auth_enabled() -> bool:
    return os.getenv("ENVIRONMENT", "development").lower() == "development"


async def verify_intranet_token(token: str) -> dict[str, Any]:
    cache_key = hashlib.sha256(token.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    cached = auth_cache.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]
    verify_url = os.getenv(
        "INTRANET_VERIFY_URL",
        "https://intranet-v2.crepesywaffles.com/api/auth/verify",
    )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                verify_url, headers={"Authorization": f"Bearer {token}"}
            )
    except httpx.RequestError as exc:
        raise HTTPException(503, "No fue posible validar la sesión con la Intranet") from exc
    if response.status_code == 401:
        raise HTTPException(
            401,
            "La sesión de la Intranet no es válida o no tiene acceso a esta aplicación",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if response.status_code != 200:
        raise HTTPException(503, "La Intranet no pudo validar la sesión")
    data = response.json()
    if not isinstance(data.get("usuario"), dict):
        raise HTTPException(503, "La respuesta de autenticación no contiene un usuario")
    auth_cache[cache_key] = (now + timedelta(seconds=30), data)
    if len(auth_cache) > 500:
        auth_cache.clear()
    return data


async def authorize(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(
            401, "Token inválido o ausente", headers={"WWW-Authenticate": "Bearer"}
        )
    token = credentials.credentials
    expected = os.getenv("API_TOKEN", "")
    if development_auth_enabled() and expected and secrets.compare_digest(token, expected):
        identity = {
            "app": "sgsst-local",
            "expires_at": None,
            "usuario": {
                "id": "desarrollo-local",
                "nombre": "Usuario de desarrollo",
                "email_corporativo": "local@desarrollo",
            },
            "source": "development",
        }
    else:
        identity = await verify_intranet_token(token)
        identity["source"] = "intranet"
    request.state.auth_identity = identity
    return identity


app = FastAPI(title="SST API", version="1.0.0", lifespan=lifespan, dependencies=[Depends(authorize)], swagger_ui_parameters={'persistAuthorization': True})
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class RecordIn(BaseModel):
    model_config = ConfigDict(extra="allow")


@app.get("/auth/me")
def authenticated_user(request: Request):
    identity = request.state.auth_identity
    return {
        "source": identity.get("source"),
        "app": identity.get("app"),
        "expires_at": identity.get("expires_at"),
        "usuario": identity.get("usuario"),
    }


def get_table(name: str) -> Table:
    table = tables.get(name)
    if table is None:
        raise HTTPException(status_code=404, detail=f"Tabla no encontrada: {name}")
    return table


def table_pk(table: Table):
    columns = list(table.primary_key.columns)
    if len(columns) != 1:
        raise HTTPException(status_code=400, detail=f"{table.name} no tiene clave primaria simple")
    return columns[0]


def serialize(table: Table, row: dict[str, Any], conn, depth: int = 0, seen=None) -> dict[str, Any]:
    """Expand FK values and include child rows for one-to-many relationships."""
    seen = seen or set()
    result = dict(row)
    if depth >= 4:
        return result
    pk_cols = list(table.primary_key.columns)
    if len(pk_cols) == 1:
        pk_value = row.get(pk_cols[0].name)
        if pk_value is not None:
            seen = seen | {(table.fullname, str(pk_value))}
    for fk in table.foreign_keys:
        source_col = fk.parent.name
        value = row.get(source_col)
        if value is None or fk.column is None:
            continue
        target = fk.column.table
        target_pk = fk.column
        marker = (target.fullname, str(value))
        if marker in seen:
            result[source_col] = {target_pk.name: value}
            continue
        related = conn.execute(select(target).where(target_pk == value)).mappings().first()
        result[source_col] = serialize(target, dict(related), conn, depth + 1, seen | {marker}) if related else None
    # Reflected child foreign keys provide the one-to-many relationship.
    children_allowed = {'Reports': {'Actions', 'ReportPeople'}, 'Actions': {'ActionPeople'}}
    for child in tables.values():
        if depth > 1 or (table.name == 'Reports' and depth != 0) or child.name not in children_allowed.get(table.name, set()):
            continue
        for fk in child.foreign_keys:
            if fk.column is None or fk.column.table is not table:
                continue
            parent_value = row.get(fk.column.name)
            if parent_value is None:
                continue
            children = conn.execute(select(child).where(fk.parent == parent_value)).mappings().all()
            result.setdefault(child.name, []).extend(
                serialize(child, dict(item), conn, depth + 1, seen) for item in children
            )
    return result


@app.get("/health")
def health():
    return {"status": "ok", "database": os.getenv("DB_NAME", "Replica_buk")}


@app.get("/api/tables")
def list_tables():
    return {"tables": sorted(tables)}


@app.get("/api/{table_name}")
def list_records(table_name: str, limit: int = Query(default=100, ge=1, le=500), offset: int = Query(default=0, ge=0)):
    table = get_table(table_name)
    assert engine is not None
    try:
        with engine.connect() as conn:
            rows = conn.execute(select(table).order_by(*table.primary_key.columns).offset(offset).limit(limit)).mappings().all()
            return [serialize(table, dict(row), conn) for row in rows]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="Error consultando la base de datos") from exc


@app.get("/api/{table_name}/{record_id}")
def get_record(table_name: str, record_id: str):
    table = get_table(table_name)
    pk = table_pk(table)
    assert engine is not None
    try:
        with engine.connect() as conn:
            row = conn.execute(select(table).where(pk == record_id)).mappings().first()
            if row is None:
                raise HTTPException(status_code=404, detail="Registro no encontrado")
            return serialize(table, dict(row), conn)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="Error consultando la base de datos") from exc


@app.post("/api/{table_name}", status_code=201)
def create_record(table_name: str, payload: RecordIn):
    table = get_table(table_name)
    values = payload.model_dump()
    people = values.pop('ReportPeople', []) if table.name == 'Reports' else []
    action_people = values.pop('ActionPeople', []) if table.name == 'Actions' else []
    valid_columns = {column.name for column in table.columns}
    unknown = set(values) - valid_columns
    if unknown:
        raise HTTPException(status_code=422, detail=f"Columnas desconocidas: {', '.join(sorted(unknown))}")
    # For a relationship field, accept either its FK value or an object containing
    # the referenced key (or any referenced row fields).
    for fk in table.foreign_keys:
        key = fk.parent.name
        if isinstance(values.get(key), dict):
            related = values[key]
            values[key] = related.get(fk.column.name)
            if values[key] is None:
                raise HTTPException(status_code=422, detail=f"La relación {key} requiere {fk.column.name}")
    assert engine is not None
    try:
        with engine.begin() as conn:
            pk = table_pk(table)
            if table.name in {'Reports', 'Actions'} and pk.name not in values:
                # Migrated Strapi keys are not IDENTITY. Serialize allocation on this table.
                maximum = conn.execute(select(func.max(pk)).select_from(table).with_hint(table, 'WITH (TABLOCKX, HOLDLOCK)', dialect_name='mssql')).scalar()
                values[pk.name] = (maximum or 0) + 1
            result = conn.execute(insert(table).values(**values))
            if table.name == 'Actions' and values.get('ReportId') and values.get('StateId'):
                reports_table = get_table('Reports')
                conn.execute(reports_table.update().where(reports_table.c.StrapiId == values['ReportId']).values(StateId=values['StateId']))
            pk = table_pk(table)
            record_id = result.inserted_primary_key[0] if result.inserted_primary_key else values.get(pk.name)
            for person in people:
                people_table = get_table('ReportPeople')
                person_values = {key: value for key, value in person.items() if key in people_table.c}
                conn.execute(insert(people_table).values(**{**person_values, 'ReportId': record_id}))
            for person in action_people:
                action_people_table = get_table('ActionPeople')
                person_values = {key: value for key, value in person.items() if key in action_people_table.c}
                conn.execute(insert(action_people_table).values(**{**person_values, 'ActionId': record_id}))
            row = conn.execute(select(table).where(pk == record_id)).mappings().first() if record_id is not None else None
            if row is None:
                return {"created": True, "id": record_id}
            return serialize(table, dict(row), conn)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=400, detail="No se pudo crear el registro; revisa campos y relaciones") from exc

# Domain endpoints: module membership is always enforced by SQL.
import unicodedata
from collections import Counter

def module_id(module, conn):
    allowed = {'salud_general', 'salud_mental', 'osteomuscular'}
    if module not in allowed:
        raise HTTPException(404, 'Módulo desconocido')
    def norm(s):
        return ''.join(c for c in unicodedata.normalize('NFKD', str(s)).lower() if c.isalnum())
    table = get_table('CaseTypes')
    for row in conn.execute(select(table)).mappings():
        if any(norm(row.get(k,'')) == norm(module) for k in ('Name','NameKey')):
            return row['CaseTypeId']
    raise HTTPException(409, 'Tipo de caso no configurado en CaseTypes')


def authenticated_person(request: Request, role: str) -> dict[str, Any]:
    user = request.state.auth_identity.get("usuario", {})
    raw_id = user.get("id")
    person_id = int(raw_id) if str(raw_id or "").isdigit() else None
    return {
        "Role": role,
        "PersonStrapiId": person_id,
        "Documento": user.get("documento")
        or user.get("numero_documento")
        or user.get("document_number"),
        "Nombre": user.get("nombre"),
        "Correo": user.get("email_corporativo") or user.get("correo"),
        "Foto": user.get("foto") or user.get("photo") or user.get("picture_url"),
    }

@app.get('/sgsst/{module}/reports')
def module_reports(module: str, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    table = get_table('Reports')
    with engine.connect() as conn:
        condition = table.c.CaseTypeId == module_id(module, conn)
        rows = conn.execute(select(table).where(condition).order_by(table.c.StrapiId.desc()).offset(offset).limit(limit)).mappings().all()
        return batch_reports(rows, conn)

@app.post('/sgsst/{module}/reports', status_code=201)
def module_create(module: str, payload: RecordIn, request: Request):
    with engine.connect() as conn:
        kind = module_id(module, conn)
    values = payload.model_dump()
    if values.get('CaseTypeId', kind) != kind:
        raise HTTPException(422, 'El tipo de caso no corresponde al módulo')
    values['CaseTypeId'] = kind
    if not str(values.get('Descripcion','')).strip():
        raise HTTPException(422, 'La descripción es obligatoria')
    people = values.setdefault("ReportPeople", [])
    if not any(person.get("Role") == "creador" for person in people):
        people.append(authenticated_person(request, "creador"))
    return create_record('Reports', RecordIn(**values))

@app.get('/sgsst/{module}/reports/{report_id}')
def module_detail(module: str, report_id: int):
    with engine.connect() as conn:
        table = get_table('Reports')
        row = conn.execute(select(table).where(table.c.StrapiId == report_id, table.c.CaseTypeId == module_id(module,conn))).mappings().first()
        if row is None:
            raise HTTPException(404, 'Caso no encontrado en este módulo')
        return batch_reports([row], conn)[0]

@app.get('/sgsst/{module}/reports/{report_id}/actions')
def module_actions(module: str, report_id: int):
    return module_detail(module, report_id).get('Actions', [])

@app.post('/sgsst/{module}/reports/{report_id}/actions', status_code=201)
def module_create_action(module: str, report_id: int, payload: RecordIn, request: Request):
    module_detail(module, report_id)
    values=payload.model_dump()
    values['ReportId']=report_id
    values['ActionPeople']=[authenticated_person(request, 'creador_seguimiento')]
    return create_record('Actions', RecordIn(**values))

@app.get('/sgsst/{module}/catalogs')
def module_catalogs(module: str):
    with engine.connect() as conn:
        kind=module_id(module,conn)
        result={}
        for name in ['CaseTypes','Categories','States','EntityTypes','Entities','ActionTypes','AffectedSystems']:
            table=get_table(name)
            result[name]=[dict(row) for row in conn.execute(select(table).order_by(*table.primary_key.columns)).mappings()]
        result['CaseTypes']=[row for row in result['CaseTypes'] if row['CaseTypeId']==kind]
        return result

@app.get('/sgsst/{module}/collaborators')
def module_collaborators(module: str):
    with engine.connect() as conn:
        people=get_table('ReportPeople'); reports=get_table('Reports')
        return [dict(row) for row in conn.execute(select(people).join(reports,people.c.ReportId==reports.c.StrapiId).where(reports.c.CaseTypeId==module_id(module,conn),people.c.Role=='colaborador').order_by(people.c.ReportPersonId)).mappings()]

@app.get('/sgsst/{module}/dashboard')
def module_dashboard(module: str):
    with engine.connect() as conn:
        reports=get_table('Reports'); states=get_table('States'); categories=get_table('Categories')
        condition=reports.c.CaseTypeId==module_id(module,conn)
        def grouped(target, foreign_key):
            rows=conn.execute(select(target.c.Name,func.count()).select_from(reports.outerjoin(target,foreign_key==list(target.primary_key.columns)[0])).where(condition).group_by(target.c.Name))
            return [{'label': name or 'Sin dato','count': count} for name,count in rows]
        total=conn.execute(select(func.count()).select_from(reports).where(condition)).scalar()
        return {'total':total,'states':grouped(states,reports.c.StateId),'categories':grouped(categories,reports.c.CategoryId)}


def batch_reports(rows, conn, lookups=None):
    """Expand a page with batched queries instead of one query per FK per row."""
    records=[{k:v for k,v in dict(r).items() if k not in {'SourceAttributesJson'}} for r in rows]
    if not records: return []
    ids=[r['StrapiId'] for r in records]
    if lookups is None:
        lookups={}
    for name in ['CaseTypes','Categories','States','Entities','EntityTypes','ActionTypes','AffectedSystems','CIE10Catalog']:
        if name in lookups: continue
        t=get_table(name); pk=list(t.primary_key.columns)[0].name
        lookups[name]={r[pk]:dict(r) for r in conn.execute(select(t)).mappings()}
    def expand(name,row):
        result={k:v for k,v in dict(row).items() if k not in {'SourceAttributesJson','SourcePersonJson'}}
        for fk in get_table(name).foreign_keys:
            if fk.column.table.name in lookups:
                result[fk.parent.name]=lookups[fk.column.table.name].get(row.get(fk.parent.name))
        return result
    actions=get_table('Actions'); people=get_table('ReportPeople'); action_people=get_table('ActionPeople')
    grouped={i:[] for i in ids}; persons={i:[] for i in ids}
    action_rows=list(conn.execute(select(actions).where(actions.c.ReportId.in_(ids))).mappings())
    action_ids=[row['StrapiId'] for row in action_rows]
    action_persons={action_id:[] for action_id in action_ids}
    if action_ids:
        for row in conn.execute(select(action_people).where(action_people.c.ActionId.in_(action_ids))).mappings():
            action_persons[row['ActionId']].append(
                {k:v for k,v in dict(row).items() if k!='SourcePersonJson'}
            )
    for row in action_rows:
        action=expand('Actions',row)
        action['ActionPeople']=action_persons[row['StrapiId']]
        grouped[row['ReportId']].append(action)
    for row in conn.execute(select(people).where(people.c.ReportId.in_(ids))).mappings():
        persons[row['ReportId']].append({k:v for k,v in dict(row).items() if k!='SourcePersonJson'})
    return [{**expand('Reports',r),'Actions':grouped[r['StrapiId']],'ReportPeople':persons[r['StrapiId']]} for r in records]


@app.get('/sgsst/{module}/workspace')
def module_workspace(module: str):
    with engine.connect() as conn:
        kind=module_id(module,conn)
        reports=get_table('Reports')
        rows=conn.execute(select(reports).where(reports.c.CaseTypeId==kind).order_by(reports.c.StrapiId.desc())).mappings().all()
        lookups={}; result=[]
        for start in range(0,len(rows),800):
            result.extend(batch_reports(rows[start:start+800],conn,lookups))
        catalogs={}
        for name in ['CaseTypes','Categories','States','EntityTypes','Entities','ActionTypes','AffectedSystems']:
            if name in lookups: catalogs[name]=list(lookups[name].values())
            else: catalogs[name]=[dict(r) for r in conn.execute(select(get_table(name))).mappings()]
        catalogs['CaseTypes']=[r for r in catalogs['CaseTypes'] if r['CaseTypeId']==kind]
        return {'reports':result,'catalogs':catalogs}

@app.get('/sgsst/{module}/cie10')
def search_cie(module: str, q: str = Query('',max_length=100)):
    with engine.connect() as conn:
        module_id(module,conn)
        t=get_table('CIE10Catalog')
        columns=[c for c in t.columns if hasattr(c.type,'length')]
        from sqlalchemy import or_
        query=select(t).order_by(*t.primary_key.columns).limit(30)
        if q.strip(): query=query.where(or_(*(c.contains(q.strip(),autoescape=True) for c in columns)))
        return [dict(r) for r in conn.execute(query).mappings()]
@app.post('/sgsst/{module}/reports/{report_id}/actions/{action_id}')
def update_action(module: str, report_id: int, action_id: int, payload: RecordIn):
    module_detail(module, report_id)
    values=payload.model_dump()
    allowed={'ActionTypeId','AffectedSystemId','Cie10Id','StateId','Descripcion','DiagnosticoSst','Temporalidad','FechaCreacionManual','PesoKg','TallaM','DatosAdicionalesJson'}
    if set(values)-allowed: raise HTTPException(422,'Campos no editables en la acción')
    table=get_table('Actions')
    with engine.begin() as conn:
        row=conn.execute(select(table).where(table.c.StrapiId==action_id,table.c.ReportId==report_id)).mappings().first()
        if row is None: raise HTTPException(404,'Seguimiento no encontrado en este reporte')
        conn.execute(table.update().where(table.c.StrapiId==action_id).values(**values))
        if values.get('StateId'):
            report=get_table('Reports')
            conn.execute(report.update().where(report.c.StrapiId==report_id).values(StateId=values['StateId']))
        row=conn.execute(select(table).where(table.c.StrapiId==action_id)).mappings().one()
        return serialize(table,dict(row),conn)
