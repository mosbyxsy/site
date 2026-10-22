/**
 * 配置读取、校验、合并和资源排序集中在这里，避免页面渲染逻辑承担数据规则。
 * 该模块只使用浏览器及标准 JavaScript API，因此也能由 Node 内置测试器直接导入。
 */

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** 只允许普通 JSON 对象作为配置根，数组、null 等都视为配置错误。 */
export function assertConfigObject(value, sourceName) {
  if (!isObject(value)) throw new Error(`${sourceName} 必须是 JSON 对象。`);
  for (const key of ["site", "categories", "resources"]) {
    if (key in value && (key === "site" ? !isObject(value[key]) : !Array.isArray(value[key]))) {
      throw new Error(`${sourceName} 的 ${key} 格式不正确。`);
    }
  }
}

/**
 * 普通对象递归合并：远端出现的值覆盖本地值；数组作为一个值整体覆盖。
 * categories/resources 有独立的按 ID 合并规则，不走这个通用函数。
 */
export function mergeObject(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isObject(value) && isObject(result[key])
      ? mergeObject(result[key], value)
      : value;
  }
  return result;
}

/**
 * 同 ID 项在原位置合并，远端新增项依远端顺序追加。
 * 这样置顶/优先级尚未参与排序时，配置文件中的手工顺序仍然可预测。
 */
export function mergeById(baseItems = [], overrideItems = [], listName = "列表") {
  const result = baseItems.map((item) => ({ ...item }));
  const positions = new Map();
  for (const [index, item] of result.entries()) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id.trim() || positions.has(item.id)) {
      throw new Error(`${listName} 中存在无效或重复的 id。`);
    }
    positions.set(item.id, index);
  }
  const remoteIds = new Set();
  for (const item of overrideItems) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id.trim() || remoteIds.has(item.id)) {
      throw new Error(`${listName} 的 URL 配置中存在无效或重复的 id。`);
    }
    remoteIds.add(item.id);
    if (positions.has(item.id)) {
      const index = positions.get(item.id);
      result[index] = mergeObject(result[index], item);
    } else {
      positions.set(item.id, result.length);
      result.push({ ...item });
    }
  }
  return result;
}

/** URL 配置优先；inheritDefault:false 让远端成为唯一数据源。 */
export function mergeConfigs(base, remote) {
  assertConfigObject(base, "根目录配置");
  assertConfigObject(remote, "URL 配置");
  if (remote.inheritDefault === false) return { ...remote };
  const merged = mergeObject(base, remote);
  merged.site = mergeObject(base.site ?? {}, remote.site ?? {});
  merged.categories = mergeById(base.categories ?? [], remote.categories ?? [], "分类列表");
  merged.resources = mergeById(base.resources ?? [], remote.resources ?? [], "资源列表");
  return merged;
}

/**
 * 资源列表排序规则：置顶优先，其次 priority 数字从大到小，最后保持配置顺序。
 * 明确用原索引作为最后比较项，使排序在不同浏览器中的结果一致。
 */
export function sortResources(resources) {
  return resources.map((resource, index) => ({ resource, index }))
    .sort((a, b) => Number(Boolean(b.resource.pinned)) - Number(Boolean(a.resource.pinned))
      || (b.resource.priority ?? 0) - (a.resource.priority ?? 0)
      || a.index - b.index)
    .map(({ resource }) => resource);
}

/**
 * 图片优先使用资源显式配置的 iconUrl；否则尝试该网站根目录的 favicon.ico。
 * iconUrl 的相对地址以导航站页面为基准，便于引用站点自己的 assets 目录。
 */
export function getResourceIconUrl(resource, pageUrl = globalThis.location?.href ?? "http://localhost/") {
  if (resource.iconUrl?.trim()) return new URL(resource.iconUrl, pageUrl).href;
  return new URL("/favicon.ico", resource.url).href;
}

/** 对最终合并结果做严格校验，避免部分损坏的数据渲染成半成品页面。 */
export function normalizeConfig(config) {
  assertConfigObject(config, "最终配置");
  const site = config.site ?? {};
  const textFields = ["name", "headline", "tagline", "searchPlaceholder", "footerText", "about"];
  for (const field of textFields) {
    if (field in site && typeof site[field] !== "string") throw new Error(`site.${field} 必须是文字。`);
  }
  if (site.accentColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(site.accentColor)) {
    throw new Error("site.accentColor 必须是六位十六进制颜色。");
  }

  const categories = config.categories ?? [];
  const resources = config.resources ?? [];
  if (!Array.isArray(categories) || !Array.isArray(resources)) throw new Error("分类与资源必须是数组。");
  const categoryIds = new Set();
  for (const category of categories) {
    if (!isObject(category) || typeof category.id !== "string" || !category.id.trim()
      || typeof category.name !== "string" || !category.name.trim() || categoryIds.has(category.id)) {
      throw new Error("分类需要唯一的 id 和非空 name。");
    }
    if (category.id === "all") throw new Error("分类 id 不能使用保留值 all。");
    categoryIds.add(category.id);
  }

  const resourceIds = new Set();
  for (const resource of resources) {
    if (!isObject(resource) || typeof resource.id !== "string" || !resource.id.trim()
      || typeof resource.title !== "string" || !resource.title.trim()
      || typeof resource.categoryId !== "string" || !categoryIds.has(resource.categoryId)
      || typeof resource.url !== "string" || resourceIds.has(resource.id)) {
      throw new Error("资源需要唯一 id、标题、有效分类和网址。");
    }
    resourceIds.add(resource.id);
    let url;
    try { url = new URL(resource.url); } catch { throw new Error(`资源“${resource.title}”的网址无效。`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`资源“${resource.title}”只支持 HTTP/HTTPS 网址。`);
    if (resource.description !== undefined && typeof resource.description !== "string") throw new Error(`资源“${resource.title}”的介绍必须是文字。`);
    if (resource.tags !== undefined && (!Array.isArray(resource.tags) || resource.tags.some((tag) => typeof tag !== "string"))) {
      throw new Error(`资源“${resource.title}”的 tags 必须是文字数组。`);
    }
    if (resource.pinned !== undefined && typeof resource.pinned !== "boolean") throw new Error(`资源“${resource.title}”的 pinned 必须是布尔值。`);
    if (resource.priority !== undefined && (!Number.isFinite(resource.priority))) throw new Error(`资源“${resource.title}”的 priority 必须是数字。`);
    if (resource.icon !== undefined && typeof resource.icon !== "string") throw new Error(`资源“${resource.title}”的 icon 必须是文字。`);
    if (resource.iconUrl !== undefined) {
      if (typeof resource.iconUrl !== "string" || !resource.iconUrl.trim()) throw new Error(`资源“${resource.title}”的 iconUrl 必须是非空网址。`);
      let imageUrl;
      try { imageUrl = new URL(resource.iconUrl, globalThis.location?.href ?? "http://localhost/"); }
      catch { throw new Error(`资源“${resource.title}”的 iconUrl 无效。`); }
      if (!["http:", "https:"].includes(imageUrl.protocol)) throw new Error(`资源“${resource.title}”的 iconUrl 只支持 HTTP/HTTPS 地址。`);
    }
    if (resource.iconColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(resource.iconColor)) {
      throw new Error(`资源“${resource.title}”的 iconColor 必须是六位十六进制颜色。`);
    }
    if (resource.iconBackground !== undefined && !/^#[0-9a-fA-F]{6}$/.test(resource.iconBackground)) {
      throw new Error(`资源“${resource.title}”的 iconBackground 必须是六位十六进制颜色。`);
    }
  }
  return {
    site: {
      name: site.name?.trim() || "资源导航",
      headline: site.headline?.trim() || "探索值得收藏的资源",
      tagline: site.tagline?.trim() || "让工具、灵感与知识触手可及",
      searchPlaceholder: site.searchPlaceholder?.trim() || "搜索资源、关键词或标签…",
      footerText: site.footerText?.trim() || "优质资源 · 连接更大的可能",
      about: site.about?.trim() || "在这里发现值得收藏的资源。",
      accentColor: site.accentColor || "#50e4f6",
    },
    categories,
    resources: sortResources(resources),
  };
}

/**
 * 先读取远端，才能知道它是否要求跳过根配置。
 * 所有 fetch 失败统一抛错给全屏错误页；不会悄悄回退到部分配置。
 */
export async function loadConfig(search = globalThis.location?.search ?? "", fetcher = globalThis.fetch) {
  const params = new URLSearchParams(search);
  const hasRemote = params.has("config");
  const remotePath = params.get("config");
  const baseUrl = new URL("./config.json", globalThis.location?.href ?? "http://localhost/");
  const readJson = async (url, label) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const readError = (message) => new Error(controller.signal.aborted
      ? `${label}加载超时，请检查网络后重试。`
      : message);
    try {
      let response;
      // 每次验证缓存有效性，允许服务端通过 ETag/Last-Modified 返回 304。
      try { response = await fetcher(url.href, { cache: "no-cache", signal: controller.signal }); }
      catch { throw readError(`${label}无法获取，请检查地址、网络或跨域设置。`); }
      if (!response.ok) throw new Error(`${label}请求失败（HTTP ${response.status}）。`);
      let data;
      try { data = await response.json(); }
      catch { throw readError(`${label}不是有效的 JSON。`); }
      assertConfigObject(data, label);
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };

  if (!hasRemote) return normalizeConfig(await readJson(baseUrl, "根目录配置"));
  if (!remotePath?.trim()) throw new Error("config 参数不能为空。");
  let remoteUrl;
  try { remoteUrl = new URL(remotePath, globalThis.location?.href ?? baseUrl); }
  catch { throw new Error("config 参数不是有效的地址。"); }
  if (!["http:", "https:"].includes(remoteUrl.protocol)) throw new Error("config 只支持 HTTP/HTTPS 地址。");
  const remote = await readJson(remoteUrl, "URL 配置");
  if (remote.inheritDefault === false) return normalizeConfig(remote);
  const base = await readJson(baseUrl, "根目录配置");
  return normalizeConfig(mergeConfigs(base, remote));
}
