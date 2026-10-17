import { useState } from 'react'

export interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

let toastId = 0
let listeners: Set<(toasts: Toast[]) => void> = new Set()
let toasts: Toast[] = []

function notify() {
  listeners.forEach(l => l([...toasts]))
}

export function toast(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const id = ++toastId
  toasts = [...toasts, { id, message, type }]
  notify()
  setTimeout(() => {
    toasts = toasts.filter(t => t.id !== id)
    notify()
  }, 4000)
  return id
}

import React from 'react'

export function useToast() {
  const [, forceUpdate] = React.useState({})
  const [currentToasts, setCurrentToasts] = React.useState<Toast[]>(toasts)

  React.useEffect(() => {
    const listener = (newToasts: Toast[]) => {
      setCurrentToasts(newToasts)
      forceUpdate({})
    }
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  return { toasts: currentToasts, toast }
}

export default function ToastContainer() {
  const { toasts } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg glass anim-slide-up pointer-events-auto ${
            t.type === 'success' ? 'border-l-4 border-[var(--success)]' :
            t.type === 'error' ? 'border-l-4 border-[var(--danger)]' :
            'border-l-4 border-[var(--accent)]'
          }`}
        >
          <span className="text-sm">{t.message}</span>
        </div>
      ))}
    </div>
  )
}