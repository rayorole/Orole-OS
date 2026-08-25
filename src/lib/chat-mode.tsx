import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type ChatMode = 'voice' | 'text'

interface ChatModeContextValue {
  mode: ChatMode
  setMode: (mode: ChatMode) => void
  toggleMode: () => void
}

const STORAGE_KEY = 'orole.chatMode'

const ChatModeContext = createContext<ChatModeContextValue | null>(null)

/**
 * Global Voice ↔ Text chat mode. Voice (Jarvis) is the default/primary mode;
 * text chat is the backup surface reachable from every route.
 */
export function ChatModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ChatMode>('voice')

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === 'text') setModeState('text')
    } catch {
      // ignore storage errors; voice stays default
    }
  }, [])

  const setMode = useCallback((next: ChatMode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore persistence failures — mode still applies for this session
    }
  }, [])

  const value = useMemo<ChatModeContextValue>(
    () => ({
      mode,
      setMode,
      toggleMode: () => setMode(mode === 'voice' ? 'text' : 'voice'),
    }),
    [mode, setMode],
  )

  return <ChatModeContext.Provider value={value}>{children}</ChatModeContext.Provider>
}

export function useChatMode(): ChatModeContextValue {
  const ctx = useContext(ChatModeContext)
  if (!ctx) throw new Error('useChatMode must be used within ChatModeProvider')
  return ctx
}
