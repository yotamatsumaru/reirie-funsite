export function Footer() {
  return (
    <footer className="mt-12 border-t border-slate-200 bg-white sm:mt-16">
      <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-500 sm:py-8 safe-bottom">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <p className="text-xs sm:text-sm">© {new Date().getFullYear()} IDOL FAN SITE</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-xs sm:text-sm">
            <a href="/terms" className="hover:text-brand-600">
              利用規約
            </a>
            <a href="/privacy" className="hover:text-brand-600">
              プライバシー
            </a>
            <a href="/tokushoho" className="hover:text-brand-600">
              特定商取引法
            </a>
            <a href="/contact" className="hover:text-brand-600">
              お問い合わせ
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
