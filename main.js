/**
 * OBSERVER_ENGINE // COMPLETE SOURCE // VER 6.6
 * FEATURES: ALPHA-FADE TRANSITIONS // SCREEN SHAKE // PERSISTENT DATA
 * LOGIC: STATE INTERCEPTION // ASYNC LERP // GLOBAL ALPHA WRAPPER
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

// --- 1. ASSET & TEXTURE GENERATOR ---
const assets = {};
const assetFiles = {
    intro: "intro.png", startBtn: "start_btn.png", gameOver: "gameover.png",
    drill: "drill.png", rock: "obstacle.png", enemy: "enemy.png",
    bg: "background.png", stalactite: "stalactite.png", cannonball: "cannonball.png"
};

let dirtPattern;
function createDirtTexture() {
    const dSize = 128;
    const dCanvas = document.createElement('canvas');
    dCanvas.width = dSize; dCanvas.height = dSize;
    const dCtx = dCanvas.getContext('2d');
    dCtx.fillStyle = "#1a0f00"; dCtx.fillRect(0,0,dSize,dSize);
    for(let i=0; i<400; i++) {
        const x = Math.random()*dSize; const y = Math.random()*dSize;
        const s = Math.random()*4;
        dCtx.fillStyle = Math.random() > 0.5 ? "#2a1a00" : "#120800";
        dCtx.fillRect(Math.floor(x), Math.floor(y), s, s);
    }
    dirtPattern = ctx.createPattern(dCanvas, 'repeat');
}

async function loadAssets() {
    const promises = Object.keys(assetFiles).map(key => {
        return new Promise((res) => {
            const img = new Image();
            img.onload = () => { assets[key] = img; res(); };
            img.src = assetFiles[key];
        });
    });
    await Promise.all(promises);
    createDirtTexture();
}

// --- 2. GLOBAL STATE & TRANSITION LOGIC ---
let currentState = "INTRO"; 
let nextState = null;
let transitionAlpha = 0; // 0 to 1
let transitionDir = 1; // 1 for fading out, -1 for fading in
let isTransitioning = false;

let gameTimer = 0, frame = 0, hp = 100, score = 0, freezeTimer = 0;
let gear = { x: 0, y: 0, active: false, gesture: "IDLE", charge: 0, rawLM: null };
let obstacles = [], projectiles = [], enemies = [];
let activeSingularity = null, singularityCooldown = 0;
let gestureHistory = [];
const FILTER_STRENGTH = 3; 
const BARRIER_RADIUS = 100;

function triggerTransition(toState) {
    if (isTransitioning) return;
    nextState = toState;
    isTransitioning = true;
    transitionAlpha = 0;
    transitionDir = 1;
}

// --- 3. VISION SYSTEM ---
const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.7 });

hands.onResults((res) => {
    pctx.clearRect(0, 0, 320, 180);
    pctx.drawImage(res.image, 0, 0, 320, 180);
    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
        const lm = res.multiHandLandmarks[0];
        gear.rawLM = lm; gear.active = true;
        gear.x += ((1 - lm[9].x) * w - gear.x) * 0.4;
        gear.y += (lm[9].y * h - gear.y) * 0.4;
        const f = [
            Math.hypot(lm[8].x - lm[0].x, lm[8].y - lm[0].y) > Math.hypot(lm[6].x - lm[0].x, lm[6].y - lm[0].y) * 1.2,
            Math.hypot(lm[12].x - lm[0].x, lm[12].y - lm[0].y) > Math.hypot(lm[10].x - lm[0].x, lm[10].y - lm[0].y) * 1.2,
            Math.hypot(lm[16].x - lm[0].x, lm[16].y - lm[0].y) > Math.hypot(lm[14].x - lm[0].x, lm[14].y - lm[0].y) * 1.2,
            Math.hypot(lm[20].x - lm[0].x, lm[20].y - lm[0].y) > Math.hypot(lm[18].x - lm[0].x, lm[18].y - lm[0].y) * 1.2
        ];
        const pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
        let rawG = "IDLE";
        if (pinch < 0.05 && f[1] && f[2] && f[3]) rawG = "SINGULARITY";
        else if (f[0] && f[3] && !f[1] && !f[2]) rawG = "FREEZE";
        else if (f[0] && f[1] && f[2] && f[3]) rawG = (gear.charge > 30) ? "FIRE_CANNON" : "OPEN";
        else if (!f[0] && !f[1] && !f[2] && !f[3]) rawG = "CHARGE";
        else if (f[0] && f[1] && !f[2] && !f[3]) rawG = "PEACE";
        else if (f[0] && !f[1] && !f[2] && !f[3]) rawG = "SINGLE";
        gestureHistory.push(rawG);
        if (gestureHistory.length > FILTER_STRENGTH) gestureHistory.shift();
        if (gestureHistory.every(g => g === rawG)) gear.gesture = rawG;
        if (gear.gesture === "SINGULARITY" && !activeSingularity && singularityCooldown <= 0) {
            activeSingularity = { x: gear.x, y: gear.y, timer: 300 };
            singularityCooldown = 600;
        }
    } else gear.active = false;
});

// --- 4. PHASE RENDERING ---
function drawHUD() {
    const boxX = 25, boxY = 25, boxW = 240, boxH = 100;
    ctx.fillStyle = "rgba(0, 10, 25, 0.9)";
    ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 12); ctx.fill();
    ctx.strokeStyle = "#0ff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = "center"; 
    ctx.fillStyle = "#0ff"; ctx.font = "bold 12px Orbitron";
    ctx.fillText("PILOT XP STATUS", boxX + boxW/2, boxY + 35);
    ctx.fillStyle = "white"; ctx.font = "bold 28px Orbitron";
    ctx.fillText(score.toString().padStart(6, '0'), boxX + boxW/2, boxY + 70);
    const bW = 400, bH = 14, bx = w/2 - 200, by = 30;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bx-2, by-2, bW+4, bH+4);
    ctx.fillStyle = `hsl(${(hp/100)*120}, 100%, 50%)`;
    ctx.fillRect(bx, by, (Math.max(0, hp)/100)*bW, bH);
}

function drawDrilling() {
    gameTimer++;
    if (gameTimer > 800) { triggerTransition("COMBAT"); return; }
    if (hp <= 0) { triggerTransition("GAMEOVER"); return; }
    ctx.save();
    ctx.translate(0, (frame * 15) % 128);
    ctx.fillStyle = dirtPattern;
    ctx.fillRect(0, -128, w, h + 256);
    ctx.restore();
    if (frame % 45 === 0) obstacles.push({ x: Math.random() * w, y: -200 });
    obstacles.forEach((o, i) => {
        o.y += 18;
        ctx.save(); ctx.translate(o.x, o.y); ctx.scale(2.5, 2.5);
        ctx.drawImage(assets.rock, -assets.rock.width/2, -assets.rock.height/2); ctx.restore();
        if (gear.active && Math.hypot(gear.x - o.x, (h*0.7) - o.y) < 85) { hp -= 8; o.y -= 200; }
        if (o.y > h + 200) { obstacles.splice(i, 1); score += 100; }
    });
    if (gear.active) {
        ctx.save(); ctx.translate(gear.x, h*0.7); ctx.scale(0.2, 0.2);
        ctx.drawImage(assets.drill, -assets.drill.width/2, -assets.drill.height/2); ctx.restore();
    }
}

function drawCombat() {
    if (hp <= 0) { triggerTransition("GAMEOVER"); return; }
    ctx.drawImage(assets.bg, 0, 0, w, h);
    if (freezeTimer > 0) freezeTimer--;
    if (singularityCooldown > 0) singularityCooldown--;
    let takingDamage = false;

    if (activeSingularity) {
        activeSingularity.timer--;
        ctx.beginPath(); ctx.arc(activeSingularity.x, activeSingularity.y, 55, 0, Math.PI*2);
        ctx.strokeStyle = "magenta"; ctx.lineWidth = 3; ctx.stroke();
        if (activeSingularity.timer <= 0) activeSingularity = null;
    }

    if (gear.active && gear.rawLM) {
        const lm = gear.rawLM;
        const iTip = { x: (1-lm[8].x)*w, y: lm[8].y*h };
        const iKnuckle = { x: (1-lm[5].x)*w, y: lm[5].y*h };
        const dx = iTip.x - iKnuckle.x, dy = iTip.y - iKnuckle.y, dist = Math.hypot(dx, dy)||1;
        const iVec = { x: dx/dist, y: dy/dist, angle: Math.atan2(dy, dx) };
        if (gear.gesture === "SINGLE" && frame % 8 === 0) {
            projectiles.push({x: iTip.x, y: iTip.y, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
        } 
        else if (gear.gesture === "PEACE" && frame % 10 === 0) {
            const mTip = { x: (1-lm[12].x)*w, y: lm[12].y*h };
            projectiles.push({x: iTip.x, y: iTip.y, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
            projectiles.push({x: mTip.x, y: mTip.y, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
        } 
        else if (gear.gesture === "CHARGE") {
            gear.charge = Math.min(400, gear.charge + 15);
            ctx.fillStyle = "rgba(0, 255, 255, 0.3)";
            ctx.beginPath(); ctx.arc((1-lm[9].x)*w, lm[9].y*h, gear.charge/5, 0, Math.PI*2); ctx.fill();
        } 
        else if (gear.gesture === "FIRE_CANNON") {
            projectiles.push({x: (1-lm[9].x)*w, y: lm[9].y*h, vx: iVec.x*22, vy: iVec.y*22, type: "CANNON", size: 65 + gear.charge/4});
            gear.charge = 0;
        }
    }

    projectiles.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        ctx.save(); ctx.translate(p.x, p.y);
        if (p.type === "STALACTITE") {
            ctx.rotate(p.angle + Math.PI/2);
            ctx.drawImage(assets.stalactite, -20, -40, 40, 80);
        } else {
            ctx.drawImage(assets.cannonball, -p.size/2, -p.size/2, p.size, p.size);
        }
        ctx.restore();
        if (p.y < -300 || p.y > h+300 || p.x < -300 || p.x > w+300) projectiles.splice(i, 1);
    });

    if (frame % 40 === 0 && freezeTimer <= 0) enemies.push({ x: Math.random()*w, y: -100, z: 0.1, hp: 4 });
    enemies.forEach((e, i) => {
        if (freezeTimer <= 0) {
            e.z = Math.min(3.5, e.z + 0.018);
            let d = Math.hypot(gear.x - e.x, gear.y - e.y);
            if (gear.active && d < BARRIER_RADIUS) {
                let angle = Math.atan2(gear.y - e.y, gear.x - e.x);
                e.x = gear.x - Math.cos(angle) * BARRIER_RADIUS;
                e.y = gear.y - Math.sin(angle) * BARRIER_RADIUS;
                hp -= 0.15; takingDamage = true;
            }
            if (activeSingularity) {
                let sd = Math.hypot(activeSingularity.x - e.x, activeSingularity.y - e.y);
                if (sd > 110) { e.x += (activeSingularity.x - e.x) * 0.12; e.y += (activeSingularity.y - e.y) * 0.12; }
            } else {
                e.x += ((gear.x - e.x)/(d||1)) * 4; e.y += ((gear.y - e.y)/(d||1)) * 4 + 2;
            }
        }
        ctx.save(); ctx.translate(e.x, e.y); ctx.scale(e.z, e.z);
        ctx.drawImage(assets.enemy, -30, -30, 60, 60); ctx.restore();
        projectiles.forEach((p, pi) => {
            if (Math.hypot(p.x - e.x, p.y - e.y) < 55 * e.z) {
                e.hp -= (p.type === "CANNON") ? 18 : 2;
                if (p.type !== "CANNON") projectiles.splice(pi, 1);
                if (e.hp <= 0) { enemies.splice(i, 1); score += 300; }
            }
        });
    });

    if (gear.active) {
        ctx.beginPath(); ctx.arc(gear.x, gear.y, BARRIER_RADIUS, 0, Math.PI*2);
        ctx.strokeStyle = takingDamage ? `rgba(0, 255, 255, ${0.5 + Math.sin(frame/2)*0.3})` : "rgba(0, 255, 255, 0.1)";
        ctx.lineWidth = takingDamage ? 4 : 1; ctx.stroke();
        const lm = gear.rawLM;
        ctx.save(); ctx.translate(gear.x, gear.y); ctx.scale(0.3, 0.3);
        ctx.strokeStyle = (singularityCooldown > 300) ? "magenta" : (freezeTimer > 0 ? "#0ff" : "white"); 
        ctx.lineWidth = 14;
        [[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20],[5,9,13,17,0]].forEach(c => {
            ctx.beginPath();
            c.forEach((idx, ii) => {
                const rx = (lm[9].x - lm[idx].x) * w, ry = (lm[idx].y - lm[9].y) * h;
                if (ii === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
            });
            ctx.stroke();
        });
        ctx.restore();
    }
}

// --- 5. MAIN LOOP ---
async function startSystem() {
    await loadAssets();
    const camera = new Camera(video, { onFrame: async () => { await hands.send({image: video}); }, width: 640, height: 480 });
    camera.start();
    
    requestAnimationFrame(function loop() {
        frame++;
        
        // Handle Transitions
        if (isTransitioning) {
            transitionAlpha += 0.04 * transitionDir;
            if (transitionAlpha >= 1) {
                currentState = nextState;
                transitionDir = -1;
                // Reset state specific variables
                if (currentState === "DRILLING") { hp = 100; score = 0; obstacles = []; enemies = []; projectiles = []; gameTimer = 0; }
            }
            if (transitionAlpha <= 0 && transitionDir === -1) {
                isTransitioning = false;
            }
        }

        ctx.clearRect(0,0,w,h);
        
        // Draw Current State
        if (currentState === "INTRO") {
            ctx.drawImage(assets.intro, 0, 0, w, h);
            ctx.drawImage(assets.startBtn, w/2 - 150, h * 0.72, 300, 120);
        } else if (currentState === "DRILLING") drawDrilling();
        else if (currentState === "COMBAT") drawCombat();
        else if (currentState === "GAMEOVER") {
            ctx.drawImage(assets.gameOver, 0, 0, w, h);
            ctx.fillStyle = "white"; ctx.font = "bold 34px Orbitron"; ctx.textAlign = "center";
            ctx.fillText(`PILOT SCORE: ${score}`, w/2, h/2 + 60);
        }

        if (currentState !== "INTRO") { ctx.textAlign = "center"; drawHUD(); }

        // Draw Fade Overlay
        if (isTransitioning || transitionAlpha > 0) {
            ctx.fillStyle = `rgba(0, 0, 0, ${transitionAlpha})`;
            ctx.fillRect(0, 0, w, h);
        }

        requestAnimationFrame(loop);
    });
}

canvas.addEventListener('mousedown', () => {
    if (currentState === "INTRO") triggerTransition("DRILLING");
    else if (currentState === "GAMEOVER") triggerTransition("INTRO");
});
startSystem();