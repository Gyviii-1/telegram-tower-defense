// POST /api/save
// Тело: { initData, wave, gold }
// Сервер проверяет подпись initData, сам достаёт Telegram ID и пишет рекорд
// через Firebase Admin. Клиент напрямую в Firestore не пишет.
const { verifyInitData, nickFor } = require('./_lib/telegram');
const { getDb } = require('./_lib/firebase');
const { applyCors } = require('./_lib/cors');

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTH_MAX_AGE = 24 * 60 * 60; // initData действителен 24 часа
const MAX_WAVE = 100000;
const MAX_GOLD = 1000000;

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    const auth = verifyInitData(body.initData, BOT_TOKEN, AUTH_MAX_AGE);
    if (!auth) return res.status(401).json({ ok: false, error: 'auth' });

    const wave = Number(body.wave);
    const gold = Number(body.gold);
    if (!Number.isInteger(wave) || wave < 0 || wave > MAX_WAVE) {
      return res.status(400).json({ ok: false, error: 'wave' });
    }
    if (!Number.isInteger(gold) || gold < 0 || gold > MAX_GOLD) {
      return res.status(400).json({ ok: false, error: 'gold' });
    }

    const db = getDb();
    const id = String(auth.user.id);
    const ref = db.collection('leaderboard').doc(id);

    const snapshot = await ref.get();
    const previous = snapshot.exists ? snapshot.data() : null;

    const isBetter =
      !previous ||
      wave > (previous.wave || 0) ||
      (wave === (previous.wave || 0) && gold > (previous.gold || 0));

    if (!isBetter) return res.status(200).json({ ok: true, saved: false });

    await ref.set({
      nick: nickFor(auth.user),
      wave,
      gold,
      savedAt: new Date().toISOString(),
    });

    return res.status(200).json({ ok: true, saved: true });
  } catch (error) {
    console.error('save error:', error);
    return res.status(500).json({ ok: false, error: 'server' });
  }
};
