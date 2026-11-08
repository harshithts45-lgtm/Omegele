
import { supabase } from './supabase'

export async function createAnonymousSession(): Promise<string> {
  if (!supabase) {
    throw new Error('Supabase is not configured')
  }

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession()

  if (sessionError) throw sessionError

  if (sessionData.session?.user) {
    return sessionData.session.user.id
  }

  const { data, error } =
    await supabase.auth.signInAnonymously()

  if (error) throw error

  if (!data.user) {
    throw new Error('Anonymous authentication returned no user')
  }

  return data.user.id
}
