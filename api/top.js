// GET /api/top
// Возвращает топ игроков (без скрытых). Читают все.
const { getDb } = require('./_lib/firebase');
const { applyCors } = require('./_lib/cors');

const TOP_LIMIT = 10;

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const db = getDb();

    const hidden = new Set();
    const hiddenSnap = await db.collection('users').where('hidden', '==', true).get();
    hiddenSnap.forEach((doc) => hidden.add(doc.id));

    const snapshot = await db.collection('leaderboard').get();
    const list = [];
    snapshot.forEach((doc) => {
      if (hidden.has(doc.id)) return;
      const data = doc.data();
      list.push({
        nick: data.nick || 'Игрок',
        wave: data.wave || 0,
        gold: data.gold || 0,
      });
    });

    list.sort((a, b) => b.wave - a.wave || b.gold - a.gold);

    return res.status(200).json({ ok: true, top: list.slice(0, TOP_LIMIT), total: list.length });
  } catch (error) {
    console.error('top error:', error);
    return res.status(500).json({ ok: false, error: 'server' });
  }
};
