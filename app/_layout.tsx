import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import * as DevClient from "expo-dev-client"
import * as ScreenOrientation from "expo-screen-orientation"
import * as SplashScreen from "expo-splash-screen"
import { useKeepAwake } from "expo-keep-awake"
import { useEffect } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import "react-native-reanimated"

export { ErrorBoundary } from "expo-router"

SplashScreen.setOptions({ duration: 240, fade: true })

export default function RootLayout() {
  useKeepAwake()

  useEffect(() => {
    if (__DEV__) {
      try {
        DevClient.setToolsButtonVisible(false)
        DevClient.hideMenu()
      } catch {
        // no-op in builds without the floating tools button
      }
    }
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT)
    return () => {
      void ScreenOrientation.unlockAsync()
    }
  }, [])

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          orientation: "default",
          animation: "fade",
          contentStyle: { backgroundColor: "#07080A", flex: 1 },
        }}
      />
      <StatusBar style="light" />
    </SafeAreaProvider>
  )
}
