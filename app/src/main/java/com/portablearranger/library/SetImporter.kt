package com.portablearranger.library

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import com.portablearranger.engine.NativeEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class SetImporter(private val context: Context) {
    data class Progress(val message: String, val fraction: Float)

    suspend fun importTree(
        handle: Long,
        treeUri: Uri,
        onProgress: (Progress) -> Unit
    ): ImportedLibrary = withContext(Dispatchers.IO) {
        val root = DocumentFile.fromTreeUri(context, treeUri)
            ?: error("Could not open that folder")
        val setFolder = AdapterRegistry.findSetFolder(root) ?: root
        val adapter = AdapterRegistry.detect(setFolder) ?: Pa4xAdapter()
        onProgress(Progress("Reading ${adapter.displayName} SET…", 0.05f))
        val inspected = adapter.inspect(context, setFolder)
        onProgress(Progress("Found ${inspected.sounds.size} sounds, ${inspected.styles.size} styles", 0.2f))

        val dest = File(context.filesDir, "sets/${inspected.setName}")
        dest.mkdirs()
        var copied = 0
        val loadable = mutableListOf<File>()
        copyTree(setFolder, dest) { file, rel ->
            copied++
            if (copied % 8 == 0) onProgress(Progress("Copying $rel", 0.2f + 0.5f * (copied / 400f).coerceAtMost(1f)))
            val up = file.name.uppercase()
            if (up.endsWith(".WAV") || up.endsWith(".KSF") || up.endsWith(".PCM")) loadable += file
        }

        var samples = 0
        loadable.forEachIndexed { i, file ->
            onProgress(Progress("Loading ${file.name}", 0.7f + 0.25f * ((i + 1f) / loadable.size)))
            val up = file.name.uppercase()
            samples += when {
                up.endsWith(".WAV") -> {
                    val id = NativeEngine.loadWavInstrument(handle, file.absolutePath, file.nameWithoutExtension, "Imported")
                    if (id >= 0) 1 else 0
                }
                up.endsWith(".KSF") -> {
                    val id = NativeEngine.loadKsfInstrument(handle, file.absolutePath, file.nameWithoutExtension, "Imported")
                    if (id >= 0) 1 else 0
                }
                up.endsWith(".PCM") -> NativeEngine.scanPcmBank(handle, file.absolutePath)
                else -> 0
            }
        }
        onProgress(Progress("Ready", 1f))
        inspected.copy(samplesLoaded = samples)
    }

    private fun copyTree(src: DocumentFile, destDir: File, onFile: (File, String) -> Unit) {
        src.listFiles().forEach { child ->
            val name = child.name ?: return@forEach
            if (child.isDirectory) {
                val next = File(destDir, name)
                next.mkdirs()
                copyTree(child, next, onFile)
            } else {
                val out = File(destDir, name)
                context.contentResolver.openInputStream(child.uri)?.use { input ->
                    out.outputStream().use { output -> input.copyTo(output) }
                }
                onFile(out, name)
            }
        }
    }
}
