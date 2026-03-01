/**
 * OBSERVER_ENGINE // COMPLETE SOURCE // VER 5.0
 * FEATURES: BALANCED ROCK SPANNING // COMPACT SKELETON // MECHANICAL REBOUND
 * TUNING: SPAWN_RATE 50 // HITBOX_SENSITIVITY 0.8
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

// --- 1. ASSET PRELOADER ---
const assets = {};
const assetFiles = {
    intro: "intro.png",
    startBtn: "start_btn.png",
    gameOver: "gameover.png",
    drill: "drill.png",
    rock: "obstacle.png",
    enemy: "enemy.png",
    bg: "background.png",
    stalactite: "stalactite.png",
    cannonball: "cannonball.png"
};

async function loadAssets() {
    const promises = Object.keys(assetFiles).map(key => {
        return new Promise((res, rej) => {
            const img = new Image();
            img.src = assetFiles[key];
            img.onload = () => { assets[key] = img; res(); };
            img.onerror = () => rej(`Missing: ${assetFiles[key]}`);
        });
    });
    try { await Promise.all(promises); startEngine(); } 
    catch (err) { alert(err); }
}

// --- 2. GLOBAL STATE & BALANCED PHYSICS ---
let currentState = "INTRO"; 
let gameTimer = 0, frame = 0, hp = 100, score = 0, freezeTimer = 0;
let gear = { x: 0, y: 0, active: false, gesture: "IDLE", charge: 0, rawLM: null };
let obstacles = [], projectiles = [], enemies = [];

let drillSpeed = 12; 
let bounceY = 0;     
const DRILL_HOME_Y = 0.7;
const DRILL_SCALE = 0.2, ROCK_SCALE = 2.5, PHASE_DURATION = 800, LERP = 0.35;
const HAND_UI_SCALE = 0.3; // Even smaller for better visibility

// --- 3. INPUT ---
canvas.addEventListener('mousedown', (e) => {
    if (currentState === "INTRO") {
        currentState = "DRILLING";
        hp = 100; score = 0; gameTimer = 0; bounceY = 0;
        obstacles = []; projectiles = []; enemies = [];
    } else if (currentState === "GAMEOVER") currentState = "INTRO";
});

// --- 4. GESTURE & VISION ---
function isFingerExtended(tip, pip, mcp, palm) {
    return Math.hypot(tip.x - palm.x, tip.y - palm.y) > Math.hypot(pip.x - palm.x, pip.y - palm.y) * 1.15;
}

function getFiringVector(mcp, tip) {
    const dx = (1 - tip.x) * w - (1 - mcp.x) * w;
    const dy = tip.y * h - mcp.y * h;
    const mag = Math.hypot(dx, dy) || 1;
    return { x: dx / mag, y: dy / mag, angle: Math.atan2(dy, dx) };
}

const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.8 });

hands.onResults((res) => {
    pctx.clearRect(0, 0, 320, 180);
    pctx.save(); pctx.scale(-1, 1); pctx.translate(-320, 0);
    pctx.drawImage(res.image, 0, 0, 320, 180); pctx.restore();

    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
        const lm = res.multiHandLandmarks[0];
        gear.rawLM = lm; gear.active = true;
        gear.x += ((1 - lm[9].x) * w - gear.x) * LERP;
        gear.y += (lm[9].y * h - gear.y) * LERP;
        
        const palm = lm[0];
        const f = [isFingerExtended(lm[8], lm[6], lm[5], palm), isFingerExtended(lm[12], lm[10], lm[9], palm), 
                   isFingerExtended(lm[16], lm[14], lm[13], palm), isFingerExtended(lm[20], lm[18], lm[17], palm)];
        
        if (f[0] && !f[1] && !f[2] && !f[3]) gear.gesture = "SINGLE";
        else if (f[0] && f[1] && !f[2] && !f[3]) gear.gesture = "PEACE";
        else if (f[0] && f[1] && f[2] && !f[3]) gear.gesture = "HEAL";
        else if (!f[0] && !f[1] && !f[2] && !f[3]) gear.gesture = "CHARGE";
        else if (f[0] && f[1] && f[2] && f[3]) gear.gesture = (gear.charge > 20) ? "FIRE_CANNON" : "OPEN";
        else if (f[0] && f[3] && !f[1] && !f[2]) gear.gesture = "FREEZE";
        else gear.gesture = "IDLE";
    } else gear.active = false;
});

new Camera(video, { onFrame: async () => { await hands.send({image: video}); }, width: 640, height: 480 }).start();

// --- 5. RENDER SYSTEM ---

function drawHUD() {
    const barW = 400, barH = 20, bx = w/2 - barW/2, by = 30;
    ctx.fillStyle = "rgba(20, 20, 20, 0.7)";
    ctx.fillRect(bx - 4, by - 4, barW + 8, barH + 8);
    const hue = Math.max(0, (hp / 100) * 120);
    ctx.fillStyle = `hsl(${hue}, 80%, 50%)`;
    ctx.fillRect(bx, by, (Math.max(0, hp)/100) * barW, barH);
    ctx.fillStyle = "white"; ctx.font = "bold 16px Orbitron, sans-serif";
    ctx.textAlign = "center"; ctx.fillText(`HULL INTEGRITY: ${Math.ceil(hp)}%`, w/2, by + 16);
    ctx.textAlign = "right"; ctx.fillText(`XP: ${score}`, w - 40, 45);
}

function drawDrilling() {
    gameTimer++;
    if (gameTimer > PHASE_DURATION) { currentState = "COMBAT"; return; }
    if (hp <= 0) { currentState = "GAMEOVER"; return; }
    
    ctx.fillStyle = "#1a0f00"; ctx.fillRect(0, 0, w, h);
    
    // Recovery decay
    if (bounceY > 0) { bounceY -= 2.0; if (bounceY < 0) bounceY = 0; }
    let currentDrillY = h * DRILL_HOME_Y + bounceY;

    // REDUCED SPAWN FREQUENCY: Changed from every 15/20 frames to every 50
    if (frame % 50 === 0) {
        // Lane logic: snap rocks to 5 possible columns to create corridors
        const laneWidth = w / 5;
        const lane = Math.floor(Math.random() * 5);
        obstacles.push({ x: lane * laneWidth + laneWidth/2, y: -200 });
    }

    obstacles.forEach((o, i) => {
        o.y += (bounceY > 0) ? drillSpeed * 0.4 : drillSpeed;
        ctx.save(); ctx.translate(o.x, o.y); ctx.scale(ROCK_SCALE, ROCK_SCALE);
        ctx.drawImage(assets.rock, -assets.rock.width/2, -assets.rock.height/2); ctx.restore();
        
        if (gear.active) {
            let d = Math.hypot(gear.x - o.x, currentDrillY - o.y);
            // Tighter collision radius (40 instead of 45/50)
            if (d < 40 * ROCK_SCALE) {
                hp -= 2.5;
                bounceY = 160; 
                o.y -= 70;
            }
        }
        if (o.y > h + 200) obstacles.splice(i, 1);
    });

    if (gear.active) {
        ctx.save(); ctx.translate(gear.x, currentDrillY); 
        if (bounceY > 0) ctx.translate((Math.random()-0.5)*8, 0);
        ctx.scale(DRILL_SCALE, DRILL_SCALE);
        ctx.drawImage(assets.drill, -assets.drill.width/2, -assets.drill.height/2); ctx.restore();
    }
    drawHUD();
}

function drawCombat() {
    if (hp <= 0) { currentState = "GAMEOVER"; return; }
    ctx.drawImage(assets.bg, 0, 0, w, h);
    if (freezeTimer > 0) freezeTimer--;
    
    // Combat Logic (unchanged to preserve features)
    if (gear.active && gear.rawLM) {
        const lm = gear.rawLM;
        const iData = getFiringVector(lm[5], lm[8]);
        const iTip = { x: (1 - lm[8].x) * w, y: lm[8].y * h };
        if (gear.gesture === "SINGLE" && frame % 10 === 0) {
            projectiles.push({x: iTip.x, y: iTip.y, vx: iData.x * 30, vy: iData.y * 30, angle: iData.angle, type: "STALACTITE", p: 1.2});
        } else if (gear.gesture === "PEACE" && frame % 10 === 0) {
            const mData = getFiringVector(lm[9], lm[12]);
            const mTip = { x: (1 - lm[12].x) * w, y: lm[12].y * h };
            projectiles.push({x: iTip.x, y: iTip.y, vx: iData.x * 30, vy: iData.y * 30, angle: iData.angle, type: "STALACTITE", p: 1.2});
            projectiles.push({x: mTip.x, y: mTip.y, vx: mData.x * 30, vy: mData.y * 30, angle: mData.angle, type: "STALACTITE", p: 1.2});
        } else if (gear.gesture === "CHARGE") {
            gear.charge = Math.min(350, gear.charge + 5.5);
            ctx.shadowBlur = 35; ctx.shadowColor = "white";
            ctx.beginPath(); ctx.arc(gear.x, gear.y, gear.charge/3, 0, Math.PI*2);
            ctx.fillStyle = `rgba(255, 255, 255, ${gear.charge/450})`; ctx.fill(); ctx.shadowBlur = 0;
        } else if (gear.gesture === "FIRE_CANNON") {
            projectiles.push({x: gear.x, y: gear.y, vx: iData.x * 15, vy: iData.y * 15, type: "CANNON", p: gear.charge / 7, size: gear.charge / 1.1});
            gear.charge = 0;
        } else if (gear.gesture === "HEAL" && frame % 30 === 0) hp = Math.min(100, hp + 1.5);
        else if (gear.gesture === "FREEZE" && frame % 60 === 0) freezeTimer = 180;
    }

    projectiles.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        ctx.save(); ctx.translate(p.x, p.y);
        if (p.type === "STALACTITE") {
            ctx.rotate(p.angle + Math.PI/2); ctx.shadowBlur = 20; ctx.shadowColor = "#0ff";
            ctx.drawImage(assets.stalactite, -15, -30, 30, 60);
        } else {
            ctx.shadowBlur = 45; ctx.shadowColor = "gold";
            ctx.drawImage(assets.cannonball, -p.size/2, -p.size/2, p.size, p.size);
        }
        ctx.restore(); ctx.shadowBlur = 0;
        if (p.y < -500 || p.y > h+500 || p.x < -500 || p.x > w+500) projectiles.splice(i, 1);
    });

    if (frame % 45 === 0) enemies.push({ x: Math.random() * w, y: -100, s: 0.5, hp: 4 });
    enemies.forEach((e, i) => {
        if (freezeTimer === 0) {
            let dx = gear.x - e.x, dy = gear.y - e.y, dist = Math.hypot(dx, dy) || 1;
            e.x += (dx / dist) * 2.5; e.y += (dy / dist) * 3.5 + 1;
            e.s = Math.min(2.8, e.s + 0.008);
        }
        ctx.save(); ctx.translate(e.x, e.y); ctx.scale(e.s, e.s);
        ctx.drawImage(assets.enemy, -30, -30, 60, 60); ctx.restore();
        projectiles.forEach((p, pi) => {
            if (Math.hypot(p.x - e.x, p.y - e.y) < 50 * e.s) {
                e.hp -= p.p;
                if (p.type !== "CANNON") projectiles.splice(pi, 1);
                if (e.hp <= 0) { enemies.splice(i, 1); score += 150; }
            }
        });
        if (Math.hypot(e.x - gear.x, e.y - gear.y) < 60) { hp -= 4; enemies.splice(i, 1); }
    });
    drawSkeletonHand();
    drawHUD();
}

function drawSkeletonHand() {
    if (!gear.active || !gear.rawLM) return;
    const lm = gear.rawLM;
    const center = lm[9]; 
    ctx.save();
    ctx.translate(gear.x, gear.y);
    ctx.scale(HAND_UI_SCALE, HAND_UI_SCALE);
    ctx.strokeStyle = (freezeTimer > 0) ? "#0ff" : "white"; 
    ctx.lineWidth = 15; ctx.shadowBlur = 15; ctx.shadowColor = ctx.strokeStyle;
    const connections = [[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20],[5,9,13,17,0]];
    connections.forEach(chain => {
        ctx.beginPath();
        chain.forEach((idx, i) => {
            const p = lm[idx];
            const rx = (center.x - p.x) * w;
            const ry = (p.y - center.y) * h;
            if (i === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
        });
        ctx.stroke();
    });
    ctx.restore();
    ctx.shadowBlur = 0;
}

function startEngine() {
    function loop() {
        frame++;
        if (currentState === "INTRO") {
            ctx.drawImage(assets.intro, 0, 0, w, h);
            ctx.drawImage(assets.startBtn, w/2 - 150, h * 0.72, 300, 120);
        } else if (currentState === "DRILLING") drawDrilling();
        else if (currentState === "COMBAT") drawCombat();
        else if (currentState === "GAMEOVER") ctx.drawImage(assets.gameOver, 0, 0, w, h);
        requestAnimationFrame(loop);
    }
    loop();
}

loadAssets();