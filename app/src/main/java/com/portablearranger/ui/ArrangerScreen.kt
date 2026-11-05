package com.portablearranger.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.portablearranger.ui.components.Led
import com.portablearranger.ui.components.OnscreenKeyboard
import com.portablearranger.ui.components.PaButton
import com.portablearranger.ui.components.PartTile
import com.portablearranger.ui.theme.PaBg
import com.portablearranger.ui.theme.PaBgRaised
import com.portablearranger.ui.theme.PaBlue
import com.portablearranger.ui.theme.PaDim
import com.portablearranger.ui.theme.PaGold
import com.portablearranger.ui.theme.PaGreen
import com.portablearranger.ui.theme.PaMeter
import com.portablearranger.ui.theme.PaMuted
import com.portablearranger.ui.theme.PaOrange
import com.portablearranger.ui.theme.PaPanel
import com.portablearranger.ui.theme.PaPanelAlt
import com.portablearranger.ui.theme.PaPurple
import com.portablearranger.ui.theme.PaRed
import com.portablearranger.ui.theme.PaStroke
import com.portablearranger.ui.theme.PaText

@Composable
fun ArrangerScreen(vm: ArrangerViewModel) {
    val s by vm.state.collectAsStateWithLifecycle()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) vm.importSet(uri)
    }
    Column(
        Modifier
            .fillMaxSize()
            .background(PaBg)
            .padding(10.dp)
    ) {
        TopBar(s, vm) { picker.launch(null) }
        Spacer(Modifier.height(8.dp))
        KeyboardSetRow(s, vm)
        Spacer(Modifier.height(8.dp))
        Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StylePanel(s, vm, Modifier.width(340.dp).fillMaxHeight())
            BrowserPanel(s, vm, Modifier.weight(1f).fillMaxHeight())
        }
        Spacer(Modifier.height(8.dp))
        MixerRow(s, vm)
        if (s.showKeyboard) {
            Spacer(Modifier.height(8.dp))
            OnscreenKeyboard(
                modifier = Modifier.fillMaxWidth().height(118.dp),
                onNoteOn = { n, v -> vm.noteOn(n + s.transpose, v) },
                onNoteOff = { n -> vm.noteOff(n + s.transpose) }
            )
        }
    }
}

@Composable
private fun TopBar(s: ArrangerUiState, vm: ArrangerViewModel, onLoad: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Brush.horizontalGradient(listOf(PaBgRaised, PaPanel)))
            .border(1.dp, PaStroke, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Column {
            Text("ARRANGERBOX", color = PaOrange, fontWeight = FontWeight.Black, fontSize = 13.sp, letterSpacing = 1.4.sp)
            Text("${s.adapterName}  ·  ${s.setName}", color = PaMuted, fontSize = 11.sp)
        }
        Spacer(Modifier.weight(1f))
        Mode.entries.forEach { m ->
            val on = s.mode == m
            val color = when (m) {
                Mode.STYLE -> PaOrange
                Mode.SOUND -> PaBlue
                Mode.PAD -> PaPurple
                Mode.MIXER -> PaMeter
                Mode.PERF -> PaGold
                Mode.SET -> PaText
            }
            Text(
                m.name,
                color = if (on) PaBg else PaMuted,
                fontWeight = FontWeight.Bold,
                fontSize = 11.sp,
                letterSpacing = 0.8.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (on) color else Color.Transparent)
                    .clickable { vm.setMode(m) }
                    .padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }
        Led(s.midiConnected, PaGreen, s.midiName.take(10))
        Led(true, PaBlue, "${s.latencyMs.toInt()} ms")
        PaButton("LOAD SET", accent = PaBlue, minHeight = 36.dp, modifier = Modifier.width(92.dp), onClick = onLoad)
        PaButton(if (s.showKeyboard) "KEYS" else "KEYS", active = s.showKeyboard, minHeight = 36.dp, modifier = Modifier.width(56.dp)) {
            vm.toggleKeyboard()
        }
    }
}

@Composable
private fun KeyboardSetRow(s: ArrangerUiState, vm: ArrangerViewModel) {
    fun name(id: Int?) = s.sounds.firstOrNull { it.id == id }?.name ?: "—"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PartTile("UPPER 1", name(s.upper1), true, s.mode == Mode.SOUND, PaOrange, Modifier.weight(1f), { vm.setMode(Mode.SOUND) }) {}
        PartTile("UPPER 2", name(s.upper2), s.upper2On, false, PaBlue, Modifier.weight(1f), { vm.selectSound(s.upper2 ?: 7, 1) }) { vm.togglePart(1) }
        PartTile("UPPER 3", name(s.upper3), s.upper3On, false, PaPurple, Modifier.weight(1f), { s.upper3?.let { vm.selectSound(it, 2) } }) { vm.togglePart(2) }
        PartTile("LOWER", name(s.lower), s.lowerOn, false, PaGold, Modifier.weight(1f), { vm.selectSound(s.lower, 3) }) { vm.togglePart(3) }
        Column(
            Modifier
                .width(168.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(PaPanel)
                .border(1.dp, PaStroke, RoundedCornerShape(10.dp))
                .padding(8.dp)
        ) {
            Text("SPLIT  ${noteName(s.split)}", color = PaMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            Text("TRANSPOSE  ${if (s.transpose > 0) "+${s.transpose}" else "${s.transpose}"}", color = PaText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                PaButton("−", minHeight = 28.dp, modifier = Modifier.weight(1f)) { vm.transpose(-1) }
                PaButton("+", minHeight = 28.dp, modifier = Modifier.weight(1f)) { vm.transpose(1) }
            }
        }
    }
}

@Composable
private fun StylePanel(s: ArrangerUiState, vm: ArrangerViewModel, modifier: Modifier) {
    val style = s.styles.firstOrNull { it.id == s.styleId }
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(PaPanel)
            .border(1.dp, PaStroke, RoundedCornerShape(14.dp))
            .padding(10.dp)
    ) {
        Text("STYLE PLAY", color = PaOrange, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
        Text(style?.name ?: "—", color = PaText, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${s.tempo.toInt()} BPM", color = PaGold, fontSize = 20.sp, fontWeight = FontWeight.Black)
            Spacer(Modifier.width(8.dp))
            PaButton("−", minHeight = 32.dp, modifier = Modifier.width(36.dp)) { vm.nudgeTempo(-1f) }
            PaButton("+", minHeight = 32.dp, modifier = Modifier.width(36.dp)) { vm.nudgeTempo(1f) }
            Spacer(Modifier.weight(1f))
            Column(horizontalAlignment = Alignment.End) {
                Text("CHORD", color = PaMuted, fontSize = 9.sp, letterSpacing = 1.sp)
                Text(chordLabel(s.chordRoot, s.chordType), color = PaGreen, fontSize = 22.sp, fontWeight = FontWeight.Black)
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            (1..4).forEach { n ->
                PaButton("STS $n", modifier = Modifier.weight(1f), active = s.sts == n, minHeight = 36.dp, accent = PaBlue) { vm.setSts(n) }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("INTRO", color = PaDim, fontSize = 9.sp, letterSpacing = 1.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf(Sections.INTRO1 to "1", Sections.INTRO2 to "2", Sections.INTRO3 to "3").forEach { (id, lab) ->
                PaButton("INTRO $lab", Modifier.weight(1f), s.section == id, s.booked == id) { vm.book(id) }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("VARIATION", color = PaDim, fontSize = 9.sp, letterSpacing = 1.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(Sections.VAR1, Sections.VAR2, Sections.VAR3, Sections.VAR4).forEachIndexed { i, id ->
                PaButton("VAR ${i + 1}", Modifier.weight(1f).height(64.dp), s.variation == i + 1 && s.section in 4..7, s.section == id, minHeight = 64.dp) {
                    vm.book(id)
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("FILL / BREAK", color = PaDim, fontSize = 9.sp, letterSpacing = 1.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf(Sections.FILL1 to "1", Sections.FILL2 to "2", Sections.FILL3 to "3", Sections.FILL4 to "4").forEach { (id, lab) ->
                PaButton("FILL $lab", Modifier.weight(1f), s.section == id) { vm.book(id) }
            }
            PaButton("BREAK", Modifier.weight(1.1f), s.section == Sections.BREAK, accent = PaGold) { vm.book(Sections.BREAK) }
        }
        Spacer(Modifier.height(6.dp))
        Text("ENDING", color = PaDim, fontSize = 9.sp, letterSpacing = 1.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf(Sections.END1 to "1", Sections.END2 to "2", Sections.END3 to "3").forEach { (id, lab) ->
                PaButton("ENDING $lab", Modifier.weight(1f), s.section == id, accent = PaRed) { vm.book(id) }
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            PaButton("SYNC START", Modifier.weight(1f), s.synchro, accent = PaBlue) { vm.toggleSynchro() }
            PaButton("AUTO FILL", Modifier.weight(1f), s.autoFill, accent = PaGold) { vm.toggleAutoFill() }
        }
        Spacer(Modifier.height(8.dp))
        PaButton(
            if (s.playing) "STOP" else "START",
            modifier = Modifier.fillMaxWidth().height(62.dp),
            active = s.playing,
            accent = if (s.playing) PaRed else PaGreen,
            minHeight = 62.dp
        ) { vm.toggleStart() }
    }
}

@Composable
private fun BrowserPanel(s: ArrangerUiState, vm: ArrangerViewModel, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(PaPanel)
            .border(1.dp, PaStroke, RoundedCornerShape(14.dp))
            .padding(10.dp)
    ) {
        when (s.mode) {
            Mode.STYLE -> LibraryGrid(
                title = "STYLES",
                categories = listOf("All") + s.styles.map { it.category }.distinct(),
                s = s,
                vm = vm,
                items = s.styles.filter {
                    (s.category == "All" || it.category == s.category) &&
                        (s.query.isBlank() || it.name.contains(s.query, true))
                }.map { Triple(it.id, it.name, "${it.category}  ·  ${it.tempo.toInt()} BPM") },
                selected = s.styleId,
                accent = PaOrange,
                onSelect = vm::selectStyle
            )
            Mode.SOUND, Mode.PAD -> LibraryGrid(
                title = if (s.mode == Mode.PAD) "PADS / PERCUSSION" else "SOUNDS",
                categories = listOf("All", "Favorites") + s.sounds.map { it.category }.distinct(),
                s = s,
                vm = vm,
                items = s.sounds.filter {
                    val catOk = when (s.category) {
                        "All" -> true
                        "Favorites" -> it.id in s.favorites
                        else -> it.category == s.category
                    }
                    val padOk = if (s.mode == Mode.PAD) it.category == "Percussion" else true
                    catOk && padOk && (s.query.isBlank() || it.name.contains(s.query, true))
                }.map { Triple(it.id, it.name, "${it.category}  ·  ${it.bank}") },
                selected = s.upper1,
                accent = PaBlue,
                onSelect = { vm.selectSound(it, 0) },
                onLong = vm::toggleFavorite
            )
            Mode.MIXER -> MixerDetail(s, vm)
            Mode.PERF -> PerformancePane(s, vm)
            Mode.SET -> SetPane(s)
        }
    }
}

@Composable
private fun ColumnScope.LibraryGrid(
    title: String,
    categories: List<String>,
    s: ArrangerUiState,
    vm: ArrangerViewModel,
    items: List<Triple<Int, String, String>>,
    selected: Int,
    accent: Color,
    onSelect: (Int) -> Unit,
    onLong: (Int) -> Unit = {}
) {
    Text(title, color = accent, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
    Spacer(Modifier.height(6.dp))
    TextField(
        value = s.query,
        onValueChange = vm::setQuery,
        placeholder = { Text("Search", color = PaDim) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().height(48.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = PaPanelAlt,
            unfocusedContainerColor = PaPanelAlt,
            focusedTextColor = PaText,
            unfocusedTextColor = PaText,
            focusedIndicatorColor = accent,
            unfocusedIndicatorColor = PaStroke
        )
    )
    Spacer(Modifier.height(6.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        categories.take(10).forEach { c ->
            val on = s.category == c
            Text(
                c.uppercase(),
                color = if (on) PaBg else PaMuted,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (on) accent else PaPanelAlt)
                    .clickable { vm.setCategory(c) }
                    .padding(horizontal = 8.dp, vertical = 5.dp)
            )
        }
    }
    Spacer(Modifier.height(8.dp))
    LazyVerticalGrid(
        columns = GridCells.Adaptive(168.dp),
        modifier = Modifier.weight(1f).fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        items(items, key = { it.first }) { item ->
            val on = item.first == selected
            val fav = item.first in s.favorites
            Column(
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (on) accent.copy(alpha = 0.18f) else PaPanelAlt)
                    .border(1.dp, if (on) accent else PaStroke, RoundedCornerShape(8.dp))
                    .clickable { onSelect(item.first) }
                    .padding(10.dp)
            ) {
                Text(item.second, color = PaText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text((if (fav) "★ " else "") + item.third, color = PaMuted, fontSize = 10.sp, maxLines = 1)
            }
        }
    }
}

@Composable
private fun MixerRow(s: ArrangerUiState, vm: ArrangerViewModel) {
    val strips = listOf(
        Triple("KB", s.mixer.keyboard, 0),
        Triple("DRM", s.mixer.drums, 1),
        Triple("BAS", s.mixer.bass, 2),
        Triple("ACC", s.mixer.acc, 3),
        Triple("PAD", s.mixer.pad, 4),
        Triple("MST", s.mixer.master, 5)
    )
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PaPanel)
            .border(1.dp, PaStroke, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text("MIXER", color = PaMeter, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
        strips.forEach { (lab, gain, bus) ->
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Text(lab, color = PaMuted, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(28.dp))
                Slider(
                    value = gain,
                    onValueChange = { vm.setMixer(bus, it) },
                    valueRange = 0f..1.2f,
                    modifier = Modifier.weight(1f),
                    colors = SliderDefaults.colors(thumbColor = PaOrange, activeTrackColor = PaOrange)
                )
            }
        }
    }
}

@Composable
private fun MixerDetail(s: ArrangerUiState, vm: ArrangerViewModel) {
    Text("MIXER", color = PaMeter, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
    Text("Live balance for keyboard, drums, bass, accompaniment and pads.", color = PaMuted, fontSize = 13.sp)
    Spacer(Modifier.height(12.dp))
    MixerRow(s, vm)
}

@Composable
private fun PerformancePane(s: ArrangerUiState, vm: ArrangerViewModel) {
    Text("PERFORMANCES", color = PaGold, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
    Spacer(Modifier.height(8.dp))
    Text("One-tap recall of sound, style, tempo and mixer. STS 1–4 on the style panel already switch keyboard setups during a song.", color = PaMuted, fontSize = 13.sp)
    Spacer(Modifier.height(12.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("Wedding Open", "Mizrahi Set", "Ballad Night", "Debka Live").forEachIndexed { i, name ->
            PaButton(name, Modifier.weight(1f).height(72.dp), active = s.sts == i + 1, accent = PaGold, minHeight = 72.dp) {
                vm.setSts(i + 1)
                if (i == 0) vm.selectStyle(10)
                if (i == 1) vm.selectStyle(15)
                if (i == 2) vm.selectStyle(2)
                if (i == 3) vm.selectStyle(14)
            }
        }
    }
}

@Composable
private fun SetPane(s: ArrangerUiState) {
    Text("SET LIBRARY", color = PaText, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
    Spacer(Modifier.height(8.dp))
    Text("Load a Korg PA4X .SET folder from USB or tablet storage. Original names, styles and samples are imported without converting.", color = PaMuted, fontSize = 13.sp)
    Spacer(Modifier.height(8.dp))
    Text(s.importMessage.ifBlank { "No SET loaded yet. Tap LOAD SET." }, color = PaText, fontSize = 14.sp)
    if (s.importing || s.importProgress > 0f) {
        Spacer(Modifier.height(8.dp))
        LinearProgressIndicator(progress = { s.importProgress }, modifier = Modifier.fillMaxWidth(), color = PaOrange, trackColor = PaStroke)
    }
    Spacer(Modifier.height(10.dp))
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        s.setFiles.forEach { Text(it, color = PaDim, fontSize = 11.sp) }
    }
}
