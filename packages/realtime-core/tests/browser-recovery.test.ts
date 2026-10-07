import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import ts from 'typescript';

// Execute the real hook with a finite effect/state harness, not a React renderer or live server.
// Only import specifiers change. Browser close validation follows WHATWG, unlike ws server.close.
const hooksSource=`export const effects=[],states=[];
export function useEffect(effect){effects.push(effect);}
export function useRef(current){return {current};}
export function useState(initial){return [initial,value=>states.push(value)];}
export function flush(){return effects.splice(0).map(effect=>effect()).filter(Boolean);}`;
const hooksUrl='data:text/javascript;base64,'+Buffer.from(hooksSource).toString('base64');
const harness=await import(hooksUrl) as {states:string[];flush():Array<()=>void>};
const source=await readFile(new URL('../src/react.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  .replace(/from ['"]react['"]/,`from ${JSON.stringify(hooksUrl)}`)
  .replace(/from ['"]\.\/index\.js['"]/,`from ${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)}`);
const {useRealtime}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64')) as typeof import('../src/react.js');

test('real browser hook recovers snapshot failures with a valid client close and fenced lifecycle',async t=>{
  const originalSocket=Object.getOwnPropertyDescriptor(globalThis,'WebSocket');
  const originalLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  const sockets:StrictSocket[]=[];let tickets=0;
  class StrictSocket {
    onopen:(()=>void)|null=null;
    onmessage:((event:{data:string})=>void)|null=null;
    onclose:((event:{code:number})=>void)|null=null;
    onerror:(()=>void)|null=null;
    readonly closes:Array<{code:number|undefined;reason:string|undefined}>=[];
    closed=false;
    constructor(readonly url:URL){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
    send(bytes:string){const subscribe=JSON.parse(bytes);assert.equal(subscribe.type,'subscribe');
      queueMicrotask(()=>this.frame({v:1,type:'ready',contextRef:'fixture-context-'+sockets.length,accessRevision:'fixture-revision',recovery:'snapshot'}));}
    frame(frame:unknown){this.onmessage?.({data:JSON.stringify(frame)});}
    close(code?:number,reason?:string){
      assert.ok(code===undefined||code===1000||(Number.isInteger(code)&&code>=3000&&code<=4999),'InvalidAccessError: invalid browser client close code');
      if(reason!==undefined&&Buffer.byteLength(reason)>123)throw new DOMException('oversized reason','SyntaxError');
      if(this.closed)return;this.closed=true;this.closes.push({code,reason});queueMicrotask(()=>this.onclose?.({code:code??1005}));
    }
    serverClose(code:number){this.closed=true;this.onclose?.({code});}
  }
  Object.defineProperty(globalThis,'WebSocket',{configurable:true,value:StrictSocket});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'http://fixture.local/',protocol:'http:'}});
  t.mock.method(globalThis,'fetch',async()=>{tickets++;return Response.json({ticket:'synthetic-admission'});});
  t.after(()=>{
    if(originalSocket)Object.defineProperty(globalThis,'WebSocket',originalSocket);else Reflect.deleteProperty(globalThis,'WebSocket');
    if(originalLocation)Object.defineProperty(globalThis,'location',originalLocation);else Reflect.deleteProperty(globalThis,'location');
  });
  const session={subject:'synthetic-user',tenant:'synthetic-tenant',roles:['customer'],csrf:'synthetic-csrf'};
  const until=async(predicate:()=>boolean)=>{for(let i=0;i<100&&!predicate();i++)await delay(10);assert.ok(predicate(),'bounded browser recovery condition must be observed');};
  async function scenario(snapshot:(resources:readonly string[],signal:AbortSignal)=>Promise<void>,run:()=>Promise<void>,onRevoked?:()=>void,onUnavailable?:(fault:{phase:'ticket'|'transport'|'snapshot';status?:number})=>void){
    harness.states.length=0;sockets.length=0;tickets=0;
    useRealtime({session,resources:['orders'],onSnapshot:snapshot,onRevoked,onUnavailable});
    const cleanups=harness.flush();try{await run();}finally{for(const cleanup of cleanups)cleanup();await delay(0);}
  }
  await t.test('rejected snapshot closes4013 once, backs off, readmits and only reports live after a new successful read',async()=>{
    let reads=0;const faults:unknown[]=[];await scenario(async()=>{if(++reads===1)throw new Error('synthetic-read-unavailable');},async()=>{
      await until(()=>harness.states.at(-1)==='live');
      assert.deepEqual(sockets[0]!.closes,[{code:4013,reason:'SNAPSHOT_UNAVAILABLE'}]);
      assert.equal(tickets,2);assert.equal(reads,2);assert.equal(sockets.length,2);
      assert.ok(harness.states.indexOf('backoff')>=0);
      assert.equal(harness.states.filter(state=>state==='live').length,1);
      assert.deepEqual(faults,[{phase:'snapshot'}]);
    },undefined,fault=>{faults.push(fault);throw new Error('observer must not control recovery');});
  });
  await t.test('cleanup aborts a pending read and refuses its late success without retry',async()=>{
    let signal:AbortSignal|undefined,finish!:()=>void;
    await scenario(async(_resources,current)=>{signal=current;await new Promise<void>(resolve=>{finish=resolve;});},async()=>{
      await until(()=>signal!==undefined);const cleanups=harness.flush();assert.equal(cleanups.length,0);
      // Cleanup returned by the initial effect is exercised by scenario finally.
    });
    assert.equal(signal?.aborted,true);finish();await delay(400);
    assert.equal(tickets,1);assert.equal(harness.states.includes('live'),false);
    assert.deepEqual(sockets[0]!.closes,[{code:1000,reason:'CONTEXT_CLOSED'}]);
  });
  await t.test('server revocation stops rather than retrying or publishing late snapshot authority',async()=>{
    let finish!:()=>void,revoked=0;
    await scenario(async()=>{await new Promise<void>(resolve=>{finish=resolve;});},async()=>{
      await until(()=>typeof finish==='function');sockets[0]!.serverClose(4003);finish();await delay(400);
      assert.equal(harness.states.at(-1),'closed');assert.equal(revoked,1);
      assert.equal(tickets,1);assert.equal(harness.states.includes('live'),false);
    },()=>{revoked++;});
  });
  await t.test('ticket503 reports only bounded phase/status and retries without leaking provider detail',async()=>{
    const faults:unknown[]=[];
    t.mock.method(globalThis,'fetch',async()=>{tickets++;return tickets===1?Response.json({detail:'synthetic-private-provider-detail'},{status:503}):Response.json({ticket:'synthetic-admission'});});
    await scenario(async()=>{},async()=>{
      await until(()=>harness.states.at(-1)==='live');assert.equal(tickets,2);assert.equal(sockets.length,1);
      assert.deepEqual(faults,[{phase:'ticket',status:503}]);
      assert.equal(JSON.stringify(faults).includes('synthetic-private-provider-detail'),false);
    },undefined,fault=>{faults.push(fault);});
  });
});
