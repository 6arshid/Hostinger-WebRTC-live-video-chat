"use strict";
// ═══════════════════════════════════════════════════════════════
//  MULLE CLIENT v3
// ═══════════════════════════════════════════════════════════════
const L = () => window.LANGS[window.currentLang];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const fmtT = ts => new Date(ts).toLocaleTimeString(window.currentLang==="fa"?"fa-IR":"en-US",{hour:"2-digit",minute:"2-digit"});

// ─── State ────────────────────────────────────────────────────────────────────
let socket, myId, myName, myRoom, myRoomName, amOwner=false, isPublic=true;
let localStream=null, screenStream=null;
let micOn=true, camOn=true, screenOn=false;
let currentFacingMode="user"; // "user"=front, "environment"=back
let currentQuality="720p";    // default quality
let lobbyMicOn=true, lobbyCamOn=true;
const peers=new Map(); // pid→{pc,name,avatar,isOwner,iceBuf:[]}
let pendingKnock=null;

// Virtual background (MediaPipe)
let curBg='none', bgImg=null, bgAnimId=null;
let bgCanvas=null, bgCtx=null, bgMask=null, bgMaskCtx=null;
let seg=null, segReady=false, segLoading=false, segResults=null, segSkip=0;

// Pin / Spotlight
let pinnedPeerId = null;   // null = no pin, else peerId or 'local'

// Recording
let recorder=null, recChunks=[], recBlob=null, recording=false;

// YouTube Live
let ytStreaming=false, ytKey='';
// YouTube via canvas → MediaRecorder → WHIP/RTMP
// Browser can't directly push RTMP; we use canvas stream + MediaRecorder for local canvas preview
// and guide user to use OBS with the stream key. However we DO support
// capturing the canvas stream and exposing it via a local stream that ffmpeg (if available) can pick up.
// For pure browser: we output a canvas stream and show the user what's being streamed.
let ytCanvas=null, ytDrawId=null, ytMediaRecorder=null, ytBlobs=[];

// ─── UTILS ───────────────────────────────────────────────────────────────────
let _tt;
function toast(msg,dur=3000){const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(_tt);_tt=setTimeout(()=>el.classList.remove("show"),dur);}
function setConn(on,msg){
  const el=$("connScreen");
  if(!el)return;
  if(on){
    el.classList.remove("h");
    if(msg)$("connMsg").textContent=msg;
  }else{
    el.classList.add("h");
  }
}
function openModal(id){$(id).classList.remove("h");}
function closeModal(id){$(id).classList.add("h");}
function goHome(){closeModal("deletedModal");location.href=location.pathname;}
function toggleFaq(el){const open=el.classList.contains("open");document.querySelectorAll(".faq-item.open").forEach(x=>x.classList.remove("open"));if(!open)el.classList.add("open");}
function inviteURL(rid){return location.origin+location.pathname+"?room="+encodeURIComponent(rid);}
function roomFromURL(){const p=new URLSearchParams(location.search);return p.get("room")||location.hash.replace("#","")||null;}
function roomFromInput(v){
  let rid="";
  try{const u=new URL(v);rid=u.searchParams.get("room")||"";}
  catch{rid=v.trim();}
  // Clean: lowercase, only alphanumeric+dash, collapse dashes, trim dashes
  return rid.toLowerCase()
    .replace(/[^a-z0-9\-]/g,"")
    .replace(/\-+/g,"-")
    .replace(/^\-+|\-+$/g,"");
}

// ─── HOME — ROOM LIST ────────────────────────────────────────────────────────
function renderRooms(list){
  const el=$("roomsList"); if(!el)return;
  if(!list.length){el.innerHTML=`<div class="empty"><span class="emo">🌐</span><span>${L().noRooms}</span></div>`;return;}
  el.innerHTML=list.map(r=>{
    const full=r.peers>=r.max,locked=r.locked;
    const ago=Math.floor((Date.now()-r.createdAt)/60000);
    const agoS=ago<1?L().agoNow:(typeof L().agoMin==="function"?L().agoMin(ago):`${ago}m`);
    const cls=full?"full":locked?"locked":"";
    return `<div class="rc ${cls}" onclick="clickRoom('${r.id}','${esc(r.name)}',${full||locked})">
      <div class="rc-ic">${r.streaming?"📺":locked?"🔒":"📹"}</div>
      <div class="rc-bd">
        <div class="rc-nm">${esc(r.name)}</div>
        <div class="rc-meta">
          <span>👑 ${esc(r.owner)}</span>
          <span>👥 ${r.peers}/${r.max}</span>
          <span class="tag tag-pub">${L().public}</span>
          <span class="tag ${full?"tag-full":locked?"tag-lock":"tag-open"}">${full?L().full:locked?L().locked:L().open}</span>
          ${r.streaming?`<span class="tag tag-live">${L().streamingLive}</span>`:''}
          <span>${agoS}</span>
        </div>
      </div>
      <button class="btn ${full||locked?"btn-g":"btn-p"}" style="font-size:.73rem;padding:6px 12px;flex-shrink:0"
        ${full?"disabled":""} onclick="event.stopPropagation();clickRoom('${r.id}','${esc(r.name)}',${full||locked})">
        ${full?L().fullBtn:locked?"🔒":L().joinBtn2}
      </button>
    </div>`;
  }).join("");
}
function clickRoom(rid,rname,blocked){if(blocked)return toast(L().roomFull);$("jRoom").value=rid;openJoin();}

// ─── OVERLAYS ─────────────────────────────────────────────────────────────────
function closeOv(id){$(id).classList.add("h");}
async function openCreate(){$("ovCreate").classList.remove("h");startPreview();$("cName").focus();if(!$("cSlug").value)await genSlug();}
function openJoin(){$("ovJoin").classList.remove("h");$("jName").focus();}
function openBgModal(){openModal("bgModal");}
function openYtModal(){openModal("ytModal");updateYtUI();}

// ─── LOBBY PREVIEW ────────────────────────────────────────────────────────────
async function startPreview(){
  if($("lobbyVid").srcObject)return;
  try{
    const s=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    $("lobbyVid").srcObject=new MediaStream(s.getVideoTracks());
    $("pvOff").classList.add("h");
    if(!localStream)localStream=s;
  }catch{toast(L().mediaError);}
}
function toggleLobbyMic(){
  lobbyMicOn=!lobbyMicOn;
  localStream?.getAudioTracks().forEach(t=>t.enabled=lobbyMicOn);
  $("lMicBtn").className="pill"+(lobbyMicOn?"":" off");
  $("lMicBtn").innerHTML=`${lobbyMicOn?"🎙️":"🚫"} <span data-i="mic">${L().mic}</span>`;
}
function toggleLobbyCam(){
  lobbyCamOn=!lobbyCamOn;
  localStream?.getVideoTracks().forEach(t=>t.enabled=lobbyCamOn);
  $("lCamBtn").className="pill"+(lobbyCamOn?"":" off");
  $("lCamBtn").innerHTML=`${lobbyCamOn?"📷":"🚫"} <span data-i="cam">${L().cam}</span>`;
  $("pvOff").classList.toggle("h",lobbyCamOn);
}

// ─── VISIBILITY ───────────────────────────────────────────────────────────────
function setVis(v){
  isPublic=v==="public";
  $("vPub").className="vis-btn"+(isPublic?" pub-on":"");
  $("vPrv").className="vis-btn"+(isPublic?"":" prv-on");
  $("visHint").textContent=isPublic?L().hintPublic:L().hintPrivate;
}

// ─── SLUG ─────────────────────────────────────────────────────────────────────
let _slugT=null, slugOk=false;
async function genSlug(){
  try{const r=await fetch("/api/slug").then(r=>r.json());$("cSlug").value=r.slug;refreshLink();setSlugOk();slugOk=true;}
  catch{
    const a=["swift","brave","calm","epic","jade"],b=["falcon","river","stone","bloom","nova"];
    const s=`${a[Math.floor(Math.random()*a.length)]}-${b[Math.floor(Math.random()*b.length)]}-${Math.floor(Math.random()*9000)+1000}`;
    $("cSlug").value=s;refreshLink();setSlugOk();slugOk=true;
  }
}
function onSlugInput(){
  // Clean while typing (allow trailing dash while typing, but check on blur)
  let v=$("cSlug").value.toLowerCase().replace(/[^a-z0-9\-]/g,"").replace(/\-+/g,"-");
  $("cSlug").value=v;refreshLink();slugOk=false;setSlugErr("");
  clearTimeout(_slugT);
  if(!v){setSlugErr(L().slugEmpty);return;}
  if(v.length<4){setSlugErr(L().slugShort);return;}
  _slugT=setTimeout(()=>{
    socket?.emit("slug:check",{slug:v},(r)=>r.taken?setSlugErr(L().slugTaken):(setSlugOk(),slugOk=true));
    if(!socket){setSlugOk();slugOk=true;}
  },500);
}
function setSlugErr(m){$("slugErr").textContent=m;$("slugErr").style.color="var(--red)";}
function setSlugOk(){$("slugErr").textContent=L().slugFree;$("slugErr").style.color="var(--green)";}
function refreshLink(){const id=$("cSlug").value.trim();$("cLink").value=id?inviteURL(id):"";}
function cpLink(){
  const v=$("cLink").value;if(!v)return;
  navigator.clipboard.writeText(v).then(()=>{
    const b=$("cCpBtn");b.textContent=L().copied;b.className="lr-cp ok";
    setTimeout(()=>{b.innerHTML=`<span>${L().copy}</span>`;b.className="lr-cp";},2000);
  });
}

// ─── CREATE / JOIN ────────────────────────────────────────────────────────────
async function doCreate(){
  const name=$("cName").value.trim();
  const rname=$("cRoomName").value.trim()||"New Room";
  let slug=$("cSlug").value.trim().toLowerCase().replace(/[^a-z0-9\-]/g,"").replace(/\-+/g,"-").replace(/^\-|\-$/g,"");
  if(!name)return toast(L().needName);
  // Auto-fix slug if invalid
  if(!slug||slug.length<4){
    await genSlug();
    slug=$("cSlug").value.trim();
  }
  if(!slug||slug.length<4)return toast(L().needSlug);
  closeOv("ovCreate");
  await beginJoin(name,slug,rname,isPublic);
}
async function doJoin(){
  const name=$("jName").value.trim();
  const rid=roomFromInput($("jRoom").value.trim());
  if(!name)return toast(L().needName);
  if(!rid)return toast(L().needRoom);
  closeOv("ovJoin");
  await beginJoin(name,rid);
}
async function beginJoin(name,roomId,roomName,pub){
  // Final cleanup of roomId
  roomId=roomId.toLowerCase().replace(/[^a-z0-9\-]/g,"").replace(/\-+/g,"-").replace(/^\-+|\-+$/g,"");
  if(!roomId||roomId.length<4){toast(L().needSlug);return;}
  myName=name;myRoom=roomId;myRoomName=roomName||roomId;
  micOn=lobbyMicOn;camOn=lobbyCamOn;

  // Stop any existing stream first
  if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}

  // Acquire media — try video+audio, fallback to audio-only, fallback to silent
  // iOS Safari: must request in response to user gesture, with explicit constraints
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
  const isSafari=/^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const videoConstraints=isIOS
    ?{facingMode:"user"}  // iOS needs simple constraints
    :{width:{ideal:1280},height:{ideal:720},facingMode:"user"};
  try{
    localStream=await navigator.mediaDevices.getUserMedia({
      audio:true,
      video:videoConstraints,
    });
  }catch(e1){
    console.warn("[media] video+audio failed:",e1.message);
    try{localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});}
    catch(e2){
      console.warn("[media] audio-only failed:",e2.message);
      // Prompt user on iOS Safari to grant permission
      if(isIOS||isSafari){
        toast("⚠️ لطفاً در تنظیمات Safari دسترسی دوربین و میکروفون را فعال کنید",6000);
      }else{
        toast("⚠️ دسترسی به میدیا محدود است");
      }
      const ctx=new AudioContext();
      const dest=ctx.createMediaStreamDestination();
      localStream=dest.stream;
    }
  }

  localStream.getAudioTracks().forEach(t=>t.enabled=micOn);
  localStream.getVideoTracks().forEach(t=>t.enabled=camOn);

  // Show flip button if device has multiple cameras
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const videoCams=devices.filter(d=>d.kind==="videoinput");
    if(videoCams.length>1){
      const fb=$("flipBtn");if(fb)fb.style.display="";
      // also show on local tile
      const localTile=document.getElementById("t-local");
      if(localTile&&localTile._tileFlipBtn) localTile._tileFlipBtn.style.display="";
    }
  }catch(e){}

  // Update URL
  history.replaceState({},"",inviteURL(roomId));

  // IMMEDIATELY hide home and show full-screen connecting state
  $("home").style.display="none";
  ["ovCreate","ovJoin"].forEach(id=>{const el=$(id);if(el)el.classList.add("h");});
  setConn(true,L().connMsg);

  // Start socket
  setTimeout(()=>initSocket(pub),80);
}

// ─── SOCKET ───────────────────────────────────────────────────────────────────
function initSocket(pub){
  // Prevent double init
  if(socket){socket.disconnect();socket=null;}

  socket=io(location.origin,{
    path:"/socket.io/",
    transports:["websocket","polling"],
    reconnectionDelay:1000,
    reconnectionDelayMax:5000,
    timeout:20000,
    reconnectionAttempts:5,
  });

  socket.on("rooms:list",renderRooms);

  let connectErrCount=0;
  socket.on("connect_error",(err)=>{
    connectErrCount++;
    console.error("[socket] connect_error:",err.message,"attempt:",connectErrCount);
    setConn(true, `در حال اتصال مجدد… (${connectErrCount})`);
    if(connectErrCount>=5){
      setConn(false);showHome();
      toast("❌ اتصال به سرور ممکن نبود — دوباره تلاش کنید",5000);
    }
  });

  socket.on("connect",()=>{
    myId=socket.id;
    console.log("[socket] connected:",myId);
    setConn(true,L().connKnock);

    // Knock timeout
    const knockTimeout=setTimeout(()=>{
      setConn(false);showHome();
      toast("❌ اتصال به سرور ممکن نبود — دوباره تلاش کنید",5000);
    },15000);

    socket.emit("knock",{roomId:myRoom,name:myName,avatar:"👤"},res=>{
      clearTimeout(knockTimeout);
      if(!res||!res.ok){
        setConn(false);showHome();
        const reasons={
          room_full: L().roomFull,
          room_locked: L().roomLocked, 
          denied: L().denied,
          timeout: L().timeout,
          "too many requests": "تعداد درخواست‌ها زیاد است — چند ثانیه صبر کنید",
          too_many_requests: "تعداد درخواست‌ها زیاد است — چند ثانیه صبر کنید",
        };
        toast("❌ "+(reasons[res?.reason]||res?.reason||"خطا"),5000);
        return;
      }
      setConn(true,L().connJoin);
      // Timeout if server doesn't respond
      const joinTimeout=setTimeout(()=>{
        setConn(false);showHome();
        toast("❌ سرور پاسخ نداد — دوباره تلاش کنید",5000);
      },12000);

      // Sanitize roomName before sending (remove non-ASCII that server might reject)
      const safeRoomName=(myRoomName||myRoom).replace(/[<>"'`]/g,"").trim().slice(0,60)||"Room";

      console.log("[join] sending:",{roomId:myRoom,roomName:safeRoomName,name:myName});

      socket.emit("join",{
        roomId:myRoom,
        roomName:safeRoomName,
        name:myName,
        avatar:"👤",
        isPublic:pub!==false
      },res2=>{
        clearTimeout(joinTimeout);
        console.log("[join] callback:",res2);
        if(!res2||res2.error){
          setConn(false);showHome();
          const errMap={
            invalid_room_id:"شناسه اتاق نامعتبر است",
            invalid_name:"نام نامعتبر است",
            room_full:L().roomFull,
            server_full:"سرور پر است",
          };
          toast("❌ "+(errMap[res2?.error]||res2?.error||"خطا در ورود"),5000);
          return;
        }
        if(res2.iceServers&&res2.iceServers.length)ICE_CFG.splice(0,ICE_CFG.length,...res2.iceServers);
        onJoined(res2);
      });
    });
  });

  socket.on("peer:new",({peerId,name,avatar})=>{
    sysMsg(`${name} ${window.currentLang==="fa"?"وارد شد":"joined"}`);
    addPeerTile(peerId,name,avatar,false);
    createPC(peerId,name,avatar,false,true);
    updatePartList();
  });
  socket.on("peer:left",({peerId})=>{
    const e=peers.get(peerId);
    sysMsg(`${e?.name||"?"} ${window.currentLang==="fa"?"خارج شد":"left"}`);
    closePeer(peerId);updatePartList();
  });
  socket.on("signal",async({from,payload})=>await handleSignal(from,payload));
  socket.on("peer:media",({peerId,kind,enabled})=>updatePeerMedia(peerId,kind,enabled));
  socket.on("chat",appendMsg);

  socket.on("force:mute",({kind,by})=>{
    toast(L().toastMuted(by));
    if(kind==="audio"&&micOn){micOn=true;toggleMic();}
    else if(kind==="video"&&camOn){camOn=true;toggleCam();}
    else if(kind==="screen")stopScreen();
  });
  socket.on("force:kick",({by})=>{
    $("deletedMsg").textContent=L().toastKicked(by);
    openModal("deletedModal");doLeave(false);
  });
  socket.on("knock:incoming",({knockId,name,avatar})=>{
    pendingKnock=knockId;$("knName").textContent=name;$("knAv").textContent=avatar;
    $("knockNotif").classList.remove("h");
  });
  socket.on("you:owner",()=>{amOwner=true;setOwnerUI(true);toast(L().toastOwner);updatePartList();});
  socket.on("owner:changed",({name})=>toast(L().youOwnerNow(name)));
  socket.on("room:locked",({locked})=>toast(locked?"🔒 "+L().roomLocked:"🔓"));
  socket.on("room:pin",({peerId})=>{
    applyPin(peerId||null);
    // If we became owner after a pin was set, show pin buttons
    if(amOwner) document.querySelectorAll(".pin-btn").forEach(b=>b.classList.add("visible"));
  });

  socket.on("room:streaming",({active,by})=>{
    $("livebadge").classList.toggle("on",active);
    if(active)sysMsg(`📺 ${by} ${window.currentLang==="fa"?"شروع به پخش زنده کرد":"started YouTube Live"}`);
  });
  socket.on("room:deleted",({reason})=>{
    const m={owner_timeout:window.currentLang==="fa"?"owner ترک کرد — اتاق حذف شد":"Owner left — room deleted",
      owner_closed:window.currentLang==="fa"?"owner اتاق را بست":"Owner closed the room"};
    $("deletedMsg").textContent=m[reason]||reason;openModal("deletedModal");doLeave(false);
  });
  // Long session reconnect
  socket.on("disconnect",reason=>{
    if(["transport close","ping timeout","transport error"].includes(reason))toast(L().toastDisconnected+" — "+L().connMsg,5000);
    else toast(L().toastDisconnected);
  });
  socket.io.on("reconnect",()=>toast(L().toastReconnected));
  socket.io.on("reconnect_attempt",n=>{if(n>2)toast("🔄 "+L().connMsg);});
}

function onJoined({isOwner,roomName,existingPeers}){
  amOwner=isOwner;
  myRoomName=roomName||myRoomName;

  // Show room UI first
  showMeet();

  // Use requestAnimationFrame to ensure DOM is painted before adding tiles
  requestAnimationFrame(()=>{
    addLocalTile();
    existingPeers.forEach(p=>{
      addPeerTile(p.id,p.name,p.avatar,p.isOwner);
      createPC(p.id,p.name,p.avatar,p.isOwner,false);
    });
    updatePartList();
    if(curBg!=="none")loadSeg().then(()=>startBgLoop());
    console.log("[mulle] Room ready — peers:",existingPeers.length);
  });
}

// ─── WebRTC ───────────────────────────────────────────────────────────────────
let ICE_CFG=[
  {urls:"stun:stun.l.google.com:19302"},
  {urls:"stun:stun1.l.google.com:19302"},
  {urls:"stun:stun2.l.google.com:19302"},
  {urls:"turn:openrelay.metered.ca:80",username:"openrelayproject",credential:"openrelayproject"},
  {urls:"turn:openrelay.metered.ca:443",username:"openrelayproject",credential:"openrelayproject"},
  {urls:"turns:openrelay.metered.ca:443",username:"openrelayproject",credential:"openrelayproject"},
  {urls:"turn:openrelay.metered.ca:443?transport=tcp",username:"openrelayproject",credential:"openrelayproject"},
];

function createPC(pid,name,avatar,isOwner,iOffer){
  if(peers.has(pid))return peers.get(pid).pc;
  const pc=new RTCPeerConnection({
    iceServers:ICE_CFG,
    bundlePolicy:"max-bundle",
    iceTransportPolicy:"all",
  });
  peers.set(pid,{pc,name,avatar,isOwner,iceBuf:[]});
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  if(screenStream)screenStream.getTracks().forEach(t=>pc.addTrack(t,screenStream));

  pc.onicecandidate=({candidate})=>{
    if(candidate)socket.emit("signal",{to:pid,payload:{type:"candidate",candidate}});
  };
  pc.onicecandidateerror=(e)=>{
    if(e.errorCode!==701)console.warn("[ICE error]",e.errorCode,e.errorText,e.url);
  };
  pc.oniceconnectionstatechange=()=>{
    const st=pc.iceConnectionState;
    console.log(`[ICE ${pid.slice(0,6)}]`,st);
    if(st==="failed"){
      console.warn("[ICE] failed — restarting");
      if(iOffer){pc.restartIce();doOffer(pid);}
      else pc.restartIce();
    }
    if(st==="disconnected"){
      // give it 5s to recover before restart
      setTimeout(()=>{if(pc.iceConnectionState==="disconnected"){pc.restartIce();}},5000);
    }
  };
  pc.onconnectionstatechange=()=>{
    console.log(`[PC ${pid.slice(0,6)}]`,pc.connectionState);
  };
  pc.ontrack=({track,streams})=>{
    const tile=document.getElementById(`t-${pid}`);if(!tile)return;
    const vid=tile.querySelector("video");
    // Use streams[0] if available, otherwise build manually
    if(streams&&streams[0]){
      if(vid.srcObject!==streams[0])vid.srcObject=streams[0];
    }else{
      if(!vid.srcObject)vid.srcObject=new MediaStream();
      vid.srcObject.addTrack(track);
    }
    vid.play().catch(()=>{});
    if(track.kind==="video"){
      tile.querySelector(".tile-av")?.classList.add("h");
      // ensure video plays when it becomes active
      track.onunmute=()=>{vid.play().catch(()=>{});tile.querySelector(".tile-av")?.classList.add("h");};
    }
  };
  if(iOffer)setTimeout(()=>doOffer(pid),150);
  return pc;
}
async function doOffer(pid){
  const e=peers.get(pid);if(!e)return;
  try{
    const o=await e.pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});
    await e.pc.setLocalDescription(o);
    socket.emit("signal",{to:pid,payload:{type:"offer",sdp:e.pc.localDescription}});
  }catch(err){console.error("doOffer:",err);}
}
async function handleSignal(from,payload){
  if(!peers.has(from)&&payload.type==="offer"){addPeerTile(from,"?","👤",false);createPC(from,"?","👤",false,false);}
  const e=peers.get(from);if(!e)return;const{pc}=e;
  try{
    if(payload.type==="offer"){
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      for(const c of e.iceBuf)await pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});e.iceBuf=[];
      const a=await pc.createAnswer();await pc.setLocalDescription(a);
      socket.emit("signal",{to:from,payload:{type:"answer",sdp:pc.localDescription}});
    }else if(payload.type==="answer"){
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      for(const c of e.iceBuf)await pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});e.iceBuf=[];
    }else if(payload.type==="candidate"){
      if(pc.remoteDescription)await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(()=>{});
      else e.iceBuf.push(payload.candidate);
    }
  }catch(err){console.error("handleSignal:",err);}
}
function closePeer(pid){
  const e=peers.get(pid);if(e){try{e.pc.close();}catch{}peers.delete(pid);}
  // If this peer was pinned, unpin
  if(pinnedPeerId===pid){applyPin(null);if(amOwner)socket?.emit("owner:pin",{peerId:null});}
  document.getElementById(`t-${pid}`)?.remove();document.getElementById(`ts-${pid}`)?.remove();updateGrid();}
function updatePeerMedia(pid,kind,enabled){
  const t=document.getElementById(`t-${pid}`);if(!t)return;
  if(kind==="audio"){const ic=t.querySelector(".mic-ic");if(ic){ic.className=`ti mic-ic${enabled?"":" muted"}`;ic.textContent=enabled?"🎙️":"🚫";}}
  else if(kind==="video")t.querySelector(".tile-av")?.classList.toggle("h",enabled);
  else if(kind==="screen"&&!enabled){document.getElementById(`ts-${pid}`)?.remove();updateGrid();}
}

// ─── TILES ────────────────────────────────────────────────────────────────────
function addLocalTile(){
  const tile=mkTile("local",myName+(window.currentLang==="fa"?" (شما)":" (You)"),"👤",true,false,amOwner);
  tile.classList.add("me");
  const vid=tile.querySelector("video");
  vid.srcObject=new MediaStream(localStream.getTracks());vid.muted=true;vid.autoplay=true;vid.playsInline=true;
  if(!camOn)tile.querySelector(".tile-av")?.classList.remove("h");
  const mic=tile.querySelector(".mic-ic");if(mic&&!micOn){mic.className="ti mic-ic muted";mic.textContent="🚫";}
  $("grid").appendChild(tile);updateGrid();
}
function addPeerTile(pid,name,avatar,isOwner){if(document.getElementById(`t-${pid}`))return;$("grid").appendChild(mkTile(pid,name,avatar,false,false,isOwner));updateGrid();}
function mkTile(id,name,avatar,isLocal,isScr,isOwner=false){
  const d=document.createElement("div");d.className="tile"+(isScr?" scr":"");d.id=`t-${id}`;
  const v=document.createElement("video");v.autoplay=true;v.playsInline=true;if(isLocal)v.muted=true;
  const av=document.createElement("div");av.className="tile-av"+(isLocal&&camOn?" h":"");av.innerHTML=`${avatar}<p>${esc(name)}</p>`;
  const nm=document.createElement("div");nm.className="tile-nm";nm.innerHTML=(isOwner?"<span>👑</span>":"")+esc(name);
  const ics=document.createElement("div");ics.className="tile-ics";if(!isScr)ics.innerHTML=`<div class="ti mic-ic">🎙️</div>`;
  const pip=document.createElement("button");pip.className="pip-btn";pip.textContent="⧉";pip.onclick=()=>openPiP(v);

  // Watch / Hide button — lets any user hide/show a peer's video locally
  const watchBtn=document.createElement("button");
  watchBtn.className="watch-btn";
  if(isLocal)watchBtn.style.display="none"; // don't show for own tile
  watchBtn.title=window.currentLang==="fa"?"مشاهده / پنهان کردن ویدیو":"Watch / Hide video";
  watchBtn.innerHTML="👁";
  let vidHidden=false;
  watchBtn.onclick=(e)=>{
    e.stopPropagation();
    vidHidden=!vidHidden;
    v.style.visibility=vidHidden?"hidden":"";
    // also hide/show the video element itself so layout stays intact
    v.style.opacity=vidHidden?"0":"";
    av.style.display=vidHidden?"flex":"";
    if(vidHidden){av.classList.remove("h");}else{if(v.srcObject&&v.srcObject.getVideoTracks().some(t=>t.enabled))av.classList.add("h");}
    watchBtn.innerHTML=vidHidden?"🚫👁":"👁";
    watchBtn.title=vidHidden
      ?(window.currentLang==="fa"?"نمایش ویدیو":"Show video")
      :(window.currentLang==="fa"?"پنهان کردن ویدیو":"Hide video");
    watchBtn.classList.toggle("hidden-active",vidHidden);
  };

  // Pin button — only shown to owner, but rendered for all (hidden via CSS unless owner)
  const pinB=document.createElement("button");
  pinB.className="pin-btn"+(id==="local"?" visible":"");
  pinB.title=window.currentLang==="fa"?"پین کردن / حذف پین":"Pin / Unpin";
  pinB.textContent="📌";
  pinB.setAttribute("data-tid",id);
  pinB.onclick=(e)=>{e.stopPropagation();togglePin(id);};

  // ── LOCAL-ONLY: camera flip + quality controls ──
  // Always-visible container at top-center of local tile
  const localControls = document.createElement("div");
  localControls.className = "tile-local-controls";

  // Flip button
  const tileFlipBtn = document.createElement("button");
  tileFlipBtn.className = "tile-local-btn tile-flip-btn";
  tileFlipBtn.title = window.currentLang === "fa" ? "تغییر دوربین جلو/عقب" : "Switch camera";
  tileFlipBtn.innerHTML = currentFacingMode === "user" ? "🤳" : "📷";
  tileFlipBtn.onclick = async (e) => {
    e.stopPropagation();
    await switchCamera();
    tileFlipBtn.innerHTML = currentFacingMode === "user" ? "🤳" : "📷";
  };

  // Quality button
  const tileQualBtn = document.createElement("button");
  tileQualBtn.className = "tile-local-btn tile-qual-btn";
  tileQualBtn.title = window.currentLang === "fa" ? "کیفیت تصویر" : "Video quality";
  tileQualBtn.innerHTML = `<span class="qual-label">${currentQuality}</span>`;

  // Quality popup
  const qualMenu = document.createElement("div");
  qualMenu.className = "qual-menu h";
  const qualities = [{label:"480p",w:854,h:480},{label:"720p",w:1280,h:720},{label:"1080p",w:1920,h:1080},{label:"4K",w:3840,h:2160}];
  qualities.forEach(q => {
    const item = document.createElement("button");
    item.className = "qual-item" + (currentQuality === q.label ? " active" : "");
    item.textContent = q.label;
    item.onclick = async (e) => {
      e.stopPropagation();
      qualMenu.classList.add("h");
      await setVideoQuality(q.w, q.h, q.label);
      qualMenu.querySelectorAll(".qual-item").forEach(x => x.classList.toggle("active", x.textContent === q.label));
      const ql = tileQualBtn.querySelector(".qual-label");
      if (ql) ql.textContent = q.label;
    };
    qualMenu.appendChild(item);
  });
  tileQualBtn.onclick = (e) => { e.stopPropagation(); qualMenu.classList.toggle("h"); };
  document.addEventListener("click", () => qualMenu.classList.add("h"), {capture: false});

  localControls.append(tileFlipBtn, tileQualBtn);

  localControls.append(tileFlipBtn,tileQualBtn);

  if(isLocal){
    d.append(v, av, nm, ics, pip, watchBtn, pinB, localControls, qualMenu);
    // expose flip btn so camera enumeration can show it
    d._tileFlipBtn=tileFlipBtn; d._localControls=localControls;
  } else {
    d.append(v,av,nm,ics,pip,watchBtn,pinB);
  }
  return d;
}
function updateGrid(){
  const g=$("grid");

  // Step 1 — collect all .tile elements from anywhere inside #grid
  // Use a temp holder so we can safely move them around
  const holder=document.createElement("div");
  [...g.querySelectorAll(".tile")].forEach(t=>holder.appendChild(t));

  const tiles=[...holder.children];
  const total=tiles.length;
  $("cnt").textContent=total;

  // Step 2 — clear grid completely (no innerHTML — just remove non-tile children)
  [...g.children].forEach(c=>g.removeChild(c));

  if(pinnedPeerId){
    // ── SPOTLIGHT ──
    g.className="spotlight";

    const pinnedEl=document.getElementById(`t-${pinnedPeerId}`);

    // Put pinned tile first
    if(pinnedEl){
      pinnedEl.classList.add("tile-pinned");
      g.appendChild(pinnedEl);
    }

    // Put remaining tiles in horizontal strip
    const others=tiles.filter(t=>t!==pinnedEl);
    if(others.length>0){
      const strip=document.createElement("div");
      strip.className="tiles-strip";
      others.forEach(t=>{t.classList.remove("tile-pinned");strip.appendChild(t);});
      g.appendChild(strip);
    }

  }else{
    // ── NORMAL GRID ──
    tiles.forEach(t=>{t.classList.remove("tile-pinned");t.classList.remove("self-pip");g.appendChild(t);});
    const baseClass=`n${Math.min(total,10)}`;
    // 2-person: WhatsApp/Meet style — remote full-screen, local small overlay
    if(total===2){
      const localTile=document.getElementById("t-local");
      if(localTile){
        // Move local tile last so it renders on top
        g.appendChild(localTile);
        localTile.classList.add("self-pip");
      }
      g.className=baseClass+" n2-pip";
    }else{
      g.className=baseClass;
    }
  }
}
function updateTileOwner(oid){peers.forEach((e,pid)=>{const t=document.getElementById(`t-${pid}`);if(!t)return;const nm=t.querySelector(".tile-nm");if(!nm)return;nm.innerHTML=(pid===oid?"<span>👑</span>":"")+esc(e.name);e.isOwner=pid===oid;});}

// ─── PIN / SPOTLIGHT ─────────────────────────────────────────────────────────
function togglePin(tileId){
  // tileId is like "local", "abc123", "local-screen"
  if(!amOwner) return; // only owner can pin

  const newPin = (pinnedPeerId === tileId) ? null : tileId;
  applyPin(newPin);

  // Broadcast to all peers
  socket?.emit("owner:pin", {peerId: newPin});
}

function applyPin(tileId){
  pinnedPeerId = tileId;

  // Update all pin button states
  document.querySelectorAll(".pin-btn").forEach(btn=>{
    const tid = btn.getAttribute("data-tid");
    btn.classList.toggle("pinned-ic", tid === tileId);
    btn.textContent = (tid === tileId) ? "📍" : "📌";
    // Show pin buttons only to owner
    if(amOwner) btn.classList.add("visible");
  });

  updateGrid();
}

// ─── PiP ─────────────────────────────────────────────────────────────────────
async function openPiP(vid){
  try{
    if(document.pictureInPictureEnabled){
      if(document.pictureInPictureElement===vid)await document.exitPictureInPicture();
      else await vid.requestPictureInPicture();
    }
  }catch(e){toast("PiP: "+e.message);}
}

// ─── PARTICIPANTS ─────────────────────────────────────────────────────────────
function updatePartList(){
  if(!amOwner)return;const list=$("partList");if(!list)return;list.innerHTML="";
  const me=document.createElement("div");me.className="part-item";
  me.innerHTML=`<div class="part-av">👤</div><div class="part-info"><div class="part-nm">${esc(myName)} (${window.currentLang==="fa"?"شما":"You"})</div><div class="part-role">👑 ${L().owner}</div></div>`;
  list.appendChild(me);
  peers.forEach((e,pid)=>{
    const item=document.createElement("div");item.className="part-item";
    const isPinned = pinnedPeerId === pid;
    const acts=amOwner?`<div class="part-acts">
      <button class="pa ${isPinned?'active-pin':''}" title="${window.currentLang==="fa"?"پین کردن":"Pin"}" onclick="togglePin('${pid}');updatePartList()">${isPinned?"📍":"📌"}</button>
      <button class="pa ma" title="${L().muteMic}" onclick="ownerMute('${pid}','audio')">🎙️</button>
      <button class="pa ma" title="${L().muteCam}" onclick="ownerMute('${pid}','video')">📷</button>
      <button class="pa kk" title="${L().kick}" onclick="ownerKick('${pid}','${esc(e.name)}')">🚪</button>
    </div>`:"";
    item.innerHTML=`<div class="part-av">${e.avatar}</div><div class="part-info"><div class="part-nm">${esc(e.name)}</div><div class="part-role">${e.isOwner?"👑 "+L().owner:window.currentLang==="fa"?"شرکت‌کننده":"Participant"}</div></div>${acts}`;
    list.appendChild(item);
  });
}
function ownerMute(pid,kind){socket.emit("owner:mute",{peerId:pid,kind});toast("🔇 sent");}
function ownerKick(pid,name){if(!confirm(L().kickConfirm(name)))return;socket.emit("owner:kick",{peerId:pid});toast("🚪 "+name);}

// ─── CONTROLS ─────────────────────────────────────────────────────────────────
function toggleMic(){
  micOn=!micOn;localStream?.getAudioTracks().forEach(t=>t.enabled=micOn);
  socket?.emit("media",{kind:"audio",enabled:micOn});
  $("micBtn").className=`cb ${micOn?"on":"off"}`;$("micBtn").querySelector(".ico").textContent=micOn?"🎙️":"🚫";
  const ic=$("t-local")?.querySelector(".mic-ic");if(ic){ic.className=`ti mic-ic${micOn?"":" muted"}`;ic.textContent=micOn?"🎙️":"🚫";}
}
function toggleCam(){
  camOn=!camOn;localStream?.getVideoTracks().forEach(t=>t.enabled=camOn);
  socket?.emit("media",{kind:"video",enabled:camOn});
  $("camBtn").className=`cb ${camOn?"on":"off"}`;$("camBtn").querySelector(".ico").textContent=camOn?"📷":"🚫";
  $("t-local")?.querySelector(".tile-av")?.classList.toggle("h",camOn);
}
async function switchCamera(){
  if(!localStream) return;
  currentFacingMode = currentFacingMode==="user" ? "environment" : "user";
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
  try{
    const newStream=await navigator.mediaDevices.getUserMedia({
      video: isIOS ? {facingMode:currentFacingMode} : {facingMode:currentFacingMode,width:{ideal:1280},height:{ideal:720}},
      audio: false
    });
    const newVideoTrack=newStream.getVideoTracks()[0];
    if(!newVideoTrack) return;
    // Replace in localStream
    const oldVideo=localStream.getVideoTracks()[0];
    if(oldVideo){localStream.removeTrack(oldVideo);oldVideo.stop();}
    localStream.addTrack(newVideoTrack);
    newVideoTrack.enabled=camOn;
    // Update local tile
    const lv=document.querySelector("#t-local video");
    if(lv&&lv.srcObject){
      lv.srcObject.getVideoTracks().forEach(t=>{lv.srcObject.removeTrack(t);t.stop();});
      lv.srcObject.addTrack(newVideoTrack);
      lv.play().catch(()=>{});
    }
    // Update all peer connections
    peers.forEach(({pc})=>{
      pc.getSenders().filter(s=>s.track&&s.track.kind==="video")
        .forEach(s=>s.replaceTrack(newVideoTrack).catch(()=>{}));
    });
    $("flipBtn").querySelector(".ico").textContent=currentFacingMode==="user"?"🤳":"📷";
  }catch(e){console.warn("[mulle] switchCamera failed:",e.message);currentFacingMode=currentFacingMode==="user"?"environment":"user";}
}
async function setVideoQuality(w,h,label){
  if(!localStream) return;
  currentQuality=label;
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
  try{
    const fresh=await navigator.mediaDevices.getUserMedia({
      video: isIOS
        ?{facingMode:currentFacingMode}
        :{facingMode:currentFacingMode,width:{ideal:w},height:{ideal:h}},
      audio:false
    });
    const newTrack=fresh.getVideoTracks()[0];
    if(!newTrack) return;
    const old=localStream.getVideoTracks()[0];
    if(old){localStream.removeTrack(old);old.stop();}
    localStream.addTrack(newTrack);
    newTrack.enabled=camOn;
    // Update local tile
    const lv=document.querySelector("#t-local video");
    if(lv&&lv.srcObject){
      lv.srcObject.getVideoTracks().forEach(t=>{lv.srcObject.removeTrack(t);t.stop();});
      lv.srcObject.addTrack(newTrack);
      lv.play().catch(()=>{});
    }
    // Update all peer connections
    peers.forEach(({pc})=>{
      pc.getSenders().filter(s=>s.track&&s.track.kind==="video")
        .forEach(s=>s.replaceTrack(newTrack).catch(()=>{}));
    });
    // Show toast with actual resolution
    const settings=newTrack.getSettings();
    toast(`📐 ${settings.width||w}×${settings.height||h}`);
  }catch(e){console.warn("[mulle] setVideoQuality failed:",e.message);toast("⚠️ کیفیت پشتیبانی نمی‌شود");}
}
function openPanel(pid,bid){
  ["chatPanel","partPanel"].filter(x=>x!==pid).forEach(x=>{$(x)?.classList.add("h");});
  ["chatBtn","partBtn"].filter(x=>x!==bid).forEach(x=>{const el=$(x);if(el){el.className="cb";el.querySelector(".ico").textContent=el.id==="chatBtn"?"💬":"👥";}});
  const p=$(pid),b=$(bid);const nowH=p.classList.toggle("h");
  b.className=`cb${nowH?"":" on"}`;
  if(!nowH&&pid==="chatPanel")$("msgs").scrollTop=9e9;
  if(!nowH&&pid==="partPanel")updatePartList();
}
function setOwnerUI(v){
  if(v){
    $("ownbadge").classList.remove("h");
    $("partBtn").classList.remove("h");
    // Show pin buttons on all tiles
    document.querySelectorAll(".pin-btn").forEach(b=>b.classList.add("visible"));
  }
}

// ─── SCREEN SHARE ─────────────────────────────────────────────────────────────
function isMobileDevice(){
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints>1 && /MacIntel/.test(navigator.platform));
}
function initScrBtn(){
  const btn=$("scrBtn");
  if(!btn)return;
  if(isMobileDevice()||!navigator.mediaDevices?.getDisplayMedia){
    btn.style.display="none"; // hide on mobile — getDisplayMedia not supported
  }
}
async function toggleScreen(){screenOn?stopScreen():await startScreen();}
async function startScreen(){
  if(isMobileDevice()||!navigator.mediaDevices?.getDisplayMedia){
    toast(window.currentLang==="fa"?"⚠️ اشتراک‌گذاری صفحه در موبایل پشتیبانی نمی‌شود":"⚠️ Screen share is not supported on mobile",4000);
    return;
  }
  try{
    screenStream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:15},audio:true});
    screenOn=true;$("scrBtn").className="cb scron";$("scrBtn").querySelector(".ico").textContent="⏹";
    peers.forEach(({pc})=>screenStream.getTracks().forEach(t=>pc.addTrack(t,screenStream)));
    const tile=mkTile("local-screen","🖥️ "+(window.currentLang==="fa"?"صفحه من":"My Screen"),"🖥️",true,true);
    tile.classList.add("me");const vid=tile.querySelector("video");
    vid.srcObject=new MediaStream(screenStream.getTracks());vid.muted=true;
    $("grid").appendChild(tile);updateGrid();
    socket.emit("media",{kind:"screen",enabled:true});
    toast(L().toastScreenStart);
    screenStream.getVideoTracks()[0].onended=()=>stopScreen(true);
  }catch(e){if(e.name!=="NotAllowedError")toast(L().toastScreenStop);}
}
function stopScreen(silent=false){
  if(!screenStream)return;
  screenStream.getTracks().forEach(t=>{t.stop();peers.forEach(({pc})=>{const s=pc.getSenders().find(x=>x.track===t);if(s)pc.removeTrack(s);});});
  screenStream=null;screenOn=false;document.getElementById("t-local-screen")?.remove();updateGrid();
  $("scrBtn").className="cb";$("scrBtn").querySelector(".ico").textContent="🖥️";
  socket.emit("media",{kind:"screen",enabled:false});
  if(!silent)toast(L().toastScreenStop);
}

// ─── VIRTUAL BACKGROUND ───────────────────────────────────────────────────────
const BG_URLS={"1":"https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&q=80","2":"https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1280&q=80","3":"https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1280&q=80"};
async function loadSeg(){
  if(seg||segLoading)return;segLoading=true;
  try{
    const s=new SelfieSegmentation({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`});
    s.setOptions({modelSelection:1});s.onResults(r=>{segResults=r;});
    await s.initialize();seg=s;segReady=true;
  }catch(e){console.warn("Seg load failed:",e);segReady=false;}
  segLoading=false;
}
function selectBg(el,key){document.querySelectorAll("#lobbyBgGrid .bg-item").forEach(x=>x.classList.remove("active"));el.classList.add("active");applyBg(key);}
function selectBgRoom(el,key){document.querySelectorAll("#roomBgGrid .bg-item").forEach(x=>x.classList.remove("active"));el.classList.add("active");applyBg(key);closeModal("bgModal");}
function uploadBg(e){const f=e.target.files[0];if(!f)return;applyBg("custom",URL.createObjectURL(f));}
function uploadBgRoom(e){const f=e.target.files[0];if(!f)return;applyBg("custom",URL.createObjectURL(f));closeModal("bgModal");}
function applyBg(key,url){
  if(key==="none"){curBg="none";bgImg=null;stopBgLoop();return;}
  if(key==="blur"){stopBgLoop(false);curBg="blur";bgImg=null;loadSeg().then(()=>startBgLoop());return;}
  const u=url||(BG_URLS[key]||null);if(!u)return;curBg=u;
  const img=new Image();img.crossOrigin="anonymous";
  img.onload=()=>{bgImg=img;stopBgLoop(false);loadSeg().then(()=>startBgLoop());};img.src=u;
}
async function startBgLoop(){
  if(bgAnimId)return;
  const tile=document.getElementById("t-local");if(!tile)return;
  let cv=tile.querySelector("canvas.bgc");
  if(!cv){cv=document.createElement("canvas");cv.className="bgc";tile.appendChild(cv);}
  bgCanvas=cv;bgCtx=cv.getContext("2d");
  if(!bgMask){bgMask=document.createElement("canvas");bgMaskCtx=bgMask.getContext("2d");}
  const vid=tile.querySelector("video");
  // Don't hide video until we've drawn at least one frame — prevents black screen
  let firstFrameDrawn=false;
  // Fallback: if segmentation never loads in 4s, show plain video
  const segTimeout=setTimeout(()=>{
    if(!firstFrameDrawn){vid.style.opacity="";cv.style.display="none";}
  },4000);
  async function draw(){
    bgAnimId=requestAnimationFrame(draw);
    if(!vid.videoWidth||vid.readyState<2)return;
    const W=vid.videoWidth,H=vid.videoHeight;
    cv.width=W;cv.height=H;
    if(bgMask){bgMask.width=W;bgMask.height=H;}
    segSkip=(segSkip+1)%2;
    if(segSkip===0&&segReady&&seg){try{await seg.send({image:vid});}catch{}}
    if(segReady&&segResults){
      const mask=segResults.segmentationMask;
      if(curBg==="blur"){bgCtx.filter="blur(18px) brightness(.92)";bgCtx.drawImage(vid,0,0,W,H);bgCtx.filter="none";}
      else if(bgImg)bgCtx.drawImage(bgImg,0,0,W,H);
      else{bgCtx.drawImage(vid,0,0,W,H);}
      if(bgMask&&bgMaskCtx){
        bgMaskCtx.clearRect(0,0,W,H);bgMaskCtx.drawImage(mask,0,0,W,H);
        bgMaskCtx.globalCompositeOperation="source-in";bgMaskCtx.drawImage(vid,0,0,W,H);
        bgMaskCtx.globalCompositeOperation="source-over";bgCtx.drawImage(bgMask,0,0,W,H);
      }
      // First good frame drawn — now safe to hide raw video
      if(!firstFrameDrawn){
        firstFrameDrawn=true;
        clearTimeout(segTimeout);
        vid.style.opacity="0";
        cv.style.display="";
      }
    }else{
      // Segmentation not ready yet — draw fallback so canvas is visible
      if(curBg==="blur"){
        bgCtx.filter="blur(18px)";bgCtx.drawImage(vid,0,0,W,H);bgCtx.filter="none";
        bgCtx.drawImage(vid,0,0,W,H);
      }else if(bgImg){
        bgCtx.drawImage(bgImg,0,0,W,H);
        bgCtx.globalAlpha=.88;bgCtx.drawImage(vid,0,0,W,H);bgCtx.globalAlpha=1;
      }else{
        bgCtx.drawImage(vid,0,0,W,H);
      }
      if(!firstFrameDrawn){firstFrameDrawn=true;clearTimeout(segTimeout);vid.style.opacity="0";cv.style.display="";}
    }
  }
  draw();
}
function stopBgLoop(resetBg=true){
  if(bgAnimId){cancelAnimationFrame(bgAnimId);bgAnimId=null;}
  if(resetBg){curBg="none";bgImg=null;}
  const tile=document.getElementById("t-local");if(!tile)return;
  const cv=tile.querySelector("canvas.bgc");if(cv)cv.remove();
  bgCanvas=null;bgCtx=null;
  const vid=tile.querySelector("video");if(vid)vid.style.opacity="";
}

// ─── YOUTUBE LIVE ─────────────────────────────────────────────────────────────
/**
 * YouTube Live streaming approach:
 * Browser cannot directly push RTMP. We use two methods:
 * 1) Canvas capture → MediaRecorder → download as backup
 * 2) We render the composite grid on a canvas and show user the stream is "active"
 *    Real RTMP push happens via a local encoder (OBS/ffmpeg) pointed at stream key.
 *    We provide the stream key to OBS-compatible encoders.
 *
 * For a pure-browser experience: we use the canvas stream + show it locally,
 * and notify peers that streaming is active.
 * The user can also use chrome://cast or OBS browser source.
 *
 * For Node.js VPS: set PUBLIC_IP and use ffmpeg sidecar (see README).
 */
function updateYtUI(){
  const active=ytStreaming;
  $("ytStatus").classList.toggle("h",!active);
  $("ytKeyFld").classList.toggle("h",active);
  const btn=$("ytActionBtn");
  btn.querySelector("span").textContent=active?L().ytStop:L().ytStart;
  btn.className="mb "+(active?"btn-r ok":"ok btn-live");
}

async function toggleYtStream(){
  if(!ytStreaming)await startYtStream();
  else stopYtStream();
}

async function startYtStream(){
  const key=$("ytKeyInput").value.trim();
  if(!key)return toast(L().ytNote,4000);

  ytKey=key;
  ytStreaming=true;
  closeModal("ytModal");

  // Build composite canvas of the entire grid
  const grid=$("grid");
  ytCanvas=document.createElement("canvas");
  ytCanvas.width=1280;ytCanvas.height=720;
  const ctx=ytCanvas.getContext("2d");
  const FPS=24;

  ytDrawId=setInterval(()=>{
    ctx.fillStyle="#04060e";ctx.fillRect(0,0,1280,720);
    document.querySelectorAll(".tile").forEach(tile=>{
      const bgCv=tile.querySelector("canvas.bgc");
      const vid=tile.querySelector("video");
      const src=bgCv||vid;if(!src)return;
      if(vid&&vid.readyState<2&&!bgCv)return;
      const r=tile.getBoundingClientRect(),gr=grid.getBoundingClientRect();
      const x=r.left-gr.left,y=r.top-gr.top,w=r.width,h=r.height;
      const sx=(x/gr.width)*1280,sy=(y/gr.height)*720;
      const sw=(w/gr.width)*1280,sh=(h/gr.height)*720;
      ctx.save();
      if(tile.classList.contains("me")&&!tile.classList.contains("scr")){ctx.translate(sx+sw,sy);ctx.scale(-1,1);ctx.drawImage(src,0,0,sw,sh);}
      else{ctx.drawImage(src,sx,sy,sw,sh);}
      ctx.restore();
    });
    // Watermark
    ctx.fillStyle="rgba(255,255,255,.55)";ctx.font="bold 16px sans-serif";
    ctx.fillText("🔴 LIVE via Mulle",16,700);
  },1000/FPS);

  // Notify server and peers
  socket.emit("stream:start",{rtmpUrl:`rtmp://a.rtmp.youtube.com/live2/${key}`});
  $("ytBtn").className="cb liveon";$("ytBtn").querySelector(".ico").textContent="🔴";
  $("livebadge").classList.add("on");
  toast(L().toastYtStart);

  // Note: actual RTMP push via browser is not possible without a backend proxy.
  // The canvas stream is exposed for OBS "Browser Source" or ffmpeg ingestion.
  // See README for ffmpeg command.
  console.info("[Mulle] YouTube stream key set. Canvas stream active.");
  console.info("[Mulle] Use ffmpeg or OBS to push to YouTube:");
  console.info(`[Mulle] ffmpeg -re -i pipe:0 -c:v libx264 -b:v 2500k -c:a aac -f flv rtmp://a.rtmp.youtube.com/live2/${key}`);
}

function stopYtStream(){
  clearInterval(ytDrawId);ytDrawId=null;ytCanvas=null;
  ytStreaming=false;ytKey="";
  socket.emit("stream:stop");
  $("ytBtn").className="cb";$("ytBtn").querySelector(".ico").textContent="📺";
  $("livebadge").classList.remove("on");
  closeModal("ytModal");
  toast(L().toastYtStop);
}

// ─── RECORDING ────────────────────────────────────────────────────────────────
function toggleRec(){recording?stopRec():startRec();}
async function startRec(){
  try{
    const aCtx=new AudioContext(),dest=aCtx.createMediaStreamDestination();
    if(localStream.getAudioTracks().length)aCtx.createMediaStreamSource(localStream).connect(dest);
    document.querySelectorAll(".tile:not(.me) video").forEach(v=>{if(v.srcObject)try{aCtx.createMediaStreamSource(v.srcObject).connect(dest);}catch{}});
    const grid=$("grid");const cv=document.createElement("canvas");
    cv.width=grid.offsetWidth||1280;cv.height=grid.offsetHeight||720;
    const ctx=cv.getContext("2d"),FPS=15;
    const di=setInterval(()=>{
      ctx.fillStyle="#04060e";ctx.fillRect(0,0,cv.width,cv.height);

      // Get ALL tiles in DOM order (respects spotlight layout)
      const allTiles=[...document.querySelectorAll(".tile")];
      const total=allTiles.length;
      if(total===0)return;

      if(pinnedPeerId){
        // ── SPOTLIGHT RECORDING LAYOUT ──────────────────────
        const pinnedTile=document.getElementById(`t-${pinnedPeerId}`);
        const otherTiles=allTiles.filter(t=>t.id!==`t-${pinnedPeerId}`);
        const STRIP_H=Math.round(cv.height*0.22); // 22% for strip
        const MAIN_H=cv.height-STRIP_H-4;

        // Draw pinned tile (big, top)
        if(pinnedTile){
          const bgCv=pinnedTile.querySelector("canvas.bgc"),vid=pinnedTile.querySelector("video");
          const src=bgCv||vid;
          if(src&&(bgCv||(vid&&vid.readyState>=2))){
            ctx.save();
            if(pinnedTile.classList.contains("me")&&!pinnedTile.classList.contains("scr")){
              ctx.translate(cv.width,0);ctx.scale(-1,1);ctx.drawImage(src,0,0,cv.width,MAIN_H);
            }else{ctx.drawImage(src,0,0,cv.width,MAIN_H);}
            ctx.restore();
          }
        }

        // Draw strip tiles (small, bottom)
        if(otherTiles.length>0){
          const sw=Math.floor(cv.width/otherTiles.length);
          otherTiles.forEach((tile,i)=>{
            const bgCv=tile.querySelector("canvas.bgc"),vid=tile.querySelector("video");
            const src=bgCv||vid;
            if(!src||(vid&&vid.readyState<2&&!bgCv))return;
            const sx=i*sw,sy=MAIN_H+4;
            ctx.save();
            if(tile.classList.contains("me")&&!tile.classList.contains("scr")){
              ctx.translate(sx+sw,sy);ctx.scale(-1,1);ctx.drawImage(src,0,0,sw,STRIP_H);
            }else{ctx.drawImage(src,sx,sy,sw,STRIP_H);}
            ctx.restore();
          });
        }

      }else{
        // ── NORMAL GRID RECORDING ────────────────────────────
        const cols=total<=1?1:total<=4?2:3;
        const rows=Math.ceil(total/cols);
        const tw=Math.floor(cv.width/cols);
        const th=Math.floor(cv.height/rows);
        allTiles.forEach((tile,i)=>{
          const bgCv=tile.querySelector("canvas.bgc"),vid=tile.querySelector("video");
          const src=bgCv||vid;if(!src)return;
          if(vid&&vid.readyState<2&&!bgCv)return;
          const col=i%cols,row=Math.floor(i/cols);
          const x=col*tw,y=row*th;
          ctx.save();
          if(tile.classList.contains("me")&&!tile.classList.contains("scr")){
            ctx.translate(x+tw,y);ctx.scale(-1,1);ctx.drawImage(src,0,0,tw,th);
          }else{ctx.drawImage(src,x,y,tw,th);}
          ctx.restore();
        });
      }
    },1000/FPS);
    window._recDI=di;
    const mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"].find(m=>MediaRecorder.isTypeSupported(m))||"";
    const ms=new MediaStream([cv.captureStream(FPS).getVideoTracks()[0],...dest.stream.getAudioTracks()]);
    recChunks=[];recorder=new MediaRecorder(ms,mime?{mimeType:mime}:{});
    recorder.ondataavailable=e=>{if(e.data.size>0)recChunks.push(e.data);};
    recorder.onstop=()=>{clearInterval(window._recDI);recBlob=new Blob(recChunks,{type:mime||"video/webm"});openModal("saveModal");};
    recorder.start(1000);recording=true;
    $("recBtn").className="cb recon";$("recBtn").querySelector(".ico").textContent="⏹️";
    $("recbadge").classList.add("on");toast(L().toastRecStart);
  }catch(e){toast("Rec error: "+e.message);}
}
function stopRec(){if(recorder&&recorder.state!=="inactive")recorder.stop();recording=false;$("recBtn").className="cb";$("recBtn").querySelector(".ico").textContent="⏺️";$("recbadge").classList.remove("on");}
function saveRec(){closeModal("saveModal");if(!recBlob)return;const url=URL.createObjectURL(recBlob);const a=document.createElement("a");a.href=url;a.download=`mulle-${myRoom}-${new Date().toISOString().slice(0,16).replace(/:/g,"-")}.webm`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast(L().toastRecSaved);recBlob=null;recChunks=[];}
function discardRec(){closeModal("saveModal");recBlob=null;recChunks=[];toast(L().toastRecDiscard);}

// ─── CHAT ─────────────────────────────────────────────────────────────────────
function sendChat(){const el=$("chatIn"),txt=el.value.trim();if(!txt)return;socket?.emit("chat",{text:txt});el.value="";}
function appendMsg(msg){
  const box=$("msgs"),isMe=msg.from===myId;
  const d=document.createElement("div");d.className=`msg${isMe?" me":""}`;
  d.innerHTML=`<div class="av">${msg.avatar}</div><div class="bd"><div class="mt"><span class="nm">${esc(msg.name)}</span><span class="ts">${fmtT(msg.ts)}</span></div><div class="tx">${esc(msg.text)}</div></div>`;
  box.appendChild(d);box.scrollTop=box.scrollHeight;
  if(!isMe&&$("chatPanel").classList.contains("h"))$("chatBtn").querySelector(".ico").textContent="🔔";
}
function sysMsg(txt){const b=$("msgs"),d=document.createElement("div");d.className="sysmsg";d.textContent=txt;b.appendChild(d);b.scrollTop=b.scrollHeight;}

// ─── KNOCK ────────────────────────────────────────────────────────────────────
function answerKnock(admit){if(!pendingKnock)return;socket.emit("knock:answer",{knockId:pendingKnock,admit});pendingKnock=null;$("knockNotif").classList.add("h");}
function cancelKnock(){socket?.disconnect();location.href=location.pathname;}
function copyInvite(){navigator.clipboard.writeText(inviteURL(myRoom)).then(()=>toast(L().toastCopied));}

// ─── LEAVE ────────────────────────────────────────────────────────────────────
function leave(){
  const desc=$("leaveDesc");
  if(desc){
    desc.textContent=amOwner
      ?(window.currentLang==="fa"?"شما مدیر هستید. ۱۰ دقیقه بعد از خروج، اتاق حذف می‌شود.":"You are the owner. The room will be deleted 10 minutes after you leave.")
      :(window.currentLang==="fa"?"آیا می‌خواهید از اتاق خارج شوید؟":"Are you sure you want to leave the room?");
  }
  openModal("leaveModal");
}
function confirmLeave(){closeModal("leaveModal");doLeave(true);}
function doLeave(disc=true){
  if(recording)stopRec();
  if(ytStreaming)stopYtStream();
  stopScreen();stopBgLoop();
  if(disc)socket?.disconnect();
  peers.forEach(({pc})=>{try{pc.close();}catch{}});peers.clear();
  localStream?.getTracks().forEach(t=>t.stop());localStream=null;
  // Reset state
  myRoom=null;myName=null;myRoomName=null;amOwner=false;pinnedPeerId=null;
  // Clear grid
  const g=$("grid");if(g)g.innerHTML="";
  // Go back to home page
  history.replaceState({},"",location.pathname);
  showHome();
}

// ─── PAGE TRANSITIONS ─────────────────────────────────────────────────────────
function showHome(){
  $("home").style.display="flex";
  $("knockWait").style.display="none";
  $("meet").style.display="none";
  setConn(false);
}
function showMeet(){
  // Hide all pages
  $("home").style.display="none";
  $("knockWait").style.display="none";
  // Close any open overlays
  ["ovCreate","ovJoin"].forEach(id=>{
    const el=$(id); if(el) el.classList.add("h");
  });
  // Show meet room
  const meet=$("meet");
  meet.style.display="flex";
  meet.style.flexDirection="column";
  $("mrname").textContent=myRoomName;
  $("hinvId").textContent=myRoom;
  if(amOwner)setOwnerUI(true);
  setConn(false);
  // Timer
  let s=0;
  const iv=setInterval(()=>{
    const m=$("meet");
    if(!m||m.style.display==="none"){clearInterval(iv);return;}
    s++;
    $("tmr").textContent=`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  },1000);
}

// ─── VISIBILITY / RESUME HANDLER ─────────────────────────────────────────────
async function reacquireMedia(){
  if(!localStream) return;
  await new Promise(r=>setTimeout(r,600));

  // 1. Always try to play all paused videos first (cheapest fix)
  document.querySelectorAll("video").forEach(v=>{
    if(v.srcObject)v.play().catch(()=>{});
  });

  // 2. Resume AudioContext if suspended
  try{
    if(window._mulleAudioCtx&&window._mulleAudioCtx.state==="suspended"){
      await window._mulleAudioCtx.resume();
    }
  }catch(e){}

  // 3. Re-enable tracks disabled by browser while backgrounded
  if(camOn) localStream.getVideoTracks().forEach(t=>{t.enabled=true;});
  if(micOn) localStream.getAudioTracks().forEach(t=>{t.enabled=true;});

  // 4. On mobile: detect frozen/black video by checking if frames are updating
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream;
  const isMobile=isMobileDevice();
  const lv=document.querySelector("#t-local video");

  // Check for dead tracks OR frozen video (mobile-specific)
  const deadVideo=localStream.getVideoTracks().filter(t=>t.readyState==="ended");
  const deadAudio=localStream.getAudioTracks().filter(t=>t.readyState==="ended");

  // On mobile, also treat muted-by-system as dead
  const mutedVideo=isMobile?localStream.getVideoTracks().filter(t=>t.muted):[];
  const needVideoReacquire=deadVideo.length>0||mutedVideo.length>0;

  // On mobile, check for frozen frame using getVideoTracks()[0].getSettings()
  // If video is frozen, the readyState check above misses it — use a frame counter
  let videoFrozen=false;
  if(isMobile&&camOn&&lv&&lv.srcObject&&lv.readyState>=2){
    // Quick black frame detect: sample a pixel from the video
    try{
      const probe=document.createElement("canvas");probe.width=8;probe.height=8;
      const px=probe.getContext("2d");px.drawImage(lv,0,0,8,8);
      const d=px.getImageData(0,0,8,8).data;
      let sum=0;for(let i=0;i<d.length;i+=4)sum+=d[i]+d[i+1]+d[i+2];
      if(sum<100) videoFrozen=true; // all pixels near black = frozen/black frame
    }catch(e){}
  }

  if(!needVideoReacquire&&!videoFrozen&&deadAudio.length===0) return;

  console.log("[mulle] reacquiring — dead:",deadVideo.length,"muted:",mutedVideo.length,"frozen:",videoFrozen);
  try{
    const fresh=await navigator.mediaDevices.getUserMedia({
      video:(needVideoReacquire||videoFrozen)?(isIOS?{facingMode:currentFacingMode}:{width:{ideal:1280},height:{ideal:720},facingMode:currentFacingMode}):false,
      audio:deadAudio.length>0,
    });
    fresh.getTracks().forEach(newTrack=>{
      localStream.getTracks()
        .filter(t=>t.kind===newTrack.kind)
        .forEach(t=>{localStream.removeTrack(t);t.stop();});
      localStream.addTrack(newTrack);
      if(newTrack.kind==="video") newTrack.enabled=camOn;
      if(newTrack.kind==="audio") newTrack.enabled=micOn;
      // Update local tile video element
      if(lv&&lv.srcObject){
        lv.srcObject.getTracks()
          .filter(t=>t.kind===newTrack.kind)
          .forEach(t=>{lv.srcObject.removeTrack(t);t.stop();});
        lv.srcObject.addTrack(newTrack);
        lv.play().catch(()=>{});
      }
      // Update all peer connections
      peers.forEach(({pc})=>{
        pc.getSenders()
          .filter(s=>s.track&&s.track.kind===newTrack.kind)
          .forEach(s=>s.replaceTrack(newTrack).catch(()=>{}));
      });
    });
    if(camOn){
      localStream.getVideoTracks().forEach(t=>t.enabled=true);
      document.querySelector("#t-local .tile-av")?.classList.add("h");
    }
    // Restart bg loop if active
    if(curBg&&curBg!=="none"){stopBgLoop(false);loadSeg().then(()=>startBgLoop());}
  }catch(e){console.warn("[mulle] reacquire failed:",e.message);}
}

document.addEventListener("visibilitychange",()=>{
  if(!document.hidden) reacquireMedia();
});

// Also handle page focus (works in some browsers where visibilitychange doesn't fire)
window.addEventListener("focus",()=>{
  if(!document.hidden) reacquireMedia();
});

// ─── iOS Safari: play videos on user gesture to avoid black screen ─────────────
document.addEventListener("click",()=>{
  document.querySelectorAll("video").forEach(v=>{
    if(v.srcObject&&(v.paused||v.readyState<2))v.play().catch(()=>{});
  });
},{passive:true});


// ─── CONTROL BAR QUALITY PICKER ───────────────────────────────────────────────
function toggleCtrlQualMenu(e){
  e && e.stopPropagation();
  const menu = document.getElementById("ctrlQualMenu");
  if(menu) menu.classList.toggle("h");
}
async function pickCtrlQual(w, h, label){
  // close menu
  const menu = document.getElementById("ctrlQualMenu");
  if(menu) menu.classList.add("h");
  // update label on button
  const lbl = document.getElementById("ctrlQualLabel");
  if(lbl) lbl.textContent = label;
  // highlight active
  document.querySelectorAll(".ctrl-qual-item").forEach(x =>
    x.classList.toggle("active", x.textContent === label)
  );
  // apply quality (shared fn)
  await setVideoQuality(w, h, label);
  // also sync the tile overlay label if visible
  const tileQl = document.querySelector("#t-local .qual-label");
  if(tileQl) tileQl.textContent = label;
  // sync tile qual-items
  document.querySelectorAll("#t-local .qual-item").forEach(x =>
    x.classList.toggle("active", x.textContent === label)
  );
}
// close ctrl qual menu on outside click
document.addEventListener("click", () => {
  document.getElementById("ctrlQualMenu")?.classList.add("h");
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
(async()=>{
  initScrBtn(); // hide screen share button on mobile
  // Load rooms list
  try{const list=await fetch("/api/rooms").then(r=>r.json());renderRooms(list);}catch{renderRooms([]);}

  // Auto-open join panel if URL has room param
  const urlRoom=roomFromURL();
  if(urlRoom){
    $("jRoom").value=urlRoom;
    // Small delay so page is fully rendered first
    setTimeout(()=>openJoin(),100);
  }
})();
