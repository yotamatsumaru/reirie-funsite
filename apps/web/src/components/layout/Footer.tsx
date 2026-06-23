export function Footer() {
  return (
    <footer className="mt-12 border-t border-white/15 bg-twilight-plum text-twilight-cream/70 sm:mt-16">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm sm:py-10 safe-bottom">
        <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
          <div>
            <p className="font-serif text-lg tracking-wide text-twilight-cream">ReiRieRoom</p>
            <p className="mt-1 text-xs text-twilight-cream/55">
              © {new Date().getFullYear()} ReiRieRoom — REIRIE Official Fan Club
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs sm:text-sm">
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
