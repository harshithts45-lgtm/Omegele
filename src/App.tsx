
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleHelp, Flag, Mic, MicOff, PhoneOff,
  ShieldCheck, SkipForward, Video, VideoOff
} from 'lucide-react'

import { CountrySelector } from './components/CountrySelector'
import { ReportDialog } from './components/ReportDialog'
import { VideoPanel } from './components/VideoPanel'
import { countries } from './lib/countries'
import { createAnonymousSession } from './lib/anonymousSession'

import { useMatchmaking, type Match } from './hooks/useMatchmaking'
import { useMedia } from './hooks/useMedia'
import { useWebRTC } from './hooks/useWebRTC'

export default function App() {
  const [sessionId, setSessionId] = useState('')
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [country, setCountry] = useState('WW')
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [partner, setPartner] = useState<Match | null>(null)
  const [reporting, setReporting] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const connectingRef = useRef<string | null>(null)

  // Initialize anonymous authentication
  useEffect(() => {
    let active = true

    createAnonymousSession()
      .then(id => {
        if (active) setSessionId(id)
      })
      .catch(error => {
        if (active) {
          setAuthError(
            error instanceof Error
              ? error.message
              : 'Authentication failed'
          )
        }
      })
      .finally(() => {
        if (active) setAuthLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // Hooks remain unconditional
  const media = useMedia()
  const queue = useMatchmaking(sessionId)
  const rtc = useWebRTC(media.stream, sessionId)

  const countryName = useMemo(
    () => countries.find(c => c.code === country)?.name ?? 'Worldwide',
    [country]
  )

  // Connect automatically when polling discovers a participant
  useEffect(() => {
    const match = queue.match

    if (!match || connectingRef.current === match.chat_session_id) {
      return
    }

    connectingRef.current = match.chat_session_id

    setPartner(match)
    setElapsed(0)

    rtc.connect(
      match.chat_session_id,
      match.initiator
    ).catch(async error => {
      console.error('WebRTC connection failed:', error)

      setPartner(null)
      connectingRef.current = null

      await rtc.close()
      await queue.leave()
    })
  }, [queue.match, rtc.connect, rtc.close, queue.leave])

  // Conversation timer
  useEffect(() => {
    if (!partner || rtc.state !== 'connected') return

    const id = window.setInterval(
      () => setElapsed(s => s + 1),
      1000
    )

    return () => window.clearInterval(id)
  }, [partner, rtc.state])

  const start = async () => {
    if (!sessionId || !ageConfirmed) return

    try {
      const stream = await media.start()

      if (!stream) return

      setPartner(null)
      setElapsed(0)
      connectingRef.current = null

      // WW in UI maps to ALL in database
      const selectedCountry = country === 'WW' ? 'ALL' : country

      await queue.join(selectedCountry)
    } catch (error) {
      console.error('Matchmaking failed:', error)
    }
  }

  const next = async () => {
    try {
      connectingRef.current = null
      await rtc.close()

      setPartner(null)
      setElapsed(0)

      await queue.leave()

      // Keep camera active and find another participant
      await start()
    } catch (error) {
      console.error('Next participant failed:', error)
    }
  }

  const stop = async () => {
    connectingRef.current = null

    try {
      await rtc.close()
      await queue.leave()
    } catch (error) {
      console.error('Stopping chat failed:', error)
    } finally {
      setPartner(null)
      setElapsed(0)
      media.stop()
    }
  }

  const timer =
    `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:` +
    `${String(elapsed % 60).padStart(2, '0')}`

  const isSearching = queue.status === 'searching'
  const isConnected = rtc.state === 'connected'

  return (
    <main>
      <header>
        <div className="brand">
          <span className="brand-mark">
            <Video size={18} />
          </span>
          <span>Random Connect</span>
        </div>

        <div className="privacy">
          <ShieldCheck size={15} />
          Anonymous & private
        </div>

        <button className="icon-btn" aria-label="Help">
          <CircleHelp size={20} />
        </button>
      </header>

      {!ageConfirmed && (
        <div className="age-gate">
          <div>
            <ShieldCheck size={34} />
            <h1>18+ only</h1>
            <p>
              Random Connect is for adults. By continuing,
              you confirm you are at least 18 and agree
              to our community rules.
            </p>
            <button onClick={() => setAgeConfirmed(true)}>
              I am 18 or older
            </button>
          </div>
        </div>
      )}

      <section className="hero">
        <p className="eyebrow">ANONYMOUS VIDEO CHAT</p>
        <h1>
          A conversation is <em>one click</em> away.
        </h1>
        <p>
          Meet people around the world through private,
          spontaneous video conversations.
        </p>
      </section>

      <section className="video-grid">
        <VideoPanel
          stream={rtc.remoteStream}
          label="Stranger"
          searching={isSearching}
        />

        <VideoPanel
          stream={media.stream}
          label="You"
          muted
        />
      </section>

      <section className="control-card">
        <CountrySelector
          value={country}
          disabled={queue.status !== 'idle' && queue.status !== 'error'}
          onChange={c => setCountry(c.code)}
        />

        <div className="controls">
          <div className="connection">
            <span className={`status-dot ${queue.status}`} />

            <div>
              <strong>
                {partner
                  ? isConnected
                    ? 'Connected'
                    : 'Establishing video connection'
                  : isSearching
                    ? 'Searching for a match'
                    : queue.status === 'error'
                      ? 'Connection error'
                      : authLoading
                        ? 'Initializing anonymous session'
                        : 'Ready to connect'}
              </strong>

              <small>
                {partner
                  ? `${countryName} preference · ${timer}`
                  : authError || 'You stay anonymous'}
              </small>
            </div>
          </div>

          <div className="buttons">
            {queue.status === 'idle' || queue.status === 'error' ? (
              <button
                className="primary"
                onClick={start}
                disabled={!sessionId || !ageConfirmed || authLoading}
              >
                Start connecting
              </button>
            ) : (
              <button
                className="next"
                disabled={!partner || !isConnected}
                onClick={next}
              >
                <SkipForward size={18} />
                Next person
              </button>
            )}

            <button
              className="stop"
              disabled={!media.stream && queue.status === 'idle'}
              onClick={stop}
            >
              <PhoneOff size={18} />
              Stop chat
            </button>
          </div>
        </div>

        <div className="device-row">
          <button
            onClick={media.toggleCamera}
            disabled={!media.stream}
          >
            {media.cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
            {media.cameraOn ? 'Camera on' : 'Camera off'}
          </button>

          <button
            onClick={media.toggleMic}
            disabled={!media.stream}
          >
            {media.micOn ? <Mic size={18} /> : <MicOff size={18} />}
            {media.micOn ? 'Microphone on' : 'Microphone muted'}
          </button>

          {partner && (
            <button
              className="report"
              onClick={() => setReporting(true)}
            >
              <Flag size={17} />
              Report
            </button>
          )}
        </div>

        {media.error && (
          <p className="error">{media.error}</p>
        )}

        {authError && (
          <p className="error">{authError}</p>
        )}

        {queue.status === 'error' && (
          <p className="error">
            Matchmaking failed. Check your Supabase connection and try again.
          </p>
        )}

        <p className="safety">
          By connecting, you agree to be respectful.
          Leave immediately if a conversation feels unsafe.
        </p>
      </section>

      {reporting && partner && (
        <ReportDialog
          reported={partner.partner_session_id}
          reporter={sessionId}
          close={() => setReporting(false)}
        />
      )}
    </main>
  )
}
