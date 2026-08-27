import org.gradle.internal.os.OperatingSystem

plugins {
    kotlin("plugin.spring")
    id("org.springframework.boot")
    id("io.spring.dependency-management")
    `java-library`
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
