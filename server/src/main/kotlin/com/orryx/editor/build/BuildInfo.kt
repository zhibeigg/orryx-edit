package com.orryx.editor.build

import java.util.Properties

data class BuildInfo(
    val version: String,
    val commit: String,
    val buildType: String,
    val deployment: String,
    val databaseSchemaVersion: Long,
    val launcherManaged: Boolean
) {
    constructor(version: String, deployment: String, launcherManaged: Boolean) : this(
        version = version,
        commit = "unknown",
        buildType = "release",
        deployment = deployment,
        databaseSchemaVersion = 0L,
        launcherManaged = launcherManaged
    )

    companion object {
        fun load(
            classLoader: ClassLoader = BuildInfo::class.java.classLoader,
            environment: Map<String, String> = System.getenv()
        ): BuildInfo {
            val properties = Properties()
            classLoader.getResourceAsStream("build-info.properties")?.use(properties::load)
            val version = value(environment, properties, "ORRYX_VERSION", "version", "unknown")
            val deployment = value(
                environment,
                properties,
                "DEPLOYMENT_MODE",
                "deployment",
                environment["ORRYX_DEPLOYMENT"] ?: "source"
            ).lowercase()
            require(deployment in setOf("source", "launcher", "container")) {
                "DEPLOYMENT_MODE 必须为 source、launcher 或 container"
            }
            val launcherManaged = environment["ORRYX_LAUNCHER_MANAGED"]?.toBooleanStrictOrNull()
                ?: properties.getProperty("launcherManaged")?.toBooleanStrictOrNull()
                ?: (deployment == "launcher")
            return BuildInfo(
                version = version,
                commit = value(environment, properties, "BUILD_COMMIT", "commit", "unknown"),
                buildType = value(environment, properties, "BUILD_TYPE", "buildType", "release"),
                deployment = deployment,
                databaseSchemaVersion = properties.getProperty("databaseSchemaVersion")?.toLongOrNull() ?: 0L,
                launcherManaged = launcherManaged
            )
        }

        private fun value(
            environment: Map<String, String>,
            properties: Properties,
            environmentKey: String,
            propertyKey: String,
            fallback: String
        ): String = (environment[environmentKey] ?: properties.getProperty(propertyKey) ?: fallback).trim()
    }
}
