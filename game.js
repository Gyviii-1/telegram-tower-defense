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
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// ----------------------------- Константы -----------------------------
const GRID_SIZE = 10;             // размер сетки: 10 на 10 клеток
const BG_COLOR = 0x1a1a2e;        // цвет фона сцены
const CELL_COLOR = 0x16213e;      // заливка обычной (свободной) клетки
const ROAD_COLOR = 0xd4a017;      // заливка клетки дороги (жёлто-песочный)
const GRID_LINE_COLOR = 0x0f3460; // цвет линий сетки

const TOWER_COLOR = 0x2ecc71;     // цвет башни (зелёный кружок)
const TOWER_RANGE = 2.5;          // радиус атаки башни в клетках
const TOWER_FIRE_RATE = 1;        // выстрелов в секунду
const TOWER_COST = 25;            // стоимость постройки башни

const ENEMY_COLOR = 0xe74c3c;     // цвет врага (красный квадрат)
const ENEMY_HIT_COLOR = 0xffffff; // вспышка врага при попадании
const ENEMY_SPEED = 2;            // скорость врага: клеток в секунду
const ENEMY_HP = 3;               // базовое здоровье врага

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
const KILL_REWARD = 10;           // награда за убитого врага

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
  constructor(scene, pathCells, hp = ENEMY_HP) {
    super(scene, 0, 0, 1, 1, ENEMY_COLOR);

    this.pathCells = pathCells; // полный список клеток маршрута ({row, col})
    this.segment = 0;           // индекс текущего отрезка пути
    this.progress = 0;          // прогресс по отрезку: 0..1
    this.lastCellSize = 0;      // чтобы не пересчитывать размер каждый кадр
    this.hp = hp;               // здоровье (по умолчанию базовое)
    this.isDead = false;        // мёртв/исчезает — не двигается и не цель для башен

    scene.add.existing(this);   // добавляем объект в сцену
  }

  // Движение по маршруту. delta — мс, геометрия сетки передаётся из сцены,
  // чтобы враг корректно перестраивался при изменении размера экрана.
  moveAlongPath(delta, cellSize, offsetX, offsetY) {
    // Размер квадрата зависит от размера клетки (обновляем только при изменении).
    if (cellSize !== this.lastCellSize) {
      const size = cellSize * 0.6;
      this.setSize(size, size);
      this.lastCellSize = cellSize;
    }

    // Прогресс в клетках за кадр: скорость (клеток/сек) * время (сек).
    this.progress += ENEMY_SPEED * (delta / 1000);

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
        if (this.active && !this.isDead) this.setFillStyle(ENEMY_COLOR);
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
  constructor(scene, x, y, target) {
    super(scene, x, y, Math.max(3, scene.cellSize * 0.12), 0, 360, false, PROJECTILE_COLOR);

    this.target = target; // враг, в которого летим
    scene.add.existing(this);
  }

  // Летим к цели; при достижении наносим урон и исчезаем.
  flyToTarget(delta, cellSize) {
    // Цель уже мертва/удалена — снаряд просто исчезает.
    if (!this.target.active || this.target.isDead) {
      this.destroy();
      return;
    }

    const step = PROJECTILE_SPEED * cellSize * (delta / 1000);
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const distance = Math.hypot(dx, dy);

    // Долетели: наносим урон и удаляем снаряд.
    if (distance <= step) {
      this.target.takeDamage(PROJECTILE_DAMAGE);
      this.destroy();
      return;
    }

    // Двигаемся к текущей позиции цели (самонаведение).
    this.x += (dx / distance) * step;
    this.y += (dy / distance) * step;
  }
}

// ------------------------------ Башня ------------------------------
// Башня хранит своё место на сетке, радиус атаки и перезарядку.
class Tower {
  constructor(scene, row, col) {
    this.scene = scene;
    this.row = row;
    this.col = col;
    this.range = TOWER_RANGE;       // радиус атаки, клеток
    this.fireRate = TOWER_FIRE_RATE; // выстрелов в секунду
    this.cooldown = 0;              // время до следующего выстрела, сек
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
  shoot(pos, target) {
    const projectile = new Projectile(this.scene, pos.x, pos.y, target);
    this.scene.projectiles.push(projectile);
  }
}

// ------------------------------ Сцена ------------------------------
class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
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
    this.waveHp = ENEMY_HP;      // здоровье врагов текущей волны
    this.waveSpawnTimer = null;  // таймер порционного спавна

    // Карта башен: towers[row][col] — объект Tower или null.
    this.towers = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));

    // Строим маршрут: список клеток + быстрый доступ "клетка это дорога?".
    this.buildPath();

    // Списки живых врагов и снарядов.
    this.enemies = [];
    this.projectiles = [];

    // Отдельная графика для клеток сетки и для башен —
    // так их можно перерисовывать независимо.
    this.gridGraphics = this.add.graphics();
    this.towersGraphics = this.add.graphics();

    // Геометрия сетки (пересчитывается в layout()).
    this.cellSize = 0; // размер одной клетки в пикселях
    this.offsetX = 0;  // сдвиг сетки по X (чтобы центрировать)
    this.offsetY = 0;  // сдвиг сетки по Y

    // Создаём UI (тексты поверх всего).
    this.createUI();

    // Первая отрисовка и подписка на изменение размера окна/экрана.
    this.layout();
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

    // Небольшой эффект появления.
    this.gameOverText.setScale(0.5);
    this.tweens.add({
      targets: this.gameOverText,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut',
    });
  }

  // ------------------------- Игровые события -------------------------
  // Враг убит башней — начисляем золото.
  onEnemyKilled() {
    this.gold += KILL_REWARD;
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
  // документ — id игрока в Telegram (у каждого свой рекорд).
  async saveRecord() {
    const player = this.getPlayerInfo();
    try {
      await setDoc(doc(db, 'leaderboard', player.id), {
        nick: player.nick,
        wave: this.currentWave,
        gold: this.gold,
        savedAt: new Date().toISOString(),
      });
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
    this.startButton.setVisible(!this.isWaveActive);

    this.messageText.setPosition(width / 2, height * 0.8);
    this.messageText.setStyle({ fontSize: `${Math.round(uiSize * 0.9)}px` });

    this.overlay.setSize(width, height);
    this.overlay.setPosition(0, 0);

    this.gameOverText.setPosition(width / 2, height / 2);
    this.gameOverText.setStyle({ fontSize: `${Math.round(Math.min(width, height) * 0.13)}px` });
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

        g.fillStyle(TOWER_COLOR, 1);
        g.fillCircle(pos.x, pos.y, radius);
      }
    }
  }

  // Проверка: является ли клетка дорогой.
  isRoad(row, col) {
    return this.road[row] !== undefined && this.road[row][col] === true;
  }

  // ------------------------- Волны -------------------------
  // Запускаем следующую волну (вызывается кликом по кнопке).
  startNextWave() {
    if (this.isGameOver || this.isWaveActive) return;

    this.currentWave += 1;
    this.isWaveActive = true;
    this.startButton.setVisible(false); // кнопка скрыта во время волны

    // Количество врагов растёт с каждой волной.
    this.enemiesLeftToSpawn = WAVE_START_ENEMIES + this.currentWave * 2;
    // Здоровье врагов в этой волне тоже растёт.
    this.waveHp = ENEMY_HP + this.currentWave * WAVE_HP_GROWTH;

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

  // Выпускаем одного врага текущей волны с её здоровьем.
  spawnWaveEnemy() {
    if (this.isGameOver || this.enemiesLeftToSpawn <= 0) return;

    const enemy = new Enemy(this, this.pathCells, this.waveHp);
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

    // Клик вне сетки игнорируем.
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return;

    // На дороге строить нельзя.
    if (this.isRoad(row, col)) return;

    // Одна башня на клетку.
    if (this.towers[row][col]) return;

    // Проверяем золото: не хватает — предупреждаем и не строим.
    if (this.gold < TOWER_COST) {
      console.warn('Недостаточно золота для постройки башни!');
      this.showMessage(`Не хватает золота! Нужно ${TOWER_COST}`);
      return;
    }

    this.gold -= TOWER_COST;
    this.towers[row][col] = new Tower(this, row, col);
    this.drawTowers(); // перерисовываем только башни
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
