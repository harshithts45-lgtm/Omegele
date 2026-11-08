import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { countries, type Country } from '../lib/countries'
export function CountrySelector({ value, onChange, disabled }: { value: string; onChange: (c: Country) => void; disabled?: boolean }) {
  const [query, setQuery] = useState(''); const items = useMemo(() => countries.filter(c => c.name.toLowerCase().includes(query.toLowerCase())), [query])
  return <label className="country-select"><span>Match preference</span><div className="search"><Search size={16}/><input disabled={disabled} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a country" /></div><div className="country-list">{items.map(c => <button disabled={disabled} className={value === c.code ? 'selected' : ''} key={c.code} onClick={() => onChange(c)}><span>{c.flag}</span>{c.name}{value === c.code && <b>Selected</b>}</button>)}</div></label>
}
