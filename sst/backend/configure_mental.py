from main import make_engine
from sqlalchemy import MetaData,Table,select,insert,func
e=make_engine();t=Table('CaseTypes',MetaData(),schema='dbo',autoload_with=e)
with e.begin() as c:
 rows=c.execute(select(t).with_hint(t,'WITH (TABLOCKX, HOLDLOCK)',dialect_name='mssql')).mappings().all()
 if not any(r['NameKey']=='SALUD_MENTAL' for r in rows):
  v={'Name':'salud_mental'}
  if t.c.CaseTypeId.identity is None:v['CaseTypeId']=max(r['CaseTypeId'] for r in rows)+1
  c.execute(insert(t).values(**v))
  print('Catalogo Salud Mental creado')
e.dispose()

