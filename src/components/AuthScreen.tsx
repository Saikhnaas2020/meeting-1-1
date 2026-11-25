"use client"

import { useState } from "react"
import { ArrowRight, LoaderCircle, MessageCircleHeart, ShieldCheck } from "lucide-react"

const DEMO = [
  { email: "employee@my11.demo", label: "Ажилтан — А. Энхжин" },
  { email: "manager@my11.demo", label: "Удирдлага — Б. Болд" },
  { email: "hr@my11.demo", label: "HR — С. Сарантуяа" },
]

export default function AuthScreen({ showDemo }: { showDemo: boolean }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Нэвтрэх үед алдаа гарлаа.")
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Нэвтрэх үед алдаа гарлаа.")
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <form className="auth-card page-enter" onSubmit={submit}>
        <span className="brand auth-brand">
          <span className="brand-mark">
            <MessageCircleHeart size={20} strokeWidth={2.3} />
          </span>
          <span>My 1:1</span>
        </span>
        <h1>Тавтай морил</h1>
        <p className="auth-sub">Ажлын и-мэйл хаягаараа нэвтэрнэ үү.</p>
        <label className="field-label" htmlFor="email">И-мэйл</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="field-label" htmlFor="password">Нууц үг</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button wide" type="submit" disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={18} /> : null} Нэвтрэх <ArrowRight size={17} />
        </button>
        {showDemo && (
          <div className="demo-accounts">
            <p>Туршилтын хэрэглэгчид (нууц үг: <code>Demo!2026</code>)</p>
            {DEMO.map((d) => (
              <button type="button" key={d.email} onClick={() => setEmail(d.email)}>
                {d.label}
                <small>{d.email}</small>
              </button>
            ))}
          </div>
        )}
        <p className="recipient-privacy">
          <ShieldCheck size={14} /> Таны хувийн тэмдэглэл зөвхөн танд харагдана.
        </p>
      </form>
    </div>
  )
}
