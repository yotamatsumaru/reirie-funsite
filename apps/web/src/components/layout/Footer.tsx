export function Footer() {
  return (
    <footer className="mt-12 border-t-2 border-black bg-black text-white/70 sm:mt-16">
      <div className="mx-auto max-w-5xl px-4 py-8 text-sm sm:px-8 sm:py-10 safe-bottom">
        <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
          <div>
            <p className="text-lg font-black uppercase tracking-wide text-white">ReiRieRoom</p>
            <p className="mt-1 text-xs text-white/55">
              © {new Date().getFullYear()} ReiRieRoom — REIRIE Official Fan Club
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold sm:text-sm">
            <a href="/terms" className="transition hover:text-twilight-rose">
              利用規約
            </a>
            <a href="/privacy" className="transition hover:text-twilight-rose">
              プライバシー
            </a>
            <a href="/tokushoho" className="transition hover:text-twilight-rose">
              特定商取引法
            </a>
            <a href="/contact" className="transition hover:text-twilight-rose">
              お問い合わせ
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
