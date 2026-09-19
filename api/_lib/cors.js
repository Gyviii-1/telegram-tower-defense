// CORS: разрешаем запросы только с нашего сайта (GitHub Pages) и локально.
function applyCors(req, res) {
  const allowed = (
    process.env.ALLOWED_ORIGINS || 'https://gyviii-1.github.io,http://localhost:8000'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowed[0]);
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

module.exports = { applyCors };
