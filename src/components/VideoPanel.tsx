import { VideoOff, LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
type Props = { stream: MediaStream | null; label: string; searching?: boolean; muted?: boolean }
export function VideoPanel({ stream, label, searching, muted }: Props) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return <section className="video-panel"><video ref={ref} autoPlay playsInline muted={muted} />
    {!stream && <div className="video-empty">{searching ? <><LoaderCircle className="spin" size={32}/><span>Finding someone new…</span></> : <><VideoOff size={32}/><span>{label === 'You' ? 'Your camera will appear here' : 'Waiting for a stranger'}</span></>}</div>}
    <span className="video-label"><i />{label}</span>
  </section>
}
