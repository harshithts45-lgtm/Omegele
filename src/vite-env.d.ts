/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TURN_URL?: string
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
  readonly VITE_ICE_TRANSPORT_POLICY?: 'all' | 'relay'
}
