#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const PROJECT = '/home/dev/Documents/ultra-cursor/igreen-page-magic';
const FIX = path.join(PROJECT, 'docs', 'e2e', 'fixtures');
const TS_DIR = path.join(PROJECT, 'testsprite_tests');
const OUT = path.join(TS_DIR, 'pipeline-logs');
const CONFIG = path.join(TS_DIR, 'tmp', 'config.json');
const NODE = `${process.env.HOME}/.nvm/versions/node/v22.22.3/bin/node`;
const TS = '/home/dev/.npm/_npx/8ddf6bea01b2519d/node_modules/@testsprite/testsprite-mcp/dist/index.js';
const IDS = ['TC016', 'TC029', 'TC032', 'TC035'];
const INSTR = 'Run only requested ids. Captação→Em espera→E2E-BLOQUEADO→Bloqueado. Routes /admin/reaquecimento and /admin/sofia-audios. TC035: NO viewport resize — assert desktop admin shell. Reload once on ERR_EMPTY_RESPONSE. PT-BR.';

function loadEnv() {
  for (const f of ['.env.mcp.local']) {
    const p = path.join(PROJECT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  }
  process.env.API_KEY = process.env.TESTSPRITE_API_KEY || process.env.API_KEY;
}
function say(s){ console.log(s); fs.appendFileSync(path.join(OUT,'final4.log'), s+'\n'); }
function probe(){
  return new Promise(r=>{
    const req=http.get('http://127.0.0.1:8081/auth',res=>{res.resume(); r(res.statusCode||0);});
    req.on('error',()=>r(0)); req.setTimeout(5000,()=>{req.destroy(); r(0);});
  });
}
async function healthy(){
  for (let i=0;i<15;i++){ if(await probe()===200) return true; await new Promise(r=>setTimeout(r,2000)); }
  return false;
}

async function main(){
  loadEnv();
  fs.mkdirSync(OUT,{recursive:true});
  fs.writeFileSync(path.join(OUT,'final4.log'), `start ${new Date().toISOString()}\n`);
  fs.copyFileSync(path.join(FIX,'testsprite_frontend_test_plan.json'), path.join(TS_DIR,'testsprite_frontend_test_plan.json'));
  if(!(await healthy())) throw new Error('preview down');

  // one-by-one for stability
  const results=[];
  for (const id of IDS){
    say(`\n=== ${id} ===`);
    if(!(await healthy())) throw new Error('preview down');
    fs.copyFileSync(path.join(FIX,'testsprite_frontend_test_plan.json'), path.join(TS_DIR,'testsprite_frontend_test_plan.json'));
    const email=process.env.E2E_EMAIL, pass=process.env.E2E_PASSWORD;
    fs.writeFileSync(CONFIG, JSON.stringify({
      status:'commited', type:'frontend', scope:'codebase', localEndpoint:'http://localhost:8081',
      loginUser:email, loginPassword:pass, serverMode:'production',
      executionArgs:{ projectName:'igreen-page-magic', projectPath:PROJECT, testIds:[id], serverMode:'production',
        additionalInstruction: INSTR + ` Focus exclusively on ${id}.`,
        envs:{ LOGIN_USER:email, LOGIN_PASSWORD:pass, E2E_EMAIL:email, E2E_PASSWORD:pass } }
    }, null, 2));
    try { fs.rmSync(path.join(TS_DIR,'tmp','execution.lock'),{force:true,recursive:true}); } catch {}
    const code = await new Promise(resolve=>{
      const child=spawn(NODE,[TS,'generateCodeAndExecute'],{cwd:PROJECT, env:{...process.env, API_KEY:process.env.API_KEY, BROWSER:'/tmp/noop-browser.sh'}, stdio:['ignore','pipe','pipe']});
      let settled=false;
      const finish=(c)=>{ if(settled) return; settled=true; try{child.kill('SIGTERM');}catch{}; setTimeout(()=>{try{child.kill('SIGKILL');}catch{}},1500); resolve(c||0); };
      const on=d=>{ const s=d.toString(); process.stdout.write(d); if(s.includes('Test execution completed')||s.includes('Execution lock released')) setTimeout(()=>finish(0),1200); if(s.includes('Test execution failed')) setTimeout(()=>finish(1),1200); };
      child.stdout.on('data',on); child.stderr.on('data',on); child.on('close',c=>finish(c||0));
      setTimeout(()=>finish(1), 25*60*1000);
    });
    const tr=path.join(TS_DIR,'tmp','test_results.json');
    const dest=path.join(OUT, `test_results_final_${id}.json`);
    if(fs.existsSync(tr)) fs.copyFileSync(tr, dest);
    results.push({id, code, dest});
    say(`done ${id} code=${code}`);
    await new Promise(r=>setTimeout(r,5000));
  }
  let pass=0,fail=0,blocked=0;
  for (const r of results){
    if(!fs.existsSync(r.dest)) continue;
    for (const t of JSON.parse(fs.readFileSync(r.dest,'utf8'))){
      say(`${t.title} => ${t.testStatus}`);
      if(t.testStatus==='PASSED') pass++; else if(t.testStatus==='FAILED') fail++; else if(t.testStatus==='BLOCKED') blocked++;
    }
  }
  say(`FINAL4 pass=${pass} fail=${fail} blocked=${blocked}`);
  process.exit(fail===0 && blocked===0 && pass>0 ? 0 : 1);
}
main().catch(e=>{console.error(e); process.exit(1);});
