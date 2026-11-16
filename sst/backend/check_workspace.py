import time,os
from fastapi.testclient import TestClient
import main
with TestClient(main.app) as c:
 h={'Authorization':'Bearer '+os.environ['API_TOKEN']}
 for module in ['salud_general','salud_mental','osteomuscular']:
  started=time.perf_counter();r=c.get('/sgsst/'+module+'/workspace',headers=h)
  assert r.status_code==200,r.text[:200]
  body=r.json();assert all(row['CaseTypeId']['Name']==module for row in body['reports'])
  print(module,'cases',len(body['reports']),'seconds',round(time.perf_counter()-started,2),'KB',round(len(r.content)/1024),flush=True)
  r=c.get('/sgsst/'+module+'/cie10?q=A0',headers=h);assert r.status_code==200,r.text[:100]
 print('workspace and CIE search OK',flush=True)
