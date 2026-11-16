import os
from contextlib import contextmanager, nullcontext
from fastapi.testclient import TestClient
import main
with TestClient(main.app) as client:
    headers={'Authorization': 'Bearer '+os.environ['API_TOKEN']}
    for path in ['/health','/api/tables','/api/Reports?limit=1','/api/Actions?limit=1']:
        r=client.get(path,headers=headers)
        print(path,r.status_code,flush=True)
        assert r.status_code==200, r.text[:100]
    assert client.get('/health').status_code==401
    assert client.get('/api/Reports').status_code==401
    schema=client.get('/openapi.json').json()
    assert 'HTTPBearer' in schema['components']['securitySchemes']
    real=main.engine
    with real.connect() as conn:
        tx=conn.begin()
        class RollbackEngine:
            @contextmanager
            def begin(self):
                yield conn
            def connect(self):
                return nullcontext(conn)
        main.engine=RollbackEngine()
        try:
            r=client.post('/api/Reports',headers=headers,json={'Descripcion':'Prueba transaccional SGSST','FechaCreacionManual':'2026-11-15','ReportPeople':[{'Nombre':'Prueba','Documento':'TEST','Role':'colaborador'}]})
            print('POST Reports rollback:',r.status_code,flush=True)
            assert r.status_code==201, r.text[:100]
            report=r.json()
            assert len(report['ReportPeople'])==1
            r=client.post('/api/Actions',headers=headers,json={'ReportId':report['StrapiId'],'Descripcion':'Seguimiento de prueba','FechaCreacionManual':'2026-11-15'})
            print('POST Actions rollback:',r.status_code,flush=True)
            assert r.status_code==201,r.text[:100]
            detail=client.get('/api/Reports/'+str(report['StrapiId']),headers=headers).json()
            assert len(detail['Actions'])==1
            print('Report -> Actions: OK',flush=True)
            from sqlalchemy import select
            state_ids=conn.execute(select(main.get_table('States').c.StateId)).scalars().all()
            for module in ['salud_general','salud_mental','osteomuscular']:
                r=client.post('/sgsst/'+module+'/reports',headers=headers,json={'Descripcion':'Prueba de modulo','ReportPeople':[{'Role':'colaborador','Nombre':'Prueba','Documento':'TEST'}]})
                assert r.status_code==201,r.text[:100]
                created_report=r.json()
                report_id=created_report['StrapiId']
                assert {person['Role'] for person in created_report['ReportPeople']}=={'colaborador','creador'}
                path=f'/sgsst/{module}/reports/{report_id}'
                r=client.post(path+'/actions',headers=headers,json={'Descripcion':'Prueba de seguimiento','StateId':state_ids[0]})
                assert r.status_code==201,r.text[:100]
                action_id=r.json()['StrapiId']
                r=client.post(path+'/actions/'+str(action_id),headers=headers,json={'Descripcion':'Seguimiento editado','StateId':state_ids[-1]})
                assert r.status_code==200,r.text[:100]
                detail=client.get(path,headers=headers).json()
                assert detail['StateId']['StateId']==state_ids[-1]
                assert detail['Actions'][0]['Descripcion']=='Seguimiento editado'
                assert detail['Actions'][0]['ActionPeople'][0]['Role']=='creador_seguimiento'
                other='salud_mental' if module!='salud_mental' else 'salud_general'
                assert client.get(f'/sgsst/{other}/reports/{report_id}',headers=headers).status_code==404
                print(module,'create/edit/state/isolation OK',flush=True)

        finally:
            tx.rollback()
            main.engine=real
    print('Rollback completado; sin registros de prueba persistidos.',flush=True)
