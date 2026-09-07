import org.gradle.internal.os.OperatingSystem

plugins {
    kotlin("plugin.spring")
    id("org.springframework.boot")
    id("io.spring.dependency-management")
    `java-library`
    `maven-publish`
}

val runtimeDir = rootProject.layout.projectDirectory.dir("thymeleaf-reactive-runtime")
val runtimeDist = runtimeDir.dir("dist")
val npmExecutable = if (OperatingSystem.current().isWindows) "npm.cmd" else "npm"

val installBrowserDependencies = tasks.register<Exec>("installBrowserDependencies") {
    workingDir(runtimeDir)
    commandLine(npmExecutable, "ci")
    inputs.file(runtimeDir.file("package.json"))
    inputs.file(runtimeDir.file("package-lock.json"))
    outputs.dir(runtimeDir.dir("node_modules"))
}

val buildBrowserRuntime = tasks.register<Exec>("buildBrowserRuntime") {
    workingDir(runtimeDir)
    commandLine(npmExecutable, "run", "build")
    dependsOn(installBrowserDependencies)
    inputs.dir(runtimeDir.dir("src"))
    inputs.file(runtimeDir.file("package.json"))
    inputs.file(runtimeDir.file("package-lock.json"))
    outputs.dir(runtimeDist)
}

tasks.processResources {
    dependsOn(buildBrowserRuntime)
    from(runtimeDist) { into("META-INF/resources/thymeleaf-reactive") }
}

dependencies {
    api("org.springframework.boot:spring-boot-autoconfigure")
    api("org.thymeleaf:thymeleaf-spring6")
    implementation("ognl:ognl:3.4.12")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter")
    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.jar { enabled = true }
tasks.bootJar { enabled = false }

val sourcesJar = tasks.register<Jar>("sourcesJar") {
    archiveClassifier.set("sources")
    from(sourceSets.main.get().allSource)
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            groupId = project.group.toString()
            artifactId = "thymeleaf-reactive-spring-boot-starter"
            version = project.version.toString()
            from(components["java"])
            artifact(sourcesJar)

            pom {
                name.set("Thymeleaf Reactive Spring Boot Starter")
                description.set("Spring Boot auto-configuration for Thymeleaf Reactive: reactive tr:* dialect, browser runtime injection, template watching, and SSE hot module replacement.")
                url.set("https://github.com/ShiYioo/Thymeleaf-Reactive")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://github.com/ShiYioo/Thymeleaf-Reactive/blob/main/LICENSE")
                    }
                }
                developers {
                    developer {
                        id.set("ShiYioo")
                        name.set("ShiYioo")
                        url.set("https://github.com/ShiYioo")
                    }
                }
                scm {
                    url.set("https://github.com/ShiYioo/Thymeleaf-Reactive")
                    connection.set("scm:git:git://github.com/ShiYioo/Thymeleaf-Reactive.git")
                    developerConnection.set("scm:git:ssh://github.com/ShiYioo/Thymeleaf-Reactive.git")
                }
            }
        }
    }
    repositories {
        // Publishes to GitHub Packages when credentials are provided:
        //   ./gradlew publish -Pgithub.user=... -Pgithub.token=...   (or USERNAME/GITHUB_TOKEN env)
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/ShiYioo/Thymeleaf-Reactive")
            val user = providers.gradleProperty("github.user")
                .orElse(providers.environmentVariable("USERNAME"))
            val token = providers.gradleProperty("github.token")
                .orElse(providers.environmentVariable("GITHUB_TOKEN"))
            if (user.isPresent && token.isPresent) {
                credentials {
                    username = user.get()
                    password = token.get()
                }
            }
        }
    }
}
