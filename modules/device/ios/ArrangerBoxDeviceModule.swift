import ExpoModulesCore
import UIKit

public class ArrangerBoxDeviceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArrangerBoxDevice")

    Function("isAvailable") { true }

    Function("capabilities") {
      [
        "platform": "ios",
        "model": UIDevice.current.model,
        "manufacturer": "Apple",
        "usbHost": true,
        "midiService": true,
        "usbDevices": [] as [Any]
      ]
    }
  }
}
