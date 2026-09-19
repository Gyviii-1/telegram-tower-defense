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
const API_BASE = 'https://telegram-tower-defense.vercel.app';

const GRID_SIZE = 10;             // размер сетки: 10 на 10 клеток
const BG_COLOR = 0x1a1a2e;        // цвет фона сцены
const CELL_COLOR = 0x16213e;      // заливка обычной (свободной) клетки
const ROAD_COLOR = 0xd4a017;      // заливка клетки дороги (жёлто-песочный)
const GRID_LINE_COLOR = 0x0f3460; // цвет линий сетки

const TOWER_COLOR = 0x2ecc71;     // акцентный цвет интерфейса башен
const TOWER_MAX_LEVEL = 5;        // максимальный уровень башни
const TOWER_SELL_RATIO = 0.7;     // возврат золота при продаже (70% вложенного)
const TOWER_MOVE_SPEED = 3;       // скорость ходьбы башни при переносе (клеток/сек)
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
  },
  bridge: {
    name: 'Мост',
    cost: 30,
    range: 0,
    fireRate: 0,
    damage: 0,
    accuracy: 1,
    footprint: 1.4, // мост крупнее юнита примерно вдвое
    weaponScale: 0,
    isBridge: true,   // ставится на дорогу и разрешает по ней ходить
    capacity: 3,      // сколько башен могут перейти, прежде чем мост «износится»
    baseTexture: 'tower', // запасные картинки (потом bridge_base)
    texture: 'tower',
    color: 0x95a5a6,
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
// Враги заходят слева сверху (0,0), идут змейкой и выходят справа снизу (9,9).
// Между точками путь всегда идёт по прямой (вправо/влево или вверх/вниз).
const PATH_WAYPOINTS = [
  { row: 0, col: 0 }, // старт — левый верхний угол
  { row: 0, col: 6 }, // вправо по верхнему ряду
  { row: 3, col: 6 }, // вниз
  { row: 3, col: 1 }, // влево
  { row: 6, col: 1 }, // вниз
  { row: 6, col: 8 }, // вправо
  { row: 9, col: 8 }, // вниз
  { row: 9, col: 9 }, // финиш — правый нижний угол
];

// ------------------------------ Враг ------------------------------
// Враг — красный квадрат, который плавно едет по клеткам маршрута.
class Enemy extends Phaser.GameObjects.Rectangle {
  constructor(scene, pathCells, typeKey = 'normal', hp = ENEMY_HP, shield = 0) {
    const type = ENEMY_TYPES[typeKey] || ENEMY_TYPES.normal;
    const fillColor = shield > 0 ? type.shieldColor || 0x66ccff : type.color;
    super(scene, 0, 0, 1, 1, fillColor);

    this.typeKey = typeKey;      // ключ типа
    this.config = type;          // настройки типа
    this.baseColor = type.color; // обычный цвет
    this.fillColor = fillColor;  // текущая заливка (со щитом — другая)
    this.speed = type.speed;     // скорость: клеток в секунду
    this.reward = type.reward;   // золото за убийство
    this.sizeFactor = type.size; // размер относительно клетки
    this.damageMultiplier = type.damageMultiplier || 1; // броня (множитель урона)
    this.shield = shield;        // запас щита (снимается первым)

    this.pathCells = pathCells; // полный список клеток маршрута ({row, col})
    this.segment = 0;           // индекс текущего отрезка пути
    this.progress = 0;          // прогресс по отрезку: 0..1
    this.lastCellSize = 0;      // чтобы не пересчитывать размер каждый кадр
    this.hp = hp;               // здоровье (по умолчанию базовое)
    this.isDead = false;        // мёртв/исчезает — не двигается и не цель для башен

    scene.add.existing(this);   // добавляем объект в сцену
    this.setDepth(0.6);         // враг ходит по дороге — ниже моста (мост 0.9)
  }

  // Движение по маршруту. delta — мс, геометрия сетки передаётся из сцены,
  // чтобы враг корректно перестраивался при изменении размера экрана.
  moveAlongPath(delta, cellSize, offsetX, offsetY) {
    // Размер квадрата зависит от размера клетки (обновляем только при изменении).
    if (cellSize !== this.lastCellSize) {
      const size = cellSize * this.sizeFactor;
      this.setSize(size, size);
      this.lastCellSize = cellSize;
    }

    // Прогресс в клетках за кадр: скорость (клеток/сек) * время (сек).
    this.progress += this.speed * (delta / 1000);

    // Переходим на следующий отрезок, если текущий пройден.
    while (this.progress >= 1 && this.segment < this.pathCells.length - 1) {
      this.progress -= 1;
      this.segment += 1;
    }

    // Дошли до конца маршрута — враг покидает карту.
    if (this.segment >= this.pathCells.length - 1) {
      this.arriveAtEnd();
      return;
    }

    // Интерполируем позицию между началом и концом текущего отрезка.
    const from = this.pathCells[this.segment];
    const to = this.pathCells[this.segment + 1];
    const ax = offsetX + (from.col + 0.5) * cellSize;
    const ay = offsetY + (from.row + 0.5) * cellSize;
    const bx = offsetX + (to.col + 0.5) * cellSize;
    const by = offsetY + (to.row + 0.5) * cellSize;

    this.x = Phaser.Math.Linear(ax, bx, this.progress);
    this.y = Phaser.Math.Linear(ay, by, this.progress);
  }

  // Короткая белая вспышка при попадании.
  flash() {
    this.setFillStyle(ENEMY_HIT_COLOR);
    this.scene.time.delayedCall(80, () => {
      if (this.active && !this.isDead) this.setFillStyle(this.fillColor);
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
        this.fillColor = this.baseColor;
        this.setFillStyle(this.fillColor);
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
    super(scene, x, y, Math.max(3, scene.cellSize * 0.12), 0, 360, false, PROJECTILE_COLOR);

    this.target = target;   // враг, в которого стреляли
    this.damage = damage;   // урон башни (растёт с уровнем)
    this.willHit = willHit; // попадёт ли этот выстрел

    if (!willHit) {
      // Промах: выбираем случайную точку рядом с целью (разброс).
      const spread = scene.cellSize * 1.2;
      this.missX = target.x + Phaser.Math.Between(-spread, spread);
      this.missY = target.y + Phaser.Math.Between(-spread, spread);
      this.setAlpha(0.7); // промахи чуть бледнее
    }

    scene.add.existing(this);
    this.setDepth(4); // снаряды поверх всего игрового поля
  }

  // Летим к цели; при достижении наносим урон и исчезаем.
  flyToTarget(delta, cellSize) {
    const step = PROJECTILE_SPEED * cellSize * (delta / 1000);

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
    this.aimAngle = 0;               // куда направлена пушка (радианы)
    this.baseAngle = 0;              // поворот корпуса (радианы)
    this.sprite = null;              // картинка пушки (вращается)
    this.baseSprite = null;          // картинка корпуса (стоит на месте)

    // Передвижение при переносе.
    this.path = [];                  // маршрут ходьбы (точки в клетках)
    this.isMoving = false;           // идёт ли башня пешком
    this.lastCellKey = null;         // для учёта перехода через мост

    // Мост: ресурс переходов.
    this.capacity = type.capacity || 0;
    this.used = 0;
    this.usedUp = false;
  }

  // Цена следующего улучшения (зависит от типа и уровня).
  getUpgradeCost() {
    return Math.round(this.config.cost * 0.8) * this.level;
  }

  // Сколько золота вернётся при продаже.
  getSellValue() {
    return Math.floor(this.totalSpent * TOWER_SELL_RATIO);
  }

  // Можно ли ещё улучшать башню (мост не улучшается).
  canUpgrade() {
    return !this.config.isBridge && this.level < TOWER_MAX_LEVEL;
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

  // Центр башни в пикселях с учётом текущей геометрии сетки.
  getPosition(cellSize, offsetX, offsetY) {
    return {
      x: offsetX + this.gx * cellSize,
      y: offsetY + this.gy * cellSize,
    };
  }

  // Обновление башни: перезарядка, поиск цели, выстрел.
  update(delta, cellSize, offsetX, offsetY, enemies) {
    this.cooldown -= delta / 1000;

    const pos = this.getPosition(cellSize, offsetX, offsetY);
    const target = this.findTarget(enemies, pos, cellSize);

    // Наводим пушку на цель.
    if (target) {
      this.aimAngle = Math.atan2(target.y - pos.y, target.x - pos.x);
    }

    // Стреляем, только если башня умеет стрелять, есть цель и она перезарядилась.
    if (this.fireRate <= 0 || !target || this.cooldown > 0) return;

    // Выстрел из дула: чуть впереди центра по направлению пушки.
    const weaponScale = this.config.weaponScale || 1;
    const muzzleDistance = this.config.footprint * weaponScale * 0.5 * cellSize;
    const muzzle = {
      x: pos.x + Math.cos(this.aimAngle) * muzzleDistance,
      y: pos.y + Math.sin(this.aimAngle) * muzzleDistance,
    };

    this.shoot(muzzle, target);
    this.cooldown = 1 / this.fireRate; // перезарядка
  }

  // Ищем ближайшего живого врага в радиусе атаки.
  findTarget(enemies, pos, cellSize) {
    const rangePx = this.range * cellSize;
    let nearest = null;
    let nearestDistance = Infinity;

    for (const enemy of enemies) {
      if (!enemy.active || enemy.isDead) continue;

      const distance = Phaser.Math.Distance.Between(pos.x, pos.y, enemy.x, enemy.y);
      if (distance <= rangePx && distance < nearestDistance) {
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
    const projectile = new Projectile(this.scene, pos.x, pos.y, target, this.damage, willHit);
    this.scene.projectiles.push(projectile);
  }
}

// ------------------------------ Сцена ------------------------------
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

    // Если спрайта уровня ещё нет — это не ошибка, используем базовую картинку.
    this.load.on('loaderror', (file) => {
      if (file && /_\d+$/.test(file.key)) return;
      console.warn('Не загрузился файл:', file && file.key);
    });
  }

  create() {
    // Разворачиваем мини-апп на весь экран Telegram и определяем игрока.
    this.initTelegram();

    // Данные игрока и роль (creator / tester / player) — роль читается из Firebase.
    this.playerInfo = this.getPlayerInfo();
    this.playerRole = 'player';
    this.isBeta = false;

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
    // Башня, для которой включён режим переноса (кнопка «Переместить»).
    this.movingTower = null;
    // Мосты, исчерпавшие лимит (ломаются в конце кадра).
    this.brokenBridges = [];
    // Тип башни, который строим по клику (переключается панелью внизу).
    this.selectedTowerType = 'gunner';
    // Угол поворота призрака при постройке (крутится до установки).
    this.buildAngle = 0;

    // Кэш замеров картинок: где у них непрозрачная часть и её центр.
    // Заполняется лениво (при первом использовании текстуры).
    this.visualCache = {};

    // Башни хранятся списком (свободная установка, без привязки к клеткам).
    this.towers = [];

    // Состояние перетаскивания башни и установки новой.
    this.dragTower = null;
    this.dragMoved = false;
    this.isPlacing = false;

    // Строим маршрут: список клеток + быстрый доступ "клетка это дорога?".
    this.buildPath();

    // Списки живых врагов и снарядов.
    this.enemies = [];
    this.projectiles = [];

    // Отдельная графика для клеток сетки и для башен —
    // так их можно перерисовывать независимо.
    // Слои по глубине: сетка (0) → спрайты башен (1) → точки уровня (2) →
    // враги (3) → снаряды (4) → UI (90+).
    this.gridGraphics = this.add.graphics().setDepth(0);
    this.rangeGraphics = this.add.graphics().setDepth(0.5); // кольцо радиуса атаки
    this.towersGraphics = this.add.graphics().setDepth(2);

    // Геометрия сетки (пересчитывается в layout()).
    this.cellSize = 0; // размер одной клетки в пикселях
    this.offsetX = 0;  // сдвиг сетки по X (чтобы центрировать)
    this.offsetY = 0;  // сдвиг сетки по Y

    // Создаём UI (тексты поверх всего).
    this.createUI();

    // Первая отрисовка и подписка на изменение размера окна/экрана.
    this.layout();
    // Сначала снимаем старый обработчик (важно при рестарте сцены),
    // затем вешаем заново — иначе при перезапуске они накопятся.
    this.scale.off('resize', this.layout, this);
    this.scale.on('resize', this.layout, this);
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

        // Клавиша R (рус. К) поворачивает призрак будущей башни.
        if (key === 'r' || key === 'к') {
          if (this.selectedTowerType) this.rotateBuild();
          return;
        }

        const index = parseInt(event.key, 10);
        if (!index) return;
        const keys = Object.keys(TOWER_TYPES);
        const typeKey = keys[index - 1];
        if (typeKey) this.selectTowerType(typeKey);
      });
    }

    // Управление указателем: клик — постройка/меню, перетаскивание — перенос башни.
    this.input.on('pointerdown', this.handlePointerDown, this);
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handlePointerUp, this);
    this.input.on('pointerupoutside', this.handlePointerUp, this);

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
        lineSpacing: 6,
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(1, 0) // якорим к правому верхнему углу
      .setDepth(100);

    // Кнопка запуска следующей волны (левый верхний угол).
    this.startButton = this.add
      .text(0, 0, '[ СТАРТ ВОЛНЫ ]', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#2ecc71',
        backgroundColor: '#00000088',
        padding: { x: 10, y: 6 },
        stroke: '#000000',
        strokeThickness: 3,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0) // якорим к левому верхнему углу
      .setInteractive({ useHandCursor: true })
      .setDepth(100);

    // По клику/тапу запускаем следующую волну.
    this.startButton.on('pointerdown', (pointer, localX, localY, event) => {
      // Не даём клику уйти в сцену (иначе он мог бы поставить башню).
      if (event && event.stopPropagation) event.stopPropagation();
      this.startNextWave();
    });

    // Всплывающее предупреждение (например, "не хватает золота").
    this.messageText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#f1c40f',
        stroke: '#000000',
        strokeThickness: 5,
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
        strokeThickness: 8,
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
        padding: { x: 24, y: 12 },
        stroke: '#000000',
        strokeThickness: 3,
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

    // Меню башни (улучшение/продажа). Скрыто, пока не выбрана башня.
    this.towerMenu = this.add.container(0, 0).setDepth(102).setVisible(false);

    this.towerMenuBg = this.add
      .rectangle(0, 0, 270, 200, 0x000000, 0.9)
      .setStrokeStyle(2, TOWER_COLOR)
      .setInteractive();
    // Клик по фону меню не должен «проваливаться» в игровое поле.
    this.towerMenuBg.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
    });

    this.towerMenuTitle = this.add
      .text(0, -72, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#ffffff',
        fontStyle: 'bold',
        align: 'center',
        lineSpacing: 4,
      })
      .setOrigin(0.5);

    this.towerMenuUpgrade = this.add
      .text(0, -20, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#2ecc71',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.towerMenuMove = this.add
      .text(0, 22, '⤢ Переместить', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#f1c40f',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.towerMenuSell = this.add
      .text(0, 62, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#e74c3c',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.towerMenu.add([
      this.towerMenuBg,
      this.towerMenuTitle,
      this.towerMenuUpgrade,
      this.towerMenuMove,
      this.towerMenuSell,
    ]);

    this.towerMenuUpgrade.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.upgradeSelectedTower();
    });

    this.towerMenuMove.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.moveSelectedTower();
    });

    this.towerMenuSell.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      this.sellSelectedTower();
    });

    // Панель выбора башни для постройки (внизу экрана).
    this.createBuildMenu();

    // «Призрак» башни (корпус + пушка), следующий за указателем.
    const ghostType = TOWER_TYPES[this.selectedTowerType];
    this.ghostBase = this.add.image(0, 0, ghostType.baseTexture).setAlpha(0.6);
    this.ghostWeapon = this.add.image(0, 0, ghostType.baseTexture).setAlpha(0.6);
    this.ghost = this.add
      .container(0, 0, [this.ghostBase, this.ghostWeapon])
      .setDepth(5)
      .setVisible(false);
  }

  // Обновляем текст панели при изменении волны/жизней/золота.
  updateUI() {
    const nick = this.playerInfo ? this.playerInfo.nick : 'Игрок';
    const prefix = this.roleLabel(this.playerRole);
    const betaMark = this.isBeta ? ' · бета' : '';
    const nameLine = prefix ? `${nick} · ${prefix}${betaMark}` : `${nick}${betaMark}`;

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
      this.isBeta = !!data.beta;
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

  // Экран поражения.
  showGameOver() {
    this.overlay.setVisible(true);
    this.gameOverText.setVisible(true);
    this.startButton.setVisible(false); // убираем кнопку старта волны
    this.restartButton.setVisible(true); // показываем кнопку перезапуска
    this.closeTowerMenu(); // прячем меню башни, если оно было открыто
    this.buildMenu.setVisible(false); // прячем панель постройки
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
    this.refreshTowerMenu();
    this.positionTowerMenu();
    this.towerMenu.setVisible(true);
    this.showRangeRingForTower(tower);
  }

  // Закрыть меню башни.
  closeTowerMenu() {
    this.selectedTower = null;
    if (this.towerMenu) this.towerMenu.setVisible(false);
    this.clearRangeRing();
  }

  // Обновить тексты меню по текущей башне.
  refreshTowerMenu() {
    const tower = this.selectedTower;
    if (!tower) return;

    // У моста нет улучшений — показываем остаток переходов.
    if (tower.config.isBridge) {
      const left = Math.max(0, tower.capacity - tower.used);
      this.towerMenuTitle.setText(`Мост · переходов осталось: ${left}`);
      this.towerMenuUpgrade.setText('').setVisible(false);
      this.towerMenuMove.setVisible(false); // мост не переносится
      this.towerMenuSell.setText(`✖ Продать (+${tower.getSellValue()})`);
      return;
    }

    this.towerMenuUpgrade.setVisible(true);
    this.towerMenuMove.setVisible(true);
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

    const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);
    const width = this.scale.width;
    const height = this.scale.height;
    const halfW = 135; // половина ширины фона меню (270 / 2)
    const halfH = 100; // половина высоты фона меню (200 / 2)
    const margin = 8;

    let x = pos.x;
    let y = pos.y - this.cellSize * 0.8 - halfH; // сначала пробуем над башней
    if (y - halfH < margin) {
      y = pos.y + this.cellSize * 0.8 + halfH; // не влезло — ставим под башней
    }

    x = Phaser.Math.Clamp(x, halfW + margin, width - halfW - margin);
    y = Phaser.Math.Clamp(y, halfH + margin, height - halfH - margin);
    this.towerMenu.setPosition(x, y);
  }

  // Включаем режим переноса для выбранной башни.
  moveSelectedTower() {
    const tower = this.selectedTower;
    if (!tower || tower.config.isBridge) return; // мост не переносится

    this.movingTower = tower;
    this.selectedTowerType = null;
    this.refreshBuildMenu();
    this.closeTowerMenu();
    if (this.ghost) this.ghost.setVisible(false);
    this.showRangeRingForTower(tower);
    this.showMessage('Нажми на новое место для башни');
  }

  // Повернуть призрак будущей башни на 90° (до постройки).
  rotateBuild() {
    this.buildAngle = (this.buildAngle + Math.PI / 2) % (Math.PI * 2);
    this.applyGhostAngle();
  }

  // Применяем угол постройки к призраку.
  applyGhostAngle() {
    if (this.ghostBase) this.ghostBase.setRotation(this.buildAngle);
    if (this.ghostWeapon) this.ghostWeapon.setRotation(this.buildAngle);
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
    this.buildMenu = this.add.container(0, 0).setDepth(100);
    this.buildButtons = {};
    this.buildButtonWidth = 105;
    this.buildGap = 8;

    const buttonWidth = this.buildButtonWidth;
    const gap = this.buildGap;

    Object.keys(TOWER_TYPES).forEach((key, index) => {
      const type = TOWER_TYPES[key];
      const button = this.add.container(index * (buttonWidth + gap), 0);

      const bg = this.add
        .rectangle(0, 0, buttonWidth, 90, 0x000000, 0.85)
        .setStrokeStyle(2, 0xffffff, 0.4)
        .setInteractive({ useHandCursor: true });

      bg.on('pointerdown', (pointer, localX, localY, event) => {
        if (event && event.stopPropagation) event.stopPropagation();
        this.selectTowerType(key);
      });

      // Иконка = корпус + пушка 1-го уровня.
      const icon = this.add.container(0, -14);
      const baseKey = this.getBaseTextureKey(key) || type.texture;
      icon.add(this.add.image(0, 0, baseKey).setDisplaySize(34, 34));
      const weaponKey = this.getWeaponTextureKey(key, 1);
      if (weaponKey) {
        icon.add(this.add.image(0, 0, weaponKey).setDisplaySize(34, 34));
      }

      const label = this.add
        .text(0, 26, `${type.name} · ${type.cost}`, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '13px',
          color: '#ffffff',
        })
        .setOrigin(0.5);

      button.add([bg, icon, label]);
      this.buildMenu.add(button);

      this.buildButtons[key] = { container: button, bg: bg, type: type };
    });

    this.refreshBuildMenu();
  }

  // Выбрать тип башни для постройки. Повторный клик по выбранной — снять выбор.
  selectTowerType(key) {
    this.selectedTowerType = this.selectedTowerType === key ? null : key;
    this.buildAngle = 0; // новый выбор — угол сбрасываем
    this.refreshBuildMenu();
    this.applyGhostAngle();
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
    const y = height - 60;

    keys.forEach((key, index) => {
      this.buildButtons[key].container.setPosition(startX + index * (buttonWidth + gap), y);
    });
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
      const child = new Enemy(this, this.pathCells, typeKey, hp, 0);
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

  // Строим маршрут по угловым точкам PATH_WAYPOINTS.
  // Заполняем:
  //   this.pathCells — все клетки маршрута по порядку (для движения врагов);
  //   this.road       — двумерный массив true/false (дорога или нет).
  buildPath() {
    this.road = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
    this.pathCells = [];

    const addCell = (row, col) => {
      const last = this.pathCells[this.pathCells.length - 1];
      if (last && last.row === row && last.col === col) return; // без дублей
      this.pathCells.push({ row, col });
      this.road[row][col] = true;
    };

    for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
      const from = PATH_WAYPOINTS[i];
      const to = PATH_WAYPOINTS[i + 1];

      const dr = Math.sign(to.row - from.row); // шаг по строкам (-1, 0, 1)
      const dc = Math.sign(to.col - from.col); // шаг по столбцам (-1, 0, 1)

      let row = from.row;
      let col = from.col;
      addCell(row, col);

      // Идём клетка за клеткой до конечной точки отрезка.
      while (row !== to.row || col !== to.col) {
        row += dr;
        col += dc;
        addCell(row, col);
      }
    }
  }

  // Пересчёт размеров и перерисовка под текущий размер экрана.
  // Вызывается при старте и при каждом ресайзе (поворот телефона и т.п.).
  layout() {
    const width = this.scale.width;
    const height = this.scale.height;

    // Вписываем квадратную сетку в экран, сохраняя размер клеток равным по X и Y.
    this.cellSize = Math.min(width, height) / GRID_SIZE;
    // Центрируем сетку в оставшемся пространстве.
    this.offsetX = (width - this.cellSize * GRID_SIZE) / 2;
    this.offsetY = (height - this.cellSize * GRID_SIZE) / 2;

    this.drawGrid();
    this.drawTowers();
    this.layoutTowerSprites();
    this.layoutUI(width, height);
  }

  // Позиционируем элементы интерфейса под новый размер экрана.
  layoutUI(width, height) {
    const pad = Math.max(10, Math.min(width, height) * 0.03);
    const uiSize = Math.max(16, Math.min(width, height) * 0.05);

    this.uiText.setPosition(width - pad, pad);
    this.uiText.setStyle({ fontSize: `${Math.round(uiSize)}px` });

    // Кнопка старта волны — левый верхний угол; прячем, пока волна активна.
    this.startButton.setPosition(pad, pad);
    this.startButton.setStyle({ fontSize: `${Math.round(uiSize)}px` });
    this.startButton.setVisible(!this.isWaveActive && !this.isGameOver);

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
    this.buildMenu.setVisible(!this.isGameOver);
  }

  // Рисуем клетки сетки. Дорогу подсвечиваем другим цветом.
  drawGrid() {
    const g = this.gridGraphics;
    g.clear();

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = this.offsetX + col * this.cellSize;
        const y = this.offsetY + row * this.cellSize;

        // Заливка клетки: дорога или свободная земля.
        g.fillStyle(this.isRoad(row, col) ? ROAD_COLOR : CELL_COLOR, 1);
        g.fillRect(x, y, this.cellSize, this.cellSize);

        // Рамка клетки.
        g.lineStyle(2, GRID_LINE_COLOR, 1);
        g.strokeRect(x, y, this.cellSize, this.cellSize);
      }
    }
  }

  // Рисуем башни по массиву towers.
  drawTowers() {
    const g = this.towersGraphics;
    g.clear();

    for (const tower of this.towers) {
      // Запасной вариант: если картинки нет — рисуем кружок цветом типа.
      if (!this.textures.exists(tower.config.texture)) {
        const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);
        const half = (this.cellSize * tower.config.footprint) / 2;
        g.fillStyle(tower.config.color, 1);
        g.fillCircle(pos.x, pos.y, half);
      }
    }
  }

  // ------------------------- Спрайты башен -------------------------
  // Создаём корпус и пушку башни.
  createTowerSprite(tower) {
    const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);

    // Корпус (стоит на месте). Мост рисуем выше обычных башен (1.5),
    // чтобы проходящий «юнит» оказывался под мостом, а его пушка (2) — над.
    const baseKey = this.getBaseTextureKey(tower.typeKey);
    if (baseKey) {
      const baseDepth = tower.config.isBridge ? 0.9 : 1;
      tower.baseSprite = this.add.image(pos.x, pos.y, baseKey).setDepth(baseDepth);
      this.applyTowerVisual(tower.baseSprite, baseKey, tower.config.footprint);
      tower.baseSprite.setRotation(tower.baseAngle);
    }

    // Пушка (вращается к врагу).
    const weaponKey = this.getWeaponTextureKey(tower.typeKey, tower.level);
    if (weaponKey) {
      tower.sprite = this.add.image(pos.x, pos.y, weaponKey).setDepth(2);
      this.applyTowerVisual(
        tower.sprite,
        weaponKey,
        tower.config.footprint,
        tower.config.weaponScale
      );
    }
  }

  // Меняем пушку башни (например, после улучшения уровня).
  refreshTowerSprite(tower) {
    const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);
    const weaponKey = this.getWeaponTextureKey(tower.typeKey, tower.level);

    if (!weaponKey) {
      if (tower.sprite) {
        tower.sprite.destroy();
        tower.sprite = null;
      }
      return;
    }

    if (!tower.sprite) {
      tower.sprite = this.add.image(pos.x, pos.y, weaponKey).setDepth(2);
    } else {
      tower.sprite.setTexture(weaponKey);
    }

    this.applyTowerVisual(
      tower.sprite,
      weaponKey,
      tower.config.footprint,
      tower.config.weaponScale
    );
    tower.sprite.setPosition(pos.x, pos.y);
    tower.sprite.setRotation(tower.aimAngle);
  }

  // Ключ картинки корпуса: "gunner_base", иначе запасная картинка типа.
  getBaseTextureKey(typeKey) {
    const key = `${typeKey}_base`;
    if (this.textures.exists(key)) return key;

    const fallback = TOWER_TYPES[typeKey].baseTexture;
    return this.textures.exists(fallback) ? fallback : null;
  }

  // Ключ картинки пушки для уровня: "gunner_3".
  // Если спрайта этого уровня нет — берём ближайший предыдущий.
  // Если пушек нет вообще — null (башня без пушки).
  getWeaponTextureKey(typeKey, level) {
    for (let current = level; current >= 1; current--) {
      const key = `${typeKey}_${current}`;
      if (this.textures.exists(key)) return key;
    }
    return null;
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
    for (const tower of this.towers) {
      const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);

      const baseKey = this.getBaseTextureKey(tower.typeKey);
      if (tower.baseSprite && baseKey) {
        tower.baseSprite.setPosition(pos.x, pos.y);
        this.applyTowerVisual(tower.baseSprite, baseKey, tower.config.footprint);
        tower.baseSprite.setRotation(tower.baseAngle);
      }

      const weaponKey = this.getWeaponTextureKey(tower.typeKey, tower.level);
      if (tower.sprite && weaponKey) {
        tower.sprite.setPosition(pos.x, pos.y);
        this.applyTowerVisual(
          tower.sprite,
          weaponKey,
          tower.config.footprint,
          tower.config.weaponScale
        );
      }
    }
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

  // Ставим корпус и пушку башни в её текущую точку.
  positionTowerSprites(tower) {
    const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);
    if (tower.baseSprite) {
      tower.baseSprite.setPosition(pos.x, pos.y);
      tower.baseSprite.setRotation(tower.baseAngle);
    }
    if (tower.sprite) tower.sprite.setPosition(pos.x, pos.y);
  }

  // Показать кольцо радиуса атаки (rangeCells — радиус в клетках).
  showRangeRing(x, y, rangeCells, color) {
    const g = this.rangeGraphics;
    g.clear();
    const radius = rangeCells * this.cellSize;
    g.fillStyle(color, 0.08);
    g.fillCircle(x, y, radius);
    g.lineStyle(3, color, 0.8);
    g.strokeCircle(x, y, radius);
  }

  // Кольцо радиуса конкретной башни.
  showRangeRingForTower(tower) {
    const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);
    this.showRangeRing(pos.x, pos.y, tower.range, tower.config.color);
  }

  // Убрать кольцо радиуса.
  clearRangeRing() {
    if (this.rangeGraphics) this.rangeGraphics.clear();
  }

  // Проверка: является ли клетка дорогой.
  isRoad(row, col) {
    return this.road[row] !== undefined && this.road[row][col] === true;
  }

  // Мост, стоящий ровно на этой клетке (мосты ставим по центру клетки).
  bridgeAtCell(col, row) {
    for (const tower of this.towers) {
      if (!tower.config.isBridge) continue;
      if (Math.floor(tower.gx) === col && Math.floor(tower.gy) === row) return tower;
    }
    return null;
  }

  // Направление дороги в клетке: 'horizontal', 'vertical', 'corner' или null.
  roadDirectionAt(col, row) {
    const horizontal = this.isRoad(row, col - 1) || this.isRoad(row, col + 1);
    const vertical = this.isRoad(row - 1, col) || this.isRoad(row + 1, col);
    if (horizontal && vertical) return 'corner';
    if (horizontal) return 'horizontal';
    if (vertical) return 'vertical';
    return null;
  }

  // Мост всегда ставится ПОПЕРЁК дороги (вдоль — нельзя).
  bridgeAngleAt(col, row) {
    return this.roadDirectionAt(col, row) === 'horizontal' ? Math.PI / 2 : 0;
  }

  // Можно ли пройти по клетке: везде свободно, кроме дороги
  // (по дороге — только через мост, у которого остался ресурс).
  isWalkableCell(col, row) {
    if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) return false;
    if (!this.isRoad(row, col)) return true;
    const bridge = this.bridgeAtCell(col, row);
    return !!bridge && !bridge.usedUp;
  }

  // Поиск пути по клеткам (BFS). Возвращает список точек или null.
  findPath(startCol, startRow, goalCol, goalRow) {
    if (startCol === goalCol && startRow === goalRow) return [];

    const key = (c, r) => c + ',' + r;
    const queue = [[startCol, startRow]];
    const visited = new Set([key(startCol, startRow)]);
    const cameFrom = new Map();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (queue.length) {
      const [c, r] = queue.shift();

      for (const [dc, dr] of dirs) {
        const nc = c + dc;
        const nr = r + dr;
        const k = key(nc, nr);
        if (visited.has(k)) continue;
        if (!this.isWalkableCell(nc, nr)) continue;

        visited.add(k);
        cameFrom.set(k, [c, r]);

        if (nc === goalCol && nr === goalRow) {
          const path = [];
          let cur = [nc, nr];
          while (!(cur[0] === startCol && cur[1] === startRow)) {
            path.push({ gx: cur[0] + 0.5, gy: cur[1] + 0.5 });
            cur = cameFrom.get(key(cur[0], cur[1]));
          }
          path.reverse();
          return path;
        }

        queue.push([nc, nr]);
      }
    }

    return null; // пути нет
  }

  // Начинаем перенос: башня пойдёт пешком к указанной точке.
  startTowerMove(tower, gx, gy) {
    // Мосты не переносятся.
    if (tower.config.isBridge) return false;

    if (!this.canPlace(gx, gy, tower.config, tower)) {
      this.showMessage('Здесь нельзя поставить');
      return false;
    }

    const startCol = Math.floor(tower.gx);
    const startRow = Math.floor(tower.gy);
    const path = this.findPath(startCol, startRow, Math.floor(gx), Math.floor(gy));
    if (!path) {
      this.showMessage('Нет прохода (нужен мост)');
      return false;
    }

    path.push({ gx, gy });
    tower.path = path;
    tower.isMoving = true;
    tower.lastCellKey = startCol + ',' + startRow;
    return true;
  }

  // Движение башни по маршруту (при переносе).
  updateTowerMovement(tower, delta) {
    if (!tower.path || tower.path.length === 0) {
      tower.isMoving = false;
      return;
    }

    const speed = (tower.config.moveSpeed || TOWER_MOVE_SPEED) * (delta / 1000);
    const point = tower.path[0];
    const dx = point.gx - tower.gx;
    const dy = point.gy - tower.gy;
    const distance = Math.hypot(dx, dy);

    if (distance <= speed || distance < 0.02) {
      tower.gx = point.gx;
      tower.gy = point.gy;
      tower.path.shift();
      if (tower.path.length === 0) tower.isMoving = false;
    } else {
      tower.gx += (dx / distance) * speed;
      tower.gy += (dy / distance) * speed;
    }

    // Когда башня покидает клетку моста — расходуем один переход.
    const col = Math.floor(tower.gx);
    const row = Math.floor(tower.gy);
    const cellKey = col + ',' + row;
    if (tower.lastCellKey && tower.lastCellKey !== cellKey) {
      const parts = tower.lastCellKey.split(',');
      const bridge = this.bridgeAtCell(Number(parts[0]), Number(parts[1]));
      if (bridge) {
        bridge.used += 1;
        // Лимит исчерпан — мост сломается (убираем в конце кадра).
        if (bridge.capacity > 0 && bridge.used >= bridge.capacity && !bridge.usedUp) {
          bridge.usedUp = true;
          this.brokenBridges.push(bridge);
        }
      }
    }
    tower.lastCellKey = cellKey;

    this.positionTowerSprites(tower);
  }

  // Ломаем мосты, исчерпавшие лимит переходов.
  breakBridges() {
    if (this.brokenBridges.length === 0) return;

    for (const bridge of this.brokenBridges) {
      const index = this.towers.indexOf(bridge);
      if (index !== -1) this.towers.splice(index, 1);
      this.destroyTowerSprite(bridge);
      if (this.selectedTower === bridge) this.closeTowerMenu();
      if (this.movingTower === bridge) this.movingTower = null;
    }

    this.brokenBridges = [];
    this.showMessage('Мост сломался!');
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

    const enemy = new Enemy(this, this.pathCells, typeKey, hp, shield);
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

  // Переводим координаты указателя в «клеточные» единицы (центр башни).
  pointerToGrid(pointer) {
    return {
      gx: (pointer.x - this.offsetX) / this.cellSize,
      gy: (pointer.y - this.offsetY) / this.cellSize,
    };
  }

  // Находим башню под точкой по её кругу (radius).
  // Зону захвата НЕ расширяем до всего спрайта, иначе рядом с башней
  // нельзя поставить новую — клик уходил бы в перетаскивание.
  towerAt(gx, gy) {
    for (const tower of this.towers) {
      if (Math.hypot(tower.gx - gx, tower.gy - gy) <= tower.config.footprint / 2) return tower;
    }
    return null;
  }

  // Можно ли поставить башню типа type в точку:
  // в пределах поля, не на дороге и не пересекаясь с другими башнями.
  isFreeSpot(gx, gy, type, ignoreTower = null) {
    // Отступ от края поля и от дороги берём по всему спрайту (size),
    // иначе крупная башня картинкой «заезжает» на дорогу.
    const footprint = type.footprint / 2;

    // Границы игрового поля.
    if (gx - footprint < 0 || gx + footprint > GRID_SIZE) return false;
    if (gy - footprint < 0 || gy + footprint > GRID_SIZE) return false;

    // Дорога: спрайт не должен пересекаться с клетками дороги.
    for (const cell of this.pathCells) {
      const nearestX = Phaser.Math.Clamp(gx, cell.col, cell.col + 1);
      const nearestY = Phaser.Math.Clamp(gy, cell.row, cell.row + 1);
      if (Math.hypot(gx - nearestX, gy - nearestY) < footprint) return false;
    }

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

  // Можно ли разместить башню (с учётом того, что мост ставится на дорогу).
  canPlace(gx, gy, type, ignoreTower = null) {
    if (type.isBridge) {
      const col = Math.floor(gx);
      const row = Math.floor(gy);
      if (!this.isRoad(row, col)) return false; // мост — только на дорогу
      if (this.bridgeAtCell(col, row)) return false; // одна клетка — один мост
      const dir = this.roadDirectionAt(col, row);
      if (!dir || dir === 'corner') return false; // на повороте/перекрёстке нельзя
      // Призрак должен стоять ПОПЕРЁК дороги.
      const required = this.bridgeAngleAt(col, row);
      const mod = (a) => ((a % Math.PI) + Math.PI) % Math.PI;
      if (Math.abs(mod(this.buildAngle) - mod(required)) > 0.0001) return false;
      return !this.overlapsOtherTower(gx, gy, type, ignoreTower);
    }
    return this.isFreeSpot(gx, gy, type, ignoreTower);
  }

  // Обработка нажатия: башня — перетаскивание, пустое место — режим установки.
  handlePointerDown(pointer) {
    if (this.isGameOver) return;

    // ПКМ — полностью отменяем: перенос, установку и выбор башни.
    if (pointer.rightButtonDown()) {
      this.cancelAll();
      return;
    }

    const { gx, gy } = this.pointerToGrid(pointer);

    // Нажали на башню.
    const existing = this.towerAt(gx, gy);
    if (existing) {
      // Если для этой башни включён режим переноса — тащим её.
      if (this.movingTower === existing) {
        this.startDragging(existing, gx, gy);
        return;
      }
      // Иначе открываем меню. Перенос — только по кнопке «Переместить».
      this.movingTower = null;
      this.openTowerMenu(existing);
      return;
    }

    // Если включён режим переноса — башня идёт к указанной точке.
    if (this.movingTower) {
      const tower = this.movingTower;
      if (this.startTowerMove(tower, gx, gy)) {
        this.movingTower = null;
        this.clearRangeRing();
      }
      return;
    }

    // Клик по пустому месту — закрываем меню.
    this.closeTowerMenu();
    if (gx < 0 || gx > GRID_SIZE || gy < 0 || gy > GRID_SIZE) return;

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

  // Полная отмена (ПКМ): вернуть переносимую башню, снять выбор, закрыть меню.
  cancelAll() {
    if (this.dragTower) {
      const tower = this.dragTower;
      tower.gx = this.dragStartX;
      tower.gy = this.dragStartY;
      this.positionTowerSprites(tower);
      this.dragTower = null;
    }

    this.isPlacing = false;
    this.selectedTowerType = null;
    this.movingTower = null;
    this.closeTowerMenu();
    this.refreshBuildMenu();
    if (this.ghost) this.ghost.setVisible(false);
    this.clearRangeRing();
  }

  // Пытаемся построить башню выбранного типа в точке.
  tryBuild(gx, gy) {
    if (!this.selectedTowerType) return false;

    const type = TOWER_TYPES[this.selectedTowerType];

    // Мост ставим ровно по центру клетки дороги.
    if (type.isBridge) {
      gx = Math.floor(gx) + 0.5;
      gy = Math.floor(gy) + 0.5;
    }

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
    tower.baseAngle = this.buildAngle; // сохраняем поворот, выбранный при призраке
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
    const inside = gx >= 0 && gx <= GRID_SIZE && gy >= 0 && gy <= GRID_SIZE;

    if (!type || !inside || this.isGameOver) {
      this.ghost.setVisible(false);
      this.clearRangeRing();
      return;
    }

    // Корпус.
    const baseKey = this.getBaseTextureKey(this.selectedTowerType);
    if (baseKey) {
      this.ghostBase.setTexture(baseKey).setVisible(true);
      this.applyTowerVisual(this.ghostBase, baseKey, type.footprint);
    } else {
      this.ghostBase.setVisible(false);
    }

    // Пушка (у нового строения — 1-го уровня).
    const weaponKey = this.getWeaponTextureKey(this.selectedTowerType, 1);
    if (weaponKey) {
      this.ghostWeapon.setTexture(weaponKey).setVisible(true);
      this.applyTowerVisual(this.ghostWeapon, weaponKey, type.footprint, type.weaponScale);
    } else {
      this.ghostWeapon.setVisible(false);
    }

    const pos = { x: this.offsetX + gx * this.cellSize, y: this.offsetY + gy * this.cellSize };
    this.ghost.setPosition(pos.x, pos.y);

    this.applyGhostAngle();

    const canPlace = this.canPlace(gx, gy, type) && this.gold >= type.cost;
    const tint = canPlace ? 0x66ff66 : 0xff5555;
    this.ghostBase.setTint(tint);
    this.ghostWeapon.setTint(tint);
    this.ghost.setVisible(true);

    // Кольцо радиуса будущей башни.
    this.showRangeRing(pos.x, pos.y, type.range, type.color);
  }

  // Начинаем перетаскивание башни (запоминаем, за какую точку «схватили»).
  startDragging(tower, gx, gy) {
    this.dragTower = tower;
    this.dragMoved = false;
    this.dragOffsetX = tower.gx - gx;
    this.dragOffsetY = tower.gy - gy;
    this.dragStartX = tower.gx;
    this.dragStartY = tower.gy;
    this.closeTowerMenu();
    this.showRangeRingForTower(tower);
  }

  // Движение указателя: тащим башню или показываем призрак новой.
  handlePointerMove(pointer) {
    if (this.isGameOver) return;

    const { gx, gy } = this.pointerToGrid(pointer);

    // Тащим существующую башню.
    if (this.dragTower) {
      const tower = this.dragTower;
      const newGx = gx + this.dragOffsetX;
      const newGy = gy + this.dragOffsetY;

      // Небольшой порог, чтобы лёгкое дрожание пальца не считалось переносом.
      if (!this.dragMoved) {
        const movedPx =
          Math.hypot(newGx - this.dragStartX, newGy - this.dragStartY) * this.cellSize;
        if (movedPx < 8) return;
        this.dragMoved = true;
      }

      tower.gx = newGx;
      tower.gy = newGy;

      this.positionTowerSprites(tower);
      this.showRangeRingForTower(tower);
      this.ghost.setVisible(false);
      return;
    }

    // Режим переноса: кольцо следует за указателем (видно будущее место).
    if (this.movingTower) {
      const pos = {
        x: this.offsetX + gx * this.cellSize,
        y: this.offsetY + gy * this.cellSize,
      };
      this.showRangeRing(pos.x, pos.y, this.movingTower.range, this.movingTower.config.color);
      return;
    }

    // Иначе — показываем призрак будущей башни под указателем.
    this.updateGhost(gx, gy);
  }

  // Отпускание: завершаем перетаскивание башни или ставим новую.
  handlePointerUp(pointer) {
    // Перетаскивание существующей башни.
    if (this.dragTower) {
      const tower = this.dragTower;
      this.dragTower = null;
      this.movingTower = null; // перенос завершён

      // Если движения не было — это обычный клик, открываем меню башни.
      if (!this.dragMoved) {
        this.openTowerMenu(tower);
        return;
      }

      // Новое место занято — возвращаем башню на прежнее.
      if (!this.isFreeSpot(tower.gx, tower.gy, tower.config, tower)) {
        tower.gx = this.dragStartX;
        tower.gy = this.dragStartY;
        this.showMessage('Здесь нельзя поставить');
      }

      this.positionTowerSprites(tower);
      this.clearRangeRing();

      if (this.selectedTower === tower) this.positionTowerMenu();
      return;
    }

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

    // Враги.
    for (const enemy of this.enemies) {
      if (!enemy.isDead) {
        enemy.moveAlongPath(delta, this.cellSize, this.offsetX, this.offsetY);
      }
    }

    // Башни: перезарядка, поиск цели, выстрел и наводка пушки.
    for (const tower of this.towers) {
      // Башню, которую сейчас тащат, не обновляем (она «в руке»).
      if (tower === this.dragTower) continue;

      // Башня идёт пешком после переноса — двигаем, но не стреляем.
      if (tower.isMoving) {
        this.updateTowerMovement(tower, delta);
        continue;
      }

      tower.update(delta, this.cellSize, this.offsetX, this.offsetY, this.enemies);
      if (tower.sprite) tower.sprite.setRotation(tower.aimAngle);
    }

    // Убираем сломанные мосты.
    this.breakBridges();

    // Снаряды.
    for (const projectile of this.projectiles) {
      projectile.flyToTarget(delta, this.cellSize);
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
  scale: {
    // RESIZE: canvas всегда занимает весь контейнер (#game = весь экран)
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: [GameScene],
};

// Запускаем игру.
new Phaser.Game(config);
