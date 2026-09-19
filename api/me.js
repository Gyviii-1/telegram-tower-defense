// POST /api/me
// Тело: { initData }
// После проверки подписи возвращает роль и бету игрока (без лишних полей).
const { verifyInitData, nickFor } = require('./_lib/telegram');
const { getDb } = require('./_lib/firebase');
const { applyCors } = require('./_lib/cors');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CREATOR_ID = process.env.CREATOR_ID;
const AUTH_MAX_AGE = 24 * 60 * 60;

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    const auth = verifyInitData(body.initData, BOT_TOKEN, AUTH_MAX_AGE);
    if (!auth) return res.status(401).json({ ok: false, error: 'auth' });

    const id = String(auth.user.id);
    let role = id === String(CREATOR_ID) ? 'creator' : 'player';

    const db = getDb();
    const snapshot = await db.collection('users').doc(id).get();
    const data = snapshot.exists ? snapshot.data() : {};
    if (data.role) role = data.role;
    // Создатель всегда остаётся создателем.
    if (id === String(CREATOR_ID)) role = 'creator';

    const bestSnap = await db.collection('leaderboard').doc(id).get();
    const bestData = bestSnap.exists ? bestSnap.data() : {};

    // Место в рейтинге (среди не скрытых).
    const hidden = new Set();
    const hiddenSnap = await db.collection('users').where('hidden', '==', true).get();
    hiddenSnap.forEach((doc) => hidden.add(doc.id));

    const allSnap = await db.collection('leaderboard').get();
    const list = [];
    allSnap.forEach((doc) => {
      if (hidden.has(doc.id)) return;
      const item = doc.data();
      list.push({ id: doc.id, wave: item.wave || 0, gold: item.gold || 0 });
    });
    list.sort((a, b) => b.wave - a.wave || b.gold - a.gold);
    const rank = list.findIndex((item) => item.id === id) + 1;

    return res.status(200).json({
      ok: true,
      role,
      beta: role === 'creator' || role === 'tester',
      hidden: !!data.hidden,
      best: { wave: bestData.wave || 0, gold: bestData.gold || 0 },
      rank,
      total: list.length,
      nick: nickFor(auth.user),
    });
  } catch (error) {
    console.error('me error:', error);
    return res.status(500).json({ ok: false, error: 'server' });
  }
};
