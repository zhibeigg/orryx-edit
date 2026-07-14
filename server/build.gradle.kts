import org.gradle.jvm.tasks.Jar

plugins {
    kotlin("jvm") version "2.1.10"
    kotlin("plugin.serialization") version "2.1.10"
    id("io.ktor.plugin") version "3.1.2"
}

group = "com.orryx.editor"
version = rootProject.projectDir.parentFile.resolve("VERSION").readText().trim()

application {
    mainClass.set("com.orryx.editor.ApplicationKt")
}

tasks.named<Jar>("jar") {
    archiveClassifier.set("plain")
}

tasks.named<Jar>("shadowJar") {
    archiveFileName.set("orryx-editor-server-${project.version}.jar")
}

listOf("startScripts", "distTar", "distZip").forEach { taskName ->
    tasks.named(taskName) {
        dependsOn("shadowJar")
    }
}

val generatedBuildInfo = layout.buildDirectory.dir("generated-resources/build-info")
val generateBuildInfo by tasks.registering {
    inputs.property("version", project.version.toString())
    inputs.property("commit", providers.environmentVariable("BUILD_COMMIT").orElse("unknown"))
    outputs.dir(generatedBuildInfo)
    doLast {
        val output = generatedBuildInfo.get().file("build-info.properties").asFile
        output.parentFile.mkdirs()
        output.writeText(
            """
            version=${project.version}
            commit=${providers.environmentVariable("BUILD_COMMIT").orElse("unknown").get()}
            buildType=release
            deployment=source
            launcherManaged=false
            databaseSchemaVersion=11
            """.trimIndent() + "\n"
        )
    }
}

sourceSets.main { resources.srcDir(generatedBuildInfo) }
tasks.processResources { dependsOn(generateBuildInfo) }

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()
}

val ktorVersion = "3.1.2"

dependencies {
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-websockets:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-server-cors:$ktorVersion")
    implementation("io.ktor:ktor-server-default-headers:$ktorVersion")
    implementation("io.ktor:ktor-server-host-common:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages:$ktorVersion")
    implementation("io.ktor:ktor-client-core:$ktorVersion")
    implementation("io.ktor:ktor-client-cio:$ktorVersion")
    implementation("io.ktor:ktor-client-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    implementation("org.bouncycastle:bcprov-jdk18on:1.80")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-reactive:1.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-reactor:1.10.1")
    implementation("org.postgresql:r2dbc-postgresql:1.0.7.RELEASE")
    implementation("io.r2dbc:r2dbc-pool:1.0.2.RELEASE")
    implementation("ch.qos.logback:logback-classic:1.5.18")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.1")
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
    testImplementation("io.ktor:ktor-client-content-negotiation:$ktorVersion")
    testImplementation("io.ktor:ktor-client-mock:$ktorVersion")
}
