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
    plist.LSSupportsOpeningDocumentsInPlace = true
    plist.CFBundleDocumentTypes = [
      {
        CFBundleTypeName: "Korg PA SET",
        CFBundleTypeRole: "Viewer",
        LSHandlerRank: "Alternate",
        LSTypeIsPackage: true,
        CFBundleTypeExtensions: ["set", "SET"],
        LSItemContentTypes: ["com.arrangerbox.pa-set"],
      },
      {
        CFBundleTypeName: "PA4X Style / SMF",
        CFBundleTypeRole: "Viewer",
        LSHandlerRank: "Alternate",
        CFBundleTypeExtensions: ["sty", "STY", "mid", "MID", "smf", "SMF"],
        LSItemContentTypes: ["com.arrangerbox.pa-style", "public.midi-audio"],
      },
    ]
    plist.UTExportedTypeDeclarations = [
      {
        UTTypeIdentifier: "com.arrangerbox.pa-set",
        UTTypeDescription: "Korg PA SET folder",
        UTTypeConformsTo: ["com.apple.package", "public.composite-content"],
        UTTypeTagSpecification: {
          "public.filename-extension": ["set"],
        },
      },
      {
        UTTypeIdentifier: "com.arrangerbox.pa-style",
        UTTypeDescription: "PA4X Style Record SMF / STY",
        UTTypeConformsTo: ["public.data"],
        UTTypeTagSpecification: {
          "public.filename-extension": ["sty", "mid", "smf"],
        },
      },
    ]
    return mod
  })

  return config
}

module.exports = withArrangerBoxHardware
