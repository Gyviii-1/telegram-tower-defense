// game.js — прототип Tower Defense на Phaser 3.
// Шаг 10: управляемые волны врагов с кнопкой старта.
// Сохранены механики прошлых шагов: сетка, дорога, движение врагов, стрельба, анимации.
// Логика разбита на маленькие методы, чтобы дальше удобно наращивать механики.
//
// ВАЖНО: game.js подключается как ES-модуль (<script type="module">),
// поэтому здесь доступны оператор import и значения из других модулей.

// База данных Firestore из firebase-config.js.
import { db } from './firebase-config.js';
// Функции Firestore: doc — адрес документа, setDoc — запись данных.
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// ----------------------------- Константы -----------------------------
const GRID_SIZE = 10;             // размер сетки: 10 на 10 клеток
const BG_COLOR = 0x1a1a2e;        // цвет фона сцены
const CELL_COLOR = 0x16213e;      // заливка обычной (свободной) клетки
const ROAD_COLOR = 0xd4a017;      // заливка клетки дороги (жёлто-песочный)
const GRID_LINE_COLOR = 0x0f3460; // цвет линий сетки

const TOWER_COLOR = 0x2ecc71;     // акцентный цвет интерфейса башен
const TOWER_MAX_LEVEL = 5;        // максимальный уровень башни
const TOWER_SELL_RATIO = 0.7;     // возврат золота при продаже (70% вложенного)

// Типы башен. cost — цена постройки, range — радиус в клетках,
// fireRate — выстрелов в секунду, damage — урон, texture — картинка.
const TOWER_TYPES = {
  archer: {
    name: 'Стрелок',
    cost: 25,
    range: 2.5,
    fireRate: 1,
    damage: 1,
    accuracy: 1, // всегда попадает
    texture: 'tower',
    color: 0x2ecc71,
  },
  minigun: {
    name: 'Миниган',
    cost: 40,
    range: 3.5,      // бьёт дальше стрелка
    fireRate: 4,
    damage: 1,
    accuracy: 0.7,   // 70% попаданий, 30% — разброс
    texture: 'tower_minigun',
    color: 0x3498db,
  },
};

const ENEMY_HIT_COLOR = 0xffffff; // вспышка врага при попадании
const ENEMY_HP = 3;               // базовое здоровье врага по умолчанию

// Типы врагов. hp — базовое здоровье, speed — клеток/сек,
// color — цвет, reward — золото за убийство, size — размер от клетки.
const ENEMY_TYPES = {
  normal: { hp: 3,  speed: 2.0, color: 0xe74c3c, reward: 10,  size: 0.60 },
  fast:   { hp: 2,  speed: 4.0, color: 0xf39c12, reward: 8,   size: 0.45 },
  tank:   { hp: 12, speed: 1.2, color: 0x8e44ad, reward: 30,  size: 0.72 },
  boss:   { hp: 50, speed: 0.9, color: 0x2c3e50, reward: 120, size: 0.85 },
};

// ----------------------------- Волны -----------------------------
const WAVE_START_ENEMIES = 5;     // сколько врагов в 1-й волне
const WAVE_HP_GROWTH = 2;         // прирост HP врагов за каждую волну
const SPAWN_INTERVAL = 1000;      // задержка между спавном врагов, мс (1 секунда)
const WAVE_CLEAR_BONUS = 25;      // бонус золота за зачистку волны

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
  constructor(scene, pathCells, typeKey = 'normal', hp = ENEMY_HP) {
    const type = ENEMY_TYPES[typeKey] || ENEMY_TYPES.normal;
    super(scene, 0, 0, 1, 1, type.color);

    this.typeKey = typeKey;      // ключ типа ("normal", "fast", "tank", "boss")
    this.config = type;          // настройки типа
    this.baseColor = type.color; // цвет для возврата после вспышки
    this.speed = type.speed;     // скорость: клеток в секунду
    this.reward = type.reward;   // золото за убийство
    this.sizeFactor = type.size; // размер относительно клетки

    this.pathCells = pathCells; // полный список клеток маршрута ({row, col})
    this.segment = 0;           // индекс текущего отрезка пути
    this.progress = 0;          // прогресс по отрезку: 0..1
    this.lastCellSize = 0;      // чтобы не пересчитывать размер каждый кадр
    this.hp = hp;               // здоровье (по умолчанию базовое)
    this.isDead = false;        // мёртв/исчезает — не двигается и не цель для башен

    scene.add.existing(this);   // добавляем объект в сцену
    this.setDepth(3);           // враги поверх башен
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

  // Получаем урон. При 0 HP враг умирает.
  takeDamage(amount) {
    if (this.isDead) return;

    this.hp -= amount;

    // Короткая белая вспышка при попадании.
    if (this.hp > 0) {
      this.setFillStyle(ENEMY_HIT_COLOR);
      this.scene.time.delayedCall(80, () => {
        if (this.active && !this.isDead) this.setFillStyle(this.baseColor);
      });
      return;
    }

    this.die();
  }

  // Смерть: плавно увеличиваем и растворяем квадрат, затем удаляем.
  die() {
    this.isDead = true;
    this.scene.onEnemyKilled(this); // сообщаем сцене (награда золотом)

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
  constructor(scene, row, col, typeKey = 'archer') {
    const type = TOWER_TYPES[typeKey] || TOWER_TYPES.archer;

    this.scene = scene;
    this.row = row;
    this.col = col;
    this.typeKey = typeKey;          // ключ типа ("archer", "minigun", ...)
    this.config = type;              // настройки типа
    this.level = 1;                  // уровень башни
    this.range = type.range;         // радиус атаки, клеток
    this.fireRate = type.fireRate;   // выстрелов в секунду
    this.damage = type.damage;       // урон за выстрел
    this.accuracy = type.accuracy !== undefined ? type.accuracy : 1; // шанс попадания
    this.cooldown = 0;               // время до следующего выстрела, сек
    this.totalSpent = type.cost;     // сколько золота вложено (для продажи)
    this.sprite = null;              // картинка башни (создаётся сценой)
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

  // Центр башни в пикселях с учётом текущей геометрии сетки.
  getPosition(cellSize, offsetX, offsetY) {
    return {
      x: offsetX + (this.col + 0.5) * cellSize,
      y: offsetY + (this.row + 0.5) * cellSize,
    };
  }

  // Обновление башни: перезарядка, поиск цели, выстрел.
  update(delta, cellSize, offsetX, offsetY, enemies) {
    this.cooldown -= delta / 1000;

    const pos = this.getPosition(cellSize, offsetX, offsetY);
    const target = this.findTarget(enemies, pos, cellSize);

    // Стреляем, только если есть цель и башня перезарядилась.
    if (!target || this.cooldown > 0) return;

    this.shoot(pos, target);
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
    this.load.image('tower', 'assets/tower.png');
    this.load.image('tower_minigun', 'assets/tower_minigun.png');
  }

  create() {
    // Разворачиваем мини-апп на весь экран Telegram и определяем игрока.
    this.initTelegram();

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
    this.selectedTowerType = 'archer';

    // Карта башен: towers[row][col] — объект Tower или null.
    this.towers = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));

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

    // Клик/тап по сцене — строим башню в нужной клетке.
    this.input.on('pointerdown', this.handlePointerDown, this);

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
      .rectangle(0, 0, 250, 165, 0x000000, 0.9)
      .setStrokeStyle(2, TOWER_COLOR)
      .setInteractive();
    // Клик по фону меню не должен «проваливаться» в игровое поле.
    this.towerMenuBg.on('pointerdown', (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
    });

    this.towerMenuTitle = this.add
      .text(0, -52, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '17px',
        color: '#ffffff',
        fontStyle: 'bold',
        align: 'center',
        lineSpacing: 4,
      })
      .setOrigin(0.5);

    this.towerMenuUpgrade = this.add
      .text(0, 10, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#2ecc71',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.towerMenuSell = this.add
      .text(0, 52, '', {
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
      this.towerMenuSell,
    ]);

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
  }

  // Обновляем текст панели при изменении волны/жизней/золота.
  updateUI() {
    this.uiText.setText(
      `Волна: ${this.currentWave}\nЖизни: ${this.lives}\nЗолото: ${this.gold}`
    );
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
  }

  // Закрыть меню башни.
  closeTowerMenu() {
    this.selectedTower = null;
    if (this.towerMenu) this.towerMenu.setVisible(false);
  }

  // Обновить тексты меню по текущей башне.
  refreshTowerMenu() {
    const tower = this.selectedTower;
    if (!tower) return;

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

    this.towerMenuSell.setText(`Продать (+${tower.getSellValue()})`);
  }

  // Расположить меню рядом с башней, не выпуская его за края экрана.
  positionTowerMenu() {
    const tower = this.selectedTower;
    if (!tower) return;

    const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);
    const width = this.scale.width;
    const height = this.scale.height;
    const halfW = 125; // половина ширины фона меню (250 / 2)
    const halfH = 82;  // половина высоты фона меню (165 / 2)
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
    this.drawTowers();
    this.refreshTowerMenu();
    this.updateUI();
  }

  // Продать выбранную башню и вернуть часть золота.
  sellSelectedTower() {
    const tower = this.selectedTower;
    if (!tower) return;

    this.gold += tower.getSellValue();
    this.towers[tower.row][tower.col] = null;
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

    const keys = Object.keys(TOWER_TYPES);
    const buttonWidth = 150;
    const gap = 12;

    keys.forEach((key, index) => {
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

      const icon = this.add.image(0, -14, type.texture).setDisplaySize(40, 40);
      const label = this.add
        .text(0, 26, `${type.name} · ${type.cost}`, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '15px',
          color: '#ffffff',
        })
        .setOrigin(0.5);

      button.add([bg, icon, label]);
      this.buildMenu.add(button);

      this.buildButtons[key] = { container: button, bg: bg, type: type };
    });

    this.refreshBuildMenu();
  }

  // Выбрать тип башни для постройки.
  selectTowerType(key) {
    this.selectedTowerType = key;
    this.refreshBuildMenu();
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
    const buttonWidth = 150;
    const gap = 12;
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

  // Враг дошёл до конца дороги — отнимаем жизнь, при 0 запускаем Game Over.
  onEnemyReachedEnd() {
    if (this.isGameOver) return;

    this.lives = Math.max(0, this.lives - 1);
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

  // Сохраняем рекорд игрока в Firestore: коллекция "leaderboard",
  // документ — id игрока в Telegram (у каждого свой личный рекорд).
  // Записываем только если новый результат лучше прошлого.
  async saveRecord() {
    const player = this.getPlayerInfo();
    const reference = doc(db, 'leaderboard', player.id);
    const newRecord = {
      nick: player.nick,
      wave: this.currentWave,
      gold: this.gold,
      savedAt: new Date().toISOString(),
    };

    try {
      const snapshot = await getDoc(reference);
      const previous = snapshot.exists() ? snapshot.data() : null;

      const isBetter =
        !previous ||
        newRecord.wave > (previous.wave || 0) ||
        (newRecord.wave === (previous.wave || 0) && newRecord.gold > (previous.gold || 0));

      if (!isBetter) {
        console.log('Прошлый рекорд лучше — не перезаписываем.');
        return;
      }

      await setDoc(reference, newRecord);
      console.log('Рекорд успешно сохранен в Firebase!');
    } catch (error) {
      console.error('Не удалось сохранить рекорд в Firebase:', error);
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

    // Если меню башни открыто — пересчитываем позицию под новый размер.
    if (this.selectedTower) this.positionTowerMenu();

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

    const radius = this.cellSize * 0.35; // радиус кружка относительно клетки

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const tower = this.towers[row][col];
        if (!tower) continue;

        // Центр клетки.
        const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);

        // Запасной вариант: если картинки нет — рисуем кружок цветом типа.
        if (!this.textures.exists(tower.config.texture)) {
          g.fillStyle(tower.config.color, 1);
          g.fillCircle(pos.x, pos.y, radius);
        }

        // Уровень башни — белые точки под кружком (сколько точек, такой уровень).
        const pipRadius = this.cellSize * 0.045;
        const pipGap = this.cellSize * 0.14;
        const pipY = pos.y + radius * 0.75;
        const startX = pos.x - ((tower.level - 1) * pipGap) / 2;
        g.fillStyle(0xffffff, 1);
        for (let i = 0; i < tower.level; i++) {
          g.fillCircle(startX + i * pipGap, pipY, pipRadius);
        }
      }
    }
  }

  // ------------------------- Спрайты башен -------------------------
  // Создаём картинку башни (если текстура загрузилась).
  createTowerSprite(tower) {
    const textureKey = tower.config.texture;
    if (!this.textures.exists(textureKey)) return;

    const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);
    tower.sprite = this.add.image(pos.x, pos.y, textureKey).setDepth(1);
    this.sizeTowerSprite(tower);
  }

  // Подгоняем размер картинки под клетку.
  sizeTowerSprite(tower) {
    if (!tower.sprite) return;
    const size = this.cellSize * 0.8;
    tower.sprite.setDisplaySize(size, size);
  }

  // Переставляем все спрайты башен (при изменении размера экрана).
  layoutTowerSprites() {
    for (const row of this.towers) {
      for (const tower of row) {
        if (!tower || !tower.sprite) continue;
        const pos = tower.getPosition(this.cellSize, this.offsetX, this.offsetY);
        tower.sprite.setPosition(pos.x, pos.y);
        this.sizeTowerSprite(tower);
      }
    }
  }

  // Удаляем картинку башни (при продаже).
  destroyTowerSprite(tower) {
    if (!tower.sprite) return;
    tower.sprite.destroy();
    tower.sprite = null;
  }

  // Проверка: является ли клетка дорогой.
  isRoad(row, col) {
    return this.road[row] !== undefined && this.road[row][col] === true;
  }

  // ------------------------- Волны -------------------------
  // Составляем список типов врагов для волны.
  // Простые правила: fast появляются со 2-й волны, tank — с 3-й,
  // босс — в конце каждой 5-й волны.
  buildWaveComposition(wave) {
    const count = WAVE_START_ENEMIES + wave * 2;
    const queue = [];

    for (let i = 0; i < count; i++) {
      let typeKey = 'normal';
      if (wave >= 2 && i % 4 === 1) typeKey = 'fast';
      if (wave >= 3 && i % 5 === 3) typeKey = 'tank';
      queue.push(typeKey);
    }

    if (wave % 5 === 0) queue.push('boss');

    return queue;
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

    // Порционный спавн: один враг раз в секунду.
    this.waveSpawnTimer = this.time.addEvent({
      delay: SPAWN_INTERVAL,
      callback: this.spawnWaveEnemy,
      callbackScope: this,
      loop: true,
    });
  }

  // Выпускаем одного врага текущей волны.
  spawnWaveEnemy() {
    if (this.isGameOver || this.enemiesLeftToSpawn <= 0) return;

    const typeKey = this.waveQueue.shift() || 'normal';
    // Здоровье = базовое у типа + прирост за номер волны.
    const hp = ENEMY_TYPES[typeKey].hp + (this.currentWave - 1) * WAVE_HP_GROWTH;

    const enemy = new Enemy(this, this.pathCells, typeKey, hp);
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

  // Обработка клика: переводим координаты указателя в индексы клетки.
  handlePointerDown(pointer) {
    if (this.isGameOver) return;

    const col = Math.floor((pointer.x - this.offsetX) / this.cellSize);
    const row = Math.floor((pointer.y - this.offsetY) / this.cellSize);

    // Клик вне сетки — просто закрываем меню башни.
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
      this.closeTowerMenu();
      return;
    }

    // Клик по башне — открываем меню улучшения/продажи.
    const existingTower = this.towers[row][col];
    if (existingTower) {
      this.openTowerMenu(existingTower);
      return;
    }

    // Клик по пустой клетке — закрываем меню.
    this.closeTowerMenu();

    // На дороге строить нельзя.
    if (this.isRoad(row, col)) return;

    // Тип башни, выбранный в панели внизу.
    const type = TOWER_TYPES[this.selectedTowerType];

    // Проверяем золото: не хватает — предупреждаем и не строим.
    if (this.gold < type.cost) {
      console.warn('Недостаточно золота для постройки башни!');
      this.showMessage(`Не хватает золота! Нужно ${type.cost}`);
      return;
    }

    this.gold -= type.cost;
    const tower = new Tower(this, row, col, this.selectedTowerType);
    this.towers[row][col] = tower;
    this.createTowerSprite(tower);
    this.drawTowers(); // перерисовываем индикаторы уровня
    this.updateUI();
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

    // Башни: перезарядка, поиск цели, выстрел.
    for (const row of this.towers) {
      for (const tower of row) {
        if (tower) {
          tower.update(delta, this.cellSize, this.offsetX, this.offsetY, this.enemies);
        }
      }
    }

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
