/**
 * OBSERVER_ENGINE // COMPLETE SOURCE // VER 2.9
 * SCALES: DRILL 0.2 // ROCK 2.5
 * FEATURE: FULL BIONIC COMBAT SYSTEM
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('input_video');
const pip = document.getElementById('pipCanvas'); 
const pctx = pip.getContext('2d');

let w, h;
const resize = () => {
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w; canvas.height = h;
    pip.width = 320; pip.height = 180;
};
window.addEventListener('resize', resize);
resize();

// --- 1. GLOBAL TUNING ---
const DRILL_SCALE = 0.2; //
const ROCK_SCALE = 2.5;  //
const PHASE_DURATION = 600; 

// --- 2. GAME STATE ---
let currentState = "DRILLING"; 
let gameTimer = 0; 
let frame = 0;
let hp = 100;
let score = 0;

// Movement
let gear = { x: w/2, y: h * 0.7, angle: 0, active: false, gesture: "IDLE", charge: 0 };
let lerp = 0.3;

// Assets
const drillImg = new Image(); drillImg.src = "drill.png";
const rockImg = new Image();  rockImg.src = "obstacle.png";
const enemyImg = new Image(); enemyImg.src = "enemy.png";
const bgImg = new Image();    bgImg.src = "background.png";

// Entities
let obstacles = [];
let projectiles = [];
let enemies = [];
let dirtOffset = 0;
let drillSpeed = 15;

// --- 3. VISION PIPELINE ---
const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.8 });

hands.onResults((res) => {
    pctx.clearRect(0,0,320,180);
    pctx.save();
    pctx.scale(-1, 1);
    pctx.drawImage(res.image, -320, 0, 320, 180);
    pctx.restore();

    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
        const lm = res.multiHandLandmarks[0];
        
        // Inversion Fix
        const tx = (1 - lm[9].x) * w; 
        gear.x += (tx - gear.x) * lerp;
        
        if (currentState === "COMBAT") {
            // Combat Y-tracking
            gear.y += (lm[9].y * h - gear.y) * lerp;
            // Natural Tilt
            gear.angle = Math.atan2(lm[9].y - lm[0].y, lm[9].x - lm[0].x) + Math.PI/2 - 0.3;
            
            // Gesture Mapping
            const up = (i) => lm[i].y < lm[i-2].y;
            if (up(8) && !up(12)) gear.gesture = "BOLT";
            else if (!up(8) && !up(12)) gear.gesture = "CHARGE";
            else if (up(8) && up(12)) gear.gesture = "SPLIT";
            else gear.gesture = "IDLE";
        } else {
            gear.y = h * 0.7; // Locked Y for Drilling
            gear.angle = 0;
        }
        gear.active = true;
    } else { gear.active = false; }
});

new Camera(video, { onFrame: async () => { await hands.send({image: video}); }, width: 640, height: 480 }).start();

// --- 4. SCENES ---

function drawDrillingScene() {
    gameTimer++;
    dirtOffset += drillSpeed;

    if (gameTimer > PHASE_DURATION) {
        currentState = "COMBAT";
        obstacles = [];
        return;
    }

    ctx.fillStyle = "#1a0f00";
    ctx.fillRect(0, 0, w, h);

    // Rocks (Spawn Top, Move Down)
    if (frame % 20 === 0) obstacles.push({ x: Math.random() * w, y: -200, s: 50 });

    obstacles.forEach((o, i) => {
        o.y += drillSpeed;
        if (rockImg.complete) {
            ctx.save();
            ctx.translate(o.x, o.y);
            ctx.scale(ROCK_SCALE, ROCK_SCALE); //
            ctx.drawImage(rockImg, -rockImg.width/2, -rockImg.height/2);
            ctx.restore();
        }
        // Collision
        if (gear.active && Math.hypot(gear.x - o.x, gear.y - o.y) < (40 * ROCK_SCALE)) {
            hp -= 0.1;
        }
        if (o.y > h + 200) obstacles.splice(i, 1);
    });

    if (gear.active && drillImg.complete) {
        ctx.save();
        ctx.translate(gear.x, gear.y);
        ctx.scale(DRILL_SCALE, DRILL_SCALE); //
        ctx.drawImage(drillImg, -drillImg.width/2, -drillImg.height/2);
        ctx.restore();
    }
}

function drawCombatScene() {
    // Combat Background
    if (bgImg.complete) ctx.drawImage(bgImg, 0, 0, w, h);
    else { ctx.fillStyle = "#050505"; ctx.fillRect(0,0,w,h); }

    if (gear.active) {
        // Charging Logic
        if (gear.gesture === "CHARGE") {
            gear.charge = Math.min(100, gear.charge + 2);
            // Visual Charge Orb
            ctx.beginPath();
            ctx.arc(gear.x, gear.y - 40, gear.charge/2, 0, Math.PI*2);
            ctx.fillStyle = `rgba(255, 255, 255, ${gear.charge/100})`;
            ctx.fill();
        } else {
            // Fire Big Cannon
            if (gear.charge >= 100) {
                projectiles.push({x: gear.x, y: gear.y, vx: 0, vy: -20, type: "MEGA", color: "#fff"});
            }
            gear.charge = 0;
            
            // Rapid Fire
            if (frame % 10 === 0) {
                if (gear.gesture === "BOLT") {
                    projectiles.push({x: gear.x, y: gear.y, vx: 0, vy: -25, type: "SMALL", color: "#0ff"});
                }
                if (gear.gesture === "SPLIT") {
                    projectiles.push({x: gear.x, y: gear.y, vx: -5, vy: -20, type: "SMALL", color: "#0ff"});
                    projectiles.push({x: gear.x, y: gear.y, vx: 5, vy: -20, type: "SMALL", color: "#0ff"});
                }
            }
        }
    }

    // Spawn Enemies
    if (frame % 60 === 0) enemies.push({ x: Math.random() * w, y: -100, hp: 3 });

    // Projectile Engine (Fixed Bullets)
    projectiles.forEach((p, i) => {
        p.x += (p.vx || 0);
        p.y += p.vy;
        
        ctx.fillStyle = p.color;
        const size = p.type === "MEGA" ? 60 : 6;
        const length = p.type === "MEGA" ? 150 : 30;
        ctx.fillRect(p.x - size/2, p.y, size, length);

        if (p.y < -300) projectiles.splice(i, 1); // Aggressive cleanup
    });

    // Enemy AI
    enemies.forEach((e, i) => {
        e.y += 3;
        if (enemyImg.complete) ctx.drawImage(enemyImg, e.x-30, e.y-30, 60, 60);
        else { ctx.strokeStyle = "red"; ctx.strokeRect(e.x-25, e.y-25, 50, 50); }

        projectiles.forEach((p, pi) => {
            if (Math.hypot(p.x - e.x, p.y - e.y) < 40) {
                e.hp -= (p.type === "MEGA" ? 10 : 1);
                if (p.type !== "MEGA") projectiles.splice(pi, 1);
                if (e.hp <= 0) { enemies.splice(i, 1); score += 100; }
            }
        });
        if (e.y > h + 100) enemies.splice(i, 1);
    });

    drawBionicChassis();
}

function drawBionicChassis() {
    if (!gear.active) return;
    ctx.save();
    ctx.translate(gear.x, gear.y);
    ctx.rotate(gear.angle);
    
    // The Bionic Robot Arm
    ctx.shadowBlur = 15; ctx.shadowColor = "#00ffff";
    ctx.strokeStyle = "#00ffff";
    ctx.lineWidth = 3;
    ctx.fillStyle = "rgba(0, 50, 50, 0.8)";
    
    // Main Body
    ctx.beginPath();
    ctx.moveTo(-30, 40); ctx.lineTo(30, 40);
    ctx.lineTo(20, -50); ctx.lineTo(-20, -50);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    
    // Shoulder Pistons
    ctx.strokeRect(-40, 0, 10, 40);
    ctx.strokeRect(30, 0, 10, 40);
    
    ctx.restore();
}

function loop() {
    frame++;
    if (currentState === "DRILLING") drawDrillingScene();
    else drawCombatScene();
    requestAnimationFrame(loop);
}
loop();