'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// COMPRESSION VIDÉO — testée avec de VRAIES vidéos (ffmpeg-static génère la
// source ET compresse). On vérifie l'objectif produit : plus léger, ≤ 720p sur
// le grand côté, faststart (moov au début), et le stockage (upsert + URL).
// ─────────────────────────────────────────────────────────────────────────────
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn, spawnSync } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');
const svc = require('../../src/services/videoCompression.service');

/** Génère une vidéo de test (mire) aux dimensions voulues → buffer MP4. */
function genererVideo(width, height, seconds = 1) {
  return new Promise((resolve, reject) => {
    const dir = os.tmpdir();
    const out = path.join(dir, `src-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
    const args = [
      '-y', '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=15:duration=${seconds}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '8000k', '-pix_fmt', 'yuv420p', out,
    ];
    const p = spawn(ffmpegPath, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', async (code) => {
      if (code !== 0) return reject(new Error('génération échouée: ' + err.slice(-300)));
      try { const buf = await fs.readFile(out); await fs.rm(out, { force: true }); resolve(buf); }
      catch (e) { reject(e); }
    });
  });
}

/** Dimensions d'un buffer vidéo, via `ffmpeg -i` (parse la ligne Stream Video). */
async function dimensions(buffer) {
  const f = path.join(os.tmpdir(), `probe-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  await fs.writeFile(f, buffer);
  const r = spawnSync(ffmpegPath, ['-i', f]); // pas de sortie → code≠0, mais stderr décrit l'entrée
  await fs.rm(f, { force: true }).catch(() => {});
  const m = (r.stderr.toString().match(/Video:.*?(\d{2,5})x(\d{2,5})/) || []);
  return { w: Number(m[1]), h: Number(m[2]) };
}

/** faststart = le box `moov` apparaît AVANT `mdat` dans le fichier. */
function estFaststart(buffer) {
  const s = buffer.toString('latin1');
  const moov = s.indexOf('moov');
  const mdat = s.indexOf('mdat');
  return moov !== -1 && (mdat === -1 || moov < mdat);
}

describe('arguments ffmpeg (purs)', () => {
  test('scaleFilter : cap le grand côté, jamais d’agrandissement, dims paires', () => {
    const f = svc.scaleFilter(1280);
    assert.match(f, /min\(1280,iw\)/);
    assert.match(f, /min\(1280,ih\)/);
    assert.match(f, /-2/); // dimensions paires (H.264)
  });

  test('ffmpegArgs : libx264 + bitrate + faststart + pix_fmt compatible', () => {
    const a = svc.ffmpegArgs('in', 'out.mp4').join(' ');
    assert.match(a, /libx264/);
    assert.match(a, /2500k/);
    assert.match(a, /\+faststart/);
    assert.match(a, /yuv420p/);
    assert.match(a, /-i in/);
    assert.ok(a.endsWith('out.mp4'));
  });
});

describe('assertVideo (validation)', () => {
  test('refuse un format non vidéo', () => {
    assert.throws(() => svc.assertVideo({ buffer: Buffer.alloc(1), mimetype: 'image/png', size: 1 }), /non supporté/);
  });
  test('refuse une vidéo trop lourde', () => {
    assert.throws(() => svc.assertVideo({ buffer: Buffer.alloc(1), mimetype: 'video/mp4', size: svc.MAX_INPUT_SIZE + 1 }), /trop lourde/);
  });
  test('refuse l’absence de fichier', () => {
    assert.throws(() => svc.assertVideo(null), /Aucune vidéo/);
  });
  test('accepte un mp4 valide', () => {
    assert.doesNotThrow(() => svc.assertVideo({ buffer: Buffer.alloc(1), mimetype: 'video/mp4', size: 1 }));
  });
});

describe('compression réelle (ffmpeg)', () => {
  let source; // 1920x1080, lourd
  before(async () => { source = await genererVideo(1920, 1080, 1); });

  test('un 1080p est ramené à ≤ 720p sur le grand côté', async () => {
    const out = await svc.compressVideoBuffer(source);
    const { w, h } = await dimensions(out);
    assert.equal(Math.max(w, h) <= 1280, true, `dims ${w}x${h}`);
    assert.equal(w % 2, 0); assert.equal(h % 2, 0); // paires (H.264)
  });

  test('la sortie est un MP4 faststart (moov avant mdat)', async () => {
    const out = await svc.compressVideoBuffer(source);
    assert.equal(estFaststart(out), true);
  });

  test('une vidéo PORTRAIT (1080x1920) cap AUSSI son grand côté (la hauteur)', async () => {
    const portrait = await genererVideo(1080, 1920, 1);
    const out = await svc.compressVideoBuffer(portrait);
    const { w, h } = await dimensions(out);
    assert.equal(Math.max(w, h) <= 1280, true, `dims ${w}x${h}`);
    assert.equal(h >= w, true, 'reste en portrait');
  });

  test('une PETITE vidéo (640x480) n’est PAS agrandie', async () => {
    const petite = await genererVideo(640, 480, 1);
    const out = await svc.compressVideoBuffer(petite);
    const { w, h } = await dimensions(out);
    assert.equal(w <= 640 && h <= 480, true, `dims ${w}x${h} (pas d'upscale)`);
  });
});

describe('uploadCompressedClip (stockage, supabase injecté)', () => {
  function fakeStorage() {
    const calls = { upload: [] };
    return {
      calls,
      supabase: {
        storage: {
          from: (bucket) => ({
            upload: async (p, buf, opts) => { calls.upload.push({ bucket, path: p, opts, size: buf.length }); return { data: { path: p }, error: null }; },
            getPublicUrl: (p) => ({ data: { publicUrl: `https://cdn/${bucket}/${p}` } }),
          }),
        },
      },
    };
  }

  test('téléverse dans le bucket aventure, upsert, et renvoie l’URL publique', async () => {
    const fake = fakeStorage();
    const r = await svc.uploadCompressedClip(Buffer.from('xx'), 'n1_succes', { supabase: fake.supabase });
    assert.equal(fake.calls.upload[0].bucket, svc.BUCKET_AVENTURE);
    assert.equal(fake.calls.upload[0].path, 'n1_succes.mp4');
    assert.equal(fake.calls.upload[0].opts.upsert, true);
    assert.equal(fake.calls.upload[0].opts.contentType, 'video/mp4');
    assert.equal(r.url, 'https://cdn/aventure/n1_succes.mp4');
    assert.equal(r.clipId, 'n1_succes');
  });

  test('un clipId dangereux est assaini (jamais de chemin traversant)', async () => {
    const fake = fakeStorage();
    const r = await svc.uploadCompressedClip(Buffer.from('xx'), '../../evil id', { supabase: fake.supabase });
    assert.equal(/[^a-zA-Z0-9._-]/.test(r.clipId), false);
    assert.equal(fake.calls.upload[0].path.includes('/'), false);
  });
});
