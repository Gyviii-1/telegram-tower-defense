// firebase-config.js — настройки и инициализация Firebase.
// Файл специально отделён от game.js, чтобы конфиг и игровая логика не смешивались.
//
// Это ES-модуль (подключается как <script type="module">), поэтому Firebase
// импортируется современным модульным способом прямо со CDN gstatic.
//
// apiKey у веб-приложения Firebase не является секретом —
// безопасность обеспечивают правила доступа в самой базе (Firestore).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Данные из консоли Firebase: Project settings -> General -> Your apps -> SDK setup.
const firebaseConfig = {
  apiKey: "AIzaSyDSIr6tflEu5cYQNXexM0co5hqkDXMVd8Y",
  authDomain: "telegram-tower-defense.firebaseapp.com",
  projectId: "telegram-tower-defense",
  storageBucket: "telegram-tower-defense.firebasestorage.app",
  messagingSenderId: "938563075628",
  appId: "1:938563075628:web:f8b9db3e2f358f2729db89",
  measurementId: "G-KCV35RC0KY",
};

// Инициализируем приложение Firebase и получаем базу данных Firestore.
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Экспортируем app и db, чтобы использовать их в game.js через import.
export { app, db };
