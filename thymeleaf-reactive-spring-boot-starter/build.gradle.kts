plugins {
    kotlin("plugin.spring")
    id("org.springframework.boot")
    id("io.spring.dependency-management")
    `java-library`
}

dependencies {
    api("org.springframework.boot:spring-boot-autoconfigure")
    api("org.thymeleaf:thymeleaf-spring6")
    implementation("org.springframework.boot:spring-boot-starter")
    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.jar { enabled = true }
