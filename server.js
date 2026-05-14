// SKYPLAN CLOUD SERVER
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
    .filter(c=>c.id!==excludeId && c.position && c.callsign && c.callsign!=='undefined')
    .map(c=>({
      id:c.id,
      callsign:c.callsign,
      role:c.role,
      lat:c.position.lat,
      lon:c.position.lon,
      hdg:c.position.hdg||c.position.heading||0,
      heading:c.position.heading||c.position.hdg||0,
      gs:c.position.gs||0,
      ias:c.position.ias||0,
      alt:c.position.alt||0,
      vs:c.position.vs||0,
      ts:c.position.ts||Date.now()
    }));
}
function broadcastRoom(room){
  const traffic = roomClients(room);
  for(const c of traffic){
    const players = trafficFor(room, c.id);
    send(c.ws, {type:'traffic', room, players});
  }
}

wss.on('connection',(ws,req)=>{
  const id=crypto.randomUUID();
  const c={id,ws,role:'web',room:'BRASIL',callsign:'SKY'+id.slice(0,4).toUpperCase(),position:null,lastSeen:Date.now()};
  clients.set(id,c);
  send(ws,{type:'welcome',id,server:'SKYPLAN CLOUD'});
  console.log(`[CONNECT] id=${id.slice(0,8)}`);

  ws.on('message',(raw)=>{
    let m; try{m=JSON.parse(raw)}catch(e){return}
    c.lastSeen=Date.now();

    if(m.type==='join'){
      c.role=String(m.role||'web').toLowerCase();
      c.room=String(m.room||'BRASIL').toUpperCase();
      if(m.callsign && String(m.callsign).trim() && String(m.callsign)!=='undefined'){
        c.callsign=String(m.callsign).toUpperCase();
      }
      send(ws,{type:'joined',id:c.id,role:c.role,room:c.room,callsign:c.callsign});
      console.log(`[JOIN] ${c.callsign} role=${c.role} room=${c.room}`);
      broadcastRoom(c.room);
      return;
    }

    if(m.type==='ownship' || m.type==='position'){
      const d=m.data||m;
      // Atualiza callsign se vier junto
      if(m.callsign && String(m.callsign).trim() && String(m.callsign)!=='undefined'){
        c.callsign=String(m.callsign).toUpperCase();
      }
      const lat=Number(d.lat??d.latitude);
      const lon=Number(d.lon??d.longitude);
      if(!Number.isFinite(lat)||!Number.isFinite(lon)) return;

      c.position={
        lat, lon,
        hdg:Number(d.hdg??d.heading??d.track??0),
        heading:Number(d.heading??d.hdg??d.track??0),
        gs:Number(d.gs??d.ground_speed??0),
        ias:Number(d.ias??d.indicated_airspeed??0),
        alt:Number(d.alt??d.altitude??0),
        vs:Number(d.vs??d.vertical_speed??0),
        oat:Number(d.oat??15),
        aircraft:String(d.aircraft||d.title||'SKYPLAN'),
        ts:Date.now()
      };

      // Envia ownship para browsers da mesma sala
      for(const cl of roomClients(c.room)){
        if(cl.role==='web' && cl.id!==c.id){
          send(cl.ws,{type:'ownship',callsign:c.callsign,data:c.position});
        }
      }
      broadcastRoom(c.room);
      return;
    }
  });

  ws.on('close',()=>{
    const room=c.room;
    console.log(`[DISCONNECT] ${c.callsign}`);
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
  console.log('====================================');
});
