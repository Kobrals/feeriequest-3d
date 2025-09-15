const socket = io();
let token = null;
let player = { x:0, y:1, z:5 };

const loginScreen = document.getElementById("loginScreen");
const gameCanvas = document.getElementById("gameCanvas");
const statusP = document.getElementById("status");

document.getElementById("registerBtn").onclick = async () => {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const res = await fetch("/api/register", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({username, password})
  });
  statusP.textContent = (await res.json()).success ? "Compte créé !" : "Erreur";
};

document.getElementById("loginBtn").onclick = async () => {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const res = await fetch("/api/login", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({username, password})
  });
  const data = await res.json();
  if(data.token){
    token = data.token;
    loginScreen.style.display="none";
    gameCanvas.style.display="block";
    startGame();
  } else {
    statusP.textContent = "Identifiants invalides";
  }
};

// === Jeu 3D basique avec Three.js ===
function startGame(){
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({canvas: gameCanvas});
  renderer.setSize(window.innerWidth, window.innerHeight);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(5,10,7.5);
  scene.add(light);

  const groundGeo = new THREE.PlaneGeometry(100,100);
  const groundMat = new THREE.MeshPhongMaterial({color:0x228B22});
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI/2;
  scene.add(ground);

  const playerGeo = new THREE.BoxGeometry(1,1,1);
  const playerMat = new THREE.MeshPhongMaterial({color:0xff0000});
  const playerMesh = new THREE.Mesh(playerGeo, playerMat);
  scene.add(playerMesh);

  camera.position.set(0,5,10);

  document.addEventListener("keydown", (e)=>{
    const step = 0.2;
    if(e.key==="ArrowUp"){ player.z -= step; }
    if(e.key==="ArrowDown"){ player.z += step; }
    if(e.key==="ArrowLeft"){ player.x -= step; }
    if(e.key==="ArrowRight"){ player.x += step; }
    socket.emit("move", player);
  });

  socket.on("playerMoved", data => {
    console.log("Un autre joueur a bougé", data);
  });

  function animate(){
    requestAnimationFrame(animate);
    playerMesh.position.set(player.x,0.5,player.z);
    camera.lookAt(playerMesh.position);
    renderer.render(scene, camera);
  }
  animate();

  // Sauvegarde périodique de la position
  setInterval(async ()=>{
    if(!token) return;
    await fetch("/api/save", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({token, x:player.x, y:player.y, z:player.z})
    });
  }, 5000);
}
