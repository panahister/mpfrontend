import {cp,mkdir,mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';

const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const sandbox=await mkdtemp(join(tmpdir(),'mpfrontend-negative-controls-'));
const mutations=[
  {name:'shared-session-quota',package:'security-bff',test:'redis.integration.ts',file:'session-store.ts',
    before:" or redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[3]) then return 0 end; ",
    after:' then return 0 end; ',expected:'atomic cross-replica global and per-session budgets'},
  {name:'snapshot-acknowledgement',package:'realtime-core',test:'recovery.test.ts',file:'snapshot-recovery.ts',
    before:'try{await Promise.race([this.options.snapshot(batch,controller.signal),aborted]);}',
    after:'try{void Promise.race([this.options.snapshot(batch,controller.signal),aborted]).catch(()=>undefined);}',
    expected:'recovery waits for snapshots'},
  {name:'stale-authority-publication',package:'access-core',test:'authority-fence.test.ts',file:'authority-fence.ts',
    before:"throw new DOMException('AUTHORITY_CHANGED','AbortError');",
    after:'return;',expected:'a pending response cannot publish'},
  {name:'refresh-outage-retention',package:'security-bff',test:'refresh-outage.test.ts',file:'index.ts',
    before:"if(!(error instanceof IdentityUnavailable))await vault.remove('session',id);",
    after:"await vault.remove('session',id);",expected:'verified vault record remains byte-for-byte unchanged',
    options:['--test-skip-pattern=the bounded real transport timeout']},
  {name:'refresh-outage-no-stale-authority',package:'security-bff',test:'refresh-outage.test.ts',file:'index.ts',
    before:"const tokens=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',refresh_token:current.value.refresh}));",
    after:"let tokens;try{tokens=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',refresh_token:current.value.refresh}));}catch(error){if(error instanceof IdentityUnavailable)return {id,value:current.value};throw error;}",
    expected:'200 !== 503',options:['--test-skip-pattern=the bounded real transport timeout']},
  {name:'refresh-outage-private-classification',package:'security-bff',test:'refresh-outage.test.ts',file:'index.ts',
    before:"if(!(error instanceof IdentityUnavailable))await vault.remove('session',id);",
    after:"if((error as {status?:number}).status!==503)await vault.remove('session',id);",
    expected:'a generic503 vault update failure',options:['--test-skip-pattern=the bounded real transport timeout']},
  {name:'bodyless-undefined-only-validation',package:'ftg-cli',test:'index.test.ts',file:'read-models.ts',
    before:"JSON.stringify(request.name)+'] = value => value === undefined;');",
    after:"JSON.stringify(request.name)+'] = value => true;');",expected:'Missing expected exception',
    exactMatches:1,options:['--test-name-pattern=explicit bodyless mutation']},
  {name:'browser-snapshot-close-code',package:'realtime-core',test:'browser-recovery.test.ts',file:'react.ts',
    before:"active.close(4013,'SNAPSHOT_UNAVAILABLE')",after:"active.close(1013,'SNAPSHOT_UNAVAILABLE')",
    expected:'InvalidAccessError'},
  {name:'bounded-realtime-diagnostics',package:'realtime-core',test:'browser-recovery.test.ts',file:'react.ts',
    before:'callbacks.current.onUnavailable?.(Object.freeze(fault));',after:'void fault;',
    expected:'Expected values to be strictly deep-equal'},
  {name:'realtime-admission-retry-floor',package:'realtime-core',test:'index.test.ts',file:'index.ts',
    before:'return Math.floor(ceiling/2+random()*ceiling/2);',after:'return Math.floor(random()*ceiling);',
    expected:'250 !== 375'},
  // Each production startup condition of the Security BFF and the presentation server is a guard.
  {name:'production-https-origin',package:'security-bff',test:'production.test.ts',file:'index.ts',
    before:"  if(!https(config.publicOrigin))refusals.push('HTTPS_PUBLIC_ORIGIN_REQUIRED');\n",after:'',
    expected:'the production profile refuses each missing condition by name'},
  {name:'production-durable-vault',package:'security-bff',test:'production.test.ts',file:'index.ts',
    before:"  if(!security?.durable)refusals.push('DURABLE_SESSION_VAULT_REQUIRED');\n",after:'',
    expected:'the production profile refuses each missing condition by name'},
  {name:'production-vault-tls',package:'security-bff',test:'production.test.ts',file:'index.ts',
    before:"  if(!security?.tls)refusals.push('SESSION_VAULT_TLS_REQUIRED');\n",after:'',
    expected:'the production profile refuses each missing condition by name'},
  {name:'production-client-authentication',package:'security-bff',test:'production.test.ts',file:'index.ts',
    before:"refusals.push('CLIENT_AUTHENTICATION_REQUIRED');",after:'void 0;',
    expected:'the production profile refuses each missing condition by name'},
  {name:'production-no-memory-fallback',package:'security-bff',test:'production.test.ts',file:'index.ts',
    before:'const vault=production?production.sessionVault:(config as DevelopmentBffConfig).sessionVault??createMemorySessionVault();',
    after:'const vault=createMemorySessionVault();',expected:'readiness and requests fail with 503'},
  {name:'client-assertion-unique-jti',package:'security-bff',test:'client-authentication.test.ts',file:'index.ts',
    before:'jti:randomUUID(),',after:"jti:'fixed',",expected:'private_key_jwt: the assertion names the token endpoint'},
  {name:'client-secret-header-only',package:'security-bff',test:'client-authentication.test.ts',file:'index.ts',
    before:"      return {authorization:'Basic '+",after:"      parameters.set('client_secret',secret);return {authorization:'Basic '+",
    expected:'client_secret_basic: the secret travels only in the Authorization header'},
  {name:'session-idle-timeout',package:'security-bff',test:'session-policy.test.ts',file:'index.ts',
    before:"if((value.lastSeen??Date.now())+idleSeconds*1000<=Date.now()){await vault.remove('session',id);fail(401,'LOGIN_REQUIRED');}",after:'',
    expected:'an idle session fails closed with 401'},
  {name:'session-rotation-on-authority-change',package:'security-bff',test:'session-policy.test.ts',file:'index.ts',
    before:'if(authority(claims)!==authority(current.value.claims)){',after:'if(Number.isNaN(0)){',
    expected:'rotates when roles change at refresh'},
  {name:'session-cookie-same-site',package:'security-bff',test:'session-policy.test.ts',file:'index.ts',
    before:'const sessionSetCookie=(id:string,maxAge:number)=>cookie(sessionCookie,id,maxAge,sameSite);',
    after:'const sessionSetCookie=(id:string,maxAge:number)=>cookie(sessionCookie,id,maxAge);',
    expected:'a __Host- session cookie, Strict by default'},
  {name:'presentation-shared-tickets',package:'presentation-server',test:'production.test.ts',file:'index.ts',
    before:"  if(config.production?.ticketStore?.shared!==true)refusals.push('SHARED_TICKET_STORE_REQUIRED');\n",after:'',
    expected:'refuses each missing condition by name and has no memory default'}
];
try{
  await symlink(join(root,'node_modules'),join(sandbox,'node_modules'),'dir');
  for(const mutation of mutations){
    const directory=join(sandbox,mutation.name);await mkdir(join(directory,'tests'),{recursive:true});
    await cp(join(root,'packages',mutation.package,'src'),join(directory,'src'),{recursive:true});
    await cp(join(root,'packages',mutation.package,'tests',mutation.test),join(directory,'tests',mutation.test));
    await writeFile(join(directory,'package.json'),JSON.stringify({type:'module'}));
    await symlink(join(root,'packages',mutation.package,'node_modules'),join(directory,'node_modules'),'dir');
    const path=join(directory,'src',mutation.file),original=await readFile(path,'utf8');
    assert.ok(original.includes(mutation.before),'mutation must match the actual implementation');
    if(mutation.exactMatches!==undefined){
      assert.equal(original.split(mutation.before).length-1,mutation.exactMatches,'mutation must match the declared implementation locations');
    }
    await writeFile(path,original.replace(mutation.before,mutation.after));
    let result;
    try{result=await exec(process.execPath,['--import','tsx','--test',...(mutation.options??[]),join(directory,'tests',mutation.test)],{
      cwd:root,timeout:30000,maxBuffer:1048576,env:{...process.env,TSX_TSCONFIG_PATH:join(root,'tsconfig.base.json')}
    });}catch(error){result=error;}
    assert.ok(Number.isInteger(result.code)&&result.code!==0,'disabled guard must fail the real test, not timeout');
    if(!String(result.stdout).includes(mutation.expected))throw new Error('NEGATIVE_CONTROL_SETUP_FAILURE:'+String(result.stdout).slice(-3000)+String(result.stderr).slice(-1000));
    assert.match(String(result.stdout),/AssertionError|Expected values/,'failure must be an assertion, not a missing dependency');
    console.log(JSON.stringify({negativeControl:mutation.name,expectedAssertionFailure:true,workingSourceUntouched:true}));
  }
}finally{
  // Only this script-owned, newly created temporary fixture is removed.
  await rm(sandbox,{recursive:true,force:true});
}
