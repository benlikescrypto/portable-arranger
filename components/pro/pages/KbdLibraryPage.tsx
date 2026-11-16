import { useState } from "react"
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native"

import { FormDialog, LcdButton, LcdHeader } from "@/components/pro/ui"
import { Lcd } from "@/constants/theme"
import type { KbdSet, Perf } from "@/hooks/usePerformance"

type Dialog = { kind: "save" } | { kind: "sts"; slot: number } | null

export function KbdLibraryPage({ perf, styleName, onClose }: { perf: Perf; styleName: string; onClose: () => void }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const sets = [...perf.library.kbdSets].sort((a, b) => a.name.localeCompare(b.name))
  const sel = sets.find((k) => k.name === selected)
  return (
    <View style={styles.lcd}>
      <LcdHeader title="Keyboard Set Library" right={styleName} />
      <View style={styles.body}>
        <View style={styles.listCol}>
          <Text style={styles.colTitle}>USER KEYBOARD SETS</Text>
          <FlatList
            data={sets}
            keyExtractor={(k) => k.name}
            ListEmptyComponent={<Text style={styles.empty}>Nothing saved yet. Tap “Save Current…”.</Text>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setSelected(item.name)
                  perf.recallKbdSet(item)
                }}
                style={({ pressed }) => [styles.item, item.name === selected && styles.itemOn, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {summary(item)}
                </Text>
              </Pressable>
            )}
          />
        </View>
        <View style={styles.stsCol}>
          <Text style={styles.colTitle}>STS OF THIS STYLE</Text>
          {perf.stsSlots.map((slot, i) => (
            <View key={i} style={styles.sts}>
              <View style={[styles.stsNum, perf.activeSts === i && styles.stsNumOn]}>
                <Text style={styles.stsNumText}>{i + 1}</Text>
              </View>
              <View style={styles.stsText}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {slot.set.name}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {slot.stored ? summary(slot.set) : "default"}
                </Text>
              </View>
              <LcdButton label="Write" onPress={() => setDialog({ kind: "sts", slot: i })} />
            </View>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        <LcdButton label="Save Current…" primary onPress={() => setDialog({ kind: "save" })} />
        <LcdButton
          label="Delete"
          disabled={!sel}
          onPress={() => {
            if (sel) perf.deleteKbdSet(sel.name)
            setSelected(null)
          }}
        />
        <View style={styles.spacer} />
        <LcdButton label="Exit" onPress={onClose} />
      </View>
      <FormDialog
        visible={dialog !== null}
        title={dialog?.kind === "sts" ? `Write STS ${dialog.slot + 1}` : "Save Keyboard Set"}
        fields={[
          {
            key: "name",
            label: "NAME",
            value: dialog?.kind === "sts" ? (perf.stsSlots[dialog.slot]?.set.name ?? "") : "My Setting",
          },
        ]}
        confirm="Write"
        onCancel={() => setDialog(null)}
        onSubmit={(v) => {
          const name = v.name?.trim() || "My Setting"
          if (dialog?.kind === "sts") perf.writeSts(dialog.slot, name)
          else perf.saveKbdSet(name)
          setDialog(null)
        }}
      />
    </View>
  )
}

function summary(set: KbdSet) {
  return set.parts
    .map((p, i) => (p.on && p.sound ? `${["U1", "U2", "U3", "L"][i]}:${p.sound}` : null))
    .filter(Boolean)
    .join("  ")
}

const styles = StyleSheet.create({
  lcd: { flex: 1, backgroundColor: Lcd.bg, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#2A3038" },
  body: { flex: 1, minHeight: 0, flexDirection: "row" },
  listCol: { flex: 1.2, borderRightWidth: 1, borderRightColor: Lcd.line },
  stsCol: { flex: 1, padding: 6, gap: 6 },
  colTitle: { color: Lcd.dim, fontSize: 9, fontWeight: "900", letterSpacing: 1, padding: 6 },
  empty: { color: Lcd.muted, fontSize: 12, padding: 10 },
  item: { paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Lcd.line },
  itemOn: { backgroundColor: Lcd.cell, borderLeftWidth: 3, borderLeftColor: Lcd.tabOn },
  itemName: { color: Lcd.text, fontSize: 13, fontWeight: "900" },
  itemMeta: { color: Lcd.dim, fontSize: 9.5, fontWeight: "700", marginTop: 1 },
  sts: { flexDirection: "row", alignItems: "center", gap: 8, padding: 6, borderRadius: 6, backgroundColor: Lcd.bgDeep },
  stsNum: { width: 26, height: 26, borderRadius: 4, backgroundColor: Lcd.cell, alignItems: "center", justifyContent: "center" },
  stsNumOn: { backgroundColor: "#3B78C4" },
  stsNumText: { color: Lcd.text, fontWeight: "900" },
  stsText: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", gap: 6, padding: 6, borderTopWidth: 1, borderTopColor: Lcd.line, backgroundColor: Lcd.bgDeep },
  spacer: { flex: 1 },
})
