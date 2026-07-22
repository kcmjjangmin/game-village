/* ═══════════════════════════════════════════════════════════
   🌸 게임&웹툰학과 마을 — 멀티플레이 서버
   ───────────────────────────────────────────────────────────
   실행 방법:
     1) Node.js 설치 (v18 이상 권장)
     2) 이 폴더에서:  npm install
     3) 실행:         npm start   (또는 node server.js)
     4) 브라우저에서  http://localhost:3000  접속

   game-village-homepage.html 파일이 이 파일과 같은 폴더에
   있어야 합니다. 접속자들의 위치를 중계(릴레이)만 하는
   가벼운 서버라 소규모 학과 홈페이지 트래픽에 충분합니다.
   ═══════════════════════════════════════════════════════════ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 60;            // 동시 접속 상한 (필요시 조정)

/* ── 정적 파일 서버 (홈페이지 HTML 서빙) ── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = urlPath === '/' ? '/game-village-homepage.html' : urlPath;
  const fp = path.join(__dirname, path.normalize(file));
  if (!fp.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ── WebSocket 릴레이 ── */
const wss = new WebSocketServer({ server });
let nextId = 1;
const players = new Map();   // id → { ws, profile, state }

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const broadcast = (obj, exceptId) => {
  players.forEach((p, id) => { if (id !== exceptId) send(p.ws, obj); });
};

wss.on('connection', ws => {
  const id = nextId++;

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'hi' && !players.has(id)) {
      if (players.size >= MAX_PLAYERS) { ws.close(); return; }
      const profile = {
        name: String(m.name || '모험가').slice(0, 20),
        hair: m.hair | 0, shirt: m.shirt | 0, cape: m.cape | 0, eye: m.eye | 0,
      };
      players.set(id, { ws, profile, state: { x: 0, y: 0, z: 8, ry: 0, m: false, r: false } });
      // 신규 접속자에게: 내 id + 기존 플레이어 목록
      const others = {};
      players.forEach((p, pid) => { if (pid !== id) others[pid] = { p: p.profile, s: p.state }; });
      send(ws, { t: 'welcome', id, players: others });
      // 기존 접속자들에게: 새 친구 등장!
      broadcast({ t: 'join', id, p: profile }, id);
      console.log(`[+] #${id} ${profile.name} 입장 (현재 ${players.size}명)`);

    } else if (m.t === 's' && players.has(id)) {
      const s = players.get(id).state;
      s.x = +m.x || 0; s.y = +m.y || 0; s.z = +m.z || 0;
      s.ry = +m.ry || 0; s.m = !!m.m; s.r = !!m.r;
      broadcast({ t: 's', id, ...s }, id);

    } else if (m.t === 'chat' && players.has(id)) {
      const p = players.get(id);
      const now = Date.now();
      if (now - (p.lastChat || 0) < 600) return;   // 도배 방지
      p.lastChat = now;
      const msg = String(m.msg || '').slice(0, 60).trim();
      if (msg) broadcast({ t: 'chat', id, msg }, id);

    } else if (m.t === 'emote' && players.has(id)) {
      const p = players.get(id);
      const now = Date.now();
      if (now - (p.lastEmote || 0) < 400) return;
      p.lastEmote = now;
      broadcast({ t: 'emote', id, e: Math.max(0, Math.min(9, m.e | 0)) }, id);
    }
  });

  ws.on('close', () => {
    if (players.has(id)) {
      const name = players.get(id).profile.name;
      players.delete(id);
      broadcast({ t: 'leave', id });
      console.log(`[-] #${id} ${name} 퇴장 (현재 ${players.size}명)`);
    }
  });
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log('🌸 게임&웹툰학과 마을 서버 실행 중!');
  console.log(`   접속 주소: http://localhost:${PORT}`);
});
