import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HardDrive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GoogleLogo } from '@/components/auth/GoogleLogo'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/api'
import { setAuthSession, type AuthUser } from '@/lib/auth'

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser }
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim()
const captchaLoadError = 'Captcha could not load. If you block Google scripts, allow them for this site and try again.'

declare global {
  interface Window {
    grecaptcha?: {
      render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void }) => number
      reset: (widgetId?: number) => void
    }
  }
}

export function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaError, setCaptchaError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const recaptchaRef = useRef<HTMLDivElement | null>(null)
  const recaptchaWidgetId = useRef<number | null>(null)

  useEffect(() => {
    if (!recaptchaSiteKey) {
      setCaptchaError('Registration captcha is not configured. Please try again later.')
      return
    }

    const scriptId = 'google-recaptcha-script'
    const renderCaptcha = () => {
      if (!recaptchaRef.current || !window.grecaptcha || recaptchaWidgetId.current !== null) return
      try {
        recaptchaWidgetId.current = window.grecaptcha.render(recaptchaRef.current, {
          sitekey: recaptchaSiteKey,
          callback: (token) => {
            setCaptchaToken(token)
            setCaptchaError('')
          },
          'expired-callback': () => setCaptchaToken(''),
        })
      } catch {
        setCaptchaError(captchaLoadError)
      }
    }

    let script = document.getElementById(scriptId) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = scriptId
      script.src = 'https://www.google.com/recaptcha/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.onload = renderCaptcha
      script.onerror = () => setCaptchaError(captchaLoadError)
      document.body.appendChild(script)
    } else {
      renderCaptcha()
    }

    const timer = window.setTimeout(() => {
      if (recaptchaWidgetId.current === null) setCaptchaError(captchaLoadError)
    }, 10_000)

    return () => window.clearTimeout(timer)
  }, [])

  async function continueWithGoogle() {
    setGoogleLoading(true)
    setError('')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 30_000)
    try {
      const data = await apiFetch<{ url: string }>('/auth/google/url', { skipAuth: true, signal: controller.signal })
      window.location.assign(data.url)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Google sign-in took too long to start. Please try again.')
      } else {
        setError(err instanceof Error ? err.message : 'Google register failed')
      }
    } finally {
      window.clearTimeout(timeout)
      setGoogleLoading(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    if (captchaError) {
      setError(captchaError)
      setLoading(false)
      return
    }
    if (recaptchaSiteKey && !captchaToken) {
      setError('Please complete the captcha.')
      setLoading(false)
      return
    }
    try {
      const data = await apiFetch<AuthResponse>('/auth/register', { method: 'POST', skipAuth: true, body: JSON.stringify({ name, email, password, captchaToken }) })
      setAuthSession(data.accessToken, data.refreshToken, data.user)
      navigate('/all-files')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Register failed')
      if (recaptchaWidgetId.current !== null) window.grecaptcha?.reset(recaptchaWidgetId.current)
      setCaptchaToken('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-5">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"><HardDrive className="h-6 w-6" /></div>
          <div><h1 className="text-2xl font-extrabold">Register</h1><p className="text-sm text-slate-500">Create your storage gateway account.</p></div>
        </div>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-semibold">Name<Input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label className="grid gap-2 text-sm font-semibold">Email<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="grid gap-2 text-sm font-semibold">Password<Input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <div className="min-h-[78px] overflow-hidden rounded-xl bg-slate-50 p-2"><div ref={recaptchaRef} /></div>
          {captchaError ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="alert">{captchaError}</p> : null}
          {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600" role="alert">{error}</p> : null}
          <Button disabled={loading || Boolean(captchaError)}>{loading ? 'Creating...' : 'Create Account'}</Button>
        </form>
        <div className="mt-4 grid gap-3">
          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
          <Button variant="outline" disabled={googleLoading} onClick={continueWithGoogle}><GoogleLogo />{googleLoading ? 'Redirecting...' : 'Continue with Google and connect Drive'}</Button>
        </div>
        <p className="mt-5 text-center text-sm text-slate-500">Already registered? <Link className="font-bold text-blue-600" to="/login">Login</Link></p>
      </Card>
    </main>
  )
}
