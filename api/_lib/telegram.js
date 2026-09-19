// Проверка подписи Telegram WebApp initData.
// Документация: Telegram -> "Validating data received via the Mini App".
const crypto = require('crypto');

// initData приходит от клиента, а botToken знает только сервер.
// Возвращает { user, authDate } при валидной подписи, иначе null.
function verifyInitData(initData, botToken, maxAgeSeconds) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAgeSeconds) return null;

  let user = null;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch (error) {
    user = null;
  }
  if (!user || !user.id) return null;

  return { user, authDate };
}

// Ник из профиля Telegram.
function nickFor(user) {
  if (user.username) return '@' + user.username;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || 'Игрок';
}

module.exports = { verifyInitData, nickFor };
