import { useState } from 'react'
import { supabase } from '../lib/supabase'
export function ReportDialog({ reported, reporter, close }: { reported: string; reporter: string; close: () => void }) {
 const [reason, setReason] = useState('Inappropriate behavior'); const [sent, setSent] = useState(false)
 const submit = async () => { if (!supabase) return; const { error } = await supabase.from('reports').insert({ reporter_session: reporter, reported_session: reported, reason }); if (!error) setSent(true) }
 return <div className="dialog-backdrop"><div className="dialog"><h2>Report participant</h2>{sent ? <p>Your report was sent to the moderation queue. You can now safely leave or find a new chat.</p> : <><p>Reports are reviewed to help keep Random Connect safe.</p><select value={reason} onChange={e => setReason(e.target.value)}><option>Inappropriate behavior</option><option>Harassment or bullying</option><option>Explicit content</option><option>Spam or scam</option></select><button className="danger" onClick={submit}>Send report</button></>}<button className="text-btn" onClick={close}>Close</button></div></div>
}
