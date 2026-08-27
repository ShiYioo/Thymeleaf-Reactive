plugins {
    kotlin("plugin.spring")
    id("org.springframework.boot")
    id("io.spring.dependency-management")
    `java-library`
}

val runtimeDir = rootProject.layout.projectDirectory.dir("thymeleaf-reactive-runtime")
val runtimeDist = runtimeDir.dir("dist")

val installBrowserDependencies by tasks.registering(Exec::class) {
    workingDir(runtimeDir)
    commandLine("npm", "ci")
    inputs.file(runtimeDir.file("package.json"))
    inputs.file(runtimeDir.file("package-lock.json"))
    outputs.dir(runtimeDir.dir("node_modules"))
}

val buildBrowserRuntime by tasks.registering(Exec::class) {
    workingDir(runtimeDir)
    commandLine("npm", "run", "build")
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
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter")
    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.jar { enabled = true }
