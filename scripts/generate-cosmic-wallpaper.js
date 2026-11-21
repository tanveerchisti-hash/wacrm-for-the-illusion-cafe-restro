/* eslint-disable */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')

const wallpapersDir = path.resolve(__dirname, '../public/wallpapers')
if (!fs.existsSync(wallpapersDir)) {
  fs.mkdirSync(wallpapersDir, { recursive: true })
}

console.log('[wallpaper] Target output directory:', wallpapersDir)

const posterPath = path.join(wallpapersDir, 'sagittarius-a-poster.jpg')
const webmPath = path.join(wallpapersDir, 'sagittarius-a.webm')
const mp4Path = path.join(wallpapersDir, 'sagittarius-a.mp4')

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

  // Starfield
  const stars = [];
  for (let i = 0; i < 280; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.5 + 0.3,
      alpha: Math.random() * 0.7 + 0.3,
      phase: Math.random() * Math.PI * 2
    });
  }

  // Accretion plasma particles
  const particles = [];
  for (let i = 0; i < 350; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 100 + Math.random() * 260;
    particles.push({
      baseAngle: angle,
      dist: dist,
      orbitSpeed: (180 / dist) * 1.0,
      size: Math.random() * 2.2 + 0.6,
      opacity: Math.random() * 0.6 + 0.25
    });
  }

  function drawFrame(progress) {
    const time = progress * Math.PI * 2;

    // 1. Deep space background with subtle WACRM purple/indigo nebula
    ctx.fillStyle = '#020108';
    ctx.fillRect(0, 0, W, H);

    // Subtle galactic nebula glow
    const nebulaGrad = ctx.createRadialGradient(cx, cy, 60, cx, cy, 620);
    nebulaGrad.addColorStop(0, 'rgba(42, 14, 62, 0.45)');
    nebulaGrad.addColorStop(0.35, 'rgba(24, 9, 42, 0.25)');
    nebulaGrad.addColorStop(0.7, 'rgba(12, 6, 25, 0.12)');
    nebulaGrad.addColorStop(1, 'rgba(2, 1, 8, 1)');
    ctx.fillStyle = nebulaGrad;
    ctx.fillRect(0, 0, W, H);

    // 2. Stars with subtle twinkle
    stars.forEach(s => {
      const tw = Math.sin(time + s.phase) * 0.25 + 0.75;
      ctx.fillStyle = 'rgba(220, 225, 255, ' + (s.alpha * tw).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.save();
    ctx.translate(cx, cy);

    // 3. Gravitational Lensing (Upper & Lower bent accretion rings)
    // Top lensed arc
    const topArcGrad = ctx.createRadialGradient(0, -35, 80, 0, -35, 190);
    topArcGrad.addColorStop(0, 'rgba(255, 230, 160, 0)');
    topArcGrad.addColorStop(0.35, 'rgba(255, 175, 55, 0.7)');
    topArcGrad.addColorStop(0.65, 'rgba(215, 95, 20, 0.45)');
    topArcGrad.addColorStop(0.85, 'rgba(140, 45, 15, 0.2)');
    topArcGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = topArcGrad;
    ctx.beginPath();
    ctx.ellipse(0, -25, 220, 150, 0, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();

    // Bottom lensed arc
    const botArcGrad = ctx.createRadialGradient(0, 30, 80, 0, 30, 170);
    botArcGrad.addColorStop(0, 'rgba(255, 200, 120, 0)');
    botArcGrad.addColorStop(0.4, 'rgba(220, 120, 30, 0.4)');
    botArcGrad.addColorStop(0.75, 'rgba(130, 40, 10, 0.15)');
    botArcGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = botArcGrad;
    ctx.beginPath();
    ctx.ellipse(0, 20, 200, 120, 0, 0, Math.PI);
    ctx.fill();

    // 4. Main Accretion Disk (foreshortened horizontal disk)
    ctx.save();
    ctx.scale(1, 0.28);

    const diskGrad = ctx.createRadialGradient(-30, 0, 95, 0, 0, 380);
    diskGrad.addColorStop(0, 'rgba(255, 245, 210, 0.95)');
    diskGrad.addColorStop(0.12, 'rgba(255, 185, 45, 0.85)');
    diskGrad.addColorStop(0.35, 'rgba(235, 115, 25, 0.65)');
    diskGrad.addColorStop(0.65, 'rgba(165, 45, 30, 0.35)');
    diskGrad.addColorStop(0.85, 'rgba(85, 20, 60, 0.15)');
    diskGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = diskGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 380, 0, Math.PI * 2);
    ctx.fill();

    // Plasma wave rings
    for (let ring = 0; ring < 6; ring++) {
      ctx.strokeStyle = ring % 2 === 0 ? 'rgba(255, 220, 140, 0.25)' : 'rgba(240, 130, 30, 0.2)';
      ctx.lineWidth = 14 + ring * 6;
      ctx.beginPath();
      const rRing = 120 + ring * 40;
      ctx.ellipse(0, 0, rRing, rRing * 0.95, time * (0.8 - ring * 0.08), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Plasma particles with Doppler beaming
    particles.forEach(p => {
      const curAngle = p.baseAngle + time * p.orbitSpeed;
      const px = Math.cos(curAngle) * p.dist;
      const py = Math.sin(curAngle) * p.dist;
      const doppler = Math.max(0.2, 1.0 - (px / p.dist) * 0.45);

      ctx.fillStyle = 'rgba(255, ' + Math.floor(200 + doppler * 50) + ', ' + Math.floor(100 + doppler * 100) + ', ' + (p.opacity * doppler).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, p.size * doppler, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();

    // 5. Relativistic Photon Ring
    const photonGrad = ctx.createRadialGradient(-5, 0, 92, 0, 0, 102);
    photonGrad.addColorStop(0, 'rgba(255, 250, 230, 0.95)');
    photonGrad.addColorStop(0.4, 'rgba(255, 200, 90, 0.7)');
    photonGrad.addColorStop(0.8, 'rgba(210, 110, 30, 0.3)');
    photonGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = photonGrad;
    ctx.beginPath();
    ctx.arc(0, 0, 102, 0, Math.PI * 2);
    ctx.fill();

    // 6. The Event Horizon Shadow
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(0, 0, 93, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Draw frame 0 and upload poster
  drawFrame(0);
  canvas.toBlob(blob => {
    fetch('/upload-poster', { method: 'POST', body: blob }).then(() => {
      console.log('Poster uploaded');
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
        console.log('Video uploaded');
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
      console.log('[wallpaper] Poster saved successfully:', buffer.length, 'bytes');
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
      console.log('[wallpaper] WebM video saved successfully:', buffer.length, 'bytes');
      console.log('[wallpaper] MP4 fallback saved successfully');
      videoReceived = true;
      res.writeHead(200);
      res.end('OK');
    });
  } else if (req.url === '/done') {
    res.writeHead(200);
    res.end('DONE');
    console.log('[wallpaper] All assets received! Finalizing...');
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
    console.log('[wallpaper] Generator server closed.');
    process.exit(0);
  });
}

const PORT = 48921;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[wallpaper] Server ready on http://127.0.0.1:${PORT}`);
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  console.log('[wallpaper] Launching Edge headless to render & record canvas...');
  edgeProc = spawn(edgePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1280,720',
    `http://127.0.0.1:${PORT}/`
  ]);

  // Timeout safety
  setTimeout(() => {
    if (!videoReceived || !posterReceived) {
      console.log('[wallpaper] Timeout reached. Cleaning up.');
      cleanupAndExit();
    }
  }, 25000);
});
