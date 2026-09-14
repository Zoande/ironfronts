import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameConnection } from '../src/client/game-connection';
import { connectGame } from '../src/client/auth-api';
vi.mock('../src/client/auth-api',()=>({connectGame:vi.fn()}));
class Socket extends EventTarget {
  static CONNECTING=0; static OPEN=1; static instances:Socket[]=[];
  readyState=0; sent:unknown[]=[];
  constructor(_url:string){super();Socket.instances.push(this);}
  send(text:string){this.sent.push(JSON.parse(text));}
  close=vi.fn(()=>{this.readyState=3;this.dispatchEvent(new Event('close'));});
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  message(data:unknown){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
}
const state = () => ({ simulationTick:0,viewerCountryId:1,startCamera:{x:0,z:0,distance:1},countries:{1:{id:1,name:'A',color:'#fff',controller:'player',alive:true}},
  provinceOwners:{},provinceBuildings:{},provinceActions:{},productionQueues:{},constructionQueues:{},rallyPoints:{},armies:{},resourceNodes:{},ownCountry:null,relations:{} });
function handshake(socket: Socket, revision=0, debugEnabled=false) {
  socket.open();
  socket.message({type:'hello',gameId:'world-at-war-2',gameVersion:'world-at-war@4',protocolVersion:4,capabilities:[],
    world:{version:'12',hash:'a'.repeat(64),assetBaseUrl:'http://world',artifactHashes:{}},countryId:1,debugEnabled});
  socket.message({type:'baseline',revision,state:state(),catalogs:{units:[],buildings:[]},clock:{gameStartedAtEpochMs:0,gameEpochMs:0,serverEpochMs:0,speed:1,generation:0,utcOffsetMinutes:120}});
}
beforeEach(()=>{
  vi.useFakeTimers();vi.stubGlobal('window',globalThis);vi.stubGlobal('WebSocket',Socket);Socket.instances=[];
  vi.mocked(connectGame).mockClear();
  vi.mocked(connectGame).mockResolvedValue({protocolVersion:4,websocketUrl:'ws://localhost',ticket:'ticket'} as Awaited<ReturnType<typeof connectGame>>);
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('connection handshake cleanup',()=>{
  it('rejects and closes a socket when the baseline times out',async()=>{
    const result=GameConnection.open().catch(error=>error);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).message).toMatch(/timed out/);
    expect(Socket.instances[0].close).toHaveBeenCalled();
  });
  it('rejects malformed nested protocol data immediately',async()=>{
    const result=GameConnection.open().catch(error=>error);await Promise.resolve();
    Socket.instances[0].message({type:'baseline',revision:1,state:{armies:{a:{x:'invalid'}}}});
    expect((await result).message).toMatch(/Invalid response/);
    expect(Socket.instances[0].close).toHaveBeenCalledWith(1002,'Invalid server message');
  });
  it('rejects a socket closed before the battlefield arrives',async()=>{
    const result=GameConnection.open().catch(error=>error);await Promise.resolve();Socket.instances[0].close();
    expect((await result).message).toMatch(/before the battlefield/);
  });
  it('cancels a pending handshake without starting reconnect timers',async()=>{
    const connection=new GameConnection();
    const result=(connection as unknown as {connect():Promise<void>}).connect().catch(error=>error);
    await Promise.resolve();connection.close();await result;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Socket.instances).toHaveLength(1);expect(connection.status).toBe('closed');
  });
  it('reconnects through a fresh ticket and installs a replacement baseline',async()=>{
    const opened=GameConnection.open(); await Promise.resolve();
    handshake(Socket.instances[0],2);
    const connection=await opened;
    expect(connection.baselineGeneration).toBe(1);
    Socket.instances[0].close();
    await vi.advanceTimersByTimeAsync(1_000); await Promise.resolve();
    expect(Socket.instances).toHaveLength(2);
    handshake(Socket.instances[1],7);
    await Promise.resolve();
    expect(connectGame).toHaveBeenCalledTimes(2);
    expect(connection.status).toBe('ready');
    expect(connection.revision).toBe(7);
    expect(connection.baselineGeneration).toBe(2);
    connection.close();
  });
  it('exposes debug access only when the authenticated hello grants it',async()=>{
    const opened=GameConnection.open(); await Promise.resolve();
    handshake(Socket.instances[0],0,true);
    const connection=await opened;
    expect(connection.debugEnabled).toBe(true);
    connection.close();

    const ordinaryOpened=GameConnection.open(); await Promise.resolve();
    handshake(Socket.instances[1],0,false);
    const ordinary=await ordinaryOpened;
    expect(ordinary.debugEnabled).toBe(false);
    ordinary.close();
  });
  it('requests one baseline for a revision gap and closes if resync stalls',async()=>{
    const opened=GameConnection.open(); await Promise.resolve(); handshake(Socket.instances[0],2);
    const connection=await opened;
    Socket.instances[0].message({type:'delta',fromRevision:1,revision:3,
      delta:{changed:{},upserts:{},removals:{},redactions:[]},events:[]});
    expect(connection.status).toBe('resyncing');
    expect(Socket.instances[0].sent.filter((message)=>message && (message as {type?:string}).type==='resync')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(Socket.instances[0].close).toHaveBeenCalledWith(4000,'Resync timeout');
    connection.close();
  });
  it('accepts commands during a brief inbound lull while the authenticated socket remains open',async()=>{
    const opened=GameConnection.open(); await Promise.resolve(); handshake(Socket.instances[0],2);
    const connection=await opened;
    const result=vi.fn();
    await vi.advanceTimersByTimeAsync(3_000);
    connection.command({type:'stopArmy',armyId:'a'},result);
    expect(Socket.instances[0].sent.some((message) =>
      message && (message as {type?:string}).type === 'command')).toBe(true);
    expect(result).not.toHaveBeenCalled();
    connection.close();
  });
});
