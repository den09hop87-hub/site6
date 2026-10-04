(() => {
  const config = window.SITE_CONFIG || {};
  const loginPage = document.getElementById("login-page");
  const application = document.getElementById("application");
  const status = document.getElementById("auth-status");
  const searchInput = document.getElementById("search-input");
  const entryList = document.getElementById("entry-list");
  const filterBar = document.getElementById("filter-bar");
  const dialog = document.getElementById("entry-dialog");
  const authApiUrl = String(config.authApiUrl || "").replace(/\/+$/, "");

  const headings = {
    cassie: ["ОПЕРАТОРСКАЯ · РЕГЛАМЕНТ", "CASSIE", "Утверждённые материалы для работы с системой оповещения."],
    guide: ["СПРАВОЧНЫЙ РАЗДЕЛ", "Руководство", "Регламенты, инструкции и основные рабочие материалы."],
    violators: ["ЗАКРЫТЫЙ СПРАВОЧНИК", "Нарушители", "Записи из загруженного реестра отдела."],
    veterans: ["СПРАВОЧНЫЙ РАЗДЕЛ", "Ветераны", "Профили участников из загруженного реестра."],
    all: ["ПОИСК ПО ВСЕМ МАТЕРИАЛАМ", "Вся база", "Руководство, CASSIE и списки отдела."],
  };

  const pages = window.MRP_DATA || {};
  const documents = (Array.isArray(pages.instructions) ? pages.instructions : []).map((entry) => ({
    ...entry,
    type: "guide",
    name: entry.title || "Документ",
    searchable: [entry.title, entry.group, entry.text, entry.sourceUrl].filter(Boolean).join(" "),
  }));
  const records = [
    ...(Array.isArray(pages.violators) ? pages.violators : []).map((entry) => ({ ...entry, type: "violators", group: "Нарушители" })),
    ...(Array.isArray(pages.veterans) ? pages.veterans : []).map((entry) => ({ ...entry, type: "veterans", group: "Ветераны" })),
  ].map((entry) => ({ ...entry, name: entry.name || "Без имени", searchable: [entry.name, entry.text, entry.id].filter(Boolean).join(" ") }));
  const items = [...documents, ...records];
  const normalize = (value) => String(value || "").toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  let activeView = "cassie";
  let activeGroup = "";

  function matchesView(item) {
    if (activeView === "cassie") return item.type === "guide" && /cassie|касси|кэсси/i.test(item.searchable);
    if (activeView === "all") return true;
    return item.type === activeView;
  }

  function currentItems() {
    const terms = normalize(searchInput.value).split(/\s+/).filter(Boolean);
    return items.filter((item) => {
      if (!matchesView(item)) return false;
      if (activeGroup && item.group !== activeGroup) return false;
      const text = normalize(item.searchable);
      return terms.every((term) => text.includes(term));
    });
  }

  function updateNavigation() {
    for (const button of document.querySelectorAll("[data-view]")) {
      const selected = button.dataset.view === activeView;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    }
    const [eyebrow, title, description] = headings[activeView];
    document.getElementById("section-eyebrow").textContent = eyebrow;
    document.getElementById("section-title").textContent = title;
    document.getElementById("section-description").textContent = description;
    document.getElementById("cassie-notice").hidden = activeView !== "cassie";
    activeGroup = "";
    render();
  }

  function renderFilters(visibleItems) {
    const groups = [...new Set(visibleItems.map((item) => item.group).filter(Boolean))];
    if (groups.length < 2 || activeView === "all") {
      filterBar.replaceChildren();
      filterBar.hidden = true;
      return;
    }
    filterBar.hidden = false;
    filterBar.replaceChildren();
    for (const group of ["Все категории", ...groups]) {
      const button = document.createElement("button");
      const value = group === "Все категории" ? "" : group;
      button.type = "button";
      button.className = `filter-chip${activeGroup === value ? " is-selected" : ""}`;
      button.textContent = group;
      button.setAttribute("aria-pressed", String(activeGroup === value));
      button.addEventListener("click", () => {
        activeGroup = value;
        render();
      });
      filterBar.append(button);
    }
  }

  function makeCard(item, index) {
    const card = document.createElement("article");
    card.className = `entry-card${item.type === "violators" ? " entry-card-alert" : ""}`;
    card.style.setProperty("--card-index", String(Math.min(index, 8)));

    const heading = document.createElement("div");
    heading.className = "entry-heading";
    const group = document.createElement("span");
    group.className = "entry-category";
    group.textContent = item.group || "Справочник";
    const icon = document.createElement("span");
    icon.className = "entry-arrow";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "↗";
    heading.append(group, icon);

    const button = document.createElement("button");
    button.className = "entry-open";
    button.type = "button";
    button.setAttribute("aria-label", `Открыть: ${item.name}`);
    const name = document.createElement("span");
    name.className = "entry-name";
    name.textContent = item.name;
    const excerpt = document.createElement("span");
    excerpt.className = "entry-excerpt";
    excerpt.textContent = String(item.text || "").replace(/[\s\v]+/g, " ").trim() || "Открыть подробности документа";
    button.append(name, excerpt);

    const footer = document.createElement("div");
    footer.className = "entry-footer";
    const id = document.createElement("span");
    id.className = "entry-id";
    id.textContent = item.id || item.group || "MATERIAL";
    const action = document.createElement("span");
    action.className = "entry-action";
    action.textContent = "Открыть материал";
    footer.append(id, action);
    card.append(heading, button, footer);
    button.addEventListener("click", () => openEntry(item));
    return card;
  }

  function openEntry(item) {
    document.getElementById("dialog-category").textContent = item.group || "СПРАВОЧНИК";
    document.getElementById("dialog-title").textContent = item.name;
    document.getElementById("dialog-body").textContent = item.text || "Полный текст в исходной записи отсутствует.";
    const source = document.getElementById("dialog-source");
    let safeUrl;
    try {
      const parsedUrl = new URL(item.sourceUrl);
      if (parsedUrl.protocol === "https:") safeUrl = parsedUrl.href;
    } catch {
      safeUrl = "";
    }
    source.hidden = !safeUrl;
    if (safeUrl) source.href = safeUrl;
    dialog.showModal();
  }

  function render() {
    const visibleItems = currentItems();
    renderFilters(visibleItems);
    document.getElementById("result-count").textContent = String(visibleItems.length).padStart(2, "0");
    document.getElementById("result-label").textContent = visibleItems.length === 1 ? "результат" : "результатов";
    const cassieCount = items.filter((item) => item.type === "guide" && /cassie|касси|кэсси/i.test(item.searchable)).length;
    document.getElementById("cassie-count").textContent = String(cassieCount).padStart(2, "0");
    entryList.replaceChildren();
    if (visibleItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const title = document.createElement("h2");
      title.textContent = "Совпадений не найдено";
      const description = document.createElement("p");
      description.textContent = "Попробуйте изменить запрос или категорию.";
      empty.append(title, description);
      entryList.append(empty);
      return;
    }
    const cards = document.createDocumentFragment();
    visibleItems.forEach((item, index) => cards.append(makeCard(item, index)));
    entryList.append(cards);
  }

  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      if (authApiUrl) {
        window.location.assign(`${authApiUrl}/auth/${button.dataset.provider}`);
        return;
      }
      const provider = button.dataset.provider === "google" ? "Google" : "Steam";
      status.textContent = `${provider} пока не подключён: сначала настройте сервер авторизации. Читайте инструкцию ниже.`;
      document.getElementById("setup-details").open = true;
    });
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      searchInput.value = "";
      updateNavigation();
    });
  });
  searchInput.addEventListener("input", render);
  document.getElementById("search-shortcut").addEventListener("click", () => searchInput.focus());
  document.getElementById("logout-button").addEventListener("click", async () => {
    if (authApiUrl) {
      try {
        await fetch(`${authApiUrl}/auth/logout`, { method: "POST", credentials: "include" });
      } catch {
        status.textContent = "Не удалось связаться с сервером для завершения сессии.";
      }
    }
    loginPage.hidden = false;
    application.hidden = true;
    loginPage.querySelector("button").focus();
  });

  window.addEventListener("keydown", (event) => {
    const editing = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
    if ((event.key === "/" || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) && !editing && !dialog.open) {
      event.preventDefault();
      searchInput.focus();
    }
  });

  async function restoreSession() {
    if (!authApiUrl) return;
    try {
      const response = await fetch(`${authApiUrl}/auth/session`, { credentials: "include" });
      if (!response.ok) return;
      const session = await response.json();
      if (session.authenticated !== true || !session.google || !session.steam) return;
      document.getElementById("account-name").textContent = session.user?.name || "Проверенный профиль";
      loginPage.hidden = true;
      application.hidden = false;
      render();
    } catch {
      status.textContent = "Сервер авторизации пока недоступен. Вход через оба сервиса обязателен.";
    }
  }

  render();
  restoreSession();
})();