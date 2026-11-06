import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import * as ScreenOrientation from "expo-screen-orientation"
import { useKeepAwake } from "expo-keep-awake"
import { useEffect } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import "react-native-reanimated"

export { ErrorBoundary } from "expo-router"

export default function RootLayout() {
  useKeepAwake()

  useEffect(() => {
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
          contentStyle: { backgroundColor: "#0B0C0E", flex: 1 },
        }}
      />
      <StatusBar style="light" />
    </SafeAreaProvider>
  )
}
