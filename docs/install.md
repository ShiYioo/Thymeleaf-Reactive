# 安装与接入

三种获取方式，按你的场景选择。都需要 JDK 25。

## 方式一：从源码构建（当前推荐，零凭据）

```powershell
git clone https://github.com/ShiYioo/Thymeleaf-Reactive.git
cd Thymeleaf-Reactive
./gradlew publishToMavenLocal          # 发布 starter 到本机 Maven 仓库
```

然后在你自己的 Spring Boot 项目里引用（Gradle 示例）：

```kotlin
// settings.gradle.kts
dependencyResolutionManagement {
    repositories { mavenCentral(); mavenLocal() }
}

// build.gradle.kts
dependencies {
    implementation("io.github.shiyioo:thymeleaf-reactive-spring-boot-starter:0.1.0")
}
```

不需要 Node/npm——浏览器运行时已内嵌在 starter 的资源里，页面自动注入。

验证过的最小消费者项目结构见 `examples/counter`（同一框架、同一方言、
同一配置三行）。

## 方式二：GitHub Packages（组织内共享，需令牌）

维护者执行 `./gradlew publish`（需 `USERNAME`/`GITHUB_TOKEN`）发布到
GitHub Packages；消费者在仓库里添加该仓库与只读令牌后即可解析坐标。

## 方式三：npm（独立使用运行时/编译器时）

```powershell
npm install @thymeleaf-reactive/runtime        # 浏览器运行时
npm install @thymeleaf-reactive/compiler       # SFC 编译器
```

**注意**：使用 Spring Boot starter 的项目不需要 npm——运行时已内嵌。
`npm publish` 由维护者在版本定稿后执行。

## 环境要求

- JDK 25（框架与示例均以 25 工具链构建）
- 消费者项目建议同样配置 Java 25 工具链
