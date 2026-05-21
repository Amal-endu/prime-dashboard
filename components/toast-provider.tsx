'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

type ToastState = 'idle' | 'refreshing' | 'success' | 'error'

type ToastContextValue = {
  startRefresh: () => void
  register: () => void
  completeOne: () => void
  failAll: () => void
  retry: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ToastState>('idle')
  const [progress, setProgress] = useState(0)
  const [showProgress, setShowProgress] = useState(false)

  const totalRef = useRef(0)
  const completedRef = useRef(0)
  const startTimeRef = useRef<number | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCallbackRef = useRef<(() => void) | null>(null)

  const clearTimers = useCallback(() => {
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
  }, [])

  const startRefresh = useCallback(() => {
    clearTimers()
    totalRef.current = 0
    completedRef.current = 0
    startTimeRef.current = Date.now()
    setState('refreshing')
    setProgress(0)
    setShowProgress(false)

    progressTimerRef.current = setTimeout(() => {
      setState(prev => {
        if (prev === 'refreshing') setShowProgress(true)
        return prev
      })
    }, 5000)
  }, [clearTimers])

  const register = useCallback(() => {
    totalRef.current += 1
  }, [])

  const completeOne = useCallback(() => {
    completedRef.current += 1
    const pct = totalRef.current > 0
      ? Math.round((completedRef.current / totalRef.current) * 100)
      : 100
    setProgress(pct)

    if (completedRef.current >= totalRef.current && totalRef.current > 0) {
      clearTimers()
      setShowProgress(false)
      setState('success')
      dismissTimerRef.current = setTimeout(() => setState('idle'), 2000)
    }
  }, [clearTimers])

  const failAll = useCallback(() => {
    clearTimers()
    setShowProgress(false)
    setState('error')
  }, [clearTimers])

  const retry = useCallback(() => {
    retryCallbackRef.current?.()
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const value = { startRefresh, register, completeOne, failAll, retry }

  if (state === 'idle') {
    return (
      <ToastContext.Provider value={value}>
        {children}
      </ToastContext.Provider>
    )
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 w-72 rounded-xl border shadow-lg text-sm font-medium">
        {state === 'refreshing' && showProgress && (
          <div className="bg-white border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-700 mb-2">
              <Loader2 className="w-4 h-4 animate-spin text-sfx-orange shrink-0" />
              <span>Refreshing data… {progress}%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-sfx-orange rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
        {state === 'success' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Configuration applied</span>
            </div>
          </div>
        )}
        {state === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center justify-between gap-2 text-red-700">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>Failed to apply config</span>
              </div>
              <button
                onClick={retry}
                className="text-xs underline text-red-600 hover:text-red-800 shrink-0"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}
