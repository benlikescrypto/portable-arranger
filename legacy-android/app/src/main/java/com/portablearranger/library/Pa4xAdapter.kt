package com.portablearranger.library

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile

class Pa4xAdapter : KeyboardAdapter {
    override val id = "korg-pa4x"
    override val displayName = "Korg PA4X"

    override fun matches(root: DocumentFile): Boolean {
        val names = root.listFiles().mapNotNull { it.name?.uppercase() }.toSet()
        if (root.name?.endsWith(".SET", true) == true) return true
        return listOf("SOUND", "STYLE", "PCM").any { it in names } ||
            names.any { it.endsWith(".PCG") || it.endsWith(".STY") || it.endsWith(".PCM") }
    }

    override fun inspect(context: Context, root: DocumentFile): ImportedLibrary {
        val setName = root.name?.removeSuffix(".SET")?.removeSuffix(".set") ?: "Imported SET"
        val files = mutableListOf<SetFile>()
        val sounds = mutableListOf<SoundItem>()
        val styles = mutableListOf<StyleItem>()
        walk(root, "") { rel, doc ->
            val name = doc.name ?: return@walk
            val upper = name.uppercase()
            val kind = when {
                upper.endsWith(".PCG") -> "SOUND"
                upper.endsWith(".STY") -> "STYLE"
                upper.endsWith(".PCM") -> "PCM"
                upper.endsWith(".KMP") -> "MULTISAMPLE"
                upper.endsWith(".KSF") -> "SAMPLE"
                upper.endsWith(".PRF") -> "KEYBOARD SET"
                upper.endsWith(".PAD") -> "PAD"
                upper.endsWith(".WAV") -> "WAV"
                else -> "FILE"
            }
            files += SetFile(rel, doc.length(), kind)
            if (doc.isFile && (upper.endsWith(".PCG") || upper.endsWith(".STY") || upper.endsWith(".PRF") ||
                    upper.endsWith(".PAD"))
            ) {
                val bytes = readBytes(context, doc.uri, 4_000_000)
                val names = BinaryNames.extractKorgNames(bytes)
                if (upper.endsWith(".STY")) {
                    names.forEach { n ->
                        styles += StyleItem(
                            id = 10_000 + styles.size,
                            name = n,
                            category = categoryGuess(n, "Style"),
                            tempo = 100f,
                            bank = name.substringBeforeLast('.'),
                            source = "PA4X SET"
                        )
                    }
                } else {
                    names.forEach { n ->
                        sounds += SoundItem(
                            id = 10_000 + sounds.size,
                            name = n,
                            category = categoryGuess(n, if (upper.endsWith(".PAD")) "Pad" else "Imported"),
                            bank = name.substringBeforeLast('.'),
                            source = "PA4X SET"
                        )
                    }
                }
            }
        }
        return ImportedLibrary(setName, id, sounds, styles, 0, files)
    }

    private fun walk(dir: DocumentFile, prefix: String, visit: (String, DocumentFile) -> Unit) {
        dir.listFiles().forEach { child ->
            val rel = if (prefix.isEmpty()) child.name ?: "" else "$prefix/${child.name}"
            visit(rel, child)
            if (child.isDirectory) walk(child, rel, visit)
        }
    }

    private fun readBytes(context: Context, uri: Uri, max: Int): ByteArray {
        return context.contentResolver.openInputStream(uri)?.use { input ->
            val buf = ByteArray(max)
            var off = 0
            while (off < max) {
                val n = input.read(buf, off, max - off)
                if (n <= 0) break
                off += n
            }
            buf.copyOf(off)
        } ?: ByteArray(0)
    }

    private fun categoryGuess(name: String, fallback: String): String {
        val n = name.lowercase()
        return when {
            listOf("piano", "grand", "epiano", "e.piano", "rhodes", "wurly").any { it in n } -> "Piano"
            listOf("violin", "string", "viola", "cello").any { it in n } -> "Strings"
            listOf("oud", "ney", "kanun", "darbuka", "riq", "saz", "bouzouki", "duduk", "mizrahi", "arabic", "orient", "israeli", "baladi").any { it in n } -> "Oriental"
            listOf("bass").any { it in n } -> "Bass"
            listOf("brass", "trumpet", "trombone", "horn").any { it in n } -> "Brass"
            listOf("sax", "flute", "clarinet").any { it in n } -> "Woodwind"
            listOf("organ", "hammond").any { it in n } -> "Organ"
            listOf("pad", "lead", "synth").any { it in n } -> "Synth"
            listOf("drum", "kit", "perc").any { it in n } -> "Percussion"
            listOf("guitar").any { it in n } -> "Guitar"
            else -> fallback
        }
    }
}
