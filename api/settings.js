// POST /api/settings
// Тело: { initData, hidden }
// Проверяем подпись и сохраняем настройку игрока (скрыт из списка) через Admin.
const { verifyInitData } = require('./_lib/telegram');
const { getDb } = require('./_lib/firebase');
const { applyCors } = require('./_lib/cors');

const BOT_TOKEN = process.env.BOT_TOKEN;
const AUTH_MAX_AGE = 24 * 60 * 60;

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    const auth = verifyInitData(body.initData, BOT_TOKEN, AUTH_MAX_AGE);
    if (!auth) return res.status(401).json({ ok: false, error: 'auth' });

    const hidden = !!body.hidden;
    const db = getDb();
    await db
      .collection('users')
      .doc(String(auth.user.id))
      .set({ hidden, updatedAt: new Date().toISOString() }, { merge: true });

    return res.status(200).json({ ok: true, hidden });
  } catch (error) {
    console.error('settings error:', error);
    return res.status(500).json({ ok: false, error: 'server' });
  }
};
