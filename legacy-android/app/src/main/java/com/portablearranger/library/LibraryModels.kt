package com.portablearranger.library

data class SoundItem(
    val id: Int,
    val name: String,
    val category: String,
    val bank: String = "FACTORY",
    val source: String = "Engine",
    val favorite: Boolean = false
)

data class StyleItem(
    val id: Int,
    val name: String,
    val category: String,
    val tempo: Float,
    val bank: String = "FACTORY",
    val source: String = "Engine"
)

data class KeyboardSet(
    val name: String,
    val upper1: Int,
    val upper2: Int? = null,
    val upper3: Int? = null,
    val lower: Int,
    val split: Int = 60,
    val tempo: Float? = null,
    val styleId: Int? = null
)

data class Performance(
    val name: String,
    val keyboardSet: KeyboardSet,
    val mixer: List<Float>,
    val variation: Int = 1
)

data class ImportedLibrary(
    val setName: String,
    val adapterId: String,
    val sounds: List<SoundItem>,
    val styles: List<StyleItem>,
    val samplesLoaded: Int,
    val files: List<SetFile>
)

data class SetFile(
    val relativePath: String,
    val size: Long,
    val kind: String
)
