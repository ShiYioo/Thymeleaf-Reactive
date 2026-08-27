plugins {
    kotlin("jvm") version "2.4.10" apply false
    kotlin("plugin.spring") version "2.4.10" apply false
    id("org.springframework.boot") version "4.1.1" apply false
    id("io.spring.dependency-management") version "1.1.7" apply false
}

allprojects {
    group = "io.github.shiyioo"
    version = "0.1.0-SNAPSHOT"
}

subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")

    java {
        toolchain { languageVersion = JavaLanguageVersion.of(25) }
    }

    kotlin {
        jvmToolchain(25)
        compilerOptions { javaParameters.set(true) }
    }

    tasks.withType<Test>().configureEach { useJUnitPlatform() }
}
