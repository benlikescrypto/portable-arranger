import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import * as ScreenOrientation from "expo-screen-orientation"
import { useKeepAwake } from "expo-keep-awake"
import { useEffect } from "react"
import "react-native-reanimated"

export { ErrorBoundary } from "expo-router"

export default function RootLayout() {
  useKeepAwake()

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
    return () => {
      void ScreenOrientation.unlockAsync()
    }
  }, [])

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0B0C0E" } }} />
      <StatusBar style="light" hidden />
    </>
  )
}
