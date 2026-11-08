import { useCallback, useEffect, useState } from 'react'

export function useMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const start = useCallback(async () => {
    if (stream) return stream
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
      setStream(next); setError(null); return next
    } catch (e) { setError(e instanceof Error ? e.message : 'Camera and microphone permission was not granted.'); return null }
  }, [stream])
  const stop = useCallback(() => { stream?.getTracks().forEach(track => track.stop()); setStream(null); setCameraOn(true); setMicOn(true) }, [stream])
  const toggleCamera = () => { stream?.getVideoTracks().forEach(t => { t.enabled = !t.enabled }); setCameraOn(v => !v) }
  const toggleMic = () => { stream?.getAudioTracks().forEach(t => { t.enabled = !t.enabled }); setMicOn(v => !v) }
  useEffect(() => () => stream?.getTracks().forEach(track => track.stop()), [stream])
  return { stream, error, start, stop, cameraOn, micOn, toggleCamera, toggleMic }
}
