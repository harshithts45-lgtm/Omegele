
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

type SignalType = 'ready' | 'offer' | 'answer' | 'ice' | 'leave'

type Signal = {
  type: SignalType
  from: string
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit
}

const turnUrls = (import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || '')
  .split(',')
  .map(url => url.trim())
  .filter(Boolean)

const iceServers: RTCIceServer[] = [{
  urls: 'stun:stun.l.google.com:19302'
}]

if (turnUrls.length > 0) {
  iceServers.push({
    // Configure UDP, TCP and TLS TURN URLs in VITE_TURN_URLS. Browsers try
    // them in order when a direct peer-to-peer route is unavailable.
    urls: turnUrls,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL
  })
}

const transportPolicy: RTCIceTransportPolicy =
  import.meta.env.VITE_ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all'

export function useWebRTC(
  localStream: MediaStream | null,
  selfId: string
) {
  const peer = useRef<RTCPeerConnection | null>(null)
  const channel = useRef<RealtimeChannel | null>(null)

  const pendingCandidates = useRef<RTCIceCandidateInit[]>([])
  const offerCreated = useRef(false)
  const readyReplySent = useRef(false)
  const closed = useRef(false)

  const [remoteStream, setRemoteStream] =
    useState<MediaStream | null>(null)

  const [state, setState] =
    useState<RTCPeerConnectionState>('new')

  const send = useCallback(async (message: Signal) => {
    const currentChannel = channel.current
    if (!currentChannel) {
      console.warn('[RTC] Cannot send: channel unavailable', message.type)
      return
    }

    try {
      const result = await currentChannel.send({
        type: 'broadcast',
        event: 'signal',
        payload: message
      })

      console.log('[RTC] Sent:', message.type, 'Result:', result)

      if (result !== 'ok') {
        console.error('[RTC] Broadcast failed:', result)
      }
    } catch (error) {
      console.error('[RTC] Send error:', error)
    }
  }, [])

  const flushCandidates = useCallback(async (
    pc: RTCPeerConnection
  ) => {
    if (!pc.remoteDescription) return

    const candidates = [...pendingCandidates.current]
    pendingCandidates.current = []

    for (const candidate of candidates) {
      await pc.addIceCandidate(candidate)
    }
  }, [])

  const close = useCallback(async () => {
    if (closed.current) return

    closed.current = true

    await send({ type: 'leave', from: selfId })

    peer.current?.close()
    peer.current = null

    if (channel.current) {
      await channel.current.unsubscribe()
      channel.current = null
    }

    pendingCandidates.current = []
    offerCreated.current = false
    readyReplySent.current = false

    setRemoteStream(null)
    setState('closed')
  }, [send, selfId])

  const connect = useCallback(async (
    roomId: string,
    initiator: boolean
  ) => {
    if (!supabase || !localStream || !selfId) {
      throw new Error('Supabase or camera stream unavailable')
    }

    if (peer.current) peer.current.close()

    if (channel.current) {
      await channel.current.unsubscribe()
    }

    closed.current = false
    offerCreated.current = false
    readyReplySent.current = false
    pendingCandidates.current = []

    setRemoteStream(null)
    setState('new')

    console.log('[RTC] Connecting:', { roomId, initiator, selfId })

    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: transportPolicy
    })
    peer.current = pc

    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream)
    })

    pc.ontrack = event => {
      console.log('[RTC] Remote track received:', event.track.kind)
      if (event.streams[0]) {
        setRemoteStream(event.streams[0])
      }
    }

    pc.onconnectionstatechange = () => {
      console.log('[RTC] Connection state:', pc.connectionState)
      setState(pc.connectionState)

      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        setRemoteStream(null)
      }
    }

    pc.oniceconnectionstatechange = () => {
      console.log('[RTC] ICE state:', pc.iceConnectionState)
    }

    pc.onicecandidateerror = event => {
      // A 701 error means the browser could not reach the STUN/TURN server.
      // Do not surface TURN credentials; the URL and error code are sufficient
      // for diagnosing a failed relay in browser DevTools.
      console.error('[RTC] ICE server error:', {
        url: event.url,
        errorCode: event.errorCode,
        errorText: event.errorText
      })
    }

    pc.onicecandidate = event => {
      if (event.candidate) {
        const type = event.candidate.type || 'unknown'
        console.log('[RTC] Local ICE candidate:', type)
        void send({
          type: 'ice',
          from: selfId,
          payload: event.candidate.toJSON()
        })
      } else {
        console.log('[RTC] ICE gathering completed')
      }
    }

    const room = supabase.channel(`chat:${roomId}`, {
      config: {
        private: true,
        broadcast: { self: false }
      }
    })

    channel.current = room

    const createOffer = async () => {
      if (
        !initiator ||
        offerCreated.current ||
        pc.signalingState !== 'stable'
      ) return

      offerCreated.current = true

      try {
        console.log('[RTC] Creating offer')

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        await send({
          type: 'offer',
          from: selfId,
          payload: offer
        })
      } catch (error) {
        offerCreated.current = false
        console.error('[RTC] Offer failed:', error)
        setState('failed')
      }
    }

    room.on(
      'broadcast',
      { event: 'signal' },
      async ({ payload }: { payload: Signal }) => {
        if (
          payload.from === selfId ||
          peer.current !== pc ||
          closed.current
        ) return

        console.log('[RTC] Received:', payload.type)

        try {
          switch (payload.type) {
            case 'ready':
              // Reply once so a late-subscribing initiator
              // cannot miss the other participant's readiness.
              if (!readyReplySent.current) {
                readyReplySent.current = true
                if (!initiator) {
                  await send({ type: 'ready', from: selfId })
                }
              }

              await createOffer()
              break

            case 'offer': {
              if (!payload.payload) return

              await pc.setRemoteDescription(
                payload.payload as RTCSessionDescriptionInit
              )

              await flushCandidates(pc)

              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)

              await send({
                type: 'answer',
                from: selfId,
                payload: answer
              })
              break
            }

            case 'answer':
              if (!payload.payload) return

              await pc.setRemoteDescription(
                payload.payload as RTCSessionDescriptionInit
              )

              await flushCandidates(pc)
              break

            case 'ice': {
              if (!payload.payload) return

              const candidate =
                payload.payload as RTCIceCandidateInit

              if (pc.remoteDescription) {
                await pc.addIceCandidate(candidate)
              } else {
                pendingCandidates.current.push(candidate)
              }
              break
            }

            case 'leave':
              closed.current = true
              pc.close()
              peer.current = null

              if (channel.current === room) {
                channel.current = null
                await room.unsubscribe()
              }

              pendingCandidates.current = []
              setRemoteStream(null)
              setState('closed')
              break
          }
        } catch (error) {
          console.error('[RTC] Signaling handler failed:', error)
          setState('failed')
        }
      }
    )

  room.subscribe(async (status, err) => {
  console.log('[RTC] Channel status:', status)

  if (err) {
    console.error('[RTC] Channel error details:', err)
  }

  if (status === 'SUBSCRIBED') {
    console.log('[RTC] Channel subscribed:', roomId)

    await send({
      type: 'ready',
      from: selfId
    })
  }

  if (
    status === 'CHANNEL_ERROR' ||
    status === 'TIMED_OUT' ||
    status === 'CLOSED'
  ) {
    console.error('[RTC] Channel subscription failed:', {
      status,
      error: err,
      roomId
    })

    setState('failed')
  }
})
  }, [localStream, selfId, send, flushCandidates])

  useEffect(() => {
    return () => {
      const pc = peer.current
      const room = channel.current

      peer.current = null
      channel.current = null

      pc?.close()

      if (room) void room.unsubscribe()
    }
  }, [])

  return { remoteStream, state, connect, close }
}
