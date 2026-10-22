import { getResourceIconUrl, loadConfig } from "./config.js";

/** 页面状态只保存在内存中；刷新后仍以 config.json 和 URL 配置为准。 */
const state = { config: null, categoryId: "all", query: "" };
const getElement = (id) => document.getElementById(id);
const boot = getElement("boot-screen");
const errorScreen = getElement("error-screen");
const app = getElement("app");
const detailDialog = getElement("detail-dialog");
const aboutDialog = getElement("about-dialog");
const categoryNames = new Map();
const categoryCounts = new Map();
const searchTexts = new Map();
const resourceCards = new Map();
// 同一次打开期间锁定桌面面板的展开方向，避免搜索结果变少时上下跳动。
let categoryPanelPlacement = null;
// 共享一个观察器：只给即将进入视口的资源图标发起请求，长列表也不会同时加载所有图片。
const pendingIconStarts = new WeakMap();
const iconObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      iconObserver.unobserve(entry.target);
      pendingIconStarts.get(entry.target)?.();
      pendingIconStarts.delete(entry.target);
    }
  }, { rootMargin: "250px" })
  : null;

/** 所有可配置的文案只进入 textContent，不将外部 JSON 插入 innerHTML。 */
function setText(id, value) { getElement(id).textContent = value; }
function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function categoryName(id) {
  return categoryNames.get(id) ?? "全部资源";
}

/**
 * 图片加载前只显示柔和占位光效；成功后显示网站图标，失败或超时才显示字母。
 * 详情层复用同一套逻辑，避免卡片显示图标而弹窗仍显示字母。
 */
function renderIconInto(container, resource, eager = false) {
  iconObserver?.unobserve(container);
  container.replaceChildren();
  container.classList.remove("has-image", "has-fallback", "is-loading");
  container.style.setProperty("--icon-color", resource.iconColor || "var(--accent)");
  if (resource.iconBackground) container.style.setProperty("--icon-background", resource.iconBackground);
  else container.style.removeProperty("--icon-background");
  const fallback = makeElement("span", "resource-icon__fallback", resource.icon?.trim() || resource.title.slice(0, 2));
  const image = makeElement("img", "resource-icon__image");
  image.alt = "";
  image.decoding = "async";
  image.loading = "eager"; // 是否请求由下方的可见性观察器控制。
  image.referrerPolicy = "no-referrer";
  container.append(image, fallback);

  let settled = false;
  let started = false;
  let timer;
  const finish = (success, final = true) => {
    if (settled || !container.contains(image)) return;
    // 超时只先显示文字占位；线上图标稍后加载成功时仍允许替换回来。
    // 真正收到 load/error 事件后才结束本次请求，避免慢网络永久显示缩写。
    if (final) settled = true;
    window.clearTimeout(timer);
    container.classList.remove("is-loading");
    container.classList.remove("has-image", "has-fallback");
    container.classList.add(success ? "has-image" : "has-fallback");
  };
  image.addEventListener("load", () => finish(image.naturalWidth > 0), { once: true });
  image.addEventListener("error", () => finish(false), { once: true });
  const startLoading = () => {
    if (started) return;
    started = true;
    container.classList.add("is-loading");
    // 只从实际开始请求时计时；屏幕外的卡片不会提前变成字母。
    timer = window.setTimeout(() => finish(false, false), 4500);
    image.src = getResourceIconUrl(resource);
  };
  if (eager || !iconObserver) startLoading();
  else {
    pendingIconStarts.set(container, startLoading);
    iconObserver.observe(container);
  }
}

function createIcon(resource, extraClass = "") {
  const icon = makeElement("div", `resource-icon ${extraClass}`);
  renderIconInto(icon, resource);
  return icon;
}

/** 按完整按钮收紧可视宽度，初始状态不露出半个分类；全部按钮仍可横向滚动。 */
function fitQuickCategories() {
  if (app.hidden) return;
  const navigation = getElement("category-navigation");
  const container = getElement("quick-categories");
  const available = navigation.clientWidth - getElement("category-more").offsetWidth - parseFloat(getComputedStyle(navigation).columnGap);
  const gap = parseFloat(getComputedStyle(container).columnGap);
  let width = 0;
  for (const button of container.children) {
    const next = width + (width ? gap : 0) + button.getBoundingClientRect().width;
    if (next > available) break;
    width = next;
  }
  container.style.width = `${Math.max(0, width || available)}px`;
}

/** 按配置顺序展示全部分类，横向滚动浏览；搜索面板保留为快捷定位入口。 */
function renderQuickCategories() {
  const container = getElement("quick-categories");
  const restoreFocus = container.contains(document.activeElement);
  const quick = [{ id: "all", name: "全部资源" }, ...state.config.categories];
  const buttons = quick.map((category) => {
    const button = makeElement("button", "category-chip", category.name);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.categoryId === category.id));
    if (state.categoryId === category.id) button.classList.add("is-active");
    button.addEventListener("click", () => selectCategory(category.id));
    return button;
  });
  container.replaceChildren(...buttons);
  fitQuickCategories();
  setText("category-more-label", "全部分类");
  getElement("category-more").classList.toggle("is-filtered", state.categoryId !== "all");
  getElement("category-more").setAttribute("aria-label", `全部分类，当前：${categoryName(state.categoryId)}`);
  getElement("category-more").title = `当前分类：${categoryName(state.categoryId)}`;
  // 只滚动分类条；从搜索面板选择的分类也会自动进入可视区。
  if (!app.hidden) {
    const activeButton = buttons.find((button) => button.classList.contains("is-active"));
    if (restoreFocus) activeButton?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (!activeButton?.isConnected) return;
      const strip = container.getBoundingClientRect();
      const active = activeButton.getBoundingClientRect();
      container.scrollLeft += active.left - strip.left - (container.clientWidth - active.width) / 2;
    });
  }
}

/** 分类面板的搜索只过滤分类名称，不会改变主资源搜索框的内容。 */
function renderCategoryList() {
  const query = getElement("category-search-input").value.trim().toLocaleLowerCase();
  // 分类数量帮助用户判断去哪里找资源，空分类也会如实显示 0。
  const all = { id: "all", name: "全部资源" };
  const matches = [all, ...state.config.categories]
    .filter((category) => category.name.toLocaleLowerCase().includes(query));
  const buttons = matches.map((category) => {
    const button = makeElement("button", "");
    button.type = "button";
    button.setAttribute("aria-pressed", String(category.id === state.categoryId));
    button.append(
      makeElement("span", "category-list__name", category.name),
      makeElement("span", "category-list__count", String(category.id === "all" ? state.config.resources.length : categoryCounts.get(category.id))),
    );
    if (category.id === state.categoryId) button.classList.add("is-active");
    button.addEventListener("click", () => selectCategory(category.id));
    return button;
  });
  getElement("category-list").replaceChildren(...buttons);
  getElement("category-empty").hidden = matches.length > 0;
  setText("category-panel-summary", `共 ${state.config.categories.length} 个分类 · ${state.config.resources.length} 个资源`);
  // 搜索只更新面板高度和位置，不改变本次打开时选定的展开方向。
  if (!getElement("category-panel").hidden) positionCategoryPanel();
}

/**
 * 桌面分类面板优先在按钮下方展开；下方不够时尝试上方。
 * 两侧都放不下时选择空间较大的一侧，并压缩可滚动的分类列表。
 * 极矮视口改用几乎占满屏幕的面板，避免标题或关闭按钮被裁切。
 * 展开方向在本次打开期间保持不变；只有关闭后重开或视口尺寸改变才重新选择。
 */
function positionCategoryPanel(reconsiderPlacement = false) {
  const panel = getElement("category-panel");
  if (panel.hidden || window.matchMedia("(max-width: 640px)").matches) return;

  const edge = 16;
  const gap = 12;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const trigger = getElement("category-more").getBoundingClientRect();
  // 临时解除高度约束，只读取面板的自然高度；同一帧内恢复，不会产生闪烁。
  panel.style.maxHeight = "none";
  const natural = panel.getBoundingClientRect();
  panel.style.maxHeight = "";

  const below = Math.max(0, viewportHeight - trigger.bottom - gap - edge);
  const above = Math.max(0, trigger.top - gap - edge);
  if (reconsiderPlacement || !categoryPanelPlacement) {
    if (trigger.top >= viewportHeight - edge || trigger.bottom <= edge || Math.max(below, above) < 180) {
      categoryPanelPlacement = "viewport";
    } else if (below >= natural.height || (above < natural.height && below >= above)) {
      categoryPanelPlacement = "below";
    } else {
      categoryPanelPlacement = "above";
    }
  }

  let top;
  let maxHeight;
  if (categoryPanelPlacement === "viewport") {
    top = edge;
    maxHeight = Math.max(0, viewportHeight - edge * 2);
  } else if (categoryPanelPlacement === "below") {
    top = trigger.bottom + gap;
    maxHeight = below;
  } else {
    maxHeight = above;
    top = trigger.top - gap - Math.min(natural.height, above);
  }

  const left = Math.min(Math.max(trigger.left, edge), viewportWidth - edge - natural.width);
  panel.style.setProperty("--category-panel-top", `${Math.round(top)}px`);
  panel.style.setProperty("--category-panel-left", `${Math.round(left)}px`);
  panel.style.setProperty("--category-panel-max-height", `${Math.round(maxHeight)}px`);
}

function openCategoryPanel() {
  categoryPanelPlacement = null;
  getElement("category-panel").hidden = false;
  getElement("category-more").setAttribute("aria-expanded", "true");
  document.body.classList.add("category-open");
  getElement("category-search-input").value = "";
  renderCategoryList();
  getElement("category-search-input").focus({ preventScroll: true });
}

function closeCategoryPanel() {
  if (getElement("category-panel").hidden) return;
  getElement("category-panel").hidden = true;
  getElement("category-more").setAttribute("aria-expanded", "false");
  document.body.classList.remove("category-open");
  categoryPanelPlacement = null;
  getElement("category-more").focus();
}

function selectCategory(id) {
  state.categoryId = id;
  renderQuickCategories();
  renderCategoryList();
  closeCategoryPanel();
  renderResources();
}

/** 主搜索按空格分词，各词都要命中标题、介绍、标签或分类名。 */
function filteredResources() {
  const terms = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return state.config.resources.filter((resource) => {
    if (state.categoryId !== "all" && resource.categoryId !== state.categoryId) return false;
    if (terms.length === 0) return true;
    const haystack = searchTexts.get(resource.id);
    return terms.every((term) => haystack.includes(term));
  });
}

/** 资源卡片的“了解更多”和外链分别绑定操作，避免点击详情时误跳转。 */
function createResourceCard(resource) {
  const card = makeElement("article", "resource-card");
  const main = makeElement("div", "resource-card__main");
  const copy = makeElement("div", "resource-card__copy");
  const titleLine = makeElement("div", "resource-card__title-line");
  titleLine.append(makeElement("h3", "", resource.title));
  if (resource.pinned) titleLine.append(makeElement("span", "pin-badge", "置顶"));
  copy.append(titleLine, makeElement("p", "resource-card__description", resource.description || "暂无介绍"));
  main.append(createIcon(resource), copy);

  const footer = makeElement("div", "resource-card__footer");
  const more = makeElement("button", "more-button");
  more.type = "button";
  more.setAttribute("aria-label", `了解更多：${resource.title}`);
  more.append(makeElement("span", "more-button__icon", "i"), document.createTextNode("了解更多"));
  more.addEventListener("click", () => openDetail(resource));
  const visit = makeElement("a", "visit-link");
  visit.href = resource.url;
  visit.target = "_blank";
  visit.rel = "noopener noreferrer";
  visit.setAttribute("aria-label", `访问资源：${resource.title}（新标签页）`);
  visit.append(document.createTextNode("访问资源"), makeElement("span", "", "↗"));
  footer.append(more, visit);
  card.append(main, footer);
  return card;
}

function renderResources() {
  const resources = filteredResources();
  // 复用卡片和图标的加载状态，避免每次输入都重建节点、重复请求图片。
  if (iconObserver) getElement("resource-grid").querySelectorAll(".resource-icon").forEach((icon) => iconObserver.unobserve(icon));
  const cards = resources.map((resource) => {
    if (!resourceCards.has(resource.id)) resourceCards.set(resource.id, createResourceCard(resource));
    return resourceCards.get(resource.id);
  });
  getElement("resource-grid").replaceChildren(...cards);
  if (iconObserver) {
    for (const card of cards) {
      const icon = card.querySelector(".resource-icon");
      if (pendingIconStarts.has(icon)) iconObserver.observe(icon);
    }
  }
  getElement("resource-grid").hidden = resources.length === 0;
  getElement("empty-state").hidden = resources.length !== 0;
  setText("result-count", `共 ${resources.length} 个资源`);
  setText("resources-heading", state.categoryId === "all" ? "精选资源" : categoryName(state.categoryId));
}

function openDetail(resource) {
  setText("detail-title", resource.title);
  setText("detail-category", categoryName(resource.categoryId));
  setText("detail-description", resource.description?.trim() || "暂无详细介绍。");
  renderIconInto(getElement("detail-icon"), resource, true);
  getElement("detail-tags").replaceChildren(...(resource.tags ?? []).map((tag) => makeElement("span", "", tag)));
  getElement("detail-tags").hidden = !resource.tags?.length;
  getElement("detail-visit").href = resource.url;
  detailDialog.showModal();
  document.body.classList.add("dialog-open");
}

function closeDetail() { detailDialog.close(); }
function openAbout() { aboutDialog.showModal(); document.body.classList.add("dialog-open"); }
function closeAbout() { aboutDialog.close(); }

/** 将已校验的配置应用到页面；所有节点先在加载层背后完成更新。 */
function renderSite() {
  const { site } = state.config;
  iconObserver?.disconnect();
  resourceCards.clear();
  categoryNames.clear();
  categoryCounts.clear();
  searchTexts.clear();
  for (const category of state.config.categories) {
    categoryNames.set(category.id, category.name);
    categoryCounts.set(category.id, 0);
  }
  for (const resource of state.config.resources) {
    categoryCounts.set(resource.categoryId, categoryCounts.get(resource.categoryId) + 1);
    searchTexts.set(resource.id, [resource.title, resource.description ?? "", ...(resource.tags ?? []), categoryName(resource.categoryId)]
      .join(" ").toLocaleLowerCase());
  }
  document.title = site.name;
  document.querySelector('meta[name="description"]').content = site.tagline;
  document.documentElement.style.setProperty("--accent", site.accentColor);
  const rgb = [1, 3, 5].map((start) => parseInt(site.accentColor.slice(start, start + 2), 16));
  document.documentElement.style.setProperty("--accent-rgb", rgb.join(", "));
  setText("site-name", site.name);
  setText("hero-title", site.headline);
  setText("hero-subtitle", site.tagline);
  setText("footer-text", site.footerText);
  setText("about-content", site.about);
  getElement("resource-search").placeholder = site.searchPlaceholder;
  renderQuickCategories();
  renderCategoryList();
  renderResources();
}

/**
 * 加载层始终覆盖页面，直到获取、合并、校验和首轮渲染全部成功。
 * 即使浏览器有缓存，也不会先露出未配置的默认内容。
 */
async function start() {
  boot.hidden = false;
  errorScreen.hidden = true;
  app.hidden = true;
  try {
    state.config = await loadConfig();
    state.categoryId = "all";
    state.query = "";
    getElement("resource-search").value = "";
    renderSite();
    app.hidden = false;
    fitQuickCategories();
    // 两帧之后直接切换到完整页面，不让页面透过半透明加载层。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      boot.hidden = true;
    }));
  } catch (error) {
    app.hidden = true;
    boot.hidden = true;
    setText("error-message", error instanceof Error ? error.message : "请检查配置地址或网络连接。");
    errorScreen.hidden = false;
  }
}

// 静态事件只绑定一次；重新尝试加载配置不会重复注册监听器。
let searchFrame;
getElement("resource-search").addEventListener("input", (event) => {
  state.query = event.target.value;
  cancelAnimationFrame(searchFrame);
  searchFrame = requestAnimationFrame(renderResources);
});
getElement("category-more").addEventListener("click", () => {
  getElement("category-panel").hidden ? openCategoryPanel() : closeCategoryPanel();
});
getElement("category-close").addEventListener("click", closeCategoryPanel);
getElement("category-search-input").addEventListener("input", renderCategoryList);
window.addEventListener("resize", () => {
  fitQuickCategories();
  // 只有视口大小变化才重新选择展开方向；普通分类搜索保持原方向。
  if (!getElement("category-panel").hidden) positionCategoryPanel(true);
});
getElement("clear-filters").addEventListener("click", () => {
  state.query = "";
  getElement("resource-search").value = "";
  selectCategory("all");
  getElement("resource-search").focus();
});
getElement("retry-button").addEventListener("click", start);
getElement("detail-close").addEventListener("click", closeDetail);
getElement("detail-dismiss").addEventListener("click", closeDetail);
getElement("about-button").addEventListener("click", openAbout);
getElement("about-close").addEventListener("click", closeAbout);
getElement("about-dismiss").addEventListener("click", closeAbout);
detailDialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));
aboutDialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));
for (const dialog of [detailDialog, aboutDialog]) {
  dialog.addEventListener("click", (event) => {
    // 原生 dialog 的遮罩点击会把目标报告为 dialog 自身；点击内容区则不关闭。
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
}
document.addEventListener("pointerdown", (event) => {
  if (!getElement("category-panel").hidden && !getElement("category-navigation").contains(event.target)) closeCategoryPanel();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !getElement("category-panel").hidden) closeCategoryPanel();
  // 手机的全屏分类页把 Tab 焦点留在面板内，避免键盘操作落到背后的页面。
  if (event.key === "Tab" && !getElement("category-panel").hidden && window.matchMedia("(max-width: 640px)").matches) {
    const focusable = [...getElement("category-panel").querySelectorAll("button:not([disabled]), input:not([disabled])")];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey
    && app.hidden === false && getElement("category-panel").hidden
    && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
    && !document.activeElement.isContentEditable && !detailDialog.open && !aboutDialog.open) {
    event.preventDefault();
    getElement("resource-search").focus();
  }
});

// 滚动一段距离后显示快捷按钮；恢复历史滚动位置时也同步状态。
function updateBackToTop() {
  getElement("back-to-top").hidden = window.scrollY < 300;
}
window.addEventListener("scroll", updateBackToTop, { passive: true });
window.addEventListener("pageshow", updateBackToTop);
getElement("back-to-top").addEventListener("click", () => {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
});
updateBackToTop();
document.fonts.ready.then(fitQuickCategories);

void start();
