/** Opened from the Home Screen icon (installed) rather than a Safari tab. */
const installed =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function App() {
  return (
    <main className="welcome">
      <img src="/apple-touch-icon.png" alt="" />
      <h1>Entrelinhas</h1>
      <p>Leia livros no original e entenda cada frase.</p>
      {installed ? (
        <p className="card">Instalado! Os livros e o vocabulário chegam nos próximos passos.</p>
      ) : (
        <p className="card">
          Para instalar no iPhone, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.
        </p>
      )}
    </main>
  );
}
