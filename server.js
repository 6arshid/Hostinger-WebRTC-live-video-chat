"use strict";

const express    = require("express");
const http       = require("http");
const https      = require("https");
const fs         = require("fs");
const path       = require("path");
const crypto     = require("crypto");
const { Server } = require("socket.io");

const PORT        = process.env.PORT || 3000;
const MAX_PEERS   = 10;
const ROOM_TTL    = 10 * 60 * 1000;
const MAX_ROOMS   = 500;
const KNOCK_TO    = 30_000;
const SLUG_RE     = /^[a-z0-9][a-z0-9\-]{2,78}[a-z0-9]$/;
const MAX_SLUG_LEN = 80;
const ADJS  = ["swift","brave","calm","dark","epic","fair","gold","jade","keen","lush","mild","neat","pure","rapid","safe","teal","vast","warm","bold","cool"];
const NOUNS = ["falcon","river","stone","bloom","flame","grove","haven","isle","jungle","kite","lagoon","mesa","nova","orbit","plaza","realm","summit","trail","vault","creek"];

const ICE = [
  {urls:"stun:stun.l.google.com:19302"},
  {urls:"stun:stun1.l.google.com:19302"},
  {urls:"turn:openrelay.metered.ca:80",          username:"openrelayproject",credential:"openrelayproject"},
  {urls:"turn:openrelay.metered.ca:443",         username:"openrelayproject",credential:"openrelayproject"},
  {urls:"turns:openrelay.metered.ca:443",        username:"openrelayproject",credential:"openrelayproject"},
];

// ─── Slug ─────────────────────────────────────────────────────────────────────
function genSlug(){
  const a=ADJS[Math.floor(Math.random()*ADJS.length)];
  const n=NOUNS[Math.floor(Math.random()*NOUNS.length)];
  return `${a}-${n}-${Math.floor(Math.random()*9000)+1000}`;
}
function uniqueSlug(){let s,i=0;do{s=genSlug();i++;}while(rooms.has(s)&&i<100);return s;}

// ─── Sanitize ─────────────────────────────────────────────────────────────────
function san(str,max=100){
  if(typeof str!=="string")return "";
  return str.replace(/[<>"'`]/g,"").trim().slice(0,max);
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const rl=new Map();
function rateOk(key,max,win=60000){
  const now=Date.now();let e=rl.get(key);
  if(!e||now>e.r){e={c:0,r:now+win};rl.set(key,e);}
  return ++e.c<=max;
}
setInterval(()=>{const n=Date.now();for(const[k,v]of rl)if(n>v.r)rl.delete(k);},5*60*1000);

// ─── App ──────────────────────────────────────────────────────────────────────
const app=express();

// Security headers
app.use((_,res,next)=>{
  res.setHeader("Content-Security-Policy",[
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://images.unsplash.com",
    "connect-src 'self' wss: ws: https://openrelay.metered.ca https://cdn.jsdelivr.net rtmp: https://a.upload.youtube.com",
    "media-src 'self' blob:",
    "worker-src blob:",
    "frame-ancestors 'none'",
  ].join("; "));
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","DENY");
  res.setHeader("X-XSS-Protection","1; mode=block");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy","camera=*, microphone=*, display-capture=*");
  next();
});
app.use(express.json({limit:"50kb"}));
app.use(express.static(path.join(__dirname,"public"),{maxAge:"1h",etag:true}));
if(process.env.NODE_ENV==="production"){
  app.use((req,res,next)=>{
    if(req.headers["x-forwarded-proto"]==="http")return res.redirect(301,"https://"+req.headers.host+req.url);
    next();
  });
}

let server;
const sc=process.env.SSL_CERT,sk=process.env.SSL_KEY;
if(sc&&sk&&fs.existsSync(sc)&&fs.existsSync(sk))
  server=https.createServer({cert:fs.readFileSync(sc),key:fs.readFileSync(sk)},app);
else
  server=http.createServer(app);

const io=new Server(server,{
  cors:{origin:process.env.ALLOWED_ORIGIN||"*",methods:["GET","POST"]},
  transports:["websocket","polling"],
  pingTimeout:60000,pingInterval:25000,upgradeTimeout:30000,
  maxHttpBufferSize:64*1024,connectTimeout:15000,
});

// ─── State ────────────────────────────────────────────────────────────────────
const rooms=new Map();

function roomPub(r){
  return{id:r.id,name:r.name,isPublic:r.isPublic,peers:r.peers.size,max:MAX_PEERS,
    locked:r.locked,owner:r.peers.get(r.ownerId)?.name??"—",createdAt:r.createdAt,
    streaming:r.streaming};
}
function broadcastRooms(){io.emit("rooms:list",[...rooms.values()].filter(r=>r.isPublic).map(roomPub));}

function schedDel(rid){
  const r=rooms.get(rid);if(!r)return;
  if(r.deleteTimer)clearTimeout(r.deleteTimer);
  r.ownerLeftAt=Date.now();
  r.deleteTimer=setTimeout(()=>{
    if(!rooms.has(rid))return;
    io.to(rid).emit("room:deleted",{reason:"owner_timeout"});
    io.in(rid).socketsLeave(rid);rooms.delete(rid);broadcastRooms();
  },ROOM_TTL);
}
function cancelDel(rid){
  const r=rooms.get(rid);if(!r||!r.deleteTimer)return;
  clearTimeout(r.deleteTimer);r.deleteTimer=null;r.ownerLeftAt=null;
}

// ─── REST ─────────────────────────────────────────────────────────────────────
function restRL(max,win=60000){
  return(req,res,next)=>{
    const ip=req.headers["x-forwarded-for"]?.split(",")[0]?.trim()||req.socket.remoteAddress||"?";
    if(!rateOk(`rest:${ip}`,max,win))return res.status(429).json({error:"too many requests"});
    next();
  };
}
app.get("/api/rooms",restRL(30),(_,res)=>res.json([...rooms.values()].filter(r=>r.isPublic).map(roomPub)));
app.get("/api/slug", restRL(10),(_,res)=>res.json({slug:uniqueSlug()}));
app.get("/health",(_,res)=>{
  if(process.env.NODE_ENV==="production")return res.json({ok:true});
  res.json({ok:true,rooms:rooms.size,uptime:Math.floor(process.uptime())});
});
// NOTE: Don't catch /socket.io/ routes — let Socket.IO handle them
app.use((req,res)=>{
  if(req.path.startsWith("/socket.io"))return res.status(404).end();
  res.status(404).json({error:"not found"});
});

// ─── Socket ───────────────────────────────────────────────────────────────────
io.use((socket,next)=>{
  const ip=socket.handshake.headers["x-forwarded-for"]?.split(",")[0]?.trim()||socket.handshake.address||"?";
  socket._ip=ip;
  // Max 5 connections per IP
  let count=0;
  for(const[,s]of io.sockets.sockets)if(s._ip===ip)count++;
  if(count>=20)return next(new Error("too many connections"));
  next();
});

io.on("connection",(socket)=>{
  let roomId=null,myInfo=null;
  const chatOk  =()=>rateOk(`chat:${socket.id}`,20);
  const sigOk   =()=>rateOk(`sig:${socket.id}`,300);
  const knockOk =()=>rateOk(`knock:${socket._ip}`,10); // 10 knocks/min per IP

  socket.on("rooms:get",(_,cb)=>{if(cb)cb([...rooms.values()].filter(r=>r.isPublic).map(roomPub));});
  socket.on("slug:new",(_,cb)=>{if(cb)cb({slug:uniqueSlug()});});
  socket.on("slug:check",({slug},cb)=>{if(cb)cb({taken:rooms.has(slug)});});

  // ── knock ──
  socket.on("knock",({roomId:rid,name,avatar},cb)=>{
    if(typeof cb!=="function")return;
    const room=rooms.get(rid);
    // New room — no rate limit needed, just let them in
    if(!room)return cb({ok:true,action:"create"});
    // Existing room — apply rate limit
    if(!knockOk())return cb({ok:false,reason:"too many requests"});
    if(room.peers.size>=MAX_PEERS)return cb({ok:false,reason:"room_full"});
    if(room.locked)return cb({ok:false,reason:"room_locked"});
    if(room.isPublic)return cb({ok:true,action:"admitted"});
    if(!room.peers.has(room.ownerId))return cb({ok:true,action:"admitted"});
    const kid=socket.id;let res=false;
    const t=setTimeout(()=>{if(!res){res=true;room.knocks.delete(kid);cb({ok:false,reason:"timeout"});}},KNOCK_TO);
    room.knocks.set(kid,{
      name,avatar:avatar||"👤",
      admit(){if(res)return;res=true;clearTimeout(t);room.knocks.delete(kid);cb({ok:true,action:"admitted"});},
      deny() {if(res)return;res=true;clearTimeout(t);room.knocks.delete(kid);cb({ok:false,reason:"denied"});},
    });
    io.to(room.ownerId).emit("knock:incoming",{knockId:kid,name,avatar:avatar||"👤"});
  });

  socket.on("knock:answer",({knockId,admit})=>{
    if(typeof knockId!=="string")return;
    const room=rooms.get(roomId);if(!room||socket.id!==room.ownerId)return;
    const k=room.knocks.get(knockId);if(k)admit?k.admit():k.deny();
  });

  // ── join ──
  socket.on("join",({roomId:rid,roomName,name,avatar,isPublic},cb)=>{
    if(typeof cb!=="function")return;
    rid=san(rid,MAX_SLUG_LEN).toLowerCase()
      .replace(/[^a-z0-9\-]/g,"")   // strip anything non-alphanumeric/dash
      .replace(/\-+/g,"-")           // collapse multiple dashes
      .replace(/^\-+|\-+$/g,"");    // trim leading/trailing dashes
    roomName=san(roomName,60)||rid;
    name=san(name,32);avatar=san(avatar,10)||"👤";
    if(!rid||rid.length<4||!SLUG_RE.test(rid))return cb({error:"invalid_room_id"});
    if(!name)return cb({error:"invalid_name"});
    if(rooms.size>=MAX_ROOMS&&!rooms.has(rid))return cb({error:"server_full"});
    let room=rooms.get(rid);
    if(!room){
      room={id:rid,name:roomName,isPublic:isPublic!==false,ownerId:socket.id,
        peers:new Map(),knocks:new Map(),locked:false,
        createdAt:Date.now(),ownerLeftAt:null,deleteTimer:null,streaming:false};
      rooms.set(rid,room);
    }
    if(room.peers.size>=MAX_PEERS)return cb({error:"room_full"});
    if(socket.id===room.ownerId&&room.deleteTimer){cancelDel(rid);io.to(rid).emit("room:owner_returned");}
    roomId=rid;
    myInfo={id:socket.id,name,avatar,isOwner:socket.id===room.ownerId};
    room.peers.set(socket.id,myInfo);socket.join(rid);
    const ex=[...room.peers.values()].filter(p=>p.id!==socket.id);
    ex.forEach(p=>io.to(p.id).emit("peer:new",{peerId:socket.id,name,avatar}));
    cb({ok:true,iceServers:ICE,isOwner:socket.id===room.ownerId,
      roomName:room.name,isPublic:room.isPublic,streaming:room.streaming,
      existingPeers:ex.map(p=>({id:p.id,name:p.name,avatar:p.avatar,isOwner:p.isOwner}))});
    broadcastRooms();
  });

  // ── signal ──
  socket.on("signal",({to,payload})=>{
    if(!sigOk()||!roomId||typeof to!=="string"||to.length>30)return;
    const room=rooms.get(roomId);if(!room||!room.peers.has(to))return;
    io.to(to).emit("signal",{from:socket.id,payload});
  });

  // ── owner controls ──
  socket.on("owner:mute",({peerId,kind})=>{
    const room=rooms.get(roomId);if(!room||socket.id!==room.ownerId||!room.peers.has(peerId))return;
    if(!["audio","video","screen"].includes(kind))return;
    io.to(peerId).emit("force:mute",{kind,by:myInfo?.name});
    io.to(roomId).emit("peer:media",{peerId,kind,enabled:false});
  });
  socket.on("owner:kick",({peerId})=>{
    const room=rooms.get(roomId);if(!room||socket.id!==room.ownerId||!room.peers.has(peerId))return;
    if(peerId===socket.id)return;
    io.to(peerId).emit("force:kick",{by:myInfo?.name});
  });

  // ── owner: pin/spotlight ──
  socket.on("owner:pin",({peerId})=>{
    const room=rooms.get(roomId);if(!room||socket.id!==room.ownerId)return;
    if(peerId&&(typeof peerId!=="string"||peerId.length>30))return;
    io.to(roomId).emit("room:pin",{peerId:peerId||null,by:myInfo?.name});
  });

  // ── YouTube Live stream state broadcast ──
  socket.on("stream:start",({rtmpUrl})=>{
    const room=rooms.get(roomId);if(!room||socket.id!==room.ownerId)return;
    if(typeof rtmpUrl!=="string"||rtmpUrl.length>200)return;
    room.streaming=true;
    // Notify all peers that streaming has started (URL is NOT sent to peers for security)
    io.to(roomId).emit("room:streaming",{active:true,by:myInfo?.name});
    broadcastRooms();
  });
  socket.on("stream:stop",()=>{
    const room=rooms.get(roomId);if(!room||socket.id!==room.ownerId)return;
    room.streaming=false;
    io.to(roomId).emit("room:streaming",{active:false});
    broadcastRooms();
  });

  // ── media ──
  socket.on("media",(data)=>{
    if(!roomId||typeof data!=="object")return;
    const kind=["audio","video","screen"].includes(data.kind)?data.kind:null;
    const enabled=typeof data.enabled==="boolean"?data.enabled:null;
    if(!kind||enabled===null)return;
    socket.to(roomId).emit("peer:media",{peerId:socket.id,kind,enabled});
  });

  // ── chat ──
  socket.on("chat",({text})=>{
    if(!roomId||!chatOk()||typeof text!=="string"||!text.trim())return;
    const safe=san(text,500);if(!safe)return;
    io.to(roomId).emit("chat",{id:crypto.randomUUID(),from:socket.id,
      name:myInfo?.name??"?",avatar:myInfo?.avatar??"👤",text:safe,ts:Date.now()});
  });

  // ── room lock ──
  socket.on("room:lock",({locked})=>{
    const room=rooms.get(roomId);
    if(!room||socket.id!==room.ownerId||typeof locked!=="boolean")return;
    room.locked=locked;io.to(roomId).emit("room:locked",{locked});broadcastRooms();
  });

  // ── close room ──
  socket.on("room:close",()=>{
    const room=rooms.get(roomId);if(!room||socket.id!==room.ownerId)return;
    io.to(roomId).emit("room:deleted",{reason:"owner_closed"});
    io.in(roomId).socketsLeave(roomId);
    if(room.deleteTimer)clearTimeout(room.deleteTimer);
    rooms.delete(roomId);broadcastRooms();
  });

  // ── disconnect ──
  socket.on("disconnect",()=>{
    if(!roomId)return;
    const room=rooms.get(roomId);if(!room)return;
    room.peers.delete(socket.id);
    socket.to(roomId).emit("peer:left",{peerId:socket.id});
    if(socket.id===room.ownerId){
      if(room.peers.size>0){
        room.ownerId=[...room.peers.keys()][0];
        const no=room.peers.get(room.ownerId);if(no)no.isOwner=true;
        io.to(room.ownerId).emit("you:owner");
        io.to(roomId).emit("owner:changed",{ownerId:room.ownerId,name:no?.name});
      }else{schedDel(roomId);}
    }else if(room.peers.size===0){schedDel(roomId);}
    broadcastRooms();
  });
});

// ─── Maintenance ──────────────────────────────────────────────────────────────
setInterval(()=>{
  const now=Date.now();let c=0;
  rooms.forEach((room,rid)=>{
    if(room.ownerLeftAt&&(now-room.ownerLeftAt)>ROOM_TTL+120000){
      if(room.deleteTimer)clearTimeout(room.deleteTimer);
      io.to(rid).emit("room:deleted",{reason:"owner_timeout"});
      io.in(rid).socketsLeave(rid);rooms.delete(rid);c++;
    }
  });
  if(c)broadcastRooms();
  console.log(`[mulle] rooms:${rooms.size} uptime:${Math.floor(process.uptime()/3600)}h`);
},60*60*1000);

process.on("uncaughtException", e=>console.error("[uncaughtException]",e.message));
process.on("unhandledRejection",e=>console.error("[unhandledRejection]",e));

server.listen(PORT,()=>{
  console.log(`\n🚀 Mulle WebRTC v3.0`);
  console.log(`   Port: ${PORT} | Mode: ${process.env.NODE_ENV||"dev"}\n`);
});
