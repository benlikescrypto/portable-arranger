const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins")

function withArrangerBoxHardware(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest
    manifest["uses-feature"] = manifest["uses-feature"] || []
    const features = [
      { $: { "android:name": "android.hardware.usb.host", "android:required": "false" } },
      { $: { "android:name": "android.software.midi", "android:required": "false" } },
    ]
    for (const feature of features) {
      const name = feature.$["android:name"]
      if (!manifest["uses-feature"].some((item) => item.$?.["android:name"] === name)) {
        manifest["uses-feature"].push(feature)
      }
    }
    const app = manifest.application?.[0]
    if (app?.$) {
      app.$["android:largeHeap"] = "true"
      app.$["android:appCategory"] = "audio"
    }
    return mod
  })

  config = withInfoPlist(config, (mod) => {
    const plist = mod.modResults
    const modes = new Set(plist.UIBackgroundModes || [])
    modes.add("audio")
    plist.UIBackgroundModes = [...modes]
    plist.UIRequiresPersistentWiFi = false
    plist.UIFileSharingEnabled = true
    return mod
  })

  return config
}

module.exports = withArrangerBoxHardware
