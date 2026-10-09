// game.js — прототип Tower Defense на Phaser 3.
// Шаг 10: управляемые волны врагов с кнопкой старта.
// Сохранены механики прошлых шагов: сетка, дорога, движение врагов, стрельба, анимации.
// Логика разбита на маленькие методы, чтобы дальше удобно наращивать механики.
//
// ВАЖНО: game.js подключается как ES-модуль (<script type="module">),
// поэтому здесь доступны оператор import и значения из других модулей.

// Firebase подключается ЛЕНИВО — прямо в saveRecord (см. ниже).
// Так большие скрипты gstatic не тормозят открытие игры:
// они скачиваются только в момент сохранения рекорда.

// ----------------------------- Константы -----------------------------
// Адрес серверного API (Vercel).
// На тестовой версии (домен vercel.app) API на том же домене — без CORS.
const API_BASE = location.hostname.endsWith('vercel.app')
  ? ''
  : 'https://telegram-tower-defense.vercel.app';

const GRID_SIZE = 10;             // размер сетки: 10 на 10 клеток
const BG_COLOR = 0x1a1a2e;        // цвет фона сцены
const CELL_COLOR = 0x16213e;      // заливка обычной (свободной) клетки
const ROAD_COLOR = 0xd4a017;      // заливка клетки дороги (жёлто-песочный)
const GRID_LINE_COLOR = 0x0f3460; // цвет линий сетки

const TOWER_COLOR = 0x2ecc71;     // акцентный цвет интерфейса башен
const TOWER_MAX_LEVEL = 5;        // максимальный уровень башни
const TOWER_SELL_RATIO = 0.7;     // возврат золота при продаже (70% вложенного)
// Размер спрайта (size) и радиус для коллизий/кликов (radius) задаются
// индивидуально у каждого типа в TOWER_TYPES.

// Типы башен. cost — цена постройки, range — радиус в клетках,
// fireRate — выстрелов в секунду, damage — урон, texture — картинка.
const TOWER_TYPES = {
  gunner: {
    name: 'Стрелок',
    cost: 25,
    range: 2.5,
    fireRate: 1,
    damage: 1,
    accuracy: 1, // всегда попадает
    footprint: 0.7, // размер корпуса в клетках
    weaponScale: 0.5, // во сколько раз пушка меньше корпуса
    baseTexture: 'tower', // корпус (стоит на месте)
    texture: 'tower', // запасная картинка
    color: 0x2ecc71,
    baseOrigin: { x: 0.5, y: 0.5 }, // опора корпуса — центр картинки
    gunOrigin: { x: 0.5, y: 0.5 },  // опора пушки — точка крепления в картинке
    gunOrbit: 0.18,                 // радиус облёта пушки вокруг корпуса (в долях клетки)
    gunMount: { x: 0, y: -0.05 },   // доп. сдвиг пушки (в долях клетки)
  },
  minigun: {
    name: 'Миниган',
    cost: 40,
    range: 3.5,      // бьёт дальше стрелка
    fireRate: 4,
    damage: 1,
    accuracy: 0.7,   // 70% попаданий, 30% — разброс
    footprint: 1.0,  // крупнее стрелка
    weaponScale: 0.75, // пулемёт крупнее пистолета
    baseTexture: 'tower_minigun', // корпус (стоит на месте)
    texture: 'tower_minigun', // запасная картинка
    color: 0x3498db,
    baseOrigin: { x: 0.5, y: 0.5 },
    gunOrigin: { x: 0.5, y: 0.5 },
    gunOrbit: 0.22,
    gunMount: { x: 0, y: -0.05 },
  },
};

const ENEMY_HIT_COLOR = 0xffffff; // вспышка врага при попадании
const ENEMY_HP = 3;               // базовое здоровье врага по умолчанию
const ENEMY_HP_SCALE = 0.12;      // прирост HP врагов за волну (множитель)

// Типы врагов. hp — базовое здоровье, speed — клеток/сек, color — цвет,
// reward — золото за убийство, size — размер от клетки.
// damageMultiplier — множитель получаемого урона (броня).
// shield / shieldColor — отдельный запас щита (щитоносец).
// splitInto / splitCount — на кого распадается при смерти.
// livesDamage — сколько жизней снимает, если дойдёт до конца.
const ENEMY_TYPES = {
  normal: { hp: 3, speed: 2.0, color: 0xe74c3c, reward: 8, size: 0.60 },
  fast: { hp: 2, speed: 4.2, color: 0xf39c12, reward: 6, size: 0.45 },
  armored: {
    hp: 8,
    speed: 1.5,
    color: 0x7f8c8d,
    reward: 14,
    size: 0.62,
    damageMultiplier: 0.6,
  },
  tank: { hp: 26, speed: 0.9, color: 0x8e44ad, reward: 30, size: 0.80 },
  splitter: {
    hp: 12,
    speed: 1.6,
    color: 0x27ae60,
    reward: 15,
    size: 0.70,
    splitInto: 'small',
    splitCount: 2,
  },
  small: { hp: 2, speed: 3.2, color: 0x2ecc71, reward: 3, size: 0.34 },
  shielded: {
    hp: 15,
    speed: 1.4,
    color: 0x2980b9,
    reward: 25,
    size: 0.70,
    shield: 12,
    shieldColor: 0x66ccff,
  },
  boss: { hp: 160, speed: 0.8, color: 0x2c3e50, reward: 220, size: 1.15, livesDamage: 3 },
};

// ----------------------------- Волны -----------------------------
const SPAWN_INTERVAL = 1000;      // базовая задержка между спавном, мс
const SPAWN_INTERVAL_MIN = 300;   // минимальная задержка (дальше волны — быстрее)
const WAVE_CLEAR_BONUS = 25;      // бонус золота за зачистку волны

// Состав волн 1–20 по документу. Дальше — процедурно (buildEndlessWave).
const WAVE_TABLE = [
  { normal: 10 }, // 1
  { normal: 15 }, // 2
  { normal: 20 }, // 3
  { normal: 15, fast: 5 }, // 4
  { normal: 20, fast: 8 }, // 5
  { normal: 15, fast: 15 }, // 6
  { normal: 20, armored: 5 }, // 7
  { normal: 15, fast: 10, armored: 8 }, // 8
  { normal: 25, armored: 10 }, // 9
  { normal: 20, armored: 5, tank: 3 }, // 10
  { normal: 20, fast: 10, tank: 5 }, // 11
  { normal: 25, armored: 8, tank: 5 }, // 12
  { normal: 20, splitter: 5 }, // 13
  { fast: 15, splitter: 8, armored: 5 }, // 14
  { normal: 25, fast: 10, splitter: 8, tank: 3 }, // 15
  { normal: 20, shielded: 8, armored: 5 }, // 16
  { fast: 15, shielded: 10, tank: 5 }, // 17
  { normal: 20, armored: 10, shielded: 8, splitter: 5 }, // 18
  { fast: 10, armored: 8, tank: 5, shielded: 8, splitter: 5 }, // 19
  { boss: 1, normal: 20, fast: 10, armored: 5 }, // 20
];

const PROJECTILE_COLOR = 0xf1c40f; // цвет снаряда (жёлтый)
const PROJECTILE_SPEED = 10;       // скорость снаряда: клеток в секунду
const PROJECTILE_DAMAGE = 1;       // урон за попадание

const START_GOLD = 100;           // стартовое золото игрока
const START_LIVES = 10;           // стартовые жизни игрока

// Маршрут врагов задаётся угловыми точками (по клеткам сетки).
// ----------------------------- Мир / изометрия -----------------------------
// 1 старая клетка = 1 world unit. Мир 10x10 юнитов.
const WORLD_SIZE = GRID_SIZE;
const ISO_HW = 64; // половина ширины изотайла (128 / 2)
const ISO_HH = 32; // половина высоты изотайла (64 / 2)
const ROAD_WIDTH = 1.0; // ширина дороги в world units

// HiDPI-масштаб: рендерим канвас в физическом разрешении экрана, а UI
// задаём в «CSS-пикселях», умножая абсолютные размеры на DPR. Ограничиваем
// двойкой ради производительности на слабых телефонах.
const DPR = Math.min(window.devicePixelRatio || 1, 2);

// ЕДИНОЕ преобразование world <-> экран (iso-пиксели). Больше нигде нет iso-математики.
function worldToScreen(wx, wy) {
  return { x: (wx - wy) * ISO_HW, y: (wx + wy) * ISO_HH };
}
function screenToWorld(sx, sy) {
  return { x: (sx / ISO_HW + sy / ISO_HH) / 2, y: (sy / ISO_HH - sx / ISO_HW) / 2 };
}

// ----------------------------- Направления (8 сторон) -----------------------------
// Порядок = экранные углы (y вниз): 0° вправо, 45° вправо-вниз, 90° вперёд(вниз),
// 135° влево-вниз, 180° влево, 225° влево-вверх, 270° назад(вверх), 315° вправо-вверх.
// Спрайты рисуются в этих ЭКРАННЫХ направлениях (диагонали — экранные 45°).
const DIRECTIONS = ['r', 'fr', 'f', 'fl', 'l', 'bl', 'b', 'br'];
const DIR_FORWARD = 'f';        // направление по умолчанию (вниз, на камеру)
const DIR_STEP = Math.PI / 4;   // сектор 45°
const DIR_HYSTERESIS = 0.15;    // ~8.6°: зона стабилизации у границы сектора

// Угол (радианы) для направления.
function dirToAngle(dir) {
  const i = DIRECTIONS.indexOf(dir);
  return (i < 0 ? DIRECTIONS.indexOf(DIR_FORWARD) : i) * DIR_STEP;
}

// Кратчайшая разница углов в диапазоне (-π, π].
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Ближайшее из 8 направлений. С гистерезисом держим текущее, пока угол не ушёл
// за границу сектора на DIR_HYSTERESIS — чтобы не дёргалось на стыках.
function angleToDir(angle, current) {
  let idx = Math.round(angle / DIR_STEP);
  idx = ((idx % 8) + 8) % 8;
  if (current) {
    const ci = DIRECTIONS.indexOf(current);
    if (ci !== -1 && Math.abs(angleDiff(angle, ci * DIR_STEP)) <= DIR_STEP / 2 + DIR_HYSTERESIS) {
      return current;
    }
  }
  return DIRECTIONS[idx];
}

// Непрерывный маршрут в world-координатах (центры клеток старого пути).
const ROUTE_WAYPOINTS = [
  { x: 0.5, y: 0.5 },
  { x: 6.5, y: 0.5 },
  { x: 6.5, y: 3.5 },
  { x: 1.5, y: 3.5 },
  { x: 1.5, y: 6.5 },
  { x: 8.5, y: 6.5 },
  { x: 8.5, y: 9.5 },
  { x: 9.5, y: 9.5 },
];

// Route = { waypoints, segments, length }
function buildRoute(waypoints) {
  const segments = [];
  let length = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    segments.push({ a, b, dir: { x: dx / len, y: dy / len }, length: len, sStart: length });
    length += len;
  }
  return { waypoints, segments, length };
}
const ROUTE = buildRoute(ROUTE_WAYPOINTS);

// Расстояние от точки до полилинии маршрута (world units) — источник истины.
function distanceToRoute(px, py, route) {
  let best = Infinity;
  for (const seg of route.segments) {
    const abx = seg.b.x - seg.a.x;
    const aby = seg.b.y - seg.a.y;
    const len2 = abx * abx + aby * aby || 1;
    let t = ((px - seg.a.x) * abx + (py - seg.a.y) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = seg.a.x + abx * t;
    const cy = seg.a.y + aby * t;
    const d = Math.hypot(px - cx, py - cy);
    if (d < best) best = d;
  }
  return best;
}

// ------------------------------ Враг ------------------------------
// Враг — красный квадрат, который плавно едет по клеткам маршрута.
class Enemy extends Phaser.GameObjects.Rectangle {
  constructor(scene, route, typeKey = 'normal', hp = ENEMY_HP, shield = 0) {
    const type = ENEMY_TYPES[typeKey] || ENEMY_TYPES.normal;
    const fillColor = shield > 0 ? type.shieldColor || 0x66ccff : type.color;
    super(scene, 0, 0, 1, 1, fillColor);

    this.typeKey = typeKey;      // ключ типа
    this.config = type;          // настройки типа
    this.baseColor = type.color; // обычный цвет
    this.baseFill = fillColor;   // текущая заливка (со щитом — другая)
    this.speed = type.speed;     // скорость: world units/sec
    this.reward = type.reward;   // золото за убийство
    this.sizeFactor = type.size; // размер относительно клетки
    this.damageMultiplier = type.damageMultiplier || 1; // броня (множитель урона)
    this.shield = shield;        // запас щита (снимается первым)

    // Маршрут и непрерывная мировая позиция.
    this.route = route;
    this.segment = 0;
    this.progress = 0;
    this.wx = ROUTE_WAYPOINTS[0].x;
    this.wy = ROUTE_WAYPOINTS[0].y;
    this.dirX = 0;
    this.dirY = 0;

    this.hp = hp;               // здоровье (по умолчанию базовое)
    this.isDead = false;        // мёртв/исчезает — не двигается и не цель для башен

    // Размер — в iso-пикселях (ISO_HW), не зависит от экрана.
    const size = this.sizeFactor * ISO_HW;
    this.setSize(size, size);

    const p = worldToScreen(this.wx, this.wy);
    this.setPosition(p.x, p.y);

    scene.add.existing(this);   // добавляем объект в сцену
    this.refreshDepth();
  }

  // Глубина отрисовки в изометрии — по (wx + wy).
  refreshDepth() {
    this.setDepth(10 + (this.wx + this.wy) * 0.01);
  }

  // world -> экран (только для отрисовки; логика — в world).
  syncScreen() {
    const p = worldToScreen(this.wx, this.wy);
    this.x = p.x;
    this.y = p.y;
    this.refreshDepth();
  }

  // Движение по сегментам Route в world-координатах.
  // delta — мс; экранные координаты в логике движения не участвуют.
  moveAlongPath(delta) {
    const segments = this.route.segments;
    if (this.segment >= segments.length) {
      this.arriveAtEnd();
      return;
    }

    let seg = segments[this.segment];
    this.progress += (this.speed * (delta / 1000)) / seg.length;

    // Перескок через несколько сегментов за один кадр — без телепортов.
    while (this.progress >= 1 && this.segment < segments.length - 1) {
      this.progress -= 1;
      this.segment += 1;
    }

    // Дошли до конца маршрута.
    if (this.segment >= segments.length - 1 && this.progress >= 1) {
      seg = segments[this.segment];
      this.wx = seg.b.x;
      this.wy = seg.b.y;
      this.dirX = seg.dir.x;
      this.dirY = seg.dir.y;
      this.syncScreen();
      this.arriveAtEnd();
      return;
    }

    seg = segments[this.segment];
    this.wx = Phaser.Math.Linear(seg.a.x, seg.b.x, this.progress);
    this.wy = Phaser.Math.Linear(seg.a.y, seg.b.y, this.progress);
    this.dirX = seg.dir.x;
    this.dirY = seg.dir.y;
    this.syncScreen();
  }

  // Короткая белая вспышка при попадании.
  flash() {
    this.setFillStyle(ENEMY_HIT_COLOR);
    this.scene.time.delayedCall(80, () => {
      if (this.active && !this.isDead) this.setFillStyle(this.baseFill);
    });
  }

  // Получаем урон. Сначала снимается щит, потом здоровье.
  // Броня (damageMultiplier) уменьшает входящий урон.
  takeDamage(amount) {
    if (this.isDead) return;

    const damage = amount * this.damageMultiplier;

    if (this.shield > 0) {
      this.shield -= damage;

      if (this.shield <= 0) {
        // Щит сломан: остаток урона уходит в здоровье.
        this.hp += this.shield;
        this.shield = 0;
        this.baseFill = this.baseColor;
        this.setFillStyle(this.baseFill);
      } else {
        this.flash();
        return;
      }
    } else {
      this.hp -= damage;
    }

    if (this.hp > 0) {
      this.flash();
      return;
    }

    this.die();
  }

  // Смерть: плавно увеличиваем и растворяем квадрат, затем удаляем.
  die() {
    this.isDead = true;
    this.scene.onEnemyKilled(this); // сообщаем сцене (награда золотом)

    // Разделяющийся враг оставляет после себя мелких.
    if (this.config.splitInto) this.scene.onEnemySplit(this);

    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: 1.6,
      duration: 250,
      ease: 'Quad.easeOut',
      onComplete: () => this.destroy(),
    });
  }

  // Враг дошёл до выхода живым — отнимаем жизнь у игрока.
  arriveAtEnd() {
    this.isDead = true;
    this.scene.onEnemyReachedEnd(this);
    this.destroy();
  }
}

// ------------------------------ Снаряд ------------------------------
// Маленький жёлтый кружок, который летит от башни точно в цель (самонаведение).
class Projectile extends Phaser.GameObjects.Arc {
  constructor(scene, x, y, target, damage = PROJECTILE_DAMAGE, willHit = true) {
    super(scene, x, y, Math.max(3, ISO_HW * 0.12), 0, 360, false, PROJECTILE_COLOR);

    this.target = target;   // враг, в которого стреляли
    this.damage = damage;   // урон башни (растёт с уровнем)
    this.willHit = willHit; // попадёт ли этот выстрел

    if (!willHit) {
      // Промах: случайная точка рядом с целью (разброс).
      const spread = ISO_HW * 1.2;
      this.missX = target.x + Phaser.Math.Between(-spread, spread);
      this.missY = target.y + Phaser.Math.Between(-spread, spread);
      this.setAlpha(0.7);
    }

    scene.add.existing(this);
    this.setDepth(50); // снаряды поверх мира (ниже UI 90+)
  }

  // Летим к цели (экранное самонаведение); при попадании наносим урон.
  flyToTarget(delta) {
    const step = PROJECTILE_SPEED * ISO_HW * (delta / 1000);

    // Точный выстрел: самонаведение на врага.
    if (this.willHit) {
      // Цель уже мертва/удалена — снаряд просто исчезает.
      if (!this.target.active || this.target.isDead) {
        this.destroy();
        return;
      }

      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const distance = Math.hypot(dx, dy);

      // Долетели: наносим урон и удаляем снаряд.
      if (distance <= step) {
        this.target.takeDamage(this.damage);
        this.destroy();
        return;
      }

      this.x += (dx / distance) * step;
      this.y += (dy / distance) * step;
      return;
    }

    // Промах: летим в точку разброса, урона не наносим.
    const dx = this.missX - this.x;
    const dy = this.missY - this.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= step) {
      this.destroy();
      return;
    }

    this.x += (dx / distance) * step;
    this.y += (dy / distance) * step;
  }
}

// ------------------------------ Башня ------------------------------
// Башня хранит своё место на сетке, радиус атаки и перезарядку.
class Tower {
  constructor(scene, gx, gy, typeKey = 'gunner') {
    const type = TOWER_TYPES[typeKey] || TOWER_TYPES.gunner;

    this.scene = scene;
    this.gx = gx; // центр башни в клетках (может быть дробным)
    this.gy = gy;
    this.typeKey = typeKey;          // ключ типа ("gunner", "minigun", ...)
    this.config = type;              // настройки типа
    this.level = 1;                  // уровень башни
    this.range = type.range;         // радиус атаки, клеток
    this.fireRate = type.fireRate;   // выстрелов в секунду
    this.damage = type.damage;       // урон за выстрел
    this.accuracy = type.accuracy !== undefined ? type.accuracy : 1; // шанс попадания
    this.cooldown = 0;               // время до следующего выстрела, сек
    this.totalSpent = type.cost;     // сколько золота вложено (для продажи)
    this.aimAngle = dirToAngle(DIR_FORWARD); // куда направлена пушка (радианы)
    this.aimDir = DIR_FORWARD;       // направление пушки (одно из 8)
    this.baseAngle = dirToAngle(DIR_FORWARD); // направление корпуса (радианы)
    this.baseDir = DIR_FORWARD;      // направление корпуса (одно из 8)
    this.sprite = null;              // картинка пушки (вращается)
    this.baseSprite = null;          // картинка корпуса (стоит на месте)
  }

  // Цена следующего улучшения (зависит от типа и уровня).
  getUpgradeCost() {
    return Math.round(this.config.cost * 0.8) * this.level;
  }

  // Сколько золота вернётся при продаже.
  getSellValue() {
    return Math.floor(this.totalSpent * TOWER_SELL_RATIO);
  }

  // Можно ли ещё улучшать башню.
  canUpgrade() {
    return this.level < TOWER_MAX_LEVEL;
  }

  // Улучшение башни: +радиус, +скорость, +урон.
  // cost передаёт сцена — там же списывается золото.
  upgrade(cost) {
    this.level += 1;
    this.range += 0.4;
    this.fireRate += 0.3;
    this.damage += 1;
    this.totalSpent += cost;
  }

  // Позиция на экране (iso) из world-координат.
  getPosition() {
    return worldToScreen(this.gx, this.gy);
  }

  // Обновление башни: перезарядка, поиск цели, выстрел.
  update(delta, enemies) {
    this.cooldown -= delta / 1000;

    const pos = this.getPosition();
    const target = this.findTarget(enemies);

    // Наводим пушку на цель (визуально — по экранным позициям) и поворачиваем корпус.
    // Нет цели — держим последнее направление (не сбрасываем).
    if (target) {
      this.aimAngle = Math.atan2(target.y - pos.y, target.x - pos.x);
      this.aimDir = angleToDir(this.aimAngle, this.aimDir);
      this.baseAngle = this.aimAngle;
      this.baseDir = angleToDir(this.baseAngle, this.baseDir);
    }

    // Стреляем, только если башня умеет стрелять, есть цель и она перезарядилась.
    if (this.fireRate <= 0 || !target || this.cooldown > 0) return;

    // Выстрел из дула: чуть впереди центра по направлению пушки.
    const weaponScale = this.config.weaponScale || 1;
    const muzzleDistance = this.config.footprint * weaponScale * 0.5 * ISO_HW;
    const muzzle = {
      x: pos.x + Math.cos(this.aimAngle) * muzzleDistance,
      y: pos.y + Math.sin(this.aimAngle) * muzzleDistance,
    };

    this.shoot(muzzle, target);
    this.cooldown = 1 / this.fireRate; // перезарядка
  }

  // Ищем ближайшего живого врага. Дальность — в world units.
  findTarget(enemies) {
    let nearest = null;
    let nearestDistance = Infinity;

    for (const enemy of enemies) {
      if (!enemy.active || enemy.isDead) continue;

      const distance = Math.hypot(this.gx - enemy.wx, this.gy - enemy.wy);
      if (distance <= this.range && distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  // Создаём снаряд, летящий в цель.
  // С шансом (1 - accuracy) выстрел уходит в «разброс» и не наносит урон.
  shoot(pos, target) {
    const willHit = Math.random() < this.accuracy;
    this.scene.playSfx('sfx_shot', 0.25);
    const projectile = new Projectile(this.scene, pos.x, pos.y, target, this.damage, willHit);
    this.scene.projectiles.push(projectile);
  }
}

// ------------------------------ Сцена ------------------------------
// ------------------------------ Меню ------------------------------
// Отдельный экран: карты тут нет. Вкладки: Инвентарь · Лобби · Топ · Магазин.
class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  preload() {
    // Картинки башен (нужны и инвентарю, и игре).
    this.load.image('tower', 'assets/tower.png');
    this.load.image('tower_minigun', 'assets/tower_minigun.png');
    for (const key in TOWER_TYPES) {
      this.load.image(`${key}_base`, `assets/${key}_base.png`);
      for (let level = 1; level <= TOWER_MAX_LEVEL; level++) {
        this.load.image(`${key}_${level}`, `assets/${key}_${level}.png`);
      }
    }
    this.load.on('loaderror', () => {});
  }

  create() {
    this.playerInfo = this.getPlayerInfo();
    this.playerRole = 'player';
    this.playerBest = { wave: 0, gold: 0 };
    this.playerRank = 0;
    this.playersTotal = 0;
    this.topList = [];

    this.initTelegram();

    this.background = this.add.rectangle(0, 0, 1, 1, 0x0d0d1a, 1).setOrigin(0, 0);

    this.title = this.add
      .text(0, 0, 'TOWER DEFENSE', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '48px',
        color: '#2ecc71',
        stroke: '#000000',
        strokeThickness: 6 * DPR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.createLobby();
    this.createInventory();
    this.createTop();
    this.createShop();
    this.createTabs();
    this.createRules();

    this.selectTab('lobby');
    this.layout();
    this.scale.off('resize', this.layout, this);
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));

    this.loadPlayerData();
  }

  createLobby() {
    this.lobbyPage = this.add.container(0, 0);

    this.profileText = this.add
      .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5);

    this.bestText = this.add
      .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#f1c40f' })
      .setOrigin(0.5);

    this.playButton = this.add
      .text(0, 0, 'ИГРАТЬ', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        backgroundColor: '#2ecc71',
        padding: { x: 30 * DPR, y: 14 * DPR },
        stroke: '#000000',
        strokeThickness: 3 * DPR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.playButton.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.scene.start('GameScene');
    });

    this.rulesButton = this.add
      .text(0, 0, 'ПРАВИЛА', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#ffffff',
        backgroundColor: '#34495e',
        padding: { x: 24 * DPR, y: 10 * DPR },
        stroke: '#000000',
        strokeThickness: 3 * DPR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.rulesButton.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.openRules();
    });

    this.lobbyPage.add([this.profileText, this.bestText, this.playButton, this.rulesButton]);
  }

  createInventory() {
    this.inventoryPage = this.add.container(0, 0).setVisible(false);

    this.inventoryTitle = this.add
      .text(0, 0, 'ИНВЕНТАРЬ · БАШНИ', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.inventoryPage.add(this.inventoryTitle);

    this.inventoryRows = [];
    for (const key in TOWER_TYPES) {
      const type = TOWER_TYPES[key];
      const row = this.add.container(0, 0);

      const bg = this.add
        .rectangle(0, 0, 320, 72, 0x1a2433, 0.95)
        .setStrokeStyle(2, 0x2ecc71, 0.6);

      const icon = this.add.container(-120, 0);
      const baseKey = this.getBaseTextureKey(key) || type.texture;
      icon.add(this.add.image(0, 0, baseKey).setDisplaySize(52, 52));
      const weaponKey = this.getWeaponTextureKey(key, 1);
      if (weaponKey) icon.add(this.add.image(0, 0, weaponKey).setDisplaySize(52, 52));

      const name = this.add
        .text(-70, -12, type.name, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '18px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5);
      const info = this.add
        .text(-70, 14, `Цена: ${type.cost}`, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '15px',
          color: '#bdc3c7',
        })
        .setOrigin(0, 0.5);

      row.add([bg, icon, name, info]);
      this.inventoryPage.add(row);
      this.inventoryRows.push(row);
    }
  }

  createTop() {
    this.topPage = this.add.container(0, 0).setVisible(false);

    this.topTitle = this.add
      .text(0, 0, 'ТОП И СТАТИСТИКА', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.statsText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '17px',
        color: '#f1c40f',
        align: 'center',
        lineSpacing: 4 * DPR,
      })
      .setOrigin(0.5);

    this.topText = this.add
      .text(0, 0, 'Загрузка…', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '17px',
        color: '#ffffff',
        align: 'left',
        lineSpacing: 6 * DPR,
      })
      .setOrigin(0.5);

    this.topPage.add([this.topTitle, this.statsText, this.topText]);
  }

  createShop() {
    this.shopPage = this.add.container(0, 0).setVisible(false);
    this.shopText = this.add
      .text(0, 0, 'МАГАЗИН\n\nСкоро', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#bdc3c7',
        align: 'center',
        lineSpacing: 8 * DPR,
      })
      .setOrigin(0.5);
    this.shopPage.add(this.shopText);
  }

  createTabs() {
    this.tabBar = this.add.container(0, 0);
    this.tabInventory = this.makeTab('Инвентарь', 'inventory');
    this.tabLobby = this.makeTab('Лобби', 'lobby');
    this.tabTop = this.makeTab('Топ', 'top');
    this.tabShop = this.makeTab('Магазин', 'shop');
    this.tabBar.add([this.tabInventory, this.tabLobby, this.tabTop, this.tabShop]);
  }

  createRules() {
    this.rulesPanel = this.add.container(0, 0).setVisible(false);

    this.rulesBg = this.add
      .rectangle(0, 0, 1, 1, 0x0d0d1a, 0.98)
      .setOrigin(0, 0)
      .setInteractive();
    this.rulesBg.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
    });

    this.rulesText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#ffffff',
        align: 'left',
        lineSpacing: 8 * DPR,
      })
      .setOrigin(0.5);

    this.rulesBack = this.add
      .text(0, 0, 'НАЗАД', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#ffffff',
        backgroundColor: '#e74c3c',
        padding: { x: 24 * DPR, y: 10 * DPR },
        stroke: '#000000',
        strokeThickness: 3 * DPR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.rulesBack.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.closeRules();
    });

    this.rulesPanel.add([this.rulesBg, this.rulesText, this.rulesBack]);
  }

  makeTab(label, key) {
    const tab = this.add
      .text(0, 0, label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#1f2b3a',
        padding: { x: 12 * DPR, y: 8 * DPR },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    tab.tabKey = key;
    tab.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.selectTab(key);
    });
    return tab;
  }

  selectTab(key) {
    this.currentTab = key;
    if (this.lobbyPage) this.lobbyPage.setVisible(key === 'lobby');
    if (this.inventoryPage) this.inventoryPage.setVisible(key === 'inventory');
    if (this.topPage) this.topPage.setVisible(key === 'top');
    if (this.shopPage) this.shopPage.setVisible(key === 'shop');

    const tabs = [this.tabInventory, this.tabLobby, this.tabTop, this.tabShop];
    for (const tab of tabs) {
      if (!tab) continue;
      tab.setBackgroundColor(tab.tabKey === key ? '#2ecc71' : '#1f2b3a');
    }
  }

  openRules() {
    this.rulesText.setText(
      'Цель — не пустить врагов до конца дороги.\n\n' +
        '• Строй башни на свободных клетках (на дорогу нельзя)\n' +
        '• Кнопка «СТАРТ ВОЛНЫ» запускает волну\n' +
        '• Клик по башне — улучшить или продать\n' +
        '• Золото дают за убийства врагов и зачистку волны\n' +
        '• Враг, дошедший до конца, отнимает жизнь'
    );
    this.rulesPanel.setVisible(true);
  }

  closeRules() {
    this.rulesPanel.setVisible(false);
  }

  refreshProfile() {
    const nick = this.playerInfo ? this.playerInfo.nick : 'Игрок';
    const prefix = this.roleLabel(this.playerRole);
    this.profileText.setText(prefix ? `${nick} · ${prefix}` : nick);

    const best = this.playerBest || { wave: 0, gold: 0 };
    this.bestText.setText(
      best.wave > 0 ? `Лучший результат: волна ${best.wave} · ${best.gold} золота` : 'Пока нет результата'
    );

    this.statsText.setText(
      `Рекорд: волна ${best.wave} · ${best.gold} золота\n` +
        `Место в топе: ${this.playerRank || '—'} из ${this.playersTotal}`
    );
  }

  refreshTop() {
    if (!this.topList || this.topList.length === 0) {
      this.topText.setText('Пока нет рекордов');
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = [];
    this.topList.forEach((item, index) => {
      const place = medals[index] || `${index + 1}.`;
      lines.push(`${place} ${item.nick} — волна ${item.wave}, ${item.gold} золота`);
    });
    this.topText.setText(lines.join('\n'));
  }

  async loadPlayerData() {
    const initData = this.getInitData();
    if (initData) {
      try {
        const res = await fetch(`${API_BASE}/api/me`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.ok) {
            this.playerRole = data.role || 'player';
            this.playerBest = data.best || { wave: 0, gold: 0 };
            this.playerRank = data.rank || 0;
            this.playersTotal = data.total || 0;
            this.refreshProfile();
          }
        }
      } catch (error) {
        console.warn('Не удалось загрузить профиль:', error);
      }
    } else {
      this.refreshProfile();
    }

    try {
      const res = await fetch(`${API_BASE}/api/top`);
      if (res.ok) {
        const data = await res.json();
        this.topList = data.top || [];
        if (data.total) this.playersTotal = data.total;
        this.refreshTop();
        this.refreshProfile();
      }
    } catch (error) {
      console.warn('Не удалось загрузить топ:', error);
      this.topText.setText('Не удалось загрузить топ');
    }
  }

  layout() {
    const width = this.scale.width;
    const height = this.scale.height;
    const size = Math.min(width, height);

    this.background.setPosition(0, 0).setSize(width, height);

    this.title.setPosition(width / 2, height * 0.14);
    this.title.setStyle({ fontSize: `${Math.round(size * 0.085)}px` });

    // Лобби
    this.profileText.setPosition(width / 2, height * 0.38);
    this.profileText.setStyle({ fontSize: `${Math.round(size * 0.05)}px` });
    this.bestText.setPosition(width / 2, height * 0.45);
    this.bestText.setStyle({ fontSize: `${Math.round(size * 0.042)}px` });
    this.playButton.setPosition(width / 2, height * 0.58);
    this.playButton.setStyle({ fontSize: `${Math.round(size * 0.07)}px` });
    this.rulesButton.setPosition(width / 2, height * 0.69);
    this.rulesButton.setStyle({ fontSize: `${Math.round(size * 0.05)}px` });

    // Инвентарь
    this.inventoryTitle.setPosition(width / 2, height * 0.22);
    this.inventoryTitle.setStyle({ fontSize: `${Math.round(size * 0.05)}px` });
    const rowGap = Math.min(size * 0.13, 90 * DPR);
    const rowScale = Math.min((width * 0.9) / 320, 1.4 * DPR);
    this.inventoryRows.forEach((row, index) => {
      row.setPosition(width / 2, height * 0.32 + index * rowGap);
      row.setScale(rowScale);
    });

    // Топ
    this.topTitle.setPosition(width / 2, height * 0.16);
    this.topTitle.setStyle({ fontSize: `${Math.round(size * 0.05)}px` });
    this.statsText.setPosition(width / 2, height * 0.32);
    this.statsText.setStyle({ fontSize: `${Math.round(size * 0.04)}px` });
    this.topText.setPosition(width / 2, height * 0.62);
    this.topText.setStyle({ fontSize: `${Math.round(size * 0.038)}px` });

    // Магазин
    this.shopText.setPosition(width / 2, height * 0.45);
    this.shopText.setStyle({ fontSize: `${Math.round(size * 0.05)}px` });

    // Вкладки
    const tabY = height * 0.94;
    this.tabInventory.setPosition(width * 0.14, tabY);
    this.tabLobby.setPosition(width * 0.38, tabY);
    this.tabTop.setPosition(width * 0.62, tabY);
    this.tabShop.setPosition(width * 0.86, tabY);
    const tabFont = `${Math.round(size * 0.038)}px`;
    this.tabInventory.setStyle({ fontSize: tabFont });
    this.tabLobby.setStyle({ fontSize: tabFont });
    this.tabTop.setStyle({ fontSize: tabFont });
    this.tabShop.setStyle({ fontSize: tabFont });

    // Правила
    this.rulesBg.setPosition(0, 0).setSize(width, height);
    this.rulesText.setPosition(width / 2, height * 0.45);
    this.rulesText.setStyle({
      fontSize: `${Math.round(size * 0.04)}px`,
      wordWrap: { width: width * 0.82 },
    });
    this.rulesBack.setPosition(width / 2, height * 0.85);
    this.rulesBack.setStyle({ fontSize: `${Math.round(size * 0.05)}px` });
  }

  getBaseTextureKey(typeKey) {
    const dirKey = `${typeKey}_base_${DIR_FORWARD}`;
    if (this.textures.exists(dirKey)) return dirKey;
    const key = `${typeKey}_base`;
    if (this.textures.exists(key)) return key;
    const fallback = TOWER_TYPES[typeKey].baseTexture;
    return this.textures.exists(fallback) ? fallback : null;
  }

  getWeaponTextureKey(typeKey, level) {
    const dirKey = `${typeKey}_gun_${level}_${DIR_FORWARD}`;
    if (this.textures.exists(dirKey)) return dirKey;
    for (let current = level; current >= 1; current--) {
      const key = `${typeKey}_${current}`;
      if (this.textures.exists(key)) return key;
    }
    return null;
  }

  initTelegram() {
    const telegram = window.Telegram ? window.Telegram.WebApp : null;
    if (!telegram) return;
    try {
      telegram.ready();
    } catch (error) {}
    try {
      telegram.expand();
    } catch (error) {}
  }

  getInitData() {
    const telegram = window.Telegram ? window.Telegram.WebApp : null;
    return telegram ? telegram.initData || '' : '';
  }

  getPlayerInfo() {
    const telegram = window.Telegram ? window.Telegram.WebApp : null;
    const user = telegram ? telegram.initDataUnsafe.user : null;
    if (user) {
      const nick = user.username
        ? '@' + user.username
        : [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Игрок';
      return { id: String(user.id), nick: nick };
    }
    return { id: 'test_player', nick: 'Гость' };
  }

  roleLabel(role) {
    if (role === 'creator') return 'создатель';
    if (role === 'tester') return 'тестер';
    return '';
  }
}

// ------------------------------ Игра ------------------------------
class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  // Предзагрузка изображений (вызывается Phaser автоматически до create).
  preload() {
    // Базовые картинки башен (запасной вариант, если нет спрайтов по уровням).
    this.load.image('tower', 'assets/tower.png');
    this.load.image('tower_minigun', 'assets/tower_minigun.png');

    // Картинки башен по уровням: assets/gunner_1.png ... gunner_5.png и т.д.
    // А также корпус: assets/gunner_base.png (не вращается).
    for (const key in TOWER_TYPES) {
      this.load.image(`${key}_base`, `assets/${key}_base.png`);
      for (let level = 1; level <= TOWER_MAX_LEVEL; level++) {
        this.load.image(`${key}_${level}`, `assets/${key}_${level}.png`);
      }
    }

    // Направленные спрайты (8 сторон): корпус и пушка. Если файлов ещё нет —
    // они просто не загрузятся, игра идёт на старых спрайтах (fallback).
    for (const key in TOWER_TYPES) {
      for (const dir of DIRECTIONS) {
        this.load.image(`${key}_base_${dir}`, `assets/${key}_base_${dir}.png`);
        for (let level = 1; level <= TOWER_MAX_LEVEL; level++) {
          this.load.image(`${key}_gun_${level}_${dir}`, `assets/${key}_gun_${level}_${dir}.png`);
        }
      }
    }

    // Звуки (mp3). Если файла нет — игра просто идёт без этого звука.
    this.load.audio('sfx_shot', 'assets/shot.mp3');
    this.load.audio('sfx_wave', 'assets/wave.mp3');
    this.load.audio('sfx_gameover', 'assets/gameover.mp3');

    // Если спрайта уровня/направления ещё нет — это не ошибка.
    this.load.on('loaderror', (file) => {
      if (
        file &&
        (/_\d+$/.test(file.key) ||
          /_base_[a-z]+$/.test(file.key) ||
          /_gun_\d+_[a-z]+$/.test(file.key))
      ) {
        return;
      }
      console.warn('Не загрузился файл:', file && file.key);
    });
  }

  create() {
    // Разворачиваем мини-апп на весь экран Telegram и определяем игрока.
    this.initTelegram();

    // Данные игрока и роль (creator / tester / player) — роль читается из Firebase.
    this.playerInfo = this.getPlayerInfo();
    this.playerRole = 'player';
    this.playerBest = { wave: 0, gold: 0 };

    // Состояние игрока (экономика и жизни).
    this.gold = START_GOLD;
    this.lives = START_LIVES;
    this.isGameOver = false;

    // Состояние волн.
    this.currentWave = 0;        // номер волны (до старта первой — 0)
    this.isWaveActive = false;   // идёт ли волна прямо сейчас
    this.enemiesLeftToSpawn = 0; // сколько врагов волны ещё не выпущено
    this.waveQueue = [];         // очередь типов врагов текущей волны
    this.waveSpawnTimer = null;  // таймер порционного спавна

    // Выбранная башня (для меню улучшения/продажи).
    this.selectedTower = null;
    // Тип башни, который строим по клику (переключается панелью внизу).
    // По умолчанию НИЧЕГО не выбрано — игрок выбирает башню сам.
    this.selectedTowerType = null;

    // Кэш замеров картинок: где у них непрозрачная часть и её центр.
    // Заполняется лениво (при первом использовании текстуры).
    this.visualCache = {};
    // Кэш единого размера направленных спрайтов (на набор направлений).
    this.dirSizeCache = {};

    // Башни хранятся списком (свободная установка, без привязки к клеткам).
    this.towers = [];

    // Состояние установки новой башни.
    this.isPlacing = false;

    // Маршрут врагов (источник истины) в world-координатах.
    this.route = ROUTE;

    // Списки живых врагов и снарядов.
    this.enemies = [];
    this.projectiles = [];

    // Слои: земля (0) → дорога (1) → кольцо радиуса (2) → fallback (3)
    // → мир (10+) → снаряды (500) → UI (900+).
    this.groundGraphics = this.add.graphics().setDepth(0);
    this.roadGraphics = this.add.graphics().setDepth(1);
    this.rangeGraphics = this.add.graphics().setDepth(2);
    this.towersGraphics = this.add.graphics().setDepth(3);

    // Пиксельный масштаб мира (iso) — константа, не зависит от экрана.
    this.cellSize = ISO_HW;
    this.offsetX = 0;
    this.offsetY = 0;

    // Создаём UI (тексты поверх всего).
    this.createUI();

    // Первая отрисовка и подписка на изменение размера окна/экрана.
    this.layout();
    // Сначала снимаем старый обработчик (важно при рестарте сцены),
    // затем вешаем заново — иначе при перезапуске они накопятся.
    this.scale.off('resize', this.layout, this);
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
    this.updateUI();

    // Подгружаем роль игрока и досылаем несохранённые рекорды.
    this.loadPlayerRole();
    this.flushPendingScores();

    // ПКМ не должна открывать контекстное меню браузера.
    if (this.input.mouse) this.input.mouse.disableContextMenu();

    // Shift — режим «ставить подряд»: после постройки выбор не снимается.
    this.shiftKey = this.input.keyboard
      ? this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)
      : null;

    // Горячие клавиши 1..N — выбор башни; повторное нажатие снимает выбор.
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (event) => {
        if (this.isGameOver) return;

        // Клавиша X (в русской раскладке — Ч) продаёт выбранную башню.
        const key = (event.key || '').toLowerCase();
        if (key === 'x' || key === 'ч') {
          if (this.selectedTower) this.sellSelectedTower();
          return;
        }

        // Клавиша E (рус. У) улучшает выбранную башню.
        if (key === 'e' || key === 'у') {
          if (this.selectedTower) this.upgradeSelectedTower();
          return;
        }

        const index = parseInt(event.key, 10);
        if (!index) return;
        const keys = Object.keys(TOWER_TYPES);
        const typeKey = keys[index - 1];
        if (typeKey) this.selectTowerType(typeKey);
      });
    }

    // Управление указателем: клик — постройка/меню, потяг по пустому — камера.
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('pointerupoutside', this.handlePointerUp, this);

    // Масштаб камеры: колесо (ПК) и два пальца (телефон: pinch + pan).
    this.setupZoom();

    // Волны запускаются вручную кнопкой "[ СТАРТ ВОЛНЫ ]".
  }

  // ------------------------- Интерфейс (UI) -------------------------
  // Создаём тексты: панель игрока, всплывающее предупреждение и экран Game Over.
  createUI() {
    // Панель с золотом и жизнями в правом верхнем углу.
    this.uiText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#ffffff',
        align: 'right',
        lineSpacing: 6 * DPR,
        stroke: '#000000',
        strokeThickness: 4 * DPR,
      })
      .setOrigin(1, 0) // якорим к правому верхнему углу
      .setDepth(100);

    // Кнопка запуска следующей волны (левый верхний угол).
    this.startButton = this.add
      .text(0, 0, 'СТАРТ', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#2ecc71',
        backgroundColor: '#00000088',
        padding: { x: 10 * DPR, y: 6 * DPR },
        stroke: '#000000',
        strokeThickness: 3 * DPR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0) // верх по центру
      .setInteractive({ useHandCursor: true })
      .setDepth(100);

    // По клику/тапу запускаем следующую волну.
    this.startButton.on('pointerdown', (pointer, localX, localY, event) => {
      // Не даём клику уйти в сцену (иначе он мог бы поставить башню).
      if (event && event.stopPropagation) event.stopPropagation();
      this.startNextWave();
    });

    // Кнопка возврата в меню.
    this.menuButton = this.add
      .text(0, 0, '☰ Меню', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#ffffff',
        backgroundColor: '#00000088',
        padding: { x: 10 * DPR, y: 6 * DPR },
        stroke: '#000000',
        strokeThickness: 3 * DPR,
      })
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(100);
    this.menuButton.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.scene.start('MenuScene');
    });



    // Всплывающее предупреждение (например, "не хватает золота").
    this.messageText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#f1c40f',
        stroke: '#000000',
        strokeThickness: 5 * DPR,
      })
      .setOrigin(0.5)
      .setDepth(100)
      .setVisible(false);

    // Затемнение экрана для Game Over.
    this.overlay = this.add
      .rectangle(0, 0, 1, 1, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setDepth(90)
      .setVisible(false);

    // Крупный текст Game Over.
    this.gameOverText = this.add
      .text(0, 0, 'GAME OVER', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '64px',
        color: '#e74c3c',
        stroke: '#000000',
        strokeThickness: 8 * DPR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(101)
      .setVisible(false);

    // Кнопка перезапуска игры (появляется только на экране Game Over).
    this.restartButton = this.add
      .text(0, 0, 'ЗАНОВО', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#2ecc71',
        padding: { x: 24 * DPR, y: 12 * DPR },
        stroke: '#000000',
        strokeThickness: 3 * DPR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(101)
      .setVisible(false);

    // По клику/тапу перезапускаем игру.
    this.restartButton.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.restartGame();
    });

    // Меню башни (улучшение/продажа).
    // ВАЖНО: без контейнера — интерактив в контейнере со scrollFactor(0)
    // ломает хит-тест кликов. Делаем прямые объекты, зафиксированные на экране.
    this.towerMenuOffsets = { bg: 0, title: -60 * DPR, upgrade: 0, sell: 60 * DPR };

    this.towerMenuBg = this.add
      .rectangle(0, 0, 270 * DPR, 200 * DPR, 0x000000, 0.9)
      .setStrokeStyle(2 * DPR, TOWER_COLOR)
      .setDepth(102)
      .setScrollFactor(0)
      .setVisible(false)
      .setInteractive();
    // Клик по фону меню не должен «проваливаться» в игровое поле.
    this.towerMenuBg.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
    });

    this.towerMenuTitle = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: `${16 * DPR}px`,
        color: '#ffffff',
        fontStyle: 'bold',
        align: 'center',
        lineSpacing: 4 * DPR,
      })
      .setOrigin(0.5)
      .setDepth(103)
      .setScrollFactor(0)
      .setVisible(false);

    this.towerMenuUpgrade = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: `${18 * DPR}px`,
        color: '#2ecc71',
      })
      .setOrigin(0.5)
      .setDepth(103)
      .setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.towerMenuSell = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: `${18 * DPR}px`,
        color: '#e74c3c',
      })
      .setOrigin(0.5)
      .setDepth(103)
      .setScrollFactor(0)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.towerMenuParts = [
      this.towerMenuBg,
      this.towerMenuTitle,
      this.towerMenuUpgrade,
      this.towerMenuSell,
    ];

    this.towerMenuUpgrade.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.upgradeSelectedTower();
    });

    this.towerMenuSell.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.sellSelectedTower();
    });

    // Панель выбора башни для постройки (внизу экрана).
    this.createBuildMenu();

    // «Призрак» башни (корпус + пушка), следующий за указателем.
    // Изначально текстура-заглушка (gunner), т.к. башня не выбрана; при
    // выборе типа updateGhost подставит нужную картинку.
    const ghostType = TOWER_TYPES[this.selectedTowerType] || TOWER_TYPES.gunner;
    this.ghostBase = this.add.image(0, 0, ghostType.baseTexture).setAlpha(0.6);
    this.ghostWeapon = this.add.image(0, 0, ghostType.baseTexture).setAlpha(0.6);
    this.ghost = this.add
      .container(0, 0, [this.ghostBase, this.ghostWeapon])
      .setDepth(40)
      .setVisible(false);

    // UI фиксируется на экране (не двигается и не масштабируется камерой).
    const fixedUI = [
      this.uiText,
      this.startButton,
      this.menuButton,
      this.messageText,
      this.overlay,
      this.gameOverText,
      this.restartButton,
    ];
    for (const obj of fixedUI) {
      if (obj) obj.setScrollFactor(0);
    }
  }

  // Обновляем текст панели при изменении волны/жизней/золота.
  updateUI() {
    const nick = this.playerInfo ? this.playerInfo.nick : 'Игрок';
    const prefix = this.roleLabel(this.playerRole);
    const nameLine = prefix ? `${nick} · ${prefix}` : nick;

    this.uiText.setText(
      `${nameLine}\nВолна: ${this.currentWave}\nЖизни: ${this.lives}\nЗолото: ${this.gold}`
    );
  }

  // Подпись роли.
  roleLabel(role) {
    if (role === 'creator') return 'создатель';
    if (role === 'tester') return 'тестер';
    return '';
  }





  // Строка initData из Telegram — именно её проверяет сервер.
  getInitData() {
    const telegram = window.Telegram ? window.Telegram.WebApp : null;
    return telegram ? telegram.initData || '' : '';
  }

  // Роль игрока берём у сервера после проверки initData.
  async loadPlayerRole() {
    const initData = this.getInitData();
    if (!initData) return;

    try {
      const response = await fetch(`${API_BASE}/api/me`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      if (!response.ok) return;

      const data = await response.json();
      if (!data.ok) return;

      this.playerRole = data.role || 'player';
      if (data.best) this.playerBest = data.best;
      this.updateUI();
    } catch (error) {
      console.warn('Не удалось загрузить роль:', error);
    }
  }

  // Показываем всплывающее сообщение и плавно гасим его.
  showMessage(text) {
    if (this.messageTween) this.messageTween.stop();

    this.messageText.setText(text).setAlpha(1).setVisible(true);
    this.messageTween = this.tweens.add({
      targets: this.messageText,
      alpha: 0,
      delay: 700,
      duration: 600,
      onComplete: () => this.messageText.setVisible(false),
    });
  }

  // Проиграть звук, если файл реально загрузился (иначе — тишина).
  playSfx(key, volume = 0.5) {
    if (this.cache.audio.exists(key)) {
      this.sound.play(key, { volume });
    }
  }

  // Экран поражения.
  showGameOver() {
    this.overlay.setVisible(true);
    this.gameOverText.setVisible(true);
    this.startButton.setVisible(false); // убираем кнопку старта волны
    this.restartButton.setVisible(true); // показываем кнопку перезапуска
    this.closeTowerMenu(); // прячем меню башни, если оно было открыто
    this.setBuildMenuVisible(false); // прячем панель постройки
    this.ghost.setVisible(false); // прячем призрак башни
    this.clearRangeRing(); // убираем кольцо радиуса

    // Небольшой эффект появления.
    this.gameOverText.setScale(0.5);
    this.tweens.add({
      targets: this.gameOverText,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut',
    });
  }

  // Полный перезапуск игры без перезагрузки страницы.
  // scene.restart() заново вызывает create() и сбрасывает всё состояние.
  restartGame() {
    this.scene.restart();
  }

  // ------------------------- Меню башни -------------------------
  // Открыть меню выбранной башни.
  openTowerMenu(tower) {
    this.selectedTower = tower;
    // Показываем все части меню.
    for (const part of this.towerMenuParts) part.setVisible(true);
    this.refreshTowerMenu();
    this.positionTowerMenu();
    this.showRangeRingForTower(tower);
  }

  // Закрыть меню башни.
  closeTowerMenu() {
    this.selectedTower = null;
    if (this.towerMenuParts) {
      for (const part of this.towerMenuParts) part.setVisible(false);
    }
    this.clearRangeRing();
  }

  // Обновить тексты меню по текущей башне.
  refreshTowerMenu() {
    const tower = this.selectedTower;
    if (!tower) return;

    this.towerMenuUpgrade.setVisible(true);
    this.towerMenuTitle.setText(
      `${tower.config.name} · ур. ${tower.level}\n` +
        `Радиус ${tower.range.toFixed(1)} · ${tower.fireRate.toFixed(1)}/с · точн. ${Math.round(
          tower.accuracy * 100
        )}%`
    );

    if (tower.canUpgrade()) {
      this.towerMenuUpgrade.setText(`Улучшить (${tower.getUpgradeCost()})`).setColor('#2ecc71');
    } else {
      this.towerMenuUpgrade.setText('МАКС. УРОВЕНЬ').setColor('#7f8c8d');
    }

    this.towerMenuSell.setText(`✖ Продать (+${tower.getSellValue()})`);
  }

  // Расположить меню рядом с башней, не выпуская его за края экрана.
  positionTowerMenu() {
    const tower = this.selectedTower;
    if (!tower) return;

    // towerMenu — UI (scrollFactor 0), поэтому берём экранные координаты башни.
    const pos = this.worldToUI(tower.gx, tower.gy);
    const width = this.scale.width;
    const height = this.scale.height;
    const halfW = 135 * DPR; // половина ширины фона меню (270 / 2)
    const halfH = 100 * DPR; // половина высоты фона меню (200 / 2)
    const margin = 8 * DPR;

    let x = pos.x;
    let y = pos.y - 70 * DPR - halfH; // сначала пробуем над башней
    if (y - halfH < margin) {
      y = pos.y + 70 * DPR + halfH; // не влезло — ставим под башней
    }

    x = Phaser.Math.Clamp(x, halfW + margin, width - halfW - margin);
    y = Phaser.Math.Clamp(y, halfH + margin, height - halfH - margin);

    const off = this.towerMenuOffsets;
    this.towerMenuBg.setPosition(x, y + off.bg);
    this.towerMenuTitle.setPosition(x, y + off.title);
    this.towerMenuUpgrade.setPosition(x, y + off.upgrade);
    this.towerMenuSell.setPosition(x, y + off.sell);
  }

  // Улучшить выбранную башню за золото.
  upgradeSelectedTower() {
    const tower = this.selectedTower;
    if (!tower || !tower.canUpgrade()) return;

    const cost = tower.getUpgradeCost();
    if (this.gold < cost) {
      this.showMessage(`Не хватает золота! Нужно ${cost}`);
      return;
    }

    this.gold -= cost;
    tower.upgrade(cost);
    this.refreshTowerSprite(tower); // меняем картинку на спрайт нового уровня
    this.drawTowers();
    this.refreshTowerMenu();
    this.showRangeRingForTower(tower); // радиус вырос — обновляем кольцо
    this.updateUI();
  }

  // Продать выбранную башню и вернуть часть золота.
  sellSelectedTower() {
    const tower = this.selectedTower;
    if (!tower) return;

    this.gold += tower.getSellValue();
    const index = this.towers.indexOf(tower);
    if (index !== -1) this.towers.splice(index, 1);
    this.destroyTowerSprite(tower);
    this.drawTowers();
    this.closeTowerMenu();
    this.updateUI();
  }

  // ------------------------- Панель постройки -------------------------
  // Создаём кнопки выбора типа башни (внизу экрана).
  createBuildMenu() {
    // Без контейнеров: интерактив в контейнере со scrollFactor(0) ломает клики.
    // Каждая кнопка = отдельные объекты, зафиксированные на экране.
    this.buildButtons = {};
    this.buildButtonWidth = 105 * DPR;
    this.buildGap = 8 * DPR;

    const buttonWidth = this.buildButtonWidth;

    Object.keys(TOWER_TYPES).forEach((key) => {
      const type = TOWER_TYPES[key];

      const bg = this.add
        .rectangle(0, 0, buttonWidth, 90 * DPR, 0x000000, 0.85)
        .setStrokeStyle(2, 0xffffff, 0.4)
        .setDepth(100)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });

      bg.on('pointerdown', (pointer, localX, localY, event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        this.selectTowerType(key);
      });

      // Иконка = корпус + пушка 1-го уровня (направление по умолчанию — вперёд).
      const base = this.resolveBase(key, DIR_FORWARD);
      const baseKey = (base && base.key) || type.texture;
      const iconBase = this.add
        .image(0, 0, baseKey)
        .setDisplaySize(34 * DPR, 34 * DPR)
        .setDepth(101)
        .setScrollFactor(0);
      const gun = this.resolveGun(key, 1, DIR_FORWARD);
      const iconWeapon = gun
        ? this.add.image(0, 0, gun.key).setDisplaySize(34 * DPR, 34 * DPR).setDepth(101).setScrollFactor(0)
        : null;

      const label = this.add
        .text(0, 0, `${type.name} · ${type.cost}`, {
          fontFamily: 'Arial, sans-serif',
          fontSize: `${13 * DPR}px`,
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(101)
        .setScrollFactor(0);

      this.buildButtons[key] = {
        bg: bg,
        iconBase: iconBase,
        iconWeapon: iconWeapon,
        label: label,
        type: type,
      };
    });

    this.refreshBuildMenu();
  }

  // Выбрать тип башни для постройки. Повторный клик по выбранной — снять выбор.
  selectTowerType(key) {
    this.selectedTowerType = this.selectedTowerType === key ? null : key;
    this.refreshBuildMenu();
    if (!this.selectedTowerType) this.cancelPlacement();
  }

  // Снять выбор башни (тогда клик по полю ничего не строит).
  clearTowerSelection() {
    this.selectedTowerType = null;
    this.refreshBuildMenu();
    this.cancelPlacement();
  }

  // Подсветить выбранную кнопку панели.
  refreshBuildMenu() {
    if (!this.buildButtons) return;
    for (const key in this.buildButtons) {
      const selected = key === this.selectedTowerType;
      this.buildButtons[key].bg.setStrokeStyle(
        3,
        selected ? TOWER_COLOR : 0xffffff,
        selected ? 1 : 0.4
      );
    }
  }

  // Расположить кнопки панели постройки внизу экрана.
  layoutBuildMenu(width, height) {
    const keys = Object.keys(this.buildButtons);
    const buttonWidth = this.buildButtonWidth;
    const gap = this.buildGap;

    const totalWidth = keys.length * buttonWidth + (keys.length - 1) * gap;
    const startX = width / 2 - totalWidth / 2 + buttonWidth / 2;
    const y = height - 60 * DPR;

    keys.forEach((key, index) => {
      const x = startX + index * (buttonWidth + gap);
      const b = this.buildButtons[key];
      b.bg.setPosition(x, y);
      b.iconBase.setPosition(x, y - 14 * DPR);
      if (b.iconWeapon) b.iconWeapon.setPosition(x, y - 14 * DPR);
      b.label.setPosition(x, y + 26 * DPR);
    });
  }

  // Показать/скрыть панель постройки целиком (например, на экране поражения).
  setBuildMenuVisible(visible) {
    if (!this.buildButtons) return;
    for (const key in this.buildButtons) {
      const b = this.buildButtons[key];
      b.bg.setVisible(visible);
      b.iconBase.setVisible(visible);
      if (b.iconWeapon) b.iconWeapon.setVisible(visible);
      b.label.setVisible(visible);
    }
  }

  // ------------------------- Игровые события -------------------------
  // Враг убит башней — начисляем золото по типу врага.
  onEnemyKilled(enemy) {
    this.gold += enemy.reward;
    this.updateUI();
  }

  // Разделяющийся враг умер — выпускаем мелких в той же точке пути.
  onEnemySplit(parent) {
    const typeKey = parent.config.splitInto;
    if (!typeKey) return;

    const base = ENEMY_TYPES[typeKey];
    const scale = this.enemyHpScale(this.currentWave);
    const count = parent.config.splitCount || 2;

    for (let i = 0; i < count; i++) {
      const hp = Math.round(base.hp * scale);
      const child = new Enemy(this, this.route, typeKey, hp, 0);
      // Ставим детей туда же, где погиб родитель (чуть вразброс).
      child.segment = parent.segment;
      child.progress = Math.max(0, parent.progress - i * 0.08);
      this.enemies.push(child);
    }
  }

  // Враг дошёл до конца дороги — отнимаем жизни, при 0 запускаем Game Over.
  onEnemyReachedEnd(enemy) {
    if (this.isGameOver) return;

    const damage = (enemy && enemy.config.livesDamage) || 1;
    this.lives = Math.max(0, this.lives - damage);
    this.updateUI();
    console.log(`Враг дошёл до конца дороги! Осталось жизней: ${this.lives}`);

    if (this.lives <= 0) this.triggerGameOver();
  }

  // Останавливаем игру и показываем экран поражения.
  triggerGameOver() {
    if (this.isGameOver) return;

    this.isGameOver = true;
    this.playSfx('sfx_gameover', 0.6);
    if (this.waveSpawnTimer) this.waveSpawnTimer.remove(false); // прекращаем спавн
    this.showGameOver();
    console.log('GAME OVER');

    // Отправляем рекорд в облако (не ждём ответа, чтобы игра не «зависла»).
    this.saveRecord();
  }

  // Инициализация Telegram Mini App (если игра открыта внутри Telegram).
  initTelegram() {
    const telegram = window.Telegram ? window.Telegram.WebApp : null;
    if (!telegram) return;

    telegram.ready(); // сообщаем Telegram, что приложение готово
    telegram.expand(); // разворачиваем на весь экран

    // Пробуем полноэкранный режим и фиксацию ориентации (если поддерживается).
    try {
      if (telegram.requestFullscreen) telegram.requestFullscreen();
    } catch (error) {
      /* не критично */
    }
    try {
      if (telegram.lockOrientation) telegram.lockOrientation();
    } catch (error) {
      /* не критично */
    }
  }

  // Данные игрока: id (для документа) и ник (из профиля Telegram).
  getPlayerInfo() {
    const telegram = window.Telegram ? window.Telegram.WebApp : null;
    const user = telegram ? telegram.initDataUnsafe.user : null;

    // Внутри Telegram — ник и id из профиля пользователя.
    if (user) {
      const nick = user.username
        ? '@' + user.username
        : [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Игрок';
      return { id: String(user.id), nick: nick };
    }

    // Игра открыта в обычном браузере — считаем гостем.
    return { id: 'test_player', nick: 'Гость' };
  }

  // Сохраняем рекорд ЧЕРЕЗ СЕРВЕР. Клиент напрямую в Firestore не пишет:
  // сервер проверит initData, сам определит Telegram ID и запишет рекорд.
  async saveRecord() {
    const payload = {
      initData: this.getInitData(),
      wave: this.currentWave,
      gold: this.gold,
    };

    const sent = await this.sendScore(payload);
    if (sent) {
      console.log('Рекорд сохранён на сервере!');
      return;
    }

    // Сервер недоступен — не теряем результат: отправим позже.
    this.queueScore(payload);
    console.log('Сервер недоступен — рекорд сохранён локально и отправится позже.');
  }

  // Отправка одного рекорда на сервер. true — если сервер принял.
  async sendScore(payload) {
    try {
      const response = await fetch(`${API_BASE}/api/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  // Кладём несохранённый рекорд в локальную очередь (localStorage).
  queueScore(payload) {
    try {
      const queue = JSON.parse(localStorage.getItem('td_pending_scores') || '[]');
      queue.push(payload);
      localStorage.setItem('td_pending_scores', JSON.stringify(queue));
    } catch (error) {
      console.warn('Не удалось сохранить рекорд локально:', error);
    }
  }

  // Пытаемся дослать все накопившиеся рекорды.
  async flushPendingScores() {
    let queue = [];
    try {
      queue = JSON.parse(localStorage.getItem('td_pending_scores') || '[]');
    } catch (error) {
      queue = [];
    }
    if (queue.length === 0) return;

    const remaining = [];
    for (const payload of queue) {
      const sent = await this.sendScore(payload);
      if (!sent) remaining.push(payload);
    }

    try {
      localStorage.setItem('td_pending_scores', JSON.stringify(remaining));
    } catch (error) {
      /* ignore */
    }
  }

  // Пересчёт размеров и перерисовка под текущий размер экрана.
  // Вызывается при старте и при каждом ресайзе (поворот телефона и т.п.).
  layout() {
    const width = this.scale.width;
    const height = this.scale.height;

    // Пиксельный масштаб мира — константа (iso), не зависит от экрана.
    this.cellSize = ISO_HW;

    this.drawGround();
    this.drawRoad();
    this.drawTowers();
    this.layoutTowerSprites();
    this.layoutUI(width, height);
    this.setupCamera();
  }

  // Камера работает поверх world-space (iso-пикселей).
  setupCamera() {
    const cam = this.cameras.main;
    const center = worldToScreen(WORLD_SIZE / 2, WORLD_SIZE / 2);
    cam.centerOn(center.x, center.y);
    if (!this.cameraInitialized) {
      cam.setZoom(this.fitZoom());
      this.cameraInitialized = true;
    }
  }

  // Зум, при котором карта целиком влезает в экран.
  fitZoom() {
    const width = this.scale.width;
    const height = this.scale.height;
    const mapW = WORLD_SIZE * ISO_HW * 2;
    const mapH = WORLD_SIZE * ISO_HH * 2;
    return Math.min(width / mapW, height / mapH) * 0.95;
  }

  minZoom() {
    // Даём отдалять карту дальше «целиком в экране» (иначе на ПК зум
    // не отдаляется вообще: стартовый зум уже равен минимуму).
    return this.fitZoom() * 0.5;
  }

  maxZoom() {
    return this.fitZoom() * 4;
  }

  // Экранные (UI) координаты из world — для меню, привязанных к башне.
  worldToUI(wx, wy) {
    const cam = this.cameras.main;
    const topLeft = cam.getWorldPoint(0, 0);
    const p = worldToScreen(wx, wy);
    return { x: (p.x - topLeft.x) * cam.zoom, y: (p.y - topLeft.y) * cam.zoom };
  }

  // Управление зумом/пэном: колесо (ПК) и два пальца (тач).
  setupZoom() {
    const cam = this.cameras.main;

    this.input.on('wheel', (pointer, gameObjects, dx, dy) => {
      const factor = dy > 0 ? 0.9 : 1.1;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, this.minZoom(), this.maxZoom()));
    });

    this.input.addPointer(1);
    this.pinchDistance = 0;
    this.pinchActive = false;
    this.pinchMid = { x: 0, y: 0 };

    // Состояние панорамирования одним пальцем.
    this.panArmed = false;
    this.panActive = false;
    this.panStart = { x: 0, y: 0 };
    this.panLast = { x: 0, y: 0 };

    this.input.on('pointermove', () => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      if (p1.isDown && p2.isDown) {
        const distance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        if (this.pinchActive) {
          // Зум по изменению расстояния.
          if (this.pinchDistance > 0) {
            const next = Phaser.Math.Clamp(
              cam.zoom * (distance / this.pinchDistance),
              this.minZoom(),
              this.maxZoom()
            );
            cam.setZoom(next);
          }
          // Пан по движению середины.
          cam.scrollX -= (midX - this.pinchMid.x) / cam.zoom;
          cam.scrollY -= (midY - this.pinchMid.y) / cam.zoom;
        }

        this.pinchDistance = distance;
        this.pinchMid.x = midX;
        this.pinchMid.y = midY;
        this.pinchActive = true;

        // Два пальца — режим пинча, одиночный пан выключаем.
        this.panArmed = false;
        this.panActive = false;
      } else {
        this.pinchActive = false;
        this.pinchDistance = 0;
      }
    });

    // Сброс пинча при отпускании пальца: иначе следующий жест 2 пальцами
    // берёт устаревшие distance/mid из прошлого раза и резко дёргает камеру.
    const resetPinch = () => {
      this.pinchActive = false;
      this.pinchDistance = 0;
    };
    this.input.on('pointerup', resetPinch);
    this.input.on('pointerupoutside', resetPinch);
  }

  // Позиционируем элементы интерфейса под новый размер экрана.
  layoutUI(width, height) {
    const pad = Math.max(10 * DPR, Math.min(width, height) * 0.03);
    const uiSize = Math.max(16 * DPR, Math.min(width, height) * 0.05);

    this.uiText.setPosition(width - pad, pad);
    this.uiText.setStyle({ fontSize: `${Math.round(uiSize)}px` });

    // Кнопка старта волны — сверху по центру. На телефоне опускаем ниже,
    // чтобы не упиралась в шапку Telegram / верхний отступ.
    const isTouch = this.game.device.input.touch;
    const startY = isTouch ? pad + uiSize * 2.5 : pad;
    this.startButton.setPosition(width / 2, startY);
    this.startButton.setStyle({ fontSize: `${Math.round(uiSize)}px` });
    this.startButton.setVisible(!this.isWaveActive && !this.isGameOver);

    // Кнопка меню — вверху слева.
    this.menuButton.setPosition(pad, pad);
    this.menuButton.setStyle({ fontSize: `${Math.round(uiSize * 0.9)}px` });
    this.menuButton.setVisible(!this.isGameOver);

    this.messageText.setPosition(width / 2, height * 0.8);
    this.messageText.setStyle({ fontSize: `${Math.round(uiSize * 0.9)}px` });

    this.overlay.setSize(width, height);
    this.overlay.setPosition(0, 0);

    this.gameOverText.setPosition(width / 2, height / 2);
    this.gameOverText.setStyle({ fontSize: `${Math.round(Math.min(width, height) * 0.13)}px` });

    // Кнопка перезапуска — под надписью GAME OVER; видна только на проигрыше.
    this.restartButton.setPosition(width / 2, height / 2 + Math.min(width, height) * 0.16);
    this.restartButton.setStyle({ fontSize: `${Math.round(Math.min(width, height) * 0.05)}px` });
    this.restartButton.setVisible(this.isGameOver);

    // Если меню башни открыто — пересчитываем позицию и кольцо под новый размер.
    if (this.selectedTower) {
      this.positionTowerMenu();
      this.showRangeRingForTower(this.selectedTower);
    }

    // Панель постройки башен.
    this.layoutBuildMenu(width, height);
    this.setBuildMenuVisible(!this.isGameOver);

  }

  // Земля — большой изометрический ромб (без видимой квадратной сетки).
  drawGround() {
    const g = this.groundGraphics;
    g.clear();
    const corners = [
      worldToScreen(0, 0),
      worldToScreen(WORLD_SIZE, 0),
      worldToScreen(WORLD_SIZE, WORLD_SIZE),
      worldToScreen(0, WORLD_SIZE),
    ];
    g.fillStyle(CELL_COLOR, 1);
    g.fillPoints(corners, true);
    g.lineStyle(3, GRID_LINE_COLOR, 1);
    g.strokePoints(corners, true);
  }

  // Дорога — одна цельная изополоса вдоль полилинии Route.
  // Углы сшиваем «митром» (без зубцов/щелей), концы уводим за границу поля.
  // Это ТОЛЬКО отрисовка: Route, движение и коллизии не меняются.
  drawRoad() {
    const g = this.roadGraphics;
    g.clear();

    const src = this.route.waypoints;
    if (!src || src.length < 2) return;

    const half = ROAD_WIDTH / 2;
    const norm = (x, y) => {
      const l = Math.hypot(x, y) || 1;
      return { x: x / l, y: y / l };
    };

    // Копия точек маршрута; первый и последний отрезки удлиняем наружу.
    const pts = src.map((p) => ({ x: p.x, y: p.y }));
    const extend = 1.0;
    const first = norm(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    pts[0] = { x: pts[0].x - first.x * extend, y: pts[0].y - first.y * extend };
    const lastDir = norm(
      pts[pts.length - 1].x - pts[pts.length - 2].x,
      pts[pts.length - 1].y - pts[pts.length - 2].y
    );
    pts[pts.length - 1] = {
      x: pts[pts.length - 1].x + lastDir.x * extend,
      y: pts[pts.length - 1].y + lastDir.y * extend,
    };

    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
      let ox;
      let oy;
      if (i === 0) {
        const d = norm(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        ox = -d.y;
        oy = d.x;
      } else if (i === pts.length - 1) {
        const d = norm(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        ox = -d.y;
        oy = d.x;
      } else {
        // Биссектриса нормалей соседних отрезков + компенсация длины (митр).
        const d0 = norm(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        const d1 = norm(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        const n0x = -d0.y;
        const n0y = d0.x;
        const n1x = -d1.y;
        const n1y = d1.x;
        let mx = n0x + n1x;
        let my = n0y + n1y;
        const ml = Math.hypot(mx, my) || 1;
        mx /= ml;
        my /= ml;
        const cosHalf = mx * n0x + my * n0y;
        const scale = Phaser.Math.Clamp(cosHalf !== 0 ? 1 / cosHalf : 1, -3, 3);
        ox = mx * scale;
        oy = my * scale;
      }
      left.push(worldToScreen(pts[i].x + ox * half, pts[i].y + oy * half));
      right.push(worldToScreen(pts[i].x - ox * half, pts[i].y - oy * half));
    }

    right.reverse();
    g.fillStyle(ROAD_COLOR, 1);
    g.fillPoints([...left, ...right], true);
  }

  // Рисуем башни по массиву towers.
  drawTowers() {
    const g = this.towersGraphics;
    g.clear();

    for (const tower of this.towers) {
      // Запасной вариант: если картинки нет — рисуем кружок цветом типа.
      if (!this.textures.exists(tower.config.texture)) {
        const pos = tower.getPosition();
        const half = (this.cellSize * tower.config.footprint) / 2;
        g.fillStyle(tower.config.color, 1);
        g.fillCircle(pos.x, pos.y, half);
      }
    }
  }

  // ------------------------- Спрайты башен -------------------------
  // Создаём корпус и пушку башни.
  createTowerSprite(tower) {
    const pos = tower.getPosition();
    const depth = 10 + (tower.gx + tower.gy) * 0.01; // глубина по world (iso)

    const base = this.resolveBase(tower.typeKey, tower.baseDir);
    if (base) {
      tower.baseSprite = this.add.image(pos.x, pos.y, base.key).setDepth(depth);
      this.applyBaseVisual(tower.baseSprite, tower.typeKey, base);
    }

    const gun = this.resolveGun(tower.typeKey, tower.level, tower.aimDir);
    if (gun) {
      tower.sprite = this.add.image(pos.x, pos.y, gun.key).setDepth(depth + 0.05);
      this.applyGunVisual(tower.sprite, tower.typeKey, gun, tower.level);
    }

    this.applyTowerFacing(tower);
  }

  // Переключаем текстуры корпуса и пушки по их ТЕКУЩИМ направлениям
  // (корпус и пушка — независимо). Направленные спрайты НЕ вращаем.
  applyTowerFacing(tower) {
    const pos = tower.getPosition();
    const type = tower.config;

    // Центр башни (вокруг него облетает пушка) — центр РИСУНКА корпуса,
    // а не точка клетки (иначе облёт идёт «у ног»).
    let centerX = pos.x;
    let centerY = pos.y;
    if (tower.baseSprite) {
      const o = type.baseOrigin || { x: 0.5, y: 1.0 };
      const vis = this.getVisual(tower.baseSprite.texture.key);
      if (vis) {
        centerX = pos.x + (vis.originX - o.x) * tower.baseSprite.displayWidth;
        centerY = pos.y + (vis.originY - o.y) * tower.baseSprite.displayHeight;
      }
    }

    if (tower.baseSprite) {
      const base = this.resolveBase(tower.typeKey, tower.baseDir);
      if (base) {
        if (tower.baseSprite.texture.key !== base.key) {
          tower.baseSprite.setTexture(base.key);
          this.applyBaseVisual(tower.baseSprite, tower.typeKey, base);
        }
        tower.baseSprite.setPosition(pos.x, pos.y);
        tower.baseSprite.setRotation(base.directional ? 0 : tower.baseAngle);
      }
    }

    if (tower.sprite) {
      const gun = this.resolveGun(tower.typeKey, tower.level, tower.aimDir);
      if (gun) {
        if (tower.sprite.texture.key !== gun.key) {
          tower.sprite.setTexture(gun.key);
          this.applyGunVisual(tower.sprite, tower.typeKey, gun, tower.level);
        }
        if (gun.directional) {
          // Пушка облетает ЦЕНТР башни в сторону цели.
          const orbit = (type.gunOrbit || 0) * this.cellSize;
          const mount = type.gunMount || { x: 0, y: 0 };
          tower.sprite.setPosition(
            centerX + Math.cos(tower.aimAngle) * orbit + mount.x * this.cellSize,
            centerY + Math.sin(tower.aimAngle) * orbit + mount.y * this.cellSize
          );
          tower.sprite.setRotation(0);
        } else {
          tower.sprite.setPosition(pos.x, pos.y);
          tower.sprite.setRotation(tower.aimAngle);
        }
      }
    }
  }

  // Меняем пушку башни (например, после улучшения уровня).
  refreshTowerSprite(tower) {
    const gun = this.resolveGun(tower.typeKey, tower.level, tower.aimDir);

    if (!gun) {
      if (tower.sprite) {
        tower.sprite.destroy();
        tower.sprite = null;
      }
      return;
    }

    if (!tower.sprite) {
      const pos = tower.getPosition();
      const depth = 10 + (tower.gx + tower.gy) * 0.01 + 0.05;
      tower.sprite = this.add.image(pos.x, pos.y, gun.key).setDepth(depth);
      this.applyGunVisual(tower.sprite, tower.typeKey, gun, tower.level);
    }

    this.applyTowerFacing(tower);
  }

  // Ключ корпуса: направленный "<type>_base_<dir>" → старый "<type>_base"
  // → запасная картинка типа. directional=true → не вращать.
  resolveBase(typeKey, dir) {
    const dirKey = `${typeKey}_base_${dir}`;
    if (this.textures.exists(dirKey)) return { key: dirKey, directional: true };

    const legacyKey = `${typeKey}_base`;
    if (this.textures.exists(legacyKey)) return { key: legacyKey, directional: false };

    const fallback = TOWER_TYPES[typeKey].baseTexture;
    if (this.textures.exists(fallback)) return { key: fallback, directional: false };
    return null;
  }

  // Ключ пушки: "<type>_gun_<level>_<dir>" (не вращается) → старый
  // "<type>_<level>" (вращается, ближайший доступный уровень) → null.
  resolveGun(typeKey, level, dir) {
    const dirKey = `${typeKey}_gun_${level}_${dir}`;
    if (this.textures.exists(dirKey)) return { key: dirKey, directional: true };

    for (let current = level; current >= 1; current--) {
      const key = `${typeKey}_${current}`;
      if (this.textures.exists(key)) return { key: key, directional: false };
    }
    return null;
  }

  // Вписываем корпус: направленный — фиксированная опора (ноги, низ-центр),
  // старый — авто-центр по непрозрачной части (как раньше).
  applyBaseVisual(image, typeKey, base) {
    const type = TOWER_TYPES[typeKey];
    const contentPx = this.cellSize * type.footprint;
    if (base.directional) {
      const o = type.baseOrigin || { x: 0.5, y: 1.0 };
      this.applyDirectionalVisual(image, base.key, contentPx, o.x, o.y, `${typeKey}_base`);
    } else {
      this.applyTowerVisual(image, base.key, type.footprint);
    }
  }

  // Вписываем пушку: направленная — фиксированная опора (точка крепления).
  applyGunVisual(image, typeKey, gun, level = 1) {
    const type = TOWER_TYPES[typeKey];
    const contentPx = this.cellSize * type.footprint * (type.weaponScale || 1);
    if (gun.directional) {
      const o = type.gunOrigin || { x: 0.5, y: 0.5 };
      this.applyDirectionalVisual(image, gun.key, contentPx, o.x, o.y, `${typeKey}_gun_${level}`);
    } else {
      this.applyTowerVisual(image, gun.key, type.footprint, type.weaponScale);
    }
  }

  // Направленный спрайт: точку опоры берём ФИКСИРОВАННУЮ, а РАЗМЕР считаем один
  // раз на весь набор направлений (по первой увиденной картинке) — иначе при
  // смене направления спрайт «прыгает» и меняет размер.
  applyDirectionalVisual(image, key, contentPx, originX, originY, sizeKey) {
    image.setOrigin(originX, originY);
    if (!(sizeKey in this.dirSizeCache)) {
      const visual = this.getVisual(key);
      const frac = visual && visual.fraction > 0 ? visual.fraction : 1;
      this.dirSizeCache[sizeKey] = contentPx / frac;
    }
    const wholePx = this.dirSizeCache[sizeKey];
    image.setDisplaySize(wholePx, wholePx);
  }

  // Вписываем картинку башни в её footprint и ставим точку опоры в центр
  // непрозрачной части — тогда спрайт встаёт ровно, как бы он ни был нарисован.
  applyTowerVisual(image, textureKey, footprint, sizeFactor = 1) {
    const visual = this.getVisual(textureKey);
    const contentPx = this.cellSize * footprint * sizeFactor; // нужный размер рисунка

    if (visual) {
      image.setOrigin(visual.originX, visual.originY);
      const wholePx = contentPx / visual.fraction; // размер всей картинки вместе с полями
      image.setDisplaySize(wholePx, wholePx);
    } else {
      image.setOrigin(0.5, 0.5);
      image.setDisplaySize(contentPx, contentPx);
    }
  }

  // Ленивый замер картинки (с кэшем), чтобы не сканировать её повторно.
  getVisual(textureKey) {
    if (!(textureKey in this.visualCache)) {
      this.visualCache[textureKey] = this.measureTexture(textureKey);
    }
    return this.visualCache[textureKey];
  }

  // Измеряем картинку: какую долю занимает непрозрачная часть и где её центр.
  measureTexture(key) {
    if (!this.textures.exists(key)) return null;

    const source = this.textures.get(key).getSourceImage();
    const width = source.width;
    const height = source.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0) return null;

    const contentWidth = maxX - minX + 1;
    const contentHeight = maxY - minY + 1;

    return {
      // доля картинки, которую занимает рисунок (по большей стороне)
      fraction: Math.max(contentWidth, contentHeight) / width,
      // центр рисунка в долях 0..1 — сюда ставим точку опоры спрайта
      originX: (minX + maxX + 1) / 2 / width,
      originY: (minY + maxY + 1) / 2 / height,
    };
  }

  // Переставляем корпус и пушку всех башен (при изменении размера экрана).
  layoutTowerSprites() {
    for (const tower of this.towers) this.applyTowerFacing(tower);
  }

  // Удаляем картинки башни (при продаже).
  destroyTowerSprite(tower) {
    if (tower.sprite) {
      tower.sprite.destroy();
      tower.sprite = null;
    }
    if (tower.baseSprite) {
      tower.baseSprite.destroy();
      tower.baseSprite = null;
    }
  }

  // Кольцо радиуса атаки: в изометрии круг проецируется в эллипс (2:1).
  showRangeRing(x, y, rangeUnits, color) {
    const g = this.rangeGraphics;
    g.clear();
    const a = ISO_HW * Math.SQRT2 * rangeUnits; // полуось по X
    const b = ISO_HH * Math.SQRT2 * rangeUnits; // полуось по Y
    g.fillStyle(color, 0.08);
    g.fillEllipse(x, y, a * 2, b * 2);
    g.lineStyle(3, color, 0.8);
    g.strokeEllipse(x, y, a * 2, b * 2);
  }

  // Кольцо радиуса конкретной башни.
  showRangeRingForTower(tower) {
    const pos = tower.getPosition();
    this.showRangeRing(pos.x, pos.y, tower.range, tower.config.color);
  }

  // Убрать кольцо радиуса.
  clearRangeRing() {
    if (this.rangeGraphics) this.rangeGraphics.clear();
  }

  // ------------------------- Волны -------------------------
  // Множитель HP врагов на волне (растёт плавно, без резких скачков).
  enemyHpScale(wave) {
    return 1 + (wave - 1) * ENEMY_HP_SCALE;
  }

  // Составляем очередь типов врагов для волны.
  buildWaveComposition(wave) {
    const counts =
      wave <= WAVE_TABLE.length ? { ...WAVE_TABLE[wave - 1] } : this.buildEndlessWave(wave);

    // Боссов выпускаем в конце, чтобы остальные успели создать давление.
    const bossCount = counts.boss || 0;
    delete counts.boss;

    // Смешиваем типы «по кругу», чтобы шли вперемешку.
    const entries = Object.entries(counts).map(([type, n]) => [type, n]);
    const queue = [];
    let added = true;
    while (added) {
      added = false;
      for (const entry of entries) {
        if (entry[1] > 0) {
          queue.push(entry[0]);
          entry[1] -= 1;
          added = true;
        }
      }
    }

    for (let i = 0; i < bossCount; i++) queue.push('boss');
    return queue;
  }

  // Волны после 20-й: плавный рост количества и смешивание типов.
  buildEndlessWave(wave) {
    const step = wave - 20;
    const scale = 1 + step * 0.15;
    const counts = {
      normal: Math.round(20 * scale),
      fast: Math.round(12 * scale),
      armored: Math.round(10 * scale),
      tank: Math.round(5 * scale),
      splitter: Math.round(6 * scale),
      shielded: Math.round(8 * scale),
    };
    if (wave % 10 === 0) counts.boss = Math.max(1, Math.floor((wave - 20) / 10) + 1);
    return counts;
  }

  // Запускаем следующую волну (вызывается кликом по кнопке).
  startNextWave() {
    if (this.isGameOver || this.isWaveActive) return;

    this.currentWave += 1;
    this.isWaveActive = true;
    this.playSfx('sfx_wave', 0.5);
    this.startButton.setVisible(false); // кнопка скрыта во время волны

    // Собираем состав волны и берём из него количество врагов.
    this.waveQueue = this.buildWaveComposition(this.currentWave);
    this.enemiesLeftToSpawn = this.waveQueue.length;

    this.updateUI();
    this.showMessage(`Волна ${this.currentWave} началась!`);

    // Порционный спавн: чем дальше волна, тем чаще выходят враги.
    const interval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL - (this.currentWave - 1) * 30);
    this.waveSpawnTimer = this.time.addEvent({
      delay: interval,
      callback: this.spawnWaveEnemy,
      callbackScope: this,
      loop: true,
    });
  }

  // Выпускаем одного врага текущей волны.
  spawnWaveEnemy() {
    if (this.isGameOver || this.enemiesLeftToSpawn <= 0) return;

    const typeKey = this.waveQueue.shift() || 'normal';
    const base = ENEMY_TYPES[typeKey];
    const scale = this.enemyHpScale(this.currentWave);

    // Здоровье и щит зависят от типа и номера волны.
    const hp = Math.round(base.hp * scale);
    const shield = base.shield ? Math.round(base.shield * scale) : 0;

    const enemy = new Enemy(this, this.route, typeKey, hp, shield);
    this.enemies.push(enemy);
    this.enemiesLeftToSpawn -= 1;

    // Все враги выпущены — таймер порционного спавна больше не нужен.
    if (this.enemiesLeftToSpawn === 0 && this.waveSpawnTimer) {
      this.waveSpawnTimer.remove(false);
      this.waveSpawnTimer = null;
    }
  }

  // Волна завершена, если все враги выпущены и на поле никого живого нет.
  checkWaveEnd() {
    if (!this.isWaveActive || this.enemiesLeftToSpawn > 0) return;

    const alive = this.enemies.some((enemy) => enemy.active && !enemy.isDead);
    if (alive) return;

    this.endWave();
  }

  // Завершаем волну: начисляем бонус и возвращаем кнопку старта.
  endWave() {
    this.isWaveActive = false;
    this.gold += WAVE_CLEAR_BONUS;
    this.updateUI();
    this.startButton.setVisible(true);
    this.showMessage(`Волна ${this.currentWave} зачищена! +${WAVE_CLEAR_BONUS} золота`);
  }

  // Экран -> world: через камеру и централизованный screenToWorld.
  pointerToGrid(pointer) {
    const worldPx = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const w = screenToWorld(worldPx.x, worldPx.y);
    return { gx: w.x, gy: w.y };
  }

  // Находим башню под точкой (px, py — в world-пикселях, как getWorldPoint).
  // Хит-тест по ГРАНИЦАМ рисунка корпуса — чтобы зона клика совпадала с картинкой,
  // а не с точкой клетки внизу.
  towerAt(px, py) {
    for (const tower of this.towers) {
      const p = tower.getPosition();
      // Круг вокруг точки башни...
      if (Math.hypot(p.x - px, p.y - py) <= (tower.config.footprint / 2) * this.cellSize) {
        return tower;
      }
      // ...и границы рисунка корпуса (совпадает с картинкой).
      if (tower.baseSprite) {
        const b = tower.baseSprite.getBounds();
        if (Phaser.Geom.Rectangle.Contains(b, px, py)) return tower;
      }
    }
    return null;
  }

  // Можно ли поставить башню типа type в точку:
  // в пределах поля, не на дороге и не пересекаясь с другими башнями.
  isFreeSpot(gx, gy, type, ignoreTower = null) {
    const radius = type.footprint / 2;

    // Границы мира.
    if (gx - radius < 0 || gx + radius > WORLD_SIZE) return false;
    if (gy - radius < 0 || gy + radius > WORLD_SIZE) return false;

    // Дорога: расстояние от центра до полилинии Route (источник истины).
    if (distanceToRoute(gx, gy, this.route) < radius + ROAD_WIDTH / 2) return false;

    return !this.overlapsOtherTower(gx, gy, type, ignoreTower);
  }

  // Пересекается ли башня с уже стоящими (минимум — 90% суммы радиусов).
  overlapsOtherTower(gx, gy, type, ignoreTower) {
    for (const tower of this.towers) {
      if (tower === ignoreTower) continue;
      const minDistance = ((type.footprint + tower.config.footprint) / 2) * 0.9;
      if (Math.hypot(tower.gx - gx, tower.gy - gy) < minDistance) return true;
    }
    return false;
  }

  // Можно ли разместить башню в точке.
  canPlace(gx, gy, type, ignoreTower = null) {
    return this.isFreeSpot(gx, gy, type, ignoreTower);
  }

  // Обработка нажатия: башня — меню, пустое место — режим установки.
  handlePointerDown(pointer) {
    if (this.isGameOver) return;

    // Сбрасываем состояние панорамирования; «вооружим» его ниже, если
    // нажали по пустому месту (на UI-элементах scene-событие не приходит).
    this.panArmed = false;
    this.panActive = false;

    // ПКМ — отменяем установку и закрываем меню.
    if (pointer.rightButtonDown()) {
      this.cancelAll();
      return;
    }

    const { gx, gy } = this.pointerToGrid(pointer);
    const worldPx = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

    // Нажали на башню — открываем её меню (улучшение/продажа).
    const existing = this.towerAt(worldPx.x, worldPx.y);
    if (existing) {
      this.openTowerMenu(existing);
      return;
    }

    // Клик по пустому месту — закрываем меню.
    this.closeTowerMenu();
    if (gx < 0 || gx > WORLD_SIZE || gy < 0 || gy > WORLD_SIZE) return;

    // Пустое место: разрешаем панорамирование одним пальцем/мышью.
    this.panArmed = true;
    this.panStart.x = pointer.x;
    this.panStart.y = pointer.y;

    // Башня не выбрана — ничего не строим.
    if (!this.selectedTowerType) return;

    this.isPlacing = true;
    this.updateGhost(gx, gy);
  }

  // Отменяем установку башни.
  cancelPlacement() {
    this.isPlacing = false;
    if (this.ghost) this.ghost.setVisible(false);
    this.clearRangeRing();
  }

  // Сброс: отмена установки, снятие выбора, закрытие меню.
  cancelAll() {
    this.isPlacing = false;
    this.selectedTowerType = null;
    this.closeTowerMenu();
    this.refreshBuildMenu();
    if (this.ghost) this.ghost.setVisible(false);
    this.clearRangeRing();
  }

  // Пытаемся построить башню выбранного типа в точке.
  tryBuild(gx, gy) {
    if (!this.selectedTowerType) return false;

    const type = TOWER_TYPES[this.selectedTowerType];

    if (!this.canPlace(gx, gy, type)) {
      this.showMessage('Здесь нельзя строить');
      return false;
    }

    if (this.gold < type.cost) {
      console.warn('Недостаточно золота для постройки башни!');
      this.showMessage(`Не хватает золота! Нужно ${type.cost}`);
      return false;
    }

    this.gold -= type.cost;
    const tower = new Tower(this, gx, gy, this.selectedTowerType);
    this.towers.push(tower);
    this.createTowerSprite(tower);
    this.drawTowers(); // перерисовываем индикаторы уровня
    this.updateUI();
    return true;
  }

  // Показываем «призрак» башни под указателем: зелёный — можно, красный — нельзя.
  updateGhost(gx, gy) {
    // Если открыто меню башни — призрак не показываем (кольцо уже от меню).
    if (this.selectedTower) {
      this.ghost.setVisible(false);
      return;
    }

    const type = this.selectedTowerType ? TOWER_TYPES[this.selectedTowerType] : null;
    const inside = gx >= 0 && gx <= WORLD_SIZE && gy >= 0 && gy <= WORLD_SIZE;

    if (!type || !inside || this.isGameOver) {
      this.ghost.setVisible(false);
      this.clearRangeRing();
      return;
    }

    // Корпус (направление по умолчанию — вперёд).
    const base = this.resolveBase(this.selectedTowerType, DIR_FORWARD);
    if (base) {
      this.ghostBase.setTexture(base.key).setVisible(true);
      this.applyBaseVisual(this.ghostBase, this.selectedTowerType, base);
      this.ghostBase.setRotation(0);
      this.ghostBase.setPosition(0, 0);
    } else {
      this.ghostBase.setVisible(false);
    }

    // Центр корпуса призрака (вокруг него облетает пушка).
    let cX = 0;
    let cY = 0;
    if (base) {
      const o = type.baseOrigin || { x: 0.5, y: 1.0 };
      const vis = this.getVisual(base.key);
      if (vis) {
        cX = (vis.originX - o.x) * this.ghostBase.displayWidth;
        cY = (vis.originY - o.y) * this.ghostBase.displayHeight;
      }
    }

    // Пушка (1-го уровня, направление по умолчанию).
    const gun = this.resolveGun(this.selectedTowerType, 1, DIR_FORWARD);
    if (gun) {
      this.ghostWeapon.setTexture(gun.key).setVisible(true);
      this.applyGunVisual(this.ghostWeapon, this.selectedTowerType, gun, 1);
      this.ghostWeapon.setRotation(0);
      const mount = type.gunMount || { x: 0, y: 0 };
      if (gun.directional) {
        const orbit = (type.gunOrbit || 0) * this.cellSize;
        const a = dirToAngle(DIR_FORWARD);
        this.ghostWeapon.setPosition(
          cX + Math.cos(a) * orbit + mount.x * this.cellSize,
          cY + Math.sin(a) * orbit + mount.y * this.cellSize
        );
      } else {
        this.ghostWeapon.setPosition(0, 0);
      }
    } else {
      this.ghostWeapon.setVisible(false);
    }

    const pos = worldToScreen(gx, gy);
    this.ghost.setPosition(pos.x, pos.y);

    const canPlace = this.canPlace(gx, gy, type) && this.gold >= type.cost;
    const tint = canPlace ? 0x66ff66 : 0xff5555;
    this.ghostBase.setTint(tint);
    this.ghostWeapon.setTint(tint);
    this.ghost.setVisible(true);

    // Кольцо радиуса будущей башни.
    this.showRangeRing(pos.x, pos.y, type.range, type.color);
  }

  // Движение указателя: показываем призрак будущей башни.
  handlePointerMove(pointer) {
    if (this.isGameOver) return;

    // Одним пальцем/мышью — панорамируем камеру (если потянули по пустому месту).
    if (this.handlePan(pointer)) return;

    const { gx, gy } = this.pointerToGrid(pointer);

    // Показываем призрак будущей башни под указателем.
    this.updateGhost(gx, gy);
  }

  // Панорамирование одним пальцем/мышью. true — если камера сдвинулась
  // (тогда не показываем призрак башни и не строим по отпусканию).
  handlePan(pointer) {
    if (!this.panArmed || this.pinchActive) {
      return false;
    }
    if (!pointer.isDown) return false;

    // Ещё не определились: ждём, пока потянут дальше порога.
    if (!this.panActive) {
      const moved = Phaser.Math.Distance.Between(
        pointer.x,
        pointer.y,
        this.panStart.x,
        this.panStart.y
      );
      if (moved < 12 * DPR) return false;

      // Это потяг, а не тап: отменяем установку башни.
      this.panActive = true;
      if (this.isPlacing) {
        this.isPlacing = false;
        if (this.ghost) this.ghost.setVisible(false);
      }
      this.clearRangeRing();
      this.panLast.x = pointer.x;
      this.panLast.y = pointer.y;
      return true;
    }

    const cam = this.cameras.main;
    cam.scrollX -= (pointer.x - this.panLast.x) / cam.zoom;
    cam.scrollY -= (pointer.y - this.panLast.y) / cam.zoom;
    this.panLast.x = pointer.x;
    this.panLast.y = pointer.y;
    return true;
  }

  // Отпускание: завершаем панорамирование или ставим новую башню.
  handlePointerUp(pointer) {
    // Сбрасываем панорамирование. Если панорамировали — тап не выполняем.
    const wasPanning = this.panActive;
    this.panArmed = false;
    this.panActive = false;

    // Если был потяг (панорамирование) — это не тап, ничего не строим.
    if (wasPanning) return;

    // Установка новой башни: строим там, где отпустили палец/мышь.
    if (this.isPlacing) {
      this.isPlacing = false;
      const { gx, gy } = this.pointerToGrid(pointer);
      const built = this.tryBuild(gx, gy);
      this.ghost.setVisible(false);
      this.clearRangeRing();

      // Без Shift после постройки выбор снимается.
      // С зажатым Shift можно ставить башни подряд.
      const keepPlacing = this.shiftKey && this.shiftKey.isDown;
      if (built && !keepPlacing) this.clearTowerSelection();
    }
  }

  // Игровой цикл: двигаем врагов, работаем башнями, летим снарядами.
  update(time, delta) {
    if (this.isGameOver) return; // игра остановлена

    // Враги (движение — в world-координатах по Route).
    for (const enemy of this.enemies) {
      if (!enemy.isDead) {
        enemy.moveAlongPath(delta);
      }
    }

    // Башни: перезарядка, поиск цели, выстрел и наводка корпуса/пушки.
    for (const tower of this.towers) {
      tower.update(delta, this.enemies);
      this.applyTowerFacing(tower);
    }

    // Снаряды.
    for (const projectile of this.projectiles) {
      projectile.flyToTarget(delta);
    }

    // Чистим удалённые объекты.
    this.enemies = this.enemies.filter((enemy) => enemy.active);
    this.projectiles = this.projectiles.filter((projectile) => projectile.active);

    // Проверяем, не закончилась ли волна.
    this.checkWaveEnd();
  }
}

// --------------------------- Конфигурация Phaser ---------------------------
const config = {
  type: Phaser.AUTO, // WebGL, а при его отсутствии — Canvas
  parent: 'game',
  backgroundColor: BG_COLOR,
  render: {
    antialias: true,
    // Мипмапы убирают «мыло» при уменьшении спрайтов (важно на телефоне).
    mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
  },
  scale: {
    // NONE: размер задаём сами (в физических пикселях) под плотность экрана.
    // Иначе Phaser рисует в CSS-разрешении, и телефон растягивает картинку.
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth * DPR,
    height: window.innerHeight * DPR,
    zoom: 1 / DPR, // стиль канваса = CSS-пиксели (бэкенд-буфер в DPR раз больше)
  },
  scene: [MenuScene, GameScene],
};

// Запускаем игру.
const game = new Phaser.Game(config);

// Держим канвас в физическом разрешении экрана и пересобираем при ресайзе.
function applyCanvasSize() {
  if (!game.scale || !game.scale.canvas) return;
  game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR);
}
window.addEventListener('resize', applyCanvasSize);
window.addEventListener('orientationchange', () => setTimeout(applyCanvasSize, 200));
game.events.once('ready', applyCanvasSize);
applyCanvasSize();
