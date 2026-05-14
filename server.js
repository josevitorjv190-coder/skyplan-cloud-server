// SKYPLAN CLOUD SERVER
// Web app conecta como role=web. Bridge conecta como role=bridge.
// Bridge envia ownship; Cloud retransmite para browsers da mesma sala e para multiplayer.

const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const clients = new Map();

const server = http.createServer((req,res)=>{
  if(req.url === '/health'){
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true, service:'skyplan-cloud', clients:clients.size}));
    return;
  }
  res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
  res.end('SKYPLAN Cloud Server Online');
});

const wss = new WebSocket.Server({server});

function send(ws,obj){
  if(ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function roomClients(room){
  return [...clients.values()].filter(c=>c.room===room);
}
function trafficFor(room, excludeId){
  return roomClients(room)
    .filter(c=>c.id!==excludeId && c.position)
    .map(c=>({id:c.id,callsign:c.callsign,role:c.role,...c.position}));
}
function broadcastRoom(room){
  for(const c of roomClients(room)){
    send(c.ws, {type:'traffic', room, players:trafficFor(room,c.id)});
  }
}
function broadcastOwnship(room, callsign, data){
  for(const c of roomClients(room)){
    if(c.role === 'web'){
      send(c.ws, {type:'ownship', callsign, data});
    }
  }
}

wss.on('connection',(ws,req)=>{
  const id=crypto.randomUUID();
  const c={id,ws,role:'web',room:'BRASIL',callsign:'SKY'+id.slice(0,4).toUpperCase(),position:null,lastSeen:Date.now()};
  clients.set(id,c);
  send(ws,{type:'welcome',id,server:'SKYPLAN CLOUD'});

  ws.on('message',(raw)=>{
    let m; try{m=JSON.parse(raw)}catch(e){return}
    c.lastSeen=Date.now();

    if(m.type==='join'){
      c.role=String(m.role||'web').toLowerCase();
      c.room=String(m.room||'BRASIL').toUpperCase();
      c.callsign=String(m.callsign||c.callsign).toUpperCase();
      send(ws,{type:'joined',id:c.id,role:c.role,room:c.room,callsign:c.callsign});
      console.log(`[JOIN] ${c.callsign} role=${c.role} room=${c.room}`);
      broadcastRoom(c.room);
      return;
    }

    if(m.type==='ownship' || m.type==='position'){
      const d=m.data||m;
      const lat=Number(d.lat??d.latitude), lon=Number(d.lon??d.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lon)) return;

      const pos={
        lat, lon,
        hdg:Number(d.hdg??d.heading??d.track??0),
        heading:Number(d.heading??d.hdg??d.track??0),
        gs:Number(d.gs??d.ground_speed??0),
        ias:Number(d.ias??d.indicated_airspeed??0),
        alt:Number(d.alt??d.altitude??0),
        vs:Number(d.vs??d.vertical_speed??0),
        oat:Number(d.oat??d.ambient_temperature??0),
        aircraft:String(d.aircraft||d.title||'SKYPLAN'),
        ts:Date.now()
      };
      c.position=pos;
      broadcastOwnship(c.room,c.callsign,pos);
      broadcastRoom(c.room);
      return;
    }
  });

  ws.on('close',()=>{
    const room=c.room;
    clients.delete(id);
    broadcastRoom(room);
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const [id,c] of clients){
    if(now-c.lastSeen > 120000){
      try{c.ws.close()}catch(e){}
      clients.delete(id);
    }
  }
},30000);

server.listen(PORT,'0.0.0.0',()=>{
  console.log('====================================');
  console.log(' SKYPLAN CLOUD SERVER');
  console.log('====================================');
  console.log('Port:', PORT);
  console.log('Health: /health');
  console.log('Use em produção: wss://SEU-DOMINIO');
  console.log('====================================');
});
