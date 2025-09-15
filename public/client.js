// public/client.js
// FéerieQuest 3D - Client (Three.js + Socket.IO)
// IMPORTANT: replace MODEL_URL by your preferred glTF character if desired.

const socket = io(window.location.origin, { transports: ['websocket'] });

// ----- UI refs -----
const canvas = document.getElementById('c');
const playerNameEl = document.getElementById('playerName');
const lvlEl = document.getElementById('lvl');
const hpEl = document.getElementById('hp');
const maxHpEl = document.getElementById('maxhp');
const goldEl = document.getElementById('gold');
const questsEl = document.getElementById('quests');
const invEl = document.getElementById('inventory');
const logEl = document.getElementById('log');
const saveBtn = document.getElementById('saveBtn');
const authBox = document.getElementById('authBox');
const uInput = document.getElementById('u'), pInput = document.getElementById('p');
const btnRegister = document.getElementById('btnRegister'), btnLogin = document.getElementById('btnLogin'), btnGuest = document.getElementById('btnGuest');

function log(msg){ const d=document.createElement('div'); d.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`; logEl.prepend(d); }

// --- Auth & profiles ---
let token = null;
let me = null;
const others = {};
const monsters = {};

// example catalog
const QUEST_CATALOG = [
  { id:'q1', title:'Collecter Herbes', desc:'Récupère 5 Herbes magiques dans le parc', target:'Herbe magique', targetCount:5, reward:{ exp:120, gold:80 } },
  { id:'q2', title:'Chasser Ombres', desc:'Vaincre 3 bêtes des bois', target:'beast', targetCount:3, reward:{ exp:180, gold:140 } }
];

// ----- Auth handlers -----
btnRegister.onclick = async () => {
  const username = uInput.value.trim(), password = pInput.value;
  if(!username||!password) return alert('pseudo+mdp requis');
  const res = await fetch('/api/register',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password })});
  const data = await res.json();
  if(data.token){ token = data.token; playerNameEl.textContent = data.username; socket.emit('auth',{ token }); authBox.style.display='none'; log('Inscrit & connecté'); } else log('Erreur inscription: '+JSON.stringify(data));
};
btnLogin.onclick = async () => {
  const username = uInput.value.trim(), password = pInput.value;
  if(!username||!password) return alert('pseudo+mdp requis');
  const res = await fetch('/api/login',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password })});
  const data = await res.json();
  if(data.token){ token = data.token; playerNameEl.textContent = data.username; socket.emit('auth',{ token }); authBox.style.display='none'; log('Connecté'); } else log('Erreur login: '+JSON.stringify(data));
};
btnGuest.onclick = () => { socket.emit('join_guest', { name: `Invité${Math.floor(Math.random()*9999)}` }); authBox.style.display='none'; };

// save
saveBtn.onclick = async () => {
  if(token && me && me.userId) {
    const res = await fetch('/api/save', { method:'POST', headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({
      x: me.x, y: me.y, z: me.z, rotationY: me.rotationY, level: me.level, exp: me.exp, gold: me.gold,
      hp: me.hp, maxHp: me.maxHp, inventory: me.inventory, quests: me.quests
    })});
    const d = await res.json();
    if(d.ok) log('Sauvegardé'); else log('Erreur sauvegarde: '+JSON.stringify(d));
  } else {
    socket.emit('save_request');
  }
};

// ----- Three.js scene -----
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x8fbfba, 0.0025);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth/window.innerHeight, 0.1, 1000);
camera.position.set(0, 4, 8);

// lighting
const hemi = new THREE.HemisphereLight(0xfff6e6, 0x223344, 0.9);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(5, 20, 10); scene.add(dir);

// ground / terrain (procedural height using noise)
const terrainSize = 1200;
const terrainSegments = 200;
const groundGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegments, terrainSegments);
groundGeo.rotateX(-Math.PI/2);

// simple pseudo-noise (improved performance over true Perlin for demo)
for (let i=0;i<groundGeo.attributes.position.count;i++) {
  const x = groundGeo.attributes.position.getX(i);
  const z = groundGeo.attributes.position.getZ(i);
  const h = Math.sin(x*0.005)*8 + Math.cos(z*0.007)*6 + (Math.random()*2-1)*1.2;
  groundGeo.attributes.position.setY(i, h);
}
groundGeo.computeVertexNormals();

const groundMat = new THREE.MeshStandardMaterial({ color:0x7adfb3, roughness:0.9, metalness:0.02 });
const ground = new THREE.Mesh(groundGeo, groundMat); ground.receiveShadow = true; scene.add(ground);

// simple water/lake
const lakeGeo = new THREE.CircleGeometry(70, 64);
const lakeMat = new THREE.MeshStandardMaterial({ color:0x446f9a, transparent:true, opacity:0.8, roughness:0.2, metalness:0.3 });
const lake = new THREE.Mesh(lakeGeo, lakeMat);
lake.rotation.x = -Math.PI/2; lake.position.y = -2; lake.position.x = -120; lake.position.z = 40;
scene.add(lake);

// instanced trees (simple cones)
const treeGroup = new THREE.Group();
const trunkGeo = new THREE.CylinderGeometry(0.6,0.6,6,6);
const trunkMat = new THREE.MeshStandardMaterial({ color:0x6b4023 });
const leafGeo = new THREE.ConeGeometry(3.5, 8, 8);
const leafMat = new THREE.MeshStandardMaterial({ color:0x1f6b3a });

for(let i=0;i<120;i++){
  const tx = Math.random()*terrainSize - terrainSize/2;
  const tz = Math.random()*terrainSize - terrainSize/2;
  const ty = sampleHeight(tx, tz) + 3;
  const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.set(tx, ty-3, tz); trunk.scale.setScalar(0.7+Math.random()*0.5);
  const leaves = new THREE.Mesh(leafGeo, leafMat); leaves.position.set(tx, ty+1.5, tz); leaves.scale.setScalar(0.8+Math.random()*0.7);
  treeGroup.add(trunk); treeGroup.add(leaves);
}
scene.add(treeGroup);

// particle system for fairy dust
const particleGeo = new THREE.BufferGeometry();
const particleCount = 500;
const positions = new Float32Array(particleCount*3);
for(let i=0;i<particleCount;i++){
  positions[i*3] = (Math.random()*terrainSize - terrainSize/2);
  positions[i*3+1] = Math.random()*25 + 1;
  positions[i*3+2] = (Math.random()*terrainSize - terrainSize/2);
}
particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particleMat = new THREE.PointsMaterial({ size: 0.2, color: 0xfff1b8, transparent:true, opacity:0.8 });
const particles = new THREE.Points(particleGeo, particleMat); scene.add(particles);

// sky dome
const skyGeo = new THREE.SphereGeometry(800, 16, 16);
const skyMat = new THREE.MeshBasicMaterial({ color: 0x9fdff0, side: THREE.BackSide });
const sky = new THREE.Mesh(skyGeo, skyMat); scene.add(sky);

// helper: get approximate ground height at (x,z) by sampling ground geometry
function sampleHeight(x, z){
  // use simple sin/cos estimate same as generated
  return Math.sin(x*0.005)*8 + Math.cos(z*0.007)*6;
}

// ----- Character model loading -----
const loader = new THREE.GLTFLoader();
// Example GLB character (Three.js example model). Replace with any glTF you prefer.
// If you have your own .glb, upload to public/assets and change URL accordingly.
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r152/examples/models/gltf/RobotExpressive/RobotExpressive.glb';

let character = {
  group: new THREE.Group(),
  mixer: null,
  actions: {},
  currentAction: null,
  modelReady: false,
  speedMultiplier: 1
};
scene.add(character.group);

// load character
loader.load(MODEL_URL, (gltf) => {
  const model = gltf.scene;
  model.scale.set(0.8,0.8,0.8);
  character.group.add(model);
  character.mixer = new THREE.AnimationMixer(model);

  // collect animations (names depend on model)
  gltf.animations.forEach(clip=> {
    character.actions[clip.name] = character.mixer.clipAction(clip);
  });

  // set idle if exists
  if(character.actions['Idle']) playAction('Idle');
  else if(character.actions['Standing']) playAction(Object.keys(character.actions)[0] || null);

  character.modelReady = true;
  log('Modèle personnage chargé');
}, undefined, (err)=> { console.error('GLTF load error', err); log('Erreur chargement modèle'); });

// play animation helper
function playAction(name) {
  if(!name || !character.actions[name]) return;
  if(character.currentAction === character.actions[name]) return;
  const toPlay = character.actions[name];
  if(character.currentAction) {
    toPlay.reset().fadeIn(0.2).play();
    character.currentAction.fadeOut(0.2);
  } else {
    toPlay.reset().play();
  }
  character.currentAction = toPlay;
}

// ----- Movement & controls -----
let controlsEnabled = false;
const controls = new THREE.PointerLockControls(camera, renderer.domElement);
document.addEventListener('click', () => {
  if(!controlsEnabled) {
    controls.lock();
  }
});
controls.addEventListener('lock', ()=> { controlsEnabled = true; log('Souris verrouillée'); });
controls.addEventListener('unlock', ()=> { controlsEnabled = false; log('Souris déverrouillée'); });

const move = { forward:false, back:false, left:false, right:false, jump:false, run:false };
document.addEventListener('keydown', (e) => {
  if(e.key === 'w') move.forward=true;
  if(e.key === 's') move.back=true;
  if(e.key === 'a') move.left=true;
  if(e.key === 'd') move.right=true;
  if(e.key === 'Shift') move.run=true;
  if(e.code === 'Space') move.jump=true;
  if(e.key === 'e') interact();
});
document.addEventListener('keyup', (e) => {
  if(e.key === 'w') move.forward=false;
  if(e.key === 's') move.back=false;
  if(e.key === 'a') move.left=false;
  if(e.key === 'd') move.right=false;
  if(e.key === 'Shift') move.run=false;
  if(e.code === 'Space') move.jump=false;
});

// physics-like variables
let velocity = new THREE.Vector3();
let playerPos = new THREE.Vector3(0, sampleHeight(0,0)+1.0, 0); // start on terrain
let playerYaw = 0;

// instantiate other players' meshes map
const otherGroup = new THREE.Group(); scene.add(otherGroup);
const monsterGroup = new THREE.Group(); scene.add(monsterGroup);

// spawn local mesh as placeholder (will be replaced by model when ready)
const placeholderGeo = new THREE.CapsuleGeometry(0.6, 1.0, 4, 8);
const placeholderMat = new THREE.MeshStandardMaterial({ color: 0xdf4b3b });
const placeholderMesh = new THREE.Mesh(placeholderGeo, placeholderMat);
placeholderMesh.castShadow = true;
character.group.add(placeholderMesh);

// update UI function
function updateUI() {
  if(!me) return;
  playerNameEl.textContent = me.username || 'Invité';
  lvlEl.textContent = me.level || 1;
  hpEl.textContent = Math.round(me.hp || 100);
  maxHpEl.textContent = Math.round(me.maxHp || 100);
  goldEl.textContent = Math.round(me.gold || 0);
  // inventory
  invEl.innerHTML = '';
  (me.inventory || []).forEach(it => {
    const d = document.createElement('div'); d.className='item'; d.textContent = `${it.name} x${it.qty||1}`; invEl.appendChild(d);
  });
  // quests
  questsEl.innerHTML = '';
  (me.quests || []).forEach(qp => {
    const qObj = QUEST_CATALOG.find(q => q.id === qp.questId) || { title: qp.questId, desc:'' };
    const el = document.createElement('div'); el.className='quest';
    el.innerHTML = `<b>${qObj.title}</b><div>${qObj.desc}</div><div>Progression: ${qp.progress||0}/${qObj.targetCount||'?'}</div>`;
    questsEl.appendChild(el);
  });
}

// interaction (E)
function interact(){
  // simple raycast in front to find monster within range
  const origin = character.group.position.clone().add(new THREE.Vector3(0,1.2,0));
  const forward = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  const ray = new THREE.Raycaster(origin, forward, 0, 10);
  const intersects = [];
  monsterGroup.children.forEach(c => {
    const mesh = c.userData.mesh || c;
    const inter = ray.intersectObject(mesh, true);
    if(inter.length) intersects.push({ mesh:c, dist: inter[0].distance });
  });
  if(intersects.length) {
    intersects.sort((a,b)=>a.dist-b.dist);
    const mChild = intersects[0].mesh;
    const mid = mChild.userData.monsterId;
    if(mid) {
      // attack
      const dmg = Math.floor(18 + Math.random()*10 + (me.level||1)*1.5);
      socket.emit('attack', { monsterId: mid, dmg });
      log(`Tu frappes le monstre (${mid}) : ${dmg} dmg`);
      if(character.actions['Punch'] || character.actions['Punch_01'] ) playAction('Punch') ;
    }
  } else {
    log('Aucun adversaire à portée');
  }
}

// ----- Socket events (sync) -----
socket.on('connect', ()=> log('Connecté au serveur'));
socket.on('auth_ok', ({ player }) => { me = player; replaceLocalPosition(player.x, player.y, player.z); updateUI(); log('Profil chargé'); });
socket.on('player_joined', (p) => { if(p.socketId !== socket.id) { others[p.socketId] = p; log(`${p.username} est arrivé`); drawOtherPlayers(); }});
socket.on('player_left', ({ socketId }) => { delete others[socketId]; drawOtherPlayers(); log('Un joueur est parti'); });
socket.on('player_moved', (data) => { if(others[data.socketId]) { others[data.socketId].x = data.x; others[data.socketId].y = data.y; others[data.socketId].z = data.z; others[data.socketId].rotationY = data.rotationY; drawOtherPlayers(); }});
socket.on('state', ({ players, monsters: mList }) => {
  players.forEach(p => { if(p.socketId !== socket.id) others[p.socketId] = p; });
  mList.forEach(m => monsters[m.id] = m);
  drawOtherPlayers(); drawMonsters();
});
socket.on('monsters_update', (arr) => { arr.forEach(m => monsters[m.id] = m); drawMonsters(); });
socket.on('monster_spawn', (m) => { monsters[m.id] = m; drawMonsters(); });
socket.on('monster_damaged', ({ monsterId, hp }) => { if(monsters[monsterId]) monsters[monsterId].hp = hp; drawMonsters(); });
socket.on('monster_killed', ({ monsterId, by, gold, exp, loot }) => {
  if(monsters[monsterId]) delete monsters[monsterId];
  drawMonsters();
  if(by === socket.id && me) {
    log(`Tu as vaincu un monstre : +${gold} Or, +${exp} XP${loot?', loot: '+loot.name:''}`);
    if(loot) { const ex = me.inventory.find(i=>i.name===loot.name); if(ex) ex.qty = (ex.qty||1) + 1; else me.inventory.push({...loot, qty:1}); }
    me.gold += gold; me.exp += exp; updateUI();
  }
});
socket.on('damaged', ({ dmg, hp }) => { if(me) { me.hp = hp; updateUI(); log(`Tu as pris ${dmg} dégâts`); }});
socket.on('died', ({ hp, x, y, gold }) => { if(me) { me.hp = hp; me.x = x; me.y = y; me.gold = gold; updateUI(); log('Tu es mort(e). Respawn.'); replaceLocalPosition(x,y,0); }});
socket.on('save_response', (r) => { if(r.ok) log('Serveur: sauvegarde OK'); else log('Serveur: erreur sauvegarde'); });
socket.on('leveled', ({ level }) => { if(me) { me.level = level; updateUI(); log('Niveau +1 ! Niveau ' + level); }});

// ----- Drawing other players & monsters -----
function drawOtherPlayers(){
  otherGroup.clear();
  Object.values(others).forEach(o => {
    if(!o) return;
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 4, 8), new THREE.MeshStandardMaterial({ color: 0x3366ff }));
    mesh.position.set(o.x || 0, sampleHeight(o.x || 0, o.y || 0)+1, o.y || 0);
    const label = makeLabel(o.username);
    label.position.set(mesh.position.x, mesh.position.y+2.2, mesh.position.z);
    otherGroup.add(mesh); otherGroup.add(label);
  });
}
function drawMonsters(){
  monsterGroup.clear();
  Object.values(monsters).forEach(m => {
    const g = new THREE.Group();
    let mm;
    if(m.type === 'boss'){
      mm = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), new THREE.MeshStandardMaterial({ color: 0x8a1a1a }));
    } else {
      mm = new THREE.Mesh(new THREE.BoxGeometry(1.6,1.2,1.6), new THREE.MeshStandardMaterial({ color: 0x5b3c1f }));
    }
    mm.position.y = sampleHeight(m.x, m.y)+0.6;
    mm.userData.monsterId = m.id;
    // HP bar
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18), new THREE.MeshBasicMaterial({ color:0x000000 }));
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.1, (m.hp/m.maxHp)*1.8), 0.12), new THREE.MeshBasicMaterial({ color:0xff4444 }));
    bar.position.x = -1 + (bar.geometry.parameters.width)/2;
    bar.position.y = 1.6;
    barBg.position.y = 1.6;
    barBg.rotation.x = -Math.PI/2; bar.rotation.x = -Math.PI/2;
    g.add(mm); g.add(barBg); g.add(bar);
    g.position.set(m.x, sampleHeight(m.x,m.y)+0.1, m.y);
    g.userData.mesh = mm; g.userData.monsterId = m.id;
    monsterGroup.add(g);
  });
}

// helper label
function makeLabel(text){
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d'); ctx.font='28px Arial'; ctx.fillStyle='white'; ctx.fillText(text,10,34);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest:false });
  const s = new THREE.Sprite(mat); s.scale.set(3.0,0.8,1);
  return s;
}

// ----- Animation loop & physics -----
const clock = new THREE.Clock();
let lastSent = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  // particles float
  particleGeo.attributes.position.array.forEach((v,i) => {
    if(i%3===1) particleGeo.attributes.position.array[i] += Math.sin((performance.now()/1000)+i)*0.0006;
  });
  particleGeo.attributes.position.needsUpdate = true;

  // simple character movement
  const speed = (move.run ? 12 : 6) * (character.speedMultiplier || 1);
  const forwardVec = new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion).setY(0).normalize();
  const rightVec = new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion).setY(0).normalize();
  let moveDir = new THREE.Vector3();
  if(move.forward) moveDir.add(forwardVec);
  if(move.back) moveDir.add(forwardVec.clone().negate());
  if(move.left) moveDir.add(rightVec.clone().negate());
  if(move.right) moveDir.add(rightVec);
  if(moveDir.lengthSq()>0) moveDir.normalize();

  // update velocity / position (simple)
  velocity.x = THREE.MathUtils.lerp(velocity.x, moveDir.x*speed, dt*8);
  velocity.z = THREE.MathUtils.lerp(velocity.z, moveDir.z*speed, dt*8);
  playerPos.x += velocity.x * dt;
  playerPos.z += velocity.z * dt;
  // gravity / Y position on terrain
  const groundY = sampleHeight(playerPos.x, playerPos.z);
  playerPos.y = groundY + 1.0; // always grounded for simplicity; integrate jump if desired

  // update character group position
  character.group.position.set(playerPos.x, playerPos.y, playerPos.z);
  // rotate to movement direction
  if(moveDir.lengthSq()>0) {
    const yaw = Math.atan2(moveDir.x, moveDir.z);
    character.group.rotation.y = yaw;
    if(character.modelReady) {
      // switch to run/walk
      if(move.run) { if(character.actions['Run']) playAction('Run'); }
      else { if(character.actions['Walk']) playAction('Walk'); }
    }
  } else {
    if(character.modelReady) {
      if(character.actions['Idle']) playAction('Idle');
    }
  }

  // camera follow
  const camTarget = character.group.position.clone().add(new THREE.Vector3(0, 2.5, 8).applyQuaternion(character.group.quaternion));
  camera.position.lerp(camTarget, 0.12);
  camera.lookAt(character.group.position.clone().add(new THREE.Vector3(0,1.5,0)));

  // update animations
  if(character.mixer) character.mixer.update(dt);

  renderer.render(scene, camera);

  // send position periodically
  if(performance.now() - lastSent > 80) {
    lastSent = performance.now();
    if(socket && socket.connected) {
      socket.emit('move', { x: playerPos.x, y: playerPos.z, z: playerPos.y, rotationY: character.group.rotation.y });
    }
  }
}
animate();

// helper to replace local position when loaded
function replaceLocalPosition(x,y,z) {
  playerPos.x = x || 0; playerPos.z = y || 0; playerPos.y = z || sampleHeight(playerPos.x, playerPos.z)+1;
  character.group.position.set(playerPos.x, playerPos.y, playerPos.z);
}

// helper: draw monsters when model etc changed
drawMonsters();
drawOtherPlayers();

// request initial state
socket.emit('request_state');

// small periodic auto-save to server (best effort)
setInterval(()=> {
  if(token && me && me.userId) {
    fetch('/api/save', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({
      x: playerPos.x, y: playerPos.z, z: playerPos.y, rotationY: character.group.rotation.y,
      inventory: me.inventory, quests: me.quests, level: me.level, exp: me.exp, gold: me.gold, hp: me.hp, maxHp: me.maxHp
    })}).then(r=>r.json()).then(d=>{ if(d.ok) console.debug('saved'); });
  }
}, 15000);

// ------ Utilities & resize -----
window.addEventListener('resize', ()=> {
  camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
