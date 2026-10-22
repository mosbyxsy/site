# 资源星图

原生 HTML、CSS、JavaScript 编写的静态资源导航站点，不需要构建工具或运行时依赖。

## 启动

用任意静态 HTTP 服务器或编辑器的静态预览功能托管项目根目录，然后访问 `index.html`。浏览器直接打开 `file://` 页面通常无法通过 `fetch` 读取 JSON。

默认配置是根目录 `config.json`。如需覆盖配置，请参考如下配置。远端服务器需要允许浏览器跨域读取（CORS）。

```text
url/?config=https://example.com/nav.json #示例地址替换为实际 JSON 地址
```

## 目录结构

```text
资源站点/
├─ index.html                    页面入口
├─ config.json                   默认站点配置、分类和资源
├─ favicon.svg                   浏览器标签页图标
├─ package.json                  ES 模块声明与测试命令
├─ README.md                     使用说明
├─ css/
│  └─ styles.css                 页面样式与动画
├─ js/
│  ├─ app.js                     页面渲染与交互
│  └─ config.js                  配置加载、合并与校验
└─ tests/
   └─ config.test.js             配置规则测试
```

修改日常资源清单只需编辑根目录的 `config.json`。部署时以项目根目录为站点根目录，保留 `index.html`、`config.json`、`favicon.svg`、`css` 和 `js` 的相对位置。

## 配置格式

```json
{
  "site": {
    "name": "资源星图",
    "headline": "探索值得收藏的资源",
    "tagline": "让工具、灵感与知识触手可及",
    "searchPlaceholder": "搜索资源、关键词或标签…",
    "footerText": "优质资源 · 连接更大的可能",
    "about": "关于本站的介绍",
    "accentColor": "#50e4f6"
  },
  "categories": [
    { "id": "tools", "name": "工具" }
  ],
  "resources": [
    {
      "id": "example",
      "categoryId": "tools",
      "title": "示例资源",
      "url": "https://example.com/",
      "description": "资源的完整介绍会显示在详情层中。",
      "tags": ["示例"],
      "icon": "E",
      "iconUrl": "https://example.com/favicon.ico",
      "iconColor": "#ffffff",
      "pinned": true,
      "priority": 100
    }
  ]
}
```

- `categories[].id` 与 `resources[].id` 必须各自唯一。每个资源的 `categoryId` 必须对应一个分类。
- `pinned` 可选，默认 `false`。置顶资源总是排在普通资源之前。
- `priority` 可选，默认 `0`。在同一置顶状态下，数字越大越靠前；相同数字保留配置顺序。搜索和分类筛选不会打乱此顺序。
- `description`、`tags`、`icon`、`iconUrl`、`iconColor` 可选。图片优先使用 `iconUrl`，未配置时自动尝试资源网站的 `/favicon.ico`；图片失败后才显示 `icon` 字母占位。`iconUrl` 可用 HTTP/HTTPS 绝对地址或相对于导航站的路径。卡片显示两行摘要；“了解更多”打开完整介绍，“访问资源”在新标签页打开 HTTP/HTTPS 链接。
- `accentColor`、`iconColor` 和可选的 `iconBackground` 使用六位十六进制颜色，如 `#50e4f6`。深色网站图标可以设置浅色 `iconBackground` 提高辨识度。

## URL 配置覆盖

`?config=` 可指向同源 JSON 路径或允许 CORS 的 HTTP/HTTPS URL。站点先读取 URL 配置；默认再读取根配置并合并：

- `site` 中同名字段由 URL 配置覆盖，嵌套对象递归合并。
- `categories`、`resources` 按 `id` 合并；同 ID 只覆盖远端给出的字段，新 ID 追加。列表最终按资源排序规则显示。
- 其他数组由 URL 配置整体覆盖。

如果 URL 配置顶层设置 `"inheritDefault": false`，将**跳过根目录配置**，完全使用 URL 配置中的分类和资源。这个模式下请在 URL 配置中提供完整数据。例如：

```json
{
  "inheritDefault": false,
  "site": { "name": "我的导航" },
  "categories": [{ "id": "tools", "name": "工具" }],
  "resources": [{ "id": "one", "categoryId": "tools", "title": "示例", "url": "https://example.com/" }]
}
```

配置获取或校验失败时，站点仅显示全屏错误页，可点击“重试”。加载完成前主页面始终隐藏。

每个配置请求超过 15 秒会取消并提示重试。请求使用缓存验证，服务端支持 ETag 或 Last-Modified 时可复用未变化的数据。分类 ID `all` 为“全部资源”保留，不能用作自定义分类。

## 性能

搜索文本和分类计数在配置加载后建立索引，搜索按动画帧合并更新。筛选复用资源卡片及其图标加载状态；图标只在接近视口时开始请求和播放加载动画。首屏在数据准备完成后显示，不再人为延迟。
