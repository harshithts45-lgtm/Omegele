
import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type Match = {
  chat_session_id: string
  partner_session_id: string
  initiator: boolean
}

type MatchStatus = 'idle' | 'searching' | 'matched' | 'error'

export function useMatchmaking(sessionId: string) {
  const [status, setStatus] = useState<MatchStatus>('idle')
  const [match, setMatch] = useState<Match | null>(null)
  const timer = useRef<number | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearInterval(timer.current)
      timer.current = null
    }
  }

  const join = useCallback(async (
    countryCode: string
  ): Promise<Match | null> => {
    const client = supabase

    if (!client || !sessionId) {
      setStatus('error')
      throw new Error('Supabase or anonymous session is unavailable')
    }

    clearTimer()
    setMatch(null)
    setStatus('searching')

    const tryMatch = async (): Promise<Match | null> => {
      const { data, error } = await client.rpc(
        'join_matchmaking_queue',
        {
          p_session_id: sessionId,
          p_country_code: countryCode
        }
      )

      if (error) throw error

      const result = data as Match | null

      if (result) {
        clearTimer()
        setMatch(result)
        setStatus('matched')
      }

      return result
    }

    try {
      const first = await tryMatch()

      if (!first && timer.current === null) {
        timer.current = window.setInterval(() => {
          void tryMatch().catch(() => {
            clearTimer()
            setStatus('error')
          })
        }, 2500)
      }

      return first
    } catch (error) {
      clearTimer()
      setStatus('error')
      throw error
    }
  }, [sessionId])

  const leave = useCallback(async () => {
    clearTimer()
    setMatch(null)

    const client = supabase

    if (client && sessionId) {
      const { error } = await client.rpc(
        'leave_matchmaking_queue',
        { p_session_id: sessionId }
      )

      if (error) throw error
    }

    setStatus('idle')
  }, [sessionId])

  return {
    status,
    match,
    join,
    leave,
    setStatus
  }
}
