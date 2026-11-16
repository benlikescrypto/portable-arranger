import { useMemo, useState } from "react"
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

import { FormDialog, LcdButton, LcdHeader, LcdTabs, type DialogField } from "@/components/pro/ui"
import { Lcd } from "@/constants/theme"
import type { Perf, SongEntry } from "@/hooks/usePerformance"

type Mode = "book" | "setlist"
type Dialog = { kind: "add" } | { kind: "edit"; entry: SongEntry } | null

export function SongBookPage({ perf, wide }: { perf: Perf; wide: boolean }) {
  const [mode, setMode] = useState<Mode>("book")
  const [query, setQuery] = useState("")
  const [genre, setGenre] = useState("All")
  const [favOnly, setFavOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(perf.currentSong)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const songs = perf.book.songs

  const genres = useMemo(
    () => ["All", ...Array.from(new Set(songs.map((s) => s.genre).filter(Boolean))).sort()],
    [songs],
  )
  const rows = useMemo(() => {
    if (mode === "setlist") {
      return perf.book.setList.map((id) => songs.find((s) => s.id === id)).filter(Boolean) as SongEntry[]
    }
    const q = query.trim().toLowerCase()
    return songs
      .filter((s) => (genre === "All" || s.genre === genre) && (!favOnly || s.favorite))
      .filter((s) => !q || `${s.title} ${s.artist} ${s.styleName} ${s.genre}`.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [favOnly, genre, mode, perf.book.setList, query, songs])

  const entry = songs.find((s) => s.id === selected) ?? null
  const fields = (e?: SongEntry): DialogField[] => [
    { key: "title", label: "TITLE", value: e?.title ?? "" },
    { key: "artist", label: "ARTIST", value: e?.artist ?? "" },
    { key: "genre", label: "GENRE", value: e?.genre ?? "" },
    { key: "key", label: "KEY", value: e?.key ?? "" },
    {
      key: "notes",
      label: "NOTES / LYRICS",
      value: e?.notes ?? "",
      multiline: true,
    },
  ]

  return (
    <View style={styles.lcd}>
      <LcdHeader
        title="SongBook"
        right={
          mode === "setlist"
            ? `Set List · ${perf.book.setList.length} ${perf.book.setList.length === 1 ? "song" : "songs"}`
            : `${songs.length} ${songs.length === 1 ? "entry" : "entries"}`
        }
      />
      {mode === "book" ? (
        <View style={styles.filters}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search title, artist, style…"
            placeholderTextColor={Lcd.dim}
            style={styles.search}
            autoCorrect={false}
            selectionColor={Lcd.tabOn}
          />
          <Pressable onPress={() => setFavOnly((v) => !v)} style={[styles.chip, favOnly && styles.chipOn]}>
            <Text style={[styles.chipText, favOnly && styles.chipTextOn]}>★</Text>
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genres}>
            {genres.map((item) => (
              <Pressable
                key={item}
                onPress={() => setGenre(item)}
                style={[styles.chip, genre === item && styles.chipOn]}
              >
                <Text style={[styles.chipText, genre === item && styles.chipTextOn]}>{item}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.head}>
        <Text style={[styles.hCell, styles.cNum]}>#</Text>
        <Text style={[styles.hCell, styles.cTitle]}>TITLE</Text>
        {wide ? <Text style={[styles.hCell, styles.cArtist]}>ARTIST</Text> : null}
        <Text style={[styles.hCell, styles.cStyle]}>STYLE</Text>
        <Text style={[styles.hCell, styles.cTempo]}>♩</Text>
        {wide ? <Text style={[styles.hCell, styles.cKey]}>KEY</Text> : null}
      </View>
      <View style={styles.listWrap}>
        <FlatList
          data={rows}
          keyExtractor={(s) => s.id}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {mode === "setlist"
                ? "The Set List is empty. Select a song in the Book and tap “+ Set List”."
                : songs.length
                  ? "No songs match."
                  : "No songs yet. Set up a style, sounds, tempo and transpose, then tap “Add Current”."}
            </Text>
          }
          renderItem={({ item, index }) => {
            const on = item.id === selected
            const current = item.id === perf.currentSong
            const inSet = perf.book.setList.includes(item.id)
            return (
              <Pressable
                onPress={() => {
                  setSelected(item.id)
                  perf.recallSong(item)
                  if (mode === "setlist") perf.setSetListIndex(index)
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${item.styleName}, tempo ${item.tempo}`}
                style={({ pressed }) => [
                  styles.row,
                  index % 2 === 1 && styles.rowAlt,
                  on && styles.rowOn,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text style={[styles.cell, styles.cNum, current && styles.cellCurrent]}>{index + 1}</Text>
                <View style={[styles.cTitle, styles.titleCell]}>
                  <Text style={[styles.cell, styles.titleText, current && styles.cellCurrent]} numberOfLines={1}>
                    {item.favorite ? "★ " : ""}
                    {item.title}
                  </Text>
                  {inSet && mode === "book" ? <Text style={styles.setMark}>SET</Text> : null}
                </View>
                {wide ? (
                  <Text style={[styles.cell, styles.cArtist]} numberOfLines={1}>
                    {item.artist}
                  </Text>
                ) : null}
                <Text style={[styles.cell, styles.cStyle]} numberOfLines={1}>
                  {item.styleName}
                </Text>
                <Text style={[styles.cell, styles.cTempo]}>{item.tempo}</Text>
                {wide ? (
                  <Text style={[styles.cell, styles.cKey]} numberOfLines={1}>
                    {item.key || (item.transpose ? `T${item.transpose > 0 ? "+" : ""}${item.transpose}` : "")}
                  </Text>
                ) : null}
              </Pressable>
            )
          }}
        />
        {entry && wide && entry.notes ? (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>{entry.title}</Text>
            <Text style={styles.notesText}>{entry.notes}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.actions}>
        {mode === "book" ? (
          <>
            <LcdButton label="Add Current" primary onPress={() => setDialog({ kind: "add" })} />
            <LcdButton label="Edit" disabled={!entry} onPress={() => entry && setDialog({ kind: "edit", entry })} />
            <LcdButton label="Write" disabled={!entry} onPress={() => entry && perf.overwriteSong(entry.id)} />
            <LcdButton
              label={entry?.favorite ? "★ Unfav" : "☆ Fav"}
              disabled={!entry}
              onPress={() => entry && perf.updateSong(entry.id, { favorite: !entry.favorite })}
            />
            <LcdButton
              label={entry && perf.book.setList.includes(entry.id) ? "− Set List" : "+ Set List"}
              disabled={!entry}
              onPress={() => entry && perf.toggleSetList(entry.id)}
            />
            {confirmDelete ? (
              <LcdButton
                label="Confirm Delete"
                danger
                onPress={() => {
                  if (entry) perf.deleteSong(entry.id)
                  setSelected(null)
                  setConfirmDelete(false)
                }}
              />
            ) : (
              <LcdButton label="Delete" disabled={!entry} onPress={() => setConfirmDelete(true)} />
            )}
          </>
        ) : (
          <>
            <LcdButton label="◀ Prev" onPress={() => perf.stepSetList(-1)} />
            <LcdButton label="Next ▶" primary onPress={() => perf.stepSetList(1)} />
            <LcdButton label="Move Up" disabled={!entry} onPress={() => entry && perf.moveInSetList(entry.id, -1)} />
            <LcdButton label="Move Down" disabled={!entry} onPress={() => entry && perf.moveInSetList(entry.id, 1)} />
            <LcdButton label="Remove" disabled={!entry} onPress={() => entry && perf.toggleSetList(entry.id)} />
          </>
        )}
      </View>
      <LcdTabs
        tabs={[
          { id: "book", label: "Book" },
          { id: "setlist", label: "Set List" },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m)
          setConfirmDelete(false)
        }}
      />
      <FormDialog
        visible={dialog !== null}
        title={dialog?.kind === "edit" ? "Edit Entry" : "New Entry from Current Setting"}
        fields={fields(dialog?.kind === "edit" ? dialog.entry : undefined)}
        confirm={dialog?.kind === "edit" ? "Save" : "Add"}
        onCancel={() => setDialog(null)}
        onSubmit={(v) => {
          const patch = {
            title: v.title?.trim() || "Untitled",
            artist: v.artist?.trim() ?? "",
            genre: v.genre?.trim() ?? "",
            key: v.key?.trim() ?? "",
            notes: v.notes ?? "",
          }
          if (dialog?.kind === "edit") perf.updateSong(dialog.entry.id, patch)
          else {
            const created = perf.addSong(patch)
            setSelected(created.id)
          }
          setDialog(null)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  lcd: {
    flex: 1,
    backgroundColor: Lcd.bg,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2A3038",
  },
  filters: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: Lcd.line,
  },
  search: {
    width: 200,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Lcd.line,
    backgroundColor: Lcd.bgDeep,
    color: Lcd.text,
    paddingHorizontal: 8,
    fontSize: 12,
    fontWeight: "700",
  },
  genres: { gap: 5 },
  chip: {
    paddingHorizontal: 9,
    height: 28,
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: Lcd.bgDeep,
    borderWidth: 1,
    borderColor: Lcd.line,
  },
  chipOn: { backgroundColor: Lcd.catOn, borderColor: Lcd.catOn },
  chipText: { color: Lcd.muted, fontSize: 11, fontWeight: "800" },
  chipTextOn: { color: "#0C2427" },
  head: {
    flexDirection: "row",
    paddingHorizontal: 8,
    height: 22,
    alignItems: "center",
    backgroundColor: Lcd.bgDeep,
  },
  hCell: { color: Lcd.dim, fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  listWrap: { flex: 1, minHeight: 0, flexDirection: "row" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 34,
  },
  rowAlt: { backgroundColor: "#56616B" },
  rowOn: {
    backgroundColor: Lcd.cell,
    borderLeftWidth: 3,
    borderLeftColor: Lcd.tabOn,
    paddingLeft: 5,
  },
  rowPressed: { opacity: 0.8 },
  cell: { color: Lcd.text, fontSize: 12.5, fontWeight: "700" },
  cellCurrent: { color: Lcd.tabOn, fontWeight: "900" },
  titleCell: { flexDirection: "row", alignItems: "center", gap: 6 },
  titleText: { flexShrink: 1, fontWeight: "900" },
  setMark: {
    color: Lcd.green,
    fontSize: 8,
    fontWeight: "900",
    borderWidth: 1,
    borderColor: Lcd.green,
    borderRadius: 3,
    paddingHorizontal: 3,
  },
  cNum: { width: 28 },
  cTitle: { flex: 2.2, minWidth: 0 },
  cArtist: { flex: 1.4 },
  cStyle: { flex: 1.5 },
  cTempo: { width: 34, textAlign: "right" },
  cKey: { width: 44, textAlign: "right" },
  empty: { color: Lcd.muted, fontSize: 13, fontWeight: "600", padding: 16 },
  notes: {
    width: 200,
    padding: 10,
    borderLeftWidth: 1,
    borderLeftColor: Lcd.line,
    backgroundColor: Lcd.bgDeep,
    gap: 6,
  },
  notesTitle: { color: Lcd.text, fontSize: 12, fontWeight: "900" },
  notesText: {
    color: Lcd.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: 6,
    borderTopWidth: 1,
    borderTopColor: Lcd.line,
    backgroundColor: Lcd.bgDeep,
  },
})
