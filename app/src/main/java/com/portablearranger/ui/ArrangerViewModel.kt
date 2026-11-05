package com.portablearranger.ui

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.portablearranger.engine.NativeEngine
import com.portablearranger.library.SetImporter
import com.portablearranger.library.SoundItem
import com.portablearranger.library.StyleItem
import com.portablearranger.midi.UsbMidiController
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class Mode { STYLE, SOUND, PAD, MIXER, PERF, SET }

data class MixerState(
    val keyboard: Float = 0.95f,
    val drums: Float = 0.92f,
    val bass: Float = 0.88f,
    val acc: Float = 0.82f,
    val pad: Float = 0.75f,
    val master: Float = 0.90f
)

data class ArrangerUiState(
    val mode: Mode = Mode.STYLE,
    val setName: String = "Factory Engine",
    val adapterName: String = "Portable Arranger",
    val sounds: List<SoundItem> = emptyList(),
    val styles: List<StyleItem> = emptyList(),
    val query: String = "",
    val category: String = "All",
    val upper1: Int = 0,
    val upper2: Int? = 7,
    val upper3: Int? = null,
    val lower: Int = 21,
    val upper2On: Boolean = false,
    val upper3On: Boolean = false,
    val lowerOn: Boolean = true,
    val split: Int = 60,
    val styleId: Int = 10,
    val tempo: Float = 98f,
    val transpose: Int = 0,
    val variation: Int = 1,
    val section: Int = 4,
    val booked: Int = 0,
    val playing: Boolean = false,
    val synchro: Boolean = true,
    val autoFill: Boolean = true,
    val chordRoot: Int = 0,
    val chordType: Int = 0,
    val mixer: MixerState = MixerState(),
    val midiConnected: Boolean = false,
    val midiName: String = "MIDI",
    val latencyMs: Float = 8f,
    val importMessage: String = "",
    val importProgress: Float = 0f,
    val importing: Boolean = false,
    val setFiles: List<String> = emptyList(),
    val favorites: Set<Int> = emptySet(),
    val sts: Int = 1,
    val showKeyboard: Boolean = true
)

class ArrangerViewModel(app: Application) : AndroidViewModel(app) {
    private val handle = NativeEngine.create()
    private val importer = SetImporter(app)
    private var midi: UsbMidiController? = null

    private val _state = MutableStateFlow(ArrangerUiState())
    val state: StateFlow<ArrangerUiState> = _state

    val engineHandle: Long get() = handle

    init {
        NativeEngine.start(handle)
        reloadCatalog()
        NativeEngine.setPartProgram(handle, 0, 0)
        NativeEngine.setPartProgram(handle, 1, 7)
        NativeEngine.setPartProgram(handle, 3, 21)
        NativeEngine.setPartEnable(handle, 1, false)
        NativeEngine.setStyle(handle, 10)
        NativeEngine.setTempo(handle, 98f)
        midi = UsbMidiController(app, handle) { connected, name ->
            _state.update { it.copy(midiConnected = connected, midiName = name) }
        }.also { it.start() }
        viewModelScope.launch {
            while (true) {
                _state.update {
                    it.copy(
                        playing = NativeEngine.isPlaying(handle),
                        section = NativeEngine.section(handle),
                        chordRoot = NativeEngine.chordRoot(handle),
                        chordType = NativeEngine.chordType(handle),
                        tempo = NativeEngine.tempo(handle),
                        latencyMs = NativeEngine.latencyMs(handle)
                    )
                }
                delay(50)
            }
        }
    }

    private fun reloadCatalog() {
        val sounds = (0 until NativeEngine.soundCount(handle)).map { id ->
            SoundItem(id, NativeEngine.soundName(handle, id), NativeEngine.soundCategory(handle, id))
        }
        val styles = (0 until NativeEngine.styleCount(handle)).map { id ->
            StyleItem(id, NativeEngine.styleName(handle, id), NativeEngine.styleCategory(handle, id), NativeEngine.styleTempo(handle, id))
        }
        _state.update { it.copy(sounds = sounds, styles = styles) }
    }

    fun setMode(mode: Mode) = _state.update { it.copy(mode = mode) }
    fun setQuery(q: String) = _state.update { it.copy(query = q) }
    fun setCategory(c: String) = _state.update { it.copy(category = c) }

    fun selectSound(id: Int, part: Int = 0) {
        NativeEngine.setPartProgram(handle, part, id)
        _state.update {
            when (part) {
                0 -> it.copy(upper1 = id)
                1 -> it.copy(upper2 = id, upper2On = true)
                2 -> it.copy(upper3 = id, upper3On = true)
                else -> it.copy(lower = id)
            }
        }
        if (part > 0) NativeEngine.setPartEnable(handle, part, true)
    }

    fun togglePart(part: Int) {
        _state.update {
            val on = when (part) {
                1 -> !it.upper2On
                2 -> !it.upper3On
                3 -> !it.lowerOn
                else -> true
            }
            NativeEngine.setPartEnable(handle, part, on)
            when (part) {
                1 -> it.copy(upper2On = on)
                2 -> it.copy(upper3On = on)
                3 -> it.copy(lowerOn = on)
                else -> it
            }
        }
    }

    fun selectStyle(id: Int) {
        NativeEngine.setStyle(handle, id)
        val tempo = NativeEngine.styleTempo(handle, id)
        NativeEngine.setTempo(handle, tempo)
        _state.update { it.copy(styleId = id, tempo = tempo) }
    }

    fun toggleStart() = NativeEngine.arrangerToggle(handle)

    fun book(section: Int) {
        NativeEngine.bookSection(handle, section)
        if (section in 4..7) _state.update { it.copy(variation = section - 3) }
    }

    fun nudgeTempo(delta: Float) {
        val t = (_state.value.tempo + delta).coerceIn(40f, 240f)
        NativeEngine.setTempo(handle, t)
        _state.update { it.copy(tempo = t) }
    }

    fun toggleSynchro() {
        val v = !_state.value.synchro
        NativeEngine.setSynchro(handle, v)
        _state.update { it.copy(synchro = v) }
    }

    fun toggleAutoFill() {
        val v = !_state.value.autoFill
        NativeEngine.setAutoFill(handle, v)
        _state.update { it.copy(autoFill = v) }
    }

    fun setMixer(bus: Int, gain: Float) {
        NativeEngine.setMixer(handle, bus, gain)
        _state.update {
            val m = it.mixer
            it.copy(
                mixer = when (bus) {
                    0 -> m.copy(keyboard = gain)
                    1 -> m.copy(drums = gain)
                    2 -> m.copy(bass = gain)
                    3 -> m.copy(acc = gain)
                    4 -> m.copy(pad = gain)
                    else -> m.copy(master = gain)
                }
            )
        }
    }

    fun noteOn(note: Int, vel: Int) = NativeEngine.noteOn(handle, 0, note, vel)
    fun noteOff(note: Int) = NativeEngine.noteOff(handle, 0, note)
    fun setSplit(n: Int) {
        NativeEngine.setSplit(handle, n)
        _state.update { it.copy(split = n) }
    }

    fun transpose(delta: Int) = _state.update { it.copy(transpose = (it.transpose + delta).coerceIn(-12, 12)) }
    fun setSts(n: Int) = _state.update { it.copy(sts = n) }
    fun toggleKeyboard() = _state.update { it.copy(showKeyboard = !it.showKeyboard) }
    fun toggleFavorite(id: Int) = _state.update {
        it.copy(favorites = if (id in it.favorites) it.favorites - id else it.favorites + id)
    }

    fun importSet(uri: Uri) {
        viewModelScope.launch {
            runCatching {
                getApplication<Application>().contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
            _state.update { it.copy(importing = true, importMessage = "Opening SET…", importProgress = 0f, mode = Mode.SET) }
            runCatching {
                importer.importTree(handle, uri) { p ->
                    _state.update { it.copy(importMessage = p.message, importProgress = p.fraction) }
                }
            }.onSuccess { lib ->
                reloadCatalog()
                val mergedSounds = _state.value.sounds
                val mergedStyles = _state.value.styles + lib.styles
                _state.update {
                    it.copy(
                        importing = false,
                        setName = lib.setName,
                        adapterName = "Korg PA4X",
                        sounds = mergedSounds,
                        styles = mergedStyles,
                        setFiles = lib.files.take(40).map { f -> "${f.kind}  ${f.relativePath}" },
                        importMessage = "Loaded ${lib.sounds.size} names, ${lib.styles.size} styles, ${lib.samplesLoaded} samples",
                        importProgress = 1f,
                        mode = Mode.SOUND
                    )
                }
            }.onFailure { e ->
                _state.update { it.copy(importing = false, importMessage = e.message ?: "Import failed") }
            }
        }
    }

    override fun onCleared() {
        midi?.stop()
        NativeEngine.stop(handle)
        NativeEngine.destroy(handle)
    }
}

fun chordLabel(root: Int, type: Int): String {
    val names = arrayOf("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    val types = arrayOf("", "m", "7", "m7", "M7", "sus4", "dim")
    return names[root.mod(12)] + types[type.coerceIn(0, types.lastIndex)]
}

fun noteName(n: Int): String {
    val names = arrayOf("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    return names[n.mod(12)] + ((n / 12) - 1)
}

object Sections {
    const val INTRO1 = 1
    const val INTRO2 = 2
    const val INTRO3 = 3
    const val VAR1 = 4
    const val VAR2 = 5
    const val VAR3 = 6
    const val VAR4 = 7
    const val FILL1 = 8
    const val FILL2 = 9
    const val FILL3 = 10
    const val FILL4 = 11
    const val BREAK = 12
    const val END1 = 13
    const val END2 = 14
    const val END3 = 15
}
