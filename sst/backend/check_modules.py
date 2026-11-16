from fastapi.testclient import TestClient
import main,os
with TestClient(main.app) as c:
 h={'Authorization':'Bearer '+os.environ['API_TOKEN']}
 for module in ['salud_general','salud_mental','osteomuscular']:
  for endpoint in ['reports?limit=1','dashboard','catalogs','collaborators']:
   r=c.get('/sgsst/'+module+'/'+endpoint,headers=h)
   print(module,endpoint,r.status_code,flush=True)
   assert r.status_code==200,r.text[:200]
