/**
 * OBSERVER_ENGINE // COMPLETE SOURCE // VER 2.3
 * FIXED: UPWARD ASCENT LOGIC (Obstacles spawn top, move down)
 * FIXED: INVERSION TOGGLE & TILT OFFSET
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

// --- CONFIGURATION ---
const INVERT_X = true; // TOGGLE THIS if left/right is still wrong
const DRILL_SCALE = 0.5; 
const TILT_OFFSET = -0.25; // Neutralizes natural wrist slant (~15 degrees)
const PHASE_DURATION = 600; 

// --- GAME STATE ---
let currentState = "DRILLING"; 
let gameTimer = 0; 
let score = 0;
let frame = 0;
let hp = 100;

// Movement & Vision
let gear = { x: w/2, y: h/2, angle: 0, active: false, lm: null, gesture: "IDLE", charge: 0 };
let lerp = 0.25;

// Phase A: Drilling (Ascent)
let drillSpeed = 12;
let dirtOffset = 0;
let obstacles = [];

// Phase B: Combat
let projectiles = [];
let enemies = [];

// --- ASSET LOADING ---
const drillImage = new Image();
drillImage.src = "drill.png"; 
let drillLoaded = false;
drillImage.onload = () => { drillLoaded = true; };
drillImage.onerror = () => {
    const temp = document.createElement('canvas');
    temp.width = 40; temp.height = 80;
    const tctx = temp.getContext('2d');
    tctx.fillStyle = "#ffaa00"; tctx.fillRect(10, 0, 20, 60);
    drillImage.src = temp.toDataURL();
    drillLoaded = true;
};

// --- VISION PIPELINE ---
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
        
        // Handle Inversion Logic
        const rawX = lm[9].x;
        const tx = INVERT_X ? rawX * w : (1 - rawX) * w; 
        const ty = lm[9].y * h;

        gear.x += (tx - gear.x) * lerp;
        gear.y += (ty - gear.y) * lerp;
        gear.lm = lm;
        gear.active = true;
        
        // Apply Angle Offset to make the tool feel "Straight"
        gear.angle = Math.atan2(lm[9].y - lm[0].y, lm[9].x - lm[0].x) + Math.PI/2 + TILT_OFFSET;

        if (currentState === "COMBAT") {
            const up = (i) => lm[i].y < lm[i-2].y;
            const iUp = up(8), mUp = up(12);
            if (iUp && !mUp) gear.gesture = "BOLT";
            else if (!iUp && !mUp) gear.gesture = "CHARGE";
            else if (iUp && mUp) gear.gesture = "SPLIT";
            else gear.gesture = "IDLE";
        }
    } else { gear.active = false; }
});

new Camera(video, { onFrame: async () => { await hands.send({image: video}); }, width: 640, height: 480 }).start();

// --- SCENES ---

function drawDrillingScene() {
    gameTimer++;
    dirtOffset += drillSpeed; // Moves background down

    if (gameTimer > PHASE_DURATION) {
        currentState = "COMBAT";
        obstacles = []; // Clear for clean transition
        return;
    }

    // Background: Moving UP means Dirt moves DOWN
    ctx.fillStyle = "#4d2600";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#331a00";
    for (let i = 0; i < w; i += 60) {
        let yPos = (i + dirtOffset) % h;
        ctx.fillRect(i, yPos, 30, 150);
    }

    // Obstacles: Spawning at TOP, moving DOWN
    if (frame % 15 === 0) {
        obstacles.push({ x: Math.random() * w, y: -100, s: 50 + Math.random() * 70 });
    }

    ctx.fillStyle = "#1a0d00";
    ctx.strokeStyle = "#663300";
    ctx.lineWidth = 4;

    obstacles.forEach((o, i) => {
        o.y += drillSpeed; // Move downward
        ctx.fillRect(o.x - o.s/2, o.y - o.s/2, o.s, o.s);
        ctx.strokeRect(o.x - o.s/2, o.y - o.s/2, o.s, o.s);
        
        // Hitbox check
        if (gear.active && Math.hypot(gear.x - o.x, gear.y - o.y) < (o.s/2 + 10)) {
            hp -= 0.4;
            ctx.fillStyle = "rgba(255, 50, 0, 0.4)";
            ctx.fillRect(0,0,w,h);
        }
        if (o.y > h + 100) obstacles.splice(i, 1);
    });

    // The Drill
    if (drillLoaded && gear.active) {
        ctx.save();
        ctx.translate(gear.x, gear.y);
        ctx.rotate(gear.angle + Math.sin(frame * 0.5) * 0.03); // Fast vibration
        ctx.scale(DRILL_SCALE, DRILL_SCALE);
        ctx.drawImage(drillImage, -drillImage.width/2, -drillImage.height/2);
        ctx.restore();
    }

    // HUD
    ctx.fillStyle = "#ffcc00";
    ctx.font = "bold 20px Courier New";
    ctx.fillText(`BREAKING SURFACE: ${Math.floor((gameTimer/PHASE_DURATION)*100)}%`, 40, 60);
    ctx.fillText(`SYSTEM INTEGRITY: ${Math.max(0, Math.floor(hp))}%`, 40, 90);
}

function drawCombatScene() {
    ctx.fillStyle = "rgba(5, 5, 5, 0.4)";
    ctx.fillRect(0, 0, w, h);

    if (gear.active) {
        if (gear.gesture === "CHARGE") gear.charge = Math.min(100, gear.charge + 2);
        else {
            if (gear.charge >= 100) {
                projectiles.push({x: gear.x, y: gear.y, vy: -15, c: "#fff", s: 60, type: "CANNON"});
            }
            gear.charge = 0;
        }
        if (frame % 8 === 0) {
            if (gear.gesture === "BOLT") projectiles.push({x: gear.x, y: gear.y, vy: -25, c: "#0ff", s: 4});
            if (gear.gesture === "SPLIT") {
                projectiles.push({x: gear.x, y: gear.y, vx: -6, vy: -20, c: "#0ff", s: 4});
                projectiles.push({x: gear.x, y: gear.y, vx: 6, vy: -20, c: "#0ff", s: 4});
            }
        }
    }

    if (frame % 50 === 0) enemies.push({ x: Math.random() * w, y: -50, hp: 3 });

    projectiles.forEach((p, i) => {
        p.x += (p.vx || 0); p.y += p.vy;
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x - p.s/2, p.y, p.s, p.type === "CANNON" ? 150 : 25);
        if (p.y < -200) projectiles.splice(i, 1);
    });

    enemies.forEach((e, i) => {
        e.y += 3;
        ctx.strokeStyle = "#f05";
        ctx.lineWidth = 3;
        ctx.strokeRect(e.x - 25, e.y - 25, 50, 50);
        
        projectiles.forEach((p, pi) => {
            if (Math.hypot(p.x - e.x, p.y - e.y) < 40) {
                e.hp -= (p.type === "CANNON" ? 10 : 1);
                if (p.type !== "CANNON") projectiles.splice(pi, 1);
                if (e.hp <= 0) { enemies.splice(i, 1); score += 100; }
            }
        });
        if (e.y > h) enemies.splice(i, 1);
    });

    drawBionicChassis();

    ctx.fillStyle = "#0ff";
    ctx.font = "20px Courier New";
    ctx.fillText(`NEURAL_LINK: ACTIVE // SCORE: ${score}`, 40, 60);
}

function drawBionicChassis() {
    if (!gear.active || !gear.lm) return;
    ctx.save();
    ctx.translate(gear.x, gear.y);
    ctx.rotate(gear.angle);
    ctx.shadowBlur = 20; ctx.shadowColor = "#00ffff";
    ctx.fillStyle = "#111"; ctx.strokeStyle = "#00ffff"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-40, 50); ctx.lineTo(40, 50);
    ctx.lineTo(30, -60); ctx.lineTo(-30, -60);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
}

function loop() {
    frame++;
    if (currentState === "DRILLING") drawDrillingScene();
    else drawCombatScene();
    requestAnimationFrame(loop);
}
loop();