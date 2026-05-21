'use client'

import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type { Config } from '@/lib/types'
import { defaultConfig, loadConfig, saveConfig as persistConfig } from '@/lib/utils'

type ConfigContextValue = {
  config: Config
  configVersion: number
  setConfig: (next: Config) => void
  triggerSave: (next: Config) => void
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<Config>(() => defaultConfig())
  const [configVersion, setConfigVersion] = useState(0)
  const onSaveRef = useRef<((config: Config) => void) | null>(null)

  useEffect(() => {
    // Hydrate from localStorage after mount — value isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfigState(loadConfig())
  }, [])

  const triggerSave = useCallback((next: Config) => {
    setConfigState(next)
    persistConfig(next)
    setConfigVersion(v => v + 1)
    onSaveRef.current?.(next)
  }, [])

  const setConfig = useCallback((next: Config) => {
    setConfigState(next)
    persistConfig(next)
  }, [])

  const value = useMemo(
    () => ({ config, configVersion, setConfig, triggerSave }),
    [config, configVersion, setConfig, triggerSave],
  )
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig(): Config {
  const ctx = useContext(ConfigContext)
  return ctx?.config ?? defaultConfig()
}

export function useConfigState(): ConfigContextValue {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfigState must be used inside <ConfigProvider>')
  return ctx
}
