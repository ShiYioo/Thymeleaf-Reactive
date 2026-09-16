# 五分钟上手指南

从零开始，在一个 Spring Boot + Thymeleaf 项目里获得响应式组件与文件级热更新。

## 环境要求

- JDK 25
- Spring Boot 4.1.x + Thymeleaf（`spring-boot-starter-thymeleaf`）
- 本项目构建产物（`mavenLocal` 或 GitHub Packages，见文末）

## 1. 添加依赖

```kotlin
// build.gradle.kts
dependencies {
    implementation("io.github.shiyioo:thymeleaf-reactive-spring-boot-starter:0.1.0")
    implementation("org.springframework.boot:spring-boot-starter-thymeleaf")
    implementation("org.springframework.boot:spring-boot-starter-web")
}
```

本地开发时先发布到本地仓库：

```powershell
./gradlew publishToMavenLocal
```

## 2. 三行配置

```properties
thymeleaf.reactive.template-path=file:src/main/resources/templates
spring.thymeleaf.cache=false
```

`file:` 目录会被文件监听器 watch（保存即触发热更新），同时注册为最高优先级模板解析器。

## 3. 第一个响应式页面

`src/main/resources/templates/index.html`：

```html
<!doctype html>
<html lang="zh" xmlns:tr="https://thymeleaf-reactive.dev">
<head><meta charset="UTF-8"><title>你好</title></head>
<body>
  <main tr:component="hello" tr:state='{"count":0,"name":""}'>
    <p data-tr-text="'你好，' + name">你好</p>
    <input tr:model="name" placeholder="输入名字">
    <button data-tr-on="click:increment">+1</button>
    <span data-tr-text="count">0</span>
  </main>

  <script>
    window.ThymeleafReactive = {
      handlers: { increment(s) { s.count = Number(s.count) + 1; } }
    };
  </script>
</body>
</html>
```

启动应用后打开页面：点击 +1 计数变化、输入名字实时预览——全部是**客户端响应式更新**，不经过服务器。

## 4. 文件级热更新

- 保存 `.html`：服务器重新渲染该组件根，浏览器原位换入（状态保留）
- 保存 `.vue`（配合 `tr:component-src`）：客户端 VDOM 原位热替换
  - 模板改动：setup 状态保留
  - 脚本改动：setup 重建（新逻辑生效）

## 5. 进阶

- **SFC 组件**：`tr:component-src="components/X.vue"`，浏览器内编译，支持 `<script setup>` 子集、`<style scoped/module>`
- **懒水合**：根元素加 `data-tr-hydrate="visible"`（或 `idle` / `interaction:click` / `media:查询`），滚动到可视区才激活
- **自定义渲染器**：`createRenderer(host)` 渲染到其他 Document
- 完整能力对照：[README](../README.md) 与 [Vue 对等审计](vue-parity.md)

## 常见问题

- **页面没有注入 runtime**：确认 `development-mode=true`（默认开启）且响应是 `text/html`
- **改模板没反应**：确认 `template-path` 是 `file:` 目录且 `spring.thymeleaf.cache=false`
- **SFC 模块 404**：确认文件在 `template-path` 目录内且以 `.vue` 结尾
