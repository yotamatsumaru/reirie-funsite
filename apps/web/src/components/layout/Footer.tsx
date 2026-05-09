export function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-500">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <p>© {new Date().getFullYear()} IDOL FAN SITE</p>
          <nav className="flex gap-4">
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
