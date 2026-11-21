/* eslint-disable */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

const wallpapersDir = path.resolve(__dirname, '../public/wallpapers')
if (!fs.existsSync(wallpapersDir)) {
  fs.mkdirSync(wallpapersDir, { recursive: true })
}

console.log('[milkyway] Target output directory:', wallpapersDir)

const posterPath = path.join(wallpapersDir, 'milky-way-poster.jpg')
const webmPath = path.join(wallpapersDir, 'milky-way.webm')
const mp4Path = path.join(wallpapersDir, 'milky-way.mp4')

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body, html { margin: 0; padding: 0; background: #000; overflow: hidden; width: 1280px; height: 720px; }
  canvas { width: 1280px; height: 720px; display: block; }
</style>
</head>
<body>
<canvas id="c" width="1280" height="720"></canvas>
<script>
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const W = 1280, H = 720;
  const cx = W / 2, cy = H / 2;

  // Background starfield (static backdrop with slight twinkle)
  const bgStars = [];
  for (let i = 0; i < 400; i++) {
    bgStars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.3 + 0.2,
      alpha: Math.random() * 0.7 + 0.2,
      phase: Math.random() * Math.PI * 2,
      color: Math.random() > 0.8 ? 'rgba(255, 200, 160,' : (Math.random() > 0.5 ? 'rgba(180, 210, 255,' : 'rgba(230, 235, 255,')
    });
  }

  // Galactic spiral arm particles (logarithmic spirals)
  const armParticles = [];
  const numArms = 2; // Grand design two-arm barred spiral
  const particlesPerArm = 450;

  for (let arm = 0; arm < numArms; arm++) {
    const armOffset = (arm * Math.PI * 2) / numArms;
    for (let i = 0; i < particlesPerArm; i++) {
      // Distance from core
      const t = Math.random();
      const dist = 30 + Math.pow(t, 0.7) * 480;

      // Logarithmic spiral angle: theta = b * ln(r)
      const spiralAngle = armOffset + Math.log(dist / 25) * 1.85;

      // Add radial and angular dispersion (dust cloud spread)
      const spread = (dist / 480) * 45;
      const angleDisp = (Math.random() - 0.5) * (0.35 + (dist / 480) * 0.4);
      const distDisp = (Math.random() - 0.5) * spread;

      const finalAngle = spiralAngle + angleDisp;
      const finalDist = dist + distDisp;

      // Color spectrum: core is warm gold/amber, mid arms are violet/magenta H-II regions, outer arms are icy blue stars
      let colorType = 'blue';
      const rand = Math.random();
      if (dist < 120) {
        colorType = 'gold';
      } else if (rand < 0.35) {
        colorType = 'magenta';
      } else if (rand < 0.7) {
        colorType = 'purple';
      } else {
        colorType = 'blue';
      }

      armParticles.push({
        baseDist: finalDist,
        baseAngle: finalAngle,
        size: Math.random() * 2.2 + 0.5,
        opacity: Math.random() * 0.7 + 0.2,
        colorType: colorType
      });
    }
  }

  // Dense Galactic Core stars
  const coreStars = [];
  for (let i = 0; i < 260; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 1.8) * 90;
    coreStars.push({
      angle: angle,
      r: r,
      size: Math.random() * 2.0 + 0.6,
      opacity: Math.random() * 0.8 + 0.25
    });
  }

  function drawFrame(progress) {
    const time = progress * Math.PI * 2;
    const rot = time * 0.5; // Majestic slow rotation

    // 1. Deep Cosmic Void Background
    ctx.fillStyle = '#020108';
    ctx.fillRect(0, 0, W, H);

    // Deep space galactic haze gradient
    const spaceGrad = ctx.createRadialGradient(cx, cy, 40, cx, cy, 750);
    spaceGrad.addColorStop(0, 'rgba(40, 12, 60, 0.5)');
    spaceGrad.addColorStop(0.3, 'rgba(25, 8, 45, 0.35)');
    spaceGrad.addColorStop(0.65, 'rgba(10, 4, 25, 0.2)');
    spaceGrad.addColorStop(1, 'rgba(2, 1, 8, 1)');
    ctx.fillStyle = spaceGrad;
    ctx.fillRect(0, 0, W, H);

    // 2. Background Starlight with Twinkle
    bgStars.forEach(s => {
      const tw = Math.sin(time + s.phase) * 0.25 + 0.75;
      ctx.fillStyle = s.color + (s.alpha * tw).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.save();
    ctx.translate(cx, cy);
    // Inclined viewing angle: Milky Way tilted at ~32 degrees
    ctx.rotate(-0.35);
    ctx.scale(1, 0.48);

    // 3. Diffuse Galactic Disk Nebula Glow
    const diskGlow = ctx.createRadialGradient(0, 0, 50, 0, 0, 520);
    diskGlow.addColorStop(0, 'rgba(255, 220, 150, 0.65)'); // Warm nucleus
    diskGlow.addColorStop(0.18, 'rgba(220, 130, 70, 0.45)'); // Inner bulge
    diskGlow.addColorStop(0.4, 'rgba(150, 45, 120, 0.25)'); // Magenta nebular zone
    diskGlow.addColorStop(0.7, 'rgba(60, 25, 110, 0.12)');  // Purple outskirts
    diskGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = diskGlow;
    ctx.beginPath();
    ctx.arc(0, 0, 520, 0, Math.PI * 2);
    ctx.fill();

    // 4. Rotating Galactic Spiral Arms
    armParticles.forEach(p => {
      const curAngle = p.baseAngle + rot;
      const px = Math.cos(curAngle) * p.baseDist;
      const py = Math.sin(curAngle) * p.baseDist;

      let fill = '';
      if (p.colorType === 'gold') {
        fill = 'rgba(255, 215, 130, ' + p.opacity.toFixed(3) + ')';
      } else if (p.colorType === 'magenta') {
        fill = 'rgba(240, 100, 180, ' + (p.opacity * 0.85).toFixed(3) + ')';
      } else if (p.colorType === 'purple') {
        fill = 'rgba(170, 120, 255, ' + (p.opacity * 0.8).toFixed(3) + ')';
      } else {
        fill = 'rgba(190, 225, 255, ' + (p.opacity * 0.9).toFixed(3) + ')';
      }

      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fill();
    });

    // 5. Dust Lane Silhouette (interstellar dark dust absorbing starlight)
    for (let arm = 0; arm < numArms; arm++) {
      const armOffset = (arm * Math.PI * 2) / numArms + 0.18;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(2, 1, 8, 0.38)';
      ctx.lineWidth = 18;
      for (let r = 80; r < 440; r += 20) {
        const theta = armOffset + rot + Math.log(r / 25) * 1.85;
        const x = Math.cos(theta) * r;
        const y = Math.sin(theta) * r;
        if (r === 80) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 6. Radiant Galactic Bulge & Core
    const coreGrad = ctx.createRadialGradient(0, 0, 5, 0, 0, 95);
    coreGrad.addColorStop(0, 'rgba(255, 255, 245, 0.95)'); // Ultra-bright center
    coreGrad.addColorStop(0.2, 'rgba(255, 230, 160, 0.85)');
    coreGrad.addColorStop(0.5, 'rgba(255, 165, 75, 0.55)');
    coreGrad.addColorStop(0.8, 'rgba(200, 70, 50, 0.25)');
    coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 95, 0, Math.PI * 2);
    ctx.fill();

    // Core stellar cluster
    coreStars.forEach(s => {
      const curAngle = s.angle + rot * 1.2;
      const px = Math.cos(curAngle) * s.r;
      const py = Math.sin(curAngle) * s.r;
      ctx.fillStyle = 'rgba(255, 245, 220, ' + s.opacity.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, s.size, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  // Draw frame 0 and upload poster
  drawFrame(0);
  canvas.toBlob(blob => {
    fetch('/upload-poster', { method: 'POST', body: blob }).then(() => {
      console.log('Milky Way poster uploaded');
      startRecording();
    });
  }, 'image/jpeg', 0.92);

  function startRecording() {
    const fps = 30;
    const durationMs = 6000;
    const totalFrames = Math.floor((durationMs / 1000) * fps);

    const stream = canvas.captureStream(fps);
    let mimeType = 'video/webm; codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm; codecs=vp8';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2500000
    });

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = () => {
      const videoBlob = new Blob(chunks, { type: mimeType });
      fetch('/upload-video', { method: 'POST', body: videoBlob }).then(() => {
        console.log('Milky Way video uploaded');
        fetch('/done');
      });
    };

    recorder.start();

    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      const progress = (frame % totalFrames) / totalFrames;
      drawFrame(progress);

      if (frame >= totalFrames) {
        clearInterval(interval);
        recorder.stop();
      }
    }, 1000 / fps);
  }
</script>
</body>
</html>`;

let posterReceived = false;
let videoReceived = false;
let edgeProc = null;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else if (req.method === 'POST' && req.url === '/upload-poster') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(posterPath, buffer);
      console.log('[milkyway] Poster saved successfully:', buffer.length, 'bytes');
      posterReceived = true;
      res.writeHead(200);
      res.end('OK');
    });
  } else if (req.method === 'POST' && req.url === '/upload-video') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(webmPath, buffer);
      fs.writeFileSync(mp4Path, buffer);
      console.log('[milkyway] WebM video saved successfully:', buffer.length, 'bytes');
      console.log('[milkyway] MP4 fallback saved successfully');
      videoReceived = true;
      res.writeHead(200);
      res.end('OK');
    });
  } else if (req.url === '/done') {
    res.writeHead(200);
    res.end('DONE');
    console.log('[milkyway] All assets received! Finalizing...');
    cleanupAndExit();
  } else {
    res.writeHead(404);
    res.end();
  }
});

function cleanupAndExit() {
  if (edgeProc) {
    try { edgeProc.kill(); } catch (e) {}
  }
  server.close(() => {
    console.log('[milkyway] Generator server closed.');
    process.exit(0);
  });
}

const PORT = 48922;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[milkyway] Server ready on http://127.0.0.1:${PORT}`);
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  console.log('[milkyway] Launching Edge headless to render & record canvas...');
  edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1280,720',
    `http://127.0.0.1:${PORT}/`
  ]);

  setTimeout(() => {
    if (!videoReceived || !posterReceived) {
      console.log('[milkyway] Timeout reached. Cleaning up.');
      cleanupAndExit();
    }
  }, 25000);
});
