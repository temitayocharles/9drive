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
type CaptchaWaiter = { resolve: (token: string) => void; reject: (error: Error) => void; timer: number }

const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim()
const captchaLoadError = 'Captcha could not load. If you block Google scripts, allow them for this site and try again.'

declare global {
  interface Window {
    grecaptcha?: {
      render?: (element: HTMLElement, options: {
        sitekey: string
        size: 'invisible'
        badge: 'bottomright'
        callback: (token: string) => void
        'expired-callback': () => void
        'error-callback': () => void
      }) => number
      execute?: (widgetId?: number) => Promise<string> | void
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
  const captchaWaiterRef = useRef<CaptchaWaiter | null>(null)

  function resolveCaptcha(token: string) {
    setCaptchaToken(token)
    setCaptchaError('')
    const waiter = captchaWaiterRef.current
    if (waiter) {
      window.clearTimeout(waiter.timer)
      captchaWaiterRef.current = null
      waiter.resolve(token)
    }
  }

  function rejectCaptcha(message: string) {
    const captchaFailure = new Error(message)
    setCaptchaToken('')
    setCaptchaError(message)
    const waiter = captchaWaiterRef.current
    if (waiter) {
      window.clearTimeout(waiter.timer)
      captchaWaiterRef.current = null
      waiter.reject(captchaFailure)
    }
  }

  useEffect(() => {
    if (!recaptchaSiteKey) {
      setCaptchaError('Registration captcha is not configured. Please try again later.')
      return
    }

    const scriptId = 'google-recaptcha-script'
    let retryTimer: number | undefined
    let attempts = 0

    const renderCaptcha = () => {
      if (recaptchaWidgetId.current !== null) return true
      if (!recaptchaRef.current || typeof window.grecaptcha?.render !== 'function') return false
      try {
        recaptchaWidgetId.current = window.grecaptcha.render(recaptchaRef.current, {
          sitekey: recaptchaSiteKey,
          size: 'invisible',
          badge: 'bottomright',
          callback: resolveCaptcha,
          'expired-callback': () => setCaptchaToken(''),
          'error-callback': () => rejectCaptcha(captchaLoadError),
        })
        setCaptchaError('')
        return true
      } catch {
        return false
      }
    }

    const tryRender = () => {
      if (renderCaptcha()) return
      attempts += 1
      if (attempts >= 100) {
        setCaptchaError(captchaLoadError)
        return
      }
      retryTimer = window.setTimeout(tryRender, 100)
    }

    let script = document.getElementById(scriptId) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = scriptId
      script.src = 'https://www.google.com/recaptcha/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.onload = tryRender
      script.onerror = () => setCaptchaError(captchaLoadError)
      document.body.appendChild(script)
    } else {
      tryRender()
    }

    return () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      if (captchaWaiterRef.current) {
        window.clearTimeout(captchaWaiterRef.current.timer)
        captchaWaiterRef.current = null
      }
    }
  }, [])

  async function getCaptchaToken() {
    if (captchaToken) return captchaToken
    const widgetId = recaptchaWidgetId.current
    if (widgetId === null || typeof window.grecaptcha?.execute !== 'function') {
      throw new Error('Captcha is still loading. Please wait a moment and try again.')
    }

    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (captchaWaiterRef.current?.timer !== timer) return
        captchaWaiterRef.current = null
        reject(new Error(captchaLoadError))
      }, 30_000)
      captchaWaiterRef.current = { resolve, reject, timer }

      try {
        const result = window.grecaptcha!.execute!(widgetId)
        if (result && typeof result.then === 'function') {
          result.then((token) => {
            if (token && captchaWaiterRef.current?.timer === timer) resolveCaptcha(token)
          }).catch(() => {
            if (captchaWaiterRef.current?.timer === timer) rejectCaptcha(captchaLoadError)
          })
        }
      } catch {
        rejectCaptcha(captchaLoadError)
      }
    })
  }

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

    try {
      const token = recaptchaSiteKey ? await getCaptchaToken() : ''
      const data = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify({ name, email, password, captchaToken: token }),
      })
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
          <div ref={recaptchaRef} />
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
