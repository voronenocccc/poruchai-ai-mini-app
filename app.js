const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.("#11161f");
  tg.setBackgroundColor?.("#090d12");
}

const ADMIN_ID = "1119650246";
const params = new URLSearchParams(location.search);
const tgUser = tg?.initDataUnsafe?.user || {};
const state = {
  user: {
    user_id: String(tgUser.id || params.get("user_id") || params.get("admin_id") || "local_demo"),
    username: tgUser.username || params.get("username") || "",
    first_name: tgUser.first_name || "Demo",
    role: localStorage.getItem("role") || ""
  },
  diagStep: 0,
  diagAnswers: {}
};

const roles = { secretary: "секретари", leader: "руководители", executor: "исполнители", it: "ИТ", all: "все" };
const qa = {
  "Безопасность": "Для пилота сервис можно запускать в закрытом контуре. Записи, стенограммы и поручения остаются внутри инфраструктуры, а отправку подтверждает человек.",
  "Точность": "ИИ не должен молча ошибаться: спорные поручения попадают на проверку. Цель MVP - F1 не ниже 0,80 по выделению поручений.",
  "Интеграции": "Минимальный набор: календарь, каталог сотрудников, трекер задач и СЭД. В демо это объясняется как API-слой поверх текущих систем.",
  "Пилот": "Пилот на 20 совещаний за 4 недели: собираем время подготовки протокола, скорость подтверждения и долю просрочек.",
  "Метрики": "Главные метрики: экономия времени секретаря, подтверждение поручений за 24 часа, снижение потерянных задач и удовлетворенность ролей."
};
const promos = {
  leader: "Поручай AI дает руководителю видимость после совещания: кто отвечает, какой срок, где риск просрочки. Пилот на 20 встреч показывает эффект в часах и дисциплине исполнения.",
  secretary: "Поручай AI снимает ручную рутину после встречи: черновик поручений, сроки и ответственные появляются сразу. Секретарь проверяет, уточняет и отправляет команде.",
  executor: "Поручай AI присылает исполнителю понятную задачу: что сделать, к какому сроку и откуда это поручение появилось. Меньше потерянного контекста и неожиданных дедлайнов."
};

async function api(path, data) {
  try {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!response.ok) throw new Error("api unavailable");
    return response.json();
  } catch (error) {
    return localFallback(path, data);
  }
}
async function get(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error("api unavailable");
    return response.json();
  } catch (error) {
    return localFallback(path);
  }
}
function localFallback(path, data = {}) {
  const leads = JSON.parse(localStorage.getItem("demo_leads") || "[]");
  if (path === "/api/user") return Promise.resolve({ ok: true, is_admin: state.user.user_id === ADMIN_ID });
  if (path === "/api/lead") {
    leads.push({ ...data, created_at: new Date().toISOString() });
    localStorage.setItem("demo_leads", JSON.stringify(leads));
    return Promise.resolve({ ok: true, local: true });
  }
  if (path === "/api/stats") return Promise.resolve({ users: 1, leads: leads.length, campaigns: Number(localStorage.getItem("demo_campaigns") || 0) });
  if (path === "/api/leads") return Promise.resolve({ leads });
  if (path === "/api/broadcast") {
    localStorage.setItem("demo_campaigns", String(Number(localStorage.getItem("demo_campaigns") || 0) + 1));
    return Promise.resolve({ ok: true, sent: 0, failed: 0, local: true });
  }
  return Promise.resolve({ ok: false, error: "offline" });
}
function sendToBot(action, payload = {}) {
  if (!tg?.sendData || state.user.user_id === "local_demo") return false;
  tg.sendData(JSON.stringify({ action, ...payload }));
  return true;
}
function vibrate(kind = "light") {
  tg?.HapticFeedback?.impactOccurred(kind);
}
function setMainButton(view) {
  if (!tg?.MainButton) return;
  if (view === "lead") {
    tg.MainButton.setText("СОХРАНИТЬ ЗАЯВКУ");
    tg.MainButton.show();
    tg.MainButton.onClick(() => document.getElementById("leadForm").requestSubmit());
    return;
  }
  tg.MainButton.hide();
}
function show(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelector(`[data-view="${view}"]`).classList.add("active");
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("active", b.dataset.go === view));
  document.body.dataset.view = view;
  setMainButton(view);
  vibrate();
  if (view === "diagnostic") renderDiag();
  if (view === "qa") renderQA();
  if (view === "promo") setPromo("leader");
  if (view === "admin") loadAdmin();
}

document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => show(button.dataset.go)));
document.querySelectorAll("[data-back]").forEach(button => button.addEventListener("click", () => show("home")));
document.querySelectorAll("[data-role-pick]").forEach(button => button.addEventListener("click", () => {
  const role = button.dataset.rolePick;
  state.user.role = role;
  localStorage.setItem("role", role);
  document.getElementById("roleGate").classList.add("hidden");
  sendToBot("register", { role });
  api("/api/user", { ...state.user, role });
}));

const contact = document.getElementById("contactInput");
if (contact && state.user.username) contact.value = `@${state.user.username}`;

api("/api/user", state.user).then(result => {
  if (result.is_admin || state.user.user_id === ADMIN_ID) {
    document.querySelectorAll(".admin-only").forEach(el => el.classList.remove("hidden"));
  }
  const startView = (location.hash || "").replace("#", "");
  if (["home", "lead", "admin", "diagnostic", "roi", "qa", "promo"].includes(startView)) show(startView);
  if (!state.user.role && state.user.user_id !== ADMIN_ID) {
    document.getElementById("roleGate").classList.remove("hidden");
  }
});

function renderDiag() {
  const questions = [
    ["meetings", "Сколько совещаний проходит в неделю?", "Например: 12"],
    ["tasks", "Сколько поручений появляется после одной встречи?", "Например: 5"],
    ["delay", "Через сколько часов задачи доходят до исполнителей?", "Например: 24"],
    ["risk", "Что чаще всего ломается?", "забыли / поздно получили / нет контроля"]
  ];
  document.getElementById("diagStepper").innerHTML = questions.map((_, i) => `<i class="${i <= state.diagStep ? "active" : ""}"></i>`).join("");
  const panel = document.getElementById("diagPanel");
  if (state.diagStep >= questions.length) {
    panel.innerHTML = `
      <h3>Готово: проблема доказана</h3>
      <p>У вас ${state.diagAnswers.meetings || "?"} совещаний в неделю, около ${state.diagAnswers.tasks || "?"} поручений на встречу, задержка до ${state.diagAnswers.delay || "?"} часов.</p>
      <div class="impact"><b>Вывод для защиты</b><br>Пилот нужен, потому что ценность измеряется не словами, а скоростью подтверждения поручений и снижением просрочек.</div>
      <button class="primary" data-go-next="lead">Оставить заявку на пилот</button>`;
    panel.querySelector("[data-go-next]").onclick = () => show("lead");
    return;
  }
  const [key, label, placeholder] = questions[state.diagStep];
  panel.innerHTML = `<label>${label}</label><input id="diagInput" placeholder="${placeholder}"><button class="primary" id="diagNext">Далее</button>`;
  document.getElementById("diagNext").onclick = () => {
    state.diagAnswers[key] = document.getElementById("diagInput").value.trim();
    state.diagStep += 1;
    renderDiag();
  };
}

function calcRoi() {
  const meetings = Number(document.getElementById("roiMeetings").value || 0);
  const hours = meetings * 45 / 60;
  document.getElementById("roiResult").innerHTML = `<b>${hours.toFixed(1)} часов в месяц</b><br>${meetings} встреч × 45 минут = ${(hours / 8).toFixed(1)} рабочих дня. Это понятная экономика для пилота.`;
  tg?.HapticFeedback?.notificationOccurred("success");
}
document.getElementById("calcRoi").onclick = calcRoi;
document.getElementById("minusMeetings").onclick = () => {
  const input = document.getElementById("roiMeetings");
  input.value = Math.max(1, Number(input.value) - 5);
  calcRoi();
};
document.getElementById("plusMeetings").onclick = () => {
  const input = document.getElementById("roiMeetings");
  input.value = Number(input.value) + 5;
  calcRoi();
};

document.getElementById("leadForm").onsubmit = async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  state.user.role = data.role;
  localStorage.setItem("role", data.role);
  if (!data.contact && state.user.username) data.contact = `@${state.user.username}`;
  const sentToBot = sendToBot("lead", { ...data, role: data.role });
  const result = sentToBot ? { ok: true, telegram: true } : await api("/api/lead", { ...state.user, ...data });
  document.getElementById("leadResult").innerHTML = result.ok ? "<b>Заявка отправлена.</b><br>Админ получит ее сообщением в Telegram." : "Не удалось сохранить заявку.";
  tg?.HapticFeedback?.notificationOccurred("success");
};

function renderQA() {
  document.getElementById("qaList").innerHTML = Object.entries(qa).map(([title, text]) => `<article><b>${title}</b><p>${text}</p></article>`).join("");
}
function setPromo(key) {
  document.querySelectorAll("[data-promo]").forEach(button => button.classList.toggle("active", button.dataset.promo === key));
  document.getElementById("promoText").textContent = promos[key];
}
document.querySelectorAll("[data-promo]").forEach(button => button.onclick = () => setPromo(button.dataset.promo));

async function loadAdmin() {
  const isAdmin = state.user.user_id === ADMIN_ID;
  document.getElementById("adminDenied").classList.toggle("hidden", isAdmin);
  document.getElementById("adminArea").classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;
  const stats = await get("/api/stats");
  document.getElementById("adminStats").innerHTML = `
    <article><b>${stats.users}</b><span>пользователей</span></article>
    <article><b>${stats.leads}</b><span>заявок</span></article>
    <article><b>${stats.campaigns}</b><span>рассылок</span></article>`;
  const leads = await get("/api/leads");
  document.getElementById("leadsTable").innerHTML = (leads.leads || []).slice(-8).reverse().map(lead => `
    <div class="row"><b>${lead.department || "Без подразделения"}</b><span>${lead.contact || "контакт не указан"} · ${lead.meetings || "?"} встреч</span></div>`).join("") || "<span>Заявок пока нет.</span>";
}
document.getElementById("previewBroadcast").onclick = () => {
  const text = document.getElementById("broadcastText").value;
  document.getElementById("broadcastResult").innerHTML = `<b>Предпросмотр</b><br>Получатели: все пользователи<br><br>${text}`;
};
document.getElementById("sendBroadcast").onclick = async () => {
  const text = document.getElementById("broadcastText").value.trim();
  const sentToBot = sendToBot("broadcast", { text });
  const result = sentToBot ? { ok: true, telegram: true } : await api("/api/broadcast", { admin_id: state.user.user_id, segment: "all", text });
  document.getElementById("broadcastResult").innerHTML = result.telegram ? "<b>Команда отправлена боту.</b><br>Итог рассылки придет админу в Telegram." : result.ok ? `<b>Рассылка отправлена</b><br>Отправлено: ${result.sent}<br>Ошибок: ${result.failed}` : `Ошибка: ${result.error}`;
  loadAdmin();
};
