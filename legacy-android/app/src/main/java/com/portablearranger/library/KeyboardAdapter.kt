package com.portablearranger.library

import android.content.Context
import androidx.documentfile.provider.DocumentFile

interface KeyboardAdapter {
    val id: String
    val displayName: String
    fun matches(root: DocumentFile): Boolean
    fun inspect(context: Context, root: DocumentFile): ImportedLibrary
}

object AdapterRegistry {
    val adapters: List<KeyboardAdapter> = listOf(Pa4xAdapter())

    fun detect(root: DocumentFile): KeyboardAdapter? {
        val setFolder = findSetFolder(root)
        val target = setFolder ?: root
        return adapters.firstOrNull { it.matches(target) }
    }

    fun findSetFolder(root: DocumentFile): DocumentFile? {
        if (root.name?.endsWith(".SET", true) == true) return root
        root.listFiles().forEach { child ->
            if (child.isDirectory && child.name?.endsWith(".SET", true) == true) return child
        }
        return if (looksLikeSet(root)) root else null
    }

    fun looksLikeSet(dir: DocumentFile): Boolean {
        val names = dir.listFiles().mapNotNull { it.name?.uppercase() }.toSet()
        return listOf("SOUND", "STYLE", "PCM", "KEYBOARDSET").count { it in names } >= 2
    }
}
