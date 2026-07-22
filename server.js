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

/* ── 갤러리 저장소 (uploads 폴더 + 메타 파일) ── */
const UP_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UP_DIR, { recursive: true });
const META_FILE = path.join(UP_DIR, 'meta.json');
let galleries = { game: [], toon: [] };
try {
  const loaded = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  if (loaded.game && loaded.toon) galleries = loaded;
} catch {}
const saveMeta = () => fs.writeFile(META_FILE, JSON.stringify(galleries), () => {});
let imgSeq = Date.now();
const MAX_IMAGES = 60;               // 갤러리당 보관 개수 (넘치면 오래된 것부터 삭제)

/* ── 정적 파일 + API 서버 ── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // 갤러리 목록 조회
  if (req.method === 'GET' && urlPath === '/api/gallery') {
    const q = new URL(req.url, 'http://x').searchParams.get('g');
    const g = q === 'toon' ? 'toon' : 'game';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: galleries[g] }));
    return;
  }

  // 작품 업로드
  if (req.method === 'POST' && urlPath === '/api/upload') {
    let body = '', size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 5e6) { req.destroy(); return; }   // 5MB 요청 상한
      body += c;
    });
    req.on('end', () => {
      try {
        const m = JSON.parse(body);
        const g = m.g === 'toon' ? 'toon' : 'game';
        const name = String(m.name || '익명').slice(0, 20);
        const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(m.data || '');
        if (!match) { res.writeHead(400); res.end('{}'); return; }
        const buf = Buffer.from(match[2], 'base64');
        if (buf.length > 3.5e6) { res.writeHead(413); res.end('{}'); return; }
        const id = (imgSeq++).toString(36);
        const fname = `${g}-${id}.${match[1] === 'png' ? 'png' : 'jpg'}`;
        fs.writeFileSync(path.join(UP_DIR, fname), buf);
        const item = { id, name, ts: Date.now(), url: '/uploads/' + fname };
        galleries[g].push(item);
        while (galleries[g].length > MAX_IMAGES) {
          const old = galleries[g].shift();
          try { fs.unlinkSync(path.join(__dirname, old.url)); } catch {}
        }
        saveMeta();
        // 접속 중인 모두에게 새 작품 알림 (액자 실시간 갱신)
        players.forEach(p => send(p.ws, { t: 'gimg', g, item }));
        console.log(`[🎨] ${name} → ${g} 갤러리 업로드 (${(buf.length/1024)|0}KB)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, item }));
      } catch (e) {
        res.writeHead(400); res.end('{}');
      }
    });
    return;
  }

  // 정적 파일
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
        hair: m.hair | 0, shirt: m.shirt | 0, cape: m.cape | 0,
        sword: m.sword | 0, eye: m.eye | 0,
      };
      players.set(id, { ws, profile, state: { x: 0, y: 0, z: 8, ry: 0, m: false, r: false, lv: 1 } });
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
      s.ry = +m.ry || 0; s.m = !!m.m; s.r = !!m.r; s.lv = Math.max(1, m.lv | 0);
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
